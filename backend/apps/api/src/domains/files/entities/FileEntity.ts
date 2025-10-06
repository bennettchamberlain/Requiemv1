import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import type { MessageEntity } from '@ci/domains/conversations';
import { UserEntity } from '@ci/domains/user';

import type { File } from '../types';

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

  @Column({ type: 'timestamptz', name: 'modified_at_source' })
  modified_at_source!: Date;

  @Column({ type: 'text' })
  bucket!: string;

  @Column({ type: 'uuid' })
  key!: string;

  @Column({ type: 'text', name: 'original_filename' })
  original_name!: string;

  @Column({ type: 'text', name: 'mime_type' })
  content_type!: string;

  @Column({ type: 'bigint', name: 'file_size_bytes' })
  size!: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne('MessageEntity', { nullable: true })
  @JoinColumn({ name: 'message_id' })
  message?: MessageEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  toFile(): File {
    return {
      id: this.id,
      name: this.original_name,
      key: this.key,
      contentType: this.content_type,
      size: this.size,
    };
  }
}
