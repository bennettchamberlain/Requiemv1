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

import { TagEntity } from '@ci/domains/search';
import { UserEntity } from '@ci/domains/user';

@Entity({ name: 'actions' })
export class ActionEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

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

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
