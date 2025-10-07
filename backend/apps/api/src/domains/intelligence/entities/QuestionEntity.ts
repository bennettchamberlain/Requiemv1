import { Entity, Column, CreateDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { Question } from '../types';

@Entity('questions')
export class QuestionEntity {
  @PrimaryColumn('uuid')
  question_id!: string;

  @Column({ nullable: true })
  question_category!: string;

  @Column()
  question_text!: string;

  @Column({ type: 'text', array: true, nullable: true })
  context_tags!: string[];

  @Column({ nullable: true })
  question_type!: string;

  @Column({ default: false })
  is_seed_question!: boolean;

  @Column({ default: true })
  is_active!: boolean;

  @Column({ default: false })
  created_by_llm!: boolean;

  @Column({ nullable: true })
  frequency_recommendation!: string;

  @Column({ type: 'integer', default: 0 })
  times_asked!: number;

  @Column({ type: 'integer', default: 0 })
  times_answered!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  toQuestion() {
    return {
      id: this.question_id,
      category: this.question_category,
      text: this.question_text,
      contextTags: this.context_tags,
      questionType: this.question_type,
      isSeedQuestion: this.is_seed_question,
      isActive: this.is_active,
      createdByLlm: this.created_by_llm,
      frequencyRecommendation: this.frequency_recommendation,
      timesAsked: this.times_asked,
      timesAnswered: this.times_answered,
    } satisfies Question;
  }
}
