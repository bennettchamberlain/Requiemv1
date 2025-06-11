import { Entity, Column, CreateDateColumn, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { UserEntity } from '@ci/domains/user';

@Entity('embeddings')
export class EmbeddingEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  model!: string;

  @Column()
  raw_input!: string;

  @Column()
  raw_input_hash!: string;

  @Column()
  entity_type!: string;

  @Column()
  data_path!: string;

  @Column()
  entity_id!: string;

  @Column({
    type: 'text',
    transformer: {
      to: (v: number[]) => `[${v.join(',')}]`,
      from: (v: string) => v.slice(1, -1).split(',').map(Number),
    },
  })
  embedding_vector!: number[];

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
