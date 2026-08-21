import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { type AskAudit, AskAuditEntity } from '../entities/AskAuditEntity';
import type { RecordAskAuditDto } from '../types';

/**
 * Append-only per-ask audit. Exactly one row is written per terminal outcome
 * (answered / auto_answered / declined / expired) — declines included, since a
 * refused ask proves the gate works. Backs the Disclosure History surface.
 */
@Injectable()
export class AskAuditService {
  constructor(
    @InjectRepository(AskAuditEntity)
    private readonly auditRepository: Repository<AskAuditEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AskAuditService.name);
  }

  /**
   * Record the outcome of an ask.
   *
   * `manager` enrolls the write in a caller-owned transaction, so the audit and
   * the answer it describes commit together or not at all. Omitted, the write
   * runs on its own connection exactly as before.
   */
  async record(data: RecordAskAuditDto, manager?: EntityManager): Promise<AskAudit> {
    const repository = this.repository(manager);
    const record = repository.create({
      id: uuidv7(),
      askId: data.askId,
      askerUserId: data.askerUserId,
      peerLinkId: data.peerLinkId ?? null,
      peerHandle: data.peerHandle ?? null,
      responderUserId: data.responderUserId,
      query: data.query,
      consentBasis: data.consentBasis ?? null,
      outcome: data.outcome,
      disclosedEntities: data.disclosedEntities ?? [],
      // The magnitude, not the itemization. `disclosedEntities` is empty for
      // every form but `retrieval`, so deriving the count from it audited a
      // real `count`/`boolean` disclosure as "nothing was shared" — see
      // {@link AskAuditEntity.disclosedCount}. The itemized length is the
      // FALLBACK, not the source: it is correct for `retrieval` and for the
      // outcomes that disclose nothing, and wrong for exactly the forms this
      // field exists to record.
      disclosedCount: data.disclosedCount ?? data.disclosedEntities?.length ?? 0,
      backingEntities: data.backingEntities ?? [],
    });
    const entity = await repository.save(record);

    return AskAuditEntity.toEgressType(entity);
  }

  /** The caller's disclosure history (asks they responded to), newest first. */
  async listForResponder(context: UserServiceContext): Promise<AskAudit[]> {
    const rows = await this.auditRepository.find({
      where: { responderUserId: context.userId },
      order: { createdAt: 'DESC' },
    });

    return rows.map(AskAuditEntity.toEgressType);
  }

  /**
   * The transaction's repository when one is supplied, otherwise the injected
   * one. `manager.getRepository` is what binds the write to the caller's
   * transaction — the injected repository has its own connection and would
   * commit independently, which is exactly the split this exists to close.
   */
  private repository(manager?: EntityManager): Repository<AskAuditEntity> {
    return manager ? manager.getRepository(AskAuditEntity) : this.auditRepository;
  }
}
