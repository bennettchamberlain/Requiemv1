import { createHash } from 'crypto';
import { createReadStream, unlink } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'stream/promises';

import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';

import { SYSTEM_USER, type ServiceContext, type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';
import { EventService } from '@ci/domains/events';
import { FileUploadedEvent } from '@ci/domains/files/events';

import { SignedFile, FileEntity } from '../entities/FileEntity';
import type { CreateFileDto, FileQuery } from '../types';
import { FileVariant } from '../types';

const BUCKET_REGION = config.staticfiles.bucket ?? 'us-east-1';
const SIGNATURE_URL = config.staticfiles.auth.signatureUrl ?? config.staticfiles.storageUrl;

@Injectable()
export class FileService implements OnModuleInit {
  private s3 = new S3Client({
    endpoint: config.staticfiles.storageUrl,
    // Minio doesn't care about the region, but we're specifying this default just to make S3 happy. May not be needed.
    region: BUCKET_REGION,
    // This is so the client is forced to use http://localhost:9000/example-bucket instead of subdomains.
    // We don't want file paths resolving to http://example-bucket.localhost:9000.
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.staticfiles.auth.accessKeyId,
      secretAccessKey: config.staticfiles.auth.secretAccessKey,
    },
  });

  private signatureS3 = new S3Client({
    endpoint: SIGNATURE_URL,
    region: BUCKET_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.staticfiles.auth.accessKeyId,
      secretAccessKey: config.staticfiles.auth.secretAccessKey,
    },
  });

  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    private readonly eventService: EventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(FileService.name);
  }

  async onModuleInit() {
    try {
      await this.s3.send(
        new HeadBucketCommand({
          Bucket: config.staticfiles.bucket,
        }),
      );

      this.logger.debug('S3 bucket exists, skipping creation');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        this.logger.debug('S3 bucket does not exist, creating a new bucket');

        await this.s3.send(
          new CreateBucketCommand({
            Bucket: config.staticfiles.bucket,
          }),
        );
      } else {
        throw err;
      }
    }
  }

  async create(context: UserServiceContext, file: CreateFileDto): Promise<SignedFile> {
    const fileId = uuidv7();
    const fileKey = uuidv4();
    const bucket = config.staticfiles.bucket;

    const s3FilePath = `s3://${bucket}/${fileKey}`;
    const fileHash = await this.getFileHash(file);

    const entity = this.fileRepository.create({
      id: fileId,
      filePath: s3FilePath,
      filename: file.originalname,
      storageType: 'cloud', // S3/Minio is cloud storage
      storageProvider: 's3',
      modifiedAtSource: new Date(), // Upload time as modification time
      bucket,
      key: fileKey,
      originalName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      fileHash: fileHash,
      variant: file.variant ?? FileVariant.ORIGINAL,
      userId: context.userId,
      parentId: file.parentId ?? null,
    });

    const result = await this.fileRepository.save(entity);

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: result.bucket ?? config.staticfiles.bucket,
          Key: result.key!,
          Body: file.buffer ?? createReadStream(file.path),
          ContentType: result.contentType,
        }),
      );
    } finally {
      if (file.path) {
        unlink(file.path, (err) => {
          if (err) {
            this.logger.error(`Failed to delete temporary file ${file.path}`, err);
          }
        });
      }
    }

    return this.signFile(result);
  }

  async findAll(context: ServiceContext): Promise<SignedFile[]> {
    const result = await this.fileRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return this.signFiles(result);
  }

  async findById(context: ServiceContext, id: string): Promise<SignedFile> {
    const result = await this.fileRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    if (result == null) {
      throw new NotFoundException();
    }

    return this.signFile(result);
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<(SignedFile | null)[]> {
    if (ids.length === 0) {
      return [];
    }

    const entities = await this.fileRepository.find({
      where: {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    const signedFiles = await this.signFiles(entities);

    const map = new Map(signedFiles.map((file) => [file.id, file]));

    return ids.map((id) => map.get(id) ?? null);
  }

  async upload(context: UserServiceContext, file: Express.Multer.File): Promise<SignedFile> {
    const created = await this.create(context, file);

    await this.eventService.send(FileUploadedEvent, {
      fileId: created.id,
      userId: context.userId,
      inventoryCapture: false,
    });

    return created;
  }

  async getFileContent(context: ServiceContext, key: string): Promise<Uint8Array> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: config.staticfiles.bucket,
        Key: key,
      }),
    );

    if (response.Body) {
      return response.Body.transformToByteArray();
    }

    throw new Error(`S3 object body was empty for key: ${key}`);
  }

  async getFileStream(context: ServiceContext, key: string): Promise<Readable> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: config.staticfiles.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`S3 object body was empty for key: ${key}`);
    }

    // AWS SDK v3 SdkStream implements Symbol.asyncIterator, so we can
    // wrap it in a Node Readable without unsafe casts or web-stream mismatches.
    return Readable.from(response.Body as AsyncIterable<Uint8Array>);
  }

  async upsertExternal(
    context: UserServiceContext,
    input: {
      externalId: string;
      provider: string;
      filename: string;
      mimeType: string;
      url?: string | null;
      size?: number | string | null;
      modifiedAt?: string | Date | null;
      storageAccount?: string | null;
    },
  ): Promise<SignedFile> {
    const userId = context.userId;

    if (!userId) {
      throw new Error('User ID is required to store external files');
    }

    const provider = input.provider || 'external';
    const filePath = input.url ?? `external://${provider}/${input.externalId}`;
    const modifiedAt =
      input.modifiedAt instanceof Date
        ? input.modifiedAt
        : input.modifiedAt
          ? new Date(input.modifiedAt)
          : new Date();
    const rawSize =
      typeof input.size === 'string'
        ? Number.parseInt(input.size, 10)
        : typeof input.size === 'number'
          ? input.size
          : 0;
    const normalizedSize = Number.isFinite(rawSize) ? rawSize : 0;

    let entity = await this.fileRepository.findOne({
      where: {
        cloudFileId: input.externalId,
        userId,
      },
    });

    if (!entity) {
      entity = await this.fileRepository.findOne({
        where: {
          filePath: filePath,
          userId,
        },
      });
    }

    if (entity) {
      this.logger.debug('Updating external file metadata', {
        userId,
        provider,
        externalId: input.externalId,
        filePath,
      });
      entity.filename = input.filename;
      entity.originalName = input.filename;
      entity.contentType = input.mimeType;
      entity.size = normalizedSize;
      entity.modifiedAtSource = modifiedAt;
      entity.storageType = 'cloud';
      entity.storageProvider = provider;
      entity.cloudFileId = input.externalId;
      entity.storageAccount = input.storageAccount ?? entity.storageAccount ?? null;
      entity.bucket = null;
      entity.key = entity.key ?? uuidv7();
      entity.filePath = filePath;
    } else {
      this.logger.debug('Creating external file record', {
        userId,
        provider,
        externalId: input.externalId,
        filePath,
      });
      entity = this.fileRepository.create({
        id: uuidv7(),
        filePath: filePath,
        filename: input.filename,
        storageType: 'cloud',
        storageProvider: provider,
        cloudFileId: input.externalId,
        storageAccount: input.storageAccount ?? null,
        modifiedAtSource: modifiedAt,
        bucket: null,
        key: uuidv7(),
        originalName: input.filename,
        contentType: input.mimeType,
        size: normalizedSize,
        userId: userId,
      });
    }

    const saved = await this.fileRepository.save(entity);
    this.logger.debug('Upserted external file', { id: saved.id, userId, externalId: input.externalId });

    return this.signFile(saved);
  }

  async search(context: ServiceContext, query: FileQuery): Promise<FileEntity[]> {
    return this.fileRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
        ...query,
      },
    });
  }

  private async signFiles(files: FileEntity[]): Promise<SignedFile[]> {
    return Promise.all(files.map(this.signFile.bind(this)));
  }

  private async signFile(file: FileEntity): Promise<SignedFile> {
    const bucket = file.bucket;
    const key = file.key;

    if (!bucket || !key) {
      return {
        ...FileEntity.toEgressType(file),
        url: file.filePath,
      };
    }

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: file.contentType,
    });

    const url = await getSignedUrl(this.signatureS3, command, {
      expiresIn: config.staticfiles.auth.signatureTTL,
    });

    return {
      ...FileEntity.toEgressType(file),
      url: this.getKeyAndQuery(url),
    };
  }

  private getKeyAndQuery(url: string): string {
    const parsed = new URL(url);

    return parsed.pathname + parsed.search;
  }

  private async getFileHash(file: Express.Multer.File) {
    if (file.buffer) {
      return createHash('sha256').update(file.buffer).digest('hex');
    }

    if (file.path) {
      const hash = createHash('sha256');

      await pipeline(createReadStream(file.path), hash);

      return hash.digest('hex');
    }

    throw new Error('File has no readable contents, cannot compute hash');
  }
}
