import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'ci', name: 'notes' })
export class NoteEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  /** Set by the memory compaction cron after LLM extraction. Null = unprocessed. */
  @Column({ type: 'timestamptz', nullable: true, name: 'processed_at' })
  processedAt!: Date | null;

  static toEgressType(entity: NoteEntity): Note {
    return {
      id: entity.id,
      title: entity.title,
      content: entity.content,
      userId: entity.userId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      processedAt: entity.processedAt ?? null,
    };
  }
}

export type Note = Readonly<NoteEntity>;
