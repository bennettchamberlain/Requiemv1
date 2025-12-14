import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { UserEntity } from '@ci/domains/user';

@Entity({ schema: 'ci', name: 'files' })
export class FileEntity {
  @PrimaryColumn({ type: 'uuid', name: 'file_id' })
  id!: string;

  @Column({ type: 'text', name: 'file_path' })
  filePath!: string;

  @Column({ type: 'text', name: 'filename' })
  filename!: string;

  @Column({ type: 'text', name: 'storage_type' })
  storageType!: string;

  @Column({ type: 'text', name: 'storage_provider', nullable: true })
  storageProvider!: string | null;

  @Column({ type: 'text', name: 'cloud_file_id', nullable: true })
  cloudFileId!: string | null;

  @Column({ type: 'text', name: 'storage_account', nullable: true })
  storageAccount!: string | null;

  @Column({ type: 'timestamptz', name: 'modified_at_source' })
  modifiedAtSource!: Date;

  @Column({ type: 'text', nullable: true })
  bucket!: string | null;

  @Column({ type: 'uuid', nullable: true })
  key!: string | null;

  @Column({ type: 'text', name: 'original_filename' })
  originalName!: string;

  @Column({ type: 'text', name: 'mime_type' })
  contentType!: string;

  @Column({ type: 'text', name: 'file_hash' })
  fileHash!: string | null;

  @Column({ type: 'bigint', name: 'file_size_bytes' })
  size!: number;

  @Column({ type: 'boolean', name: 'analysis_completed', default: false })
  analysisCompleted!: boolean;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  static toEgressType(entity: FileEntity): File {
    return {
      id: entity.id,
      originalName: entity.originalName,
      fileHash: entity.fileHash,
      key: entity.key,
      filePath: entity.filePath,
      filename: entity.filename,
      storageType: entity.storageType,
      storageProvider: entity.storageProvider,
      storageAccount: entity.storageAccount,
      cloudFileId: entity.cloudFileId,
      modifiedAtSource: entity.modifiedAtSource,
      bucket: entity.bucket,
      contentType: entity.contentType,
      size: entity.size,
      analysisCompleted: entity.analysisCompleted,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

export type File = Readonly<FileEntity>;

export type SignedFile = File & { readonly url: string };
