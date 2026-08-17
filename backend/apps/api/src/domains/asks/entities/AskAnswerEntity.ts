import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

import type { AnswerForm, AnswerSource, DisclosedItem } from '../types';

/**
 * `ci.ask_answers` — the disclosure-filtered answer produced for an ask (Phase
 * 1). Holds entity id+type references only (never raw content or signed URLs),
 * a `form` discriminator, a redaction-aware disclosed/withheld split, and a
 * templated summary. One row per ask.
 */
@Entity({ schema: 'ci', name: 'ask_answers' })
export class AskAnswerEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'ask_id' })
  askId!: string;

  @Column({ type: 'text', name: 'form' })
  form!: AnswerForm;

  @Column({ type: 'text', name: 'answer_source', default: 'peer' })
  answerSource!: AnswerSource;

  @Column({ type: 'text', name: 'summary', nullable: true })
  summary!: string | null;

  @Column({ type: 'jsonb', name: 'disclosed_entities', default: () => "'[]'::jsonb" })
  disclosedEntities!: DisclosedItem[];

  @Column({ type: 'int', name: 'disclosed_count', default: 0 })
  disclosedCount!: number;

  @Column({ type: 'int', name: 'withheld_count', default: 0 })
  withheldCount!: number;

  @Column({ type: 'text', name: 'consent_basis', nullable: true })
  consentBasis!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  static toEgressType(entity: AskAnswerEntity): AskAnswer {
    return {
      id: entity.id,
      askId: entity.askId,
      form: entity.form,
      answerSource: entity.answerSource,
      summary: entity.summary,
      disclosedEntities: entity.disclosedEntities,
      disclosedCount: entity.disclosedCount,
      withheldCount: entity.withheldCount,
      consentBasis: entity.consentBasis,
      createdAt: entity.createdAt,
    };
  }
}

export type AskAnswer = Readonly<AskAnswerEntity>;
