import { Entity, Column, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { UserEntity } from '@ci/domains/user';

import { Answer } from '../types';

import { QuestionEntity } from './QuestionEntity';

@Entity('answers')
export class AnswerEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  rag_answer_1!: string;

  @Column()
  rag_answer_2!: string;

  @Column()
  rag_answer_3!: string;

  @Column()
  give_answer_1!: string;

  @Column()
  give_answer_2!: string;

  @Column()
  give_answer_3!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne(() => QuestionEntity)
  @JoinColumn({ name: 'question_id' })
  question?: UserEntity;

  @Column({ type: 'timestamptz' })
  created_at!: Date;

  @Column({ type: 'timestamptz' })
  updated_at!: Date;

  toUser() {
    return {
      id: this.id,
      ragAnswer: this.rag_answer_1,
      answer: this.give_answer_1,
    } satisfies Answer;
  }
}
