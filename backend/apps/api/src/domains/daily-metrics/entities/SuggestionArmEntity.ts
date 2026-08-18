import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'ci_derived', name: 'suggestion_arms' })
export class SuggestionArmEntity {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'double precision', default: 1 })
  alpha!: number;

  @Column({ type: 'double precision', default: 1 })
  beta!: number;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
