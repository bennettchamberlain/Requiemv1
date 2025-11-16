import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';

import { FileEntity } from '@ci/domains/files';
import { UserEntity } from '@ci/domains/user';

import type { Message } from '../types';

import { ThreadEntity } from './ThreadEntity';

@Entity({ name: 'messages' })
export class MessageEntity {
  @PrimaryColumn({ type: 'uuid', name: 'message_id' })
  id!: string;

  @Column({ type: 'text', nullable: true, name: 'model_name' })
  model!: string | null;

  @Column({ type: 'text', nullable: false })
  role!: string;

  @Column({ type: 'text', nullable: false, name: 'content' })
  content!: string;

  @Column({ type: 'text', nullable: true, name: 'content_type' })
  mimetype!: string | null;

  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  tool_calls!: Record<string, unknown>[] | null;

  // Direct boolean field for canceled - maps to is_deleted in database
  @Column({ type: 'boolean', default: false, name: 'is_deleted' })
  canceled!: boolean;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne(() => ThreadEntity)
  @JoinColumn({ name: 'thread_id' })
  thread?: ThreadEntity;

  @ManyToOne(() => MessageEntity, { nullable: true })
  @JoinColumn({ name: 'parent_message_id' })
  promptMessage?: MessageEntity;

  @ManyToMany(() => FileEntity, { nullable: true })
  @JoinTable({
    name: 'message_files',
    joinColumn: { name: 'message_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'file_id', referencedColumnName: 'id' },
  })
  files?: FileEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  toMessage(): Message {
    return {
      id: this.id,
      model: this.model ?? null,
      role: this.role,
      content: this.content ?? '',
      mimetype: this.mimetype ?? null,
      toolCalls: this.tool_calls ?? null,
      canceled: this.canceled ?? null,

      user: this.user ? UserEntity.toEgressType(this.user) : undefined,
      thread: this.thread?.toThread(),
      promptMessage: this.promptMessage?.toMessage() ?? null,
      files: this.files?.map((file) => file.toFile()),
    } satisfies Message;
  }
}
