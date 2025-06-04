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
import { Repository } from 'typeorm';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';

import { FileEntity } from '../entities/FileEntity';
import type { File } from '../types';

const BUCKET_NAME = 'companion';
const PRESIGN_EXPIRATION = 60;

@Injectable()
export class FileService implements OnModuleInit {
  private logger = new LoggerService(FileService.name);

  private s3 = new S3Client({
    endpoint: 'http://localhost:9000',
    // Minio doesn't care about the region, but we're specifying this default just to make S3 happy. May not be needed.
    region: 'us-east-1',
    // This is so the client is forced to use http://localhost:9000/example-bucket instead of subdomains.
    // We don't want file paths resolving to http://example-bucket.localhost:9000.
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    },
  });

  private signatureS3 = new S3Client({
    endpoint: 'http://minio:9000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    },
  });

  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
  ) {}

  async onModuleInit() {
    try {
      await this.s3.send(
        new HeadBucketCommand({
          Bucket: BUCKET_NAME,
        }),
      );

      this.logger.debug('S3 bucket exists, skipping creation');
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        this.logger.debug('S3 bucket does not exist, creating a new bucket');

        await this.s3.send(
          new CreateBucketCommand({
            Bucket: BUCKET_NAME,
          }),
        );
      } else {
        throw err;
      }
    }
  }

  async findAll(context: RequestContext): Promise<File[]> {
    const result = await this.fileRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
    });

    return result.map((entity) => entity.toFile());
  }

  async findOne(context: RequestContext, id: string): Promise<File> {
    const result = await this.fileRepository.findOne({
      where: {
        id,
        user: {
          id: context.userId,
        },
      },
    });

    if (result == null) {
      throw new NotFoundException();
    }

    return result.toFile();
  }

  async upload(context: RequestContext, file: Express.Multer.File): Promise<File> {
    const entity = this.fileRepository.create({
      id: uuidv7(),
      bucket: BUCKET_NAME,
      key: uuidv4(),
      original_name: file.originalname,
      content_type: file.mimetype,
      size: file.size,
      user: {
        id: context.userId,
      },
    });

    const result = await this.fileRepository.save(entity);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: result.bucket,
        Key: result.key,
        Body: file.buffer,
        ContentType: result.content_type,
      }),
    );

    return entity.toFile();
  }

  async generatePresignedLink(context: RequestContext, id: string): Promise<string> {
    const result = await this.fileRepository.findOne({
      where: {
        id,
        user: {
          id: context.userId,
        },
      },
    });

    if (result == null) {
      throw new NotFoundException();
    }

    const command = new GetObjectCommand({
      Bucket: result.bucket,
      Key: result.key,
      ResponseContentType: result.content_type,
    });

    const url = await getSignedUrl(this.signatureS3, command, {
      expiresIn: PRESIGN_EXPIRATION,
    });

    return this.getKeyAndQuery(url);
  }

  private getKeyAndQuery(url: string): string {
    const parsed = new URL(url);

    return parsed.pathname + parsed.search;
  }
}
