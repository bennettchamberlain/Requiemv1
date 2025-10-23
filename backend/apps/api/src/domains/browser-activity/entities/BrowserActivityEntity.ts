import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';

import { UserEntity } from '@ci/domains/user';

export interface Device {
  device_id: string;
}

@Entity('browser_activity')
export class BrowserActivityEntity {
  @PrimaryColumn({ type: 'timestamptz' })
  time!: Date;

  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  device_id!: string;

  // URL and page data
  @Column({ type: 'text' })
  url!: string;

  @Column({ type: 'text', nullable: true })
  title?: string;

  // Interaction data
  @Column({ type: 'text', nullable: true })
  action_type?: string;

  @Column({ type: 'jsonb', default: {} })
  properties!: Record<string, unknown>;

  @Column({ type: 'integer', nullable: true })
  duration_seconds?: number;

  @Column({ type: 'double precision', nullable: true })
  scroll_depth_percent?: number;

  // AI-generated insights
  @Column({ type: 'text', nullable: true })
  page_summary?: string;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      to: (v: number[]) => (v ? `[${v.join(',')}]` : null),
      from: (v: string) => (v ? v.slice(1, -1).split(',').map(Number) : null),
    },
  })
  page_embedding?: number[];

  @Column({ type: 'text', nullable: true })
  category?: string;

  @Column({ type: 'double precision', nullable: true })
  productivity_score?: number;

  // Privacy
  @Column({ type: 'boolean', default: false })
  is_incognito!: boolean;

  @Column({ type: 'boolean', default: false })
  contains_sensitive!: boolean;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity | null;

  toBrowserActivity(): BrowserActivity {
    return {
      time: this.time,
      user_id: this.user_id,
      device_id: this.device_id,
      url: this.url,
      title: this.title,
      action_type: this.action_type,
      properties: this.properties,
      duration_seconds: this.duration_seconds,
      scroll_depth_percent: this.scroll_depth_percent,
      page_summary: this.page_summary,
      page_embedding: this.page_embedding,
      category: this.category,
      productivity_score: this.productivity_score,
      is_incognito: this.is_incognito,
      contains_sensitive: this.contains_sensitive,
      user: this.user?.toUser(),
    };
  }
}

export interface BrowserActivity {
  readonly time: Date;
  readonly user_id: string;
  readonly device_id: string;
  readonly url: string;
  readonly title?: string;
  readonly action_type?: string;
  readonly properties: Record<string, unknown>;
  readonly duration_seconds?: number;
  readonly scroll_depth_percent?: number;
  readonly page_summary?: string;
  readonly page_embedding?: number[];
  readonly category?: string;
  readonly productivity_score?: number;
  readonly is_incognito: boolean;
  readonly contains_sensitive: boolean;
  readonly user?: import('@ci/domains/user').User;
}
