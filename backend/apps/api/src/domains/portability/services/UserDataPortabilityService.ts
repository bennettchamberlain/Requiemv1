import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { FileService } from '@ci/domains/files';
import { UserService } from '@ci/domains/user';

import type {
  FileBlobSnapshot,
  ImportResult,
  UserDataArchive,
  UserProfileSnapshot,
  UserScopedTable,
} from '../types';
import {
  DISCOVER_USER_TABLES_SQL,
  USER_DATA_SCHEMAS,
  isExcluded,
  qualifiedName,
} from '../userDataTables';

const ARCHIVE_VERSION = 1 as const;
const INSERT_CHUNK_SIZE = 200;

@Injectable()
export class UserDataPortabilityService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly fileService: FileService,
    private readonly userService: UserService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(UserDataPortabilityService.name);
  }

  async exportArchive(context: UserServiceContext): Promise<UserDataArchive> {
    const tables = await this.discoverUserTables();
    const tableData: Record<string, Record<string, unknown>[]> = {};

    for (const table of tables) {
      const rows = await this.selectUserRows(context.userId, table);
      tableData[qualifiedName(table)] = rows.map((row) => this.serializeRow(row));
    }

    const profile = await this.exportProfile(context);
    const fileBlobs = await this.exportFileBlobs(context, tableData['ci.files'] ?? []);

    return {
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      userId: context.userId,
      profile,
      tables: tableData,
      fileBlobs,
    };
  }

  async importArchive(context: UserServiceContext, archive: UserDataArchive): Promise<ImportResult> {
    this.validateArchive(context, archive);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let rowsImported = 0;
    let filesRestored = 0;

    try {
      await this.setReplicationRole(queryRunner, 'replica');

      const tables = await this.discoverUserTables();
      for (const table of [...tables].reverse()) {
        await this.deleteUserRows(queryRunner, context.userId, table);
      }

      for (const table of tables) {
        const rows = archive.tables[qualifiedName(table)] ?? [];
        rowsImported += await this.insertUserRows(queryRunner, context.userId, table, rows);
      }

      filesRestored = await this.restoreFileBlobs(context, archive.fileBlobs);

      await this.setReplicationRole(queryRunner, 'origin');
      await queryRunner.commitTransaction();
    } catch (error) {
      await this.setReplicationRole(queryRunner, 'origin').catch(() => undefined);
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return {
      tablesImported: Object.keys(archive.tables).length,
      rowsImported,
      filesRestored,
    };
  }

  private validateArchive(context: UserServiceContext, archive: UserDataArchive): void {
    if (archive.version !== ARCHIVE_VERSION) {
      throw new BadRequestException(`Unsupported archive version: ${archive.version}`);
    }

    if (archive.userId !== context.userId) {
      throw new BadRequestException('This archive belongs to a different account');
    }

    if (!archive.tables || typeof archive.tables !== 'object') {
      throw new BadRequestException('Archive is missing table data');
    }
  }

  private async discoverUserTables(): Promise<UserScopedTable[]> {
    const discovered = (await this.dataSource.query(DISCOVER_USER_TABLES_SQL, [
      USER_DATA_SCHEMAS,
    ])) as Array<{ schema: string; table: string; user_column: string }>;

    return discovered
      .filter((row) => !isExcluded(row))
      .map((row) => ({
        schema: row.schema,
        table: row.table,
        userColumn: row.user_column as UserScopedTable['userColumn'],
      }));
  }

  private async exportProfile(context: UserServiceContext): Promise<UserProfileSnapshot | null> {
    const user = await this.userService.findById(context, context.userId);

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      entityId: user.entityId ?? null,
      onboarded: user.onboarded,
      onboardedAt: user.onboardedAt?.toISOString() ?? null,
      timezone: user.timezone,
      onboardingProgress: (user.onboardingProgress as Record<string, unknown> | null) ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private async selectUserRows(
    userId: string,
    table: UserScopedTable,
  ): Promise<Record<string, unknown>[]> {
    return this.dataSource.query(
      `SELECT * FROM "${table.schema}"."${table.table}" WHERE ${table.userColumn} = $1`,
      [userId],
    );
  }

  private async deleteUserRows(
    queryRunner: QueryRunner,
    userId: string,
    table: UserScopedTable,
  ): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "${table.schema}"."${table.table}" WHERE ${table.userColumn} = $1`,
      [userId],
    );
  }

  private async insertUserRows(
    queryRunner: QueryRunner,
    userId: string,
    table: UserScopedTable,
    rows: Record<string, unknown>[],
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    let inserted = 0;

    for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);

      for (const row of chunk) {
        const normalized = this.normalizeImportRow(row, userId, table.userColumn);
        const columns = Object.keys(normalized);
        const values = Object.values(normalized);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const columnList = columns.map((column) => `"${column}"`).join(', ');

        await queryRunner.query(
          `INSERT INTO "${table.schema}"."${table.table}" (${columnList}) VALUES (${placeholders})`,
          values,
        );
        inserted += 1;
      }
    }

    return inserted;
  }

  private normalizeImportRow(
    row: Record<string, unknown>,
    userId: string,
    userColumn: UserScopedTable['userColumn'],
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...row, [userColumn]: userId };

    for (const [key, value] of Object.entries(normalized)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        normalized[key] = value;
      }
    }

    return normalized;
  }

  private serializeRow(row: Record<string, unknown>): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) {
        serialized[key] = value.toISOString();
      } else if (Buffer.isBuffer(value)) {
        serialized[key] = value.toString('base64');
      } else if (value !== undefined) {
        serialized[key] = value;
      }
    }

    return serialized;
  }

  private async exportFileBlobs(
    context: UserServiceContext,
    fileRows: Record<string, unknown>[],
  ): Promise<FileBlobSnapshot[]> {
    const blobs: FileBlobSnapshot[] = [];

    for (const row of fileRows) {
      const id = String(row.id ?? '');
      const bucket = String(row.bucket ?? '');
      const key = String(row.key ?? '');

      if (!id || !bucket || !key) {
        continue;
      }

      try {
        const content = await this.fileService.getFileContent(context, key);
        blobs.push({
          id,
          bucket,
          key,
          contentBase64: Buffer.from(content).toString('base64'),
        });
      } catch (error) {
        this.logger.warn('Skipped file blob during export', {
          fileId: id,
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return blobs;
  }

  private async restoreFileBlobs(
    context: UserServiceContext,
    blobs: FileBlobSnapshot[],
  ): Promise<number> {
    let restored = 0;

    for (const blob of blobs) {
      try {
        await this.fileService.putObject(context, blob.bucket, blob.key, Buffer.from(blob.contentBase64, 'base64'));
        restored += 1;
      } catch (error) {
        this.logger.warn('Skipped file blob during import', {
          fileId: blob.id,
          key: blob.key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return restored;
  }

  private async setReplicationRole(
    queryRunner: QueryRunner,
    role: 'replica' | 'origin',
  ): Promise<void> {
    try {
      await queryRunner.query(`SET session_replication_role = '${role}'`);
    } catch (error) {
      this.logger.debug('Could not set session_replication_role; continuing with FK order', {
        role,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
