import {
  Entity,
  Column,
  CreateDateColumn,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Indexable } from '@ci/common/decorators';
import { UserEntity } from '@ci/domains/user';

import { Answer } from '../types';

import { QuestionEntity } from './QuestionEntity';

@Indexable('answer', ['answer_text'])
@Entity('answers')
export class AnswerEntity {
  @PrimaryColumn('uuid')
  answer_id!: string;

  @Column()
  answer_text!: string;

  @Column({ type: 'double precision', nullable: true })
  answer_confidence!: number;

  @Column({ default: 'user_input' })
  answer_source!: string;

  @Column({ nullable: true })
  answer_method!: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  answered_at!: Date;

  @Column({ type: 'jsonb', default: '{}' })
  session_context!: Record<string, unknown>;

  @Column({ nullable: true })
  emotional_state!: string;

  @Column({ nullable: true })
  location_context!: string;

  @Column({ type: 'text', array: true, nullable: true })
  extracted_entities!: string[];

  @Column({ type: 'double precision', nullable: true })
  sentiment_score!: number;

  @Column({ type: 'double precision', nullable: true })
  complexity_score!: number;

  @Column({ default: false })
  is_sensitive!: boolean;

  @Column({ default: 'private' })
  sharing_level!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne(() => QuestionEntity)
  @JoinColumn({ name: 'question_id' })
  question?: QuestionEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  toAnswer() {
    return {
      id: this.answer_id,
      answer: this.answer_text,
      answerConfidence: this.answer_confidence,
      answerSource: this.answer_source,
      answerMethod: this.answer_method,
      answeredAt: this.answered_at,
      isSensitive: this.is_sensitive,
      sharingLevel: this.sharing_level,

      user: this.user?.toUser(),
      question: this.question?.toQuestion(),
    } satisfies Answer;
  }
}
