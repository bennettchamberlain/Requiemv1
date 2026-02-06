import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  ManyToOne,
  JoinColumn,
  JoinTable,
  OneToOne,
} from 'typeorm';

import { type Thread, ThreadEntity } from '@ci/domains/conversations';
import { TagEntity } from '@ci/domains/search';
import { type User, UserEntity } from '@ci/domains/user';

@Entity({ schema: 'ci', name: 'actions' })
export class ActionEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ type: 'text', name: 'image_url', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'int', name: 'priority', nullable: true })
  priority!: number | null;

  @Column({ type: 'jsonb', name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  seen!: boolean;

  @Column({ type: 'text', name: 'thread_id', nullable: true })
  threadId!: string;

  @OneToOne(() => ThreadEntity, { nullable: true })
  @JoinColumn({ name: 'thread_id' })
  thread?: ThreadEntity;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToMany(() => TagEntity, { nullable: true })
  @JoinTable({
    name: 'action_tag',
    joinColumn: { name: 'action_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags?: TagEntity[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  static toEgressType(entity: ActionEntity): Action {
    return {
      id: entity.id,
      title: entity.title,
      text: entity.text,
      imageUrl: entity.imageUrl,
      priority: entity.priority,
      metadata: entity.metadata,
      seen: entity.seen ?? false,
      threadId: entity.threadId,
      thread: entity.thread ? ThreadEntity.toEgressType(entity.thread) : undefined,
      user: entity.user ? UserEntity.toEgressType(entity.user) : undefined,
      tags: entity.tags?.map((tag) => tag.toTag()).filter((tag) => !!tag) as string[],
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

export type Action = Readonly<Omit<ActionEntity, 'user' | 'thread' | 'tags'>> & {
  user?: User;
  thread?: Thread;
  tags?: string[];
};
