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

@Entity({ name: 'files' })
export class FileEntity {
  @PrimaryColumn({ type: 'uuid', name: 'file_id' })
  id!: string;

  @Column({ type: 'text', name: 'file_path' })
  file_path!: string;

  @Column({ type: 'text', name: 'filename' })
  filename!: string;

  @Column({ type: 'text', name: 'storage_type' })
  storage_type!: string;

  @Column({ type: 'text', name: 'storage_provider', nullable: true })
  storage_provider!: string | null;

  @Column({ type: 'text', name: 'cloud_file_id', nullable: true })
  cloud_file_id!: string | null;

  @Column({ type: 'text', name: 'storage_account', nullable: true })
  storage_account!: string | null;

  @Column({ type: 'timestamptz', name: 'modified_at_source' })
  modified_at_source!: Date;

  @Column({ type: 'text', nullable: true })
  bucket!: string | null;

  @Column({ type: 'uuid', nullable: true })
  key!: string | null;

  @Column({ type: 'text', name: 'original_filename' })
  original_name!: string;

  @Column({ type: 'text', name: 'mime_type' })
  content_type!: string;

  @Column({ type: 'text', name: 'file_hash' })
  file_hash!: string | null;

  @Column({ type: 'bigint', name: 'file_size_bytes' })
  size!: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  static toEgressType(entity: FileEntity): File {
    return {
      id: entity.id,
      original_name: entity.original_name,
      file_hash: entity.file_hash,
      key: entity.key,
      file_path: entity.file_path,
      filename: entity.filename,
      storage_type: entity.storage_type,
      storage_provider: entity.storage_provider,
      storage_account: entity.storage_account,
      cloud_file_id: entity.cloud_file_id,
      modified_at_source: entity.modified_at_source,
      bucket: entity.bucket,
      content_type: entity.content_type,
      size: entity.size,
      created_at: entity.created_at,
      updated_at: entity.updated_at,
    };
  }
}

export type File = Readonly<FileEntity>;

export type SignedFile = File & { readonly url: string };
