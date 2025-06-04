import { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';

import { LoggerService } from '@ci/common/services';

const BUCKET_NAME = 'companion';

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

  async upload(buffer: Buffer | Readable, contentType?: string) {
    const key = uuidv4();

    await this.s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return { key };
  }
}
