import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('embeddings')
export class EmbeddingEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string; // Keep as string, safer for JS... questionable... claimed from ChatGPT

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
}
