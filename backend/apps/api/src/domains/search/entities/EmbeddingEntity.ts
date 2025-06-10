import { Entity, Column, CreateDateColumn, PrimaryColumn } from 'typeorm';

@Entity('embeddings')
export class EmbeddingEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  model!: string;

  @Column()
  raw_input!: string;

  @Column({
    type: 'text',
    transformer: {
      to: (v: number[]) => `[${v.join(',')}]`,
      from: (v: string) => v.slice(1, -1).split(',').map(Number),
    },
  })
  embedding_vector!: number[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
