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

import type { Thread } from '../types';

@Entity({ name: 'threads' })
export class ThreadEntity {
  @PrimaryColumn({ type: 'uuid', name: 'thread_id' })
  id!: string;

  @Column({ type: 'text', nullable: true, name: 'title' })
  name!: string | null;

  @Column({ type: 'text', nullable: true, name: 'summary' })
  description!: string | null;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @Column({ type: 'boolean', default: false, name: 'is_archived' })
  is_archived!: boolean;

  toThread() {
    return {
      id: this.id,
      name: this.name ?? null,
      model: null, // TODO: Implement model_config handling when needed
      description: this.description ?? null,
      files: [], // Note: Files are now linked via message_id in files table, not thread-level

      user: this.user?.toUser(),
    } satisfies Thread;
  }
}
