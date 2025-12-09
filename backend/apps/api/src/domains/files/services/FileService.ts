import { createHmac } from 'crypto';

import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, NotFoundException, NotImplementedException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import { SYSTEM_USER, type ServiceContext, UserServiceContext } from '@ci/common/types';
import { RequestContext } from '@ci/common/types';
import config from '@ci/configuration';
import { EventService } from '@ci/domains/events';
import { FileUploadedEvent } from '@ci/domains/files/events';

import { SignedFile, FileEntity } from '../entities/FileEntity';
import type { FileQuery, UpdateFileDto } from '../types';

const BUCKET_REGION = config.staticfiles.bucket ?? 'us-east-1';
const SIGNATURE_URL = config.staticfiles.auth.signatureUrl ?? config.staticfiles.storageUrl;

@Injectable()
export class FileService implements OnModuleInit {
  private logger = new LoggerService(FileService.name);

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
  ) {}

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

  async findAll(context: ServiceContext): Promise<SignedFile[]> {
    const result = await this.fileRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
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
          user: {
            id: context.userId,
          },
        }),
      },
    });

    if (result == null) {
      throw new NotFoundException();
    }

    return this.signFile(result);
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<SignedFile[]> {
    if (ids.length === 0) {
      return [];
    }

    const entities = await this.fileRepository.find({
      where: {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
    });

    return this.signFiles(entities);
  }

  async update(context: ServiceContext, id: string, data: UpdateFileDto): Promise<SignedFile | null> {
    const result = await this.fileRepository.update(
      {
        id,
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
      data,
    );

    if (result.affected === 0) {
      return null;
    }

    return this.findById(context, id);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async remove(context: ServiceContext, fileId: string): Promise<void> {
    throw new NotImplementedException();
  }

  async upload(context: UserServiceContext, file: Express.Multer.File): Promise<SignedFile> {
    const fileId = uuidv7();
    const fileKey = uuidv4();
    const bucket = config.staticfiles.bucket;

    // Construct S3 path for file_path (required field)
    const filePath = `s3://${bucket}/${fileKey}`;

    const entity = this.fileRepository.create({
      id: fileId,
      filePath: filePath,
      filename: file.originalname,
      storageType: 'cloud', // S3/Minio is cloud storage
      storageProvider: 's3',
      modifiedAtSource: new Date(), // Upload time as modification time
      bucket,
      key: fileKey,
      originalName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      fileHash: createHmac('sha256', config.auth.session.fieldPepper).update(file.buffer).digest('hex'),
      user: {
        id: context.userId,
      },
    });

    const result = await this.fileRepository.save(entity);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: result.bucket ?? config.staticfiles.bucket,
        Key: result.key!,
        Body: file.buffer,
        ContentType: result.contentType,
      }),
    );

    await this.eventService.send(FileUploadedEvent, {
      fileId: result.id,
      userId: context.userId,
    });

    return this.signFile(entity);
  }

  async getFileContent(context: RequestContext, key: string): Promise<Uint8Array> {
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

  async generatePresignedLink(context: ServiceContext, id: string): Promise<string> {
    const result = await this.fileRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
    });

    if (result == null) {
      throw new NotFoundException();
    }

    if (!result.bucket || !result.key) {
      return result.filePath;
    }

    const command = new GetObjectCommand({
      Bucket: result.bucket ?? config.staticfiles.bucket,
      Key: result.key!,
      ResponseContentType: result.contentType,
    });

    const url = await getSignedUrl(this.signatureS3, command, {
      expiresIn: config.staticfiles.auth.signatureTTL,
    });

    return this.getKeyAndQuery(url);
  }

  async upsertExternal(
    context: RequestContext,
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
        user: { id: userId },
      },
    });

    if (!entity) {
      entity = await this.fileRepository.findOne({
        where: {
          filePath: filePath,
          user: { id: userId },
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
        user: { id: userId },
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
          user: {
            id: context.userId,
          },
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
}
