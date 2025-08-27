import { Entity, PrimaryColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';

import { ThreadFile } from '@ci/domains/conversations/types';
import { FileEntity } from '@ci/domains/files';

import { ThreadEntity } from './ThreadEntity';

@Entity({ name: 'thread_file' })
export class ThreadFileEntity {
  @PrimaryColumn()
  id!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @ManyToOne(() => ThreadEntity, {})
  @JoinColumn({ name: 'thread_id' })
  thread!: ThreadEntity;

  @ManyToOne(() => FileEntity, {})
  @JoinColumn({ name: 'file_id' })
  file!: FileEntity;

  toThreadFile() {
    return {
      id: this.id,
      file: this.file.toFile(),
      thread: this.thread.toThread(),
    } satisfies ThreadFile;
  }
}
