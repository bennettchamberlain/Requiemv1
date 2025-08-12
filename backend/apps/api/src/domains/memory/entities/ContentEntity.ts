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
} from 'typeorm';

import { Indexable } from '@ci/common/decorators';
import { TagEntity } from '@ci/domains/search';
import { UserEntity } from '@ci/domains/user';

import { EventEntity } from './EventEntity';

@Indexable('content', ['text'])
@Entity({ name: 'content' })
export class ContentEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'text', nullable: true })
  type!: string | null;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ type: 'text', nullable: true })
  url!: string | null;

  @Column({ type: 'text', nullable: true })
  mimetype!: string | null;

  @Column({ type: 'text', nullable: true })
  external_id!: string | null;

  @Column({ type: 'text', nullable: true })
  source_url!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  source_data!: Record<string, unknown> | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne(() => EventEntity, { nullable: true })
  @JoinColumn({ name: 'event_id' })
  event?: EventEntity;

  @ManyToMany(() => TagEntity, { nullable: true })
  @JoinTable({
    name: 'content_tag',
    joinColumn: { name: 'content_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags?: TagEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  toContent() {
    return {
      id: this.id,
      type: this.type,
      title: this.title,
      text: this.text,
      url: this.url,
      mimetype: this.mimetype,
      external_id: this.external_id,
      source_url: this.source_url,
      source_data: this.source_data,
      user_id: this.user?.id,
      event_id: this.event?.id,
      tags: this.tags?.map(tag => tag.id) || []
    } satisfies Content;
  }
}
