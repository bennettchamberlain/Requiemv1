import {
  Entity,
  Column,
  CreateDateColumn,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from '@ci/domains/user';

import type { Question } from '../types';

@Entity('questions')
export class QuestionEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  category!: string;

  @Column()
  text!: string;

  @Column()
  example_answer_1!: string;

  @Column()
  example_answer_2!: string;

  @Column()
  example_answer_3!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  toQuestion() {
    return {
      id: this.id,

      category: this.category,
      text: this.text,
      answer: this.example_answer_1,

      user: this.user?.toUser(),
    } satisfies Question;
  }
}
