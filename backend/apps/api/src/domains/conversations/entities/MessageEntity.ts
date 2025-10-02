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
  text!: string;

  @Column({ type: 'text', nullable: true, name: 'content_type' })
  mimetype!: string | null;

  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  tool_calls!: Record<string, unknown>[] | null;

  // Direct boolean field for canceled - maps to is_deleted in database
  @Column({ type: 'boolean', default: false, name: 'is_deleted' })
  deleted!: boolean;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne(() => ThreadEntity)
  @JoinColumn({ name: 'thread_id' })
  thread?: ThreadEntity;

  @ManyToOne(() => MessageEntity, { nullable: true })
  @JoinColumn({ name: 'parent_message_id' })
  promptMessage?: MessageEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  toMessage(): Message {
    return {
      id: this.id,
      model: this.model ?? null,
      role: this.role,
      content: this.text ?? '',
      mimetype: this.mimetype ?? null,
      toolCalls: this.tool_calls ?? null,
      deleted: this.deleted ?? null,

      user: this.user?.toUser(),
      thread: this.thread?.toThread(),
      promptMessage: this.promptMessage?.toMessage() ?? null,
    } satisfies Message;
  }
}
