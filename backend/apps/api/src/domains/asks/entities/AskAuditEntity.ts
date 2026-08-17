import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

import type { AskAuditOutcome, AskQuery } from '../types';

/**
 * `ci.ask_audit` — one row per terminal ask outcome. Records who asked what of
 * whom, the consent basis, the outcome, and which of the owner's entities were
 * disclosed. Declines are logged too (the gate working is the point). Feeds the
 * Disclosure History surface and, later, ISO 27560 consent receipts.
 */
@Entity({ schema: 'ci', name: 'ask_audit' })
export class AskAuditEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id!: string;

  // Soft reference: nulled (not cascade-deleted) if the ask is ever removed, so
  // the audit row outlives the ask it records.
  @Column({ type: 'uuid', name: 'ask_id', nullable: true })
  askId!: string | null;

  @Column({ type: 'uuid', name: 'asker_user_id' })
  askerUserId!: string;

  @Column({ type: 'uuid', name: 'responder_user_id' })
  responderUserId!: string;

  @Column({ type: 'jsonb', name: 'query' })
  query!: AskQuery;

  @Column({ type: 'text', name: 'consent_basis', nullable: true })
  consentBasis!: string | null;

  @Column({ type: 'text', name: 'outcome' })
  outcome!: AskAuditOutcome;

  @Column({ type: 'jsonb', name: 'disclosed_entities', default: () => "'[]'::jsonb" })
  disclosedEntities!: string[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  static toEgressType(entity: AskAuditEntity): AskAudit {
    return {
      id: entity.id,
      askId: entity.askId,
      askerUserId: entity.askerUserId,
      responderUserId: entity.responderUserId,
      query: entity.query,
      consentBasis: entity.consentBasis,
      outcome: entity.outcome,
      disclosedEntities: entity.disclosedEntities,
      createdAt: entity.createdAt,
    };
  }
}

export type AskAudit = Readonly<AskAuditEntity>;
