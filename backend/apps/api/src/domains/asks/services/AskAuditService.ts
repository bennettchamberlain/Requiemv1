import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  /** Record the outcome of an ask. */
  async record(data: RecordAskAuditDto): Promise<AskAudit> {
    const record = this.auditRepository.create({
      id: uuidv7(),
      askId: data.askId,
      askerUserId: data.askerUserId,
      responderUserId: data.responderUserId,
      query: data.query,
      consentBasis: data.consentBasis ?? null,
      outcome: data.outcome,
      disclosedEntities: data.disclosedEntities ?? [],
    });
    const entity = await this.auditRepository.save(record);

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
}
