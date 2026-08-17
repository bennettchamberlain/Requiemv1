/**
 * The interpersonal **Ask** domain — Phase 0 of the federated ask / decentralized
 * trust graph (CI-Server #1711 → epic #1712).
 *
 * An Ask is a bounded question one user directs at another user's Companion
 * memory. This module owns the ask lifecycle ({@link AskService}), the standing
 * consent grants that gate it ({@link GrantService}), and the per-ask audit log
 * ({@link AskAuditService}). The consent decision and the lifecycle state machine
 * are pure functions ({@link evaluateGrant}, {@link assertAskTransition}) so the
 * security-critical rules are testable without a database.
 *
 * Phase 0 is intra-Hub (multi-user, single box) and returns raw owner-scoped
 * results behind the `ask` feature flag for internal dogfood only — synthesized,
 * disclosure-filtered answers are Epic 1.
 *
 * @module AsksModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SearchNextModule } from '@ci/domains/search-next';

import { AskAnswerEntity } from './entities/AskAnswerEntity';
import { AskAuditEntity } from './entities/AskAuditEntity';
import { AskEntity } from './entities/AskEntity';
import { AskGrantEntity } from './entities/AskGrantEntity';
import { AskAnswerService } from './services/AskAnswerService';
import { AskAuditService } from './services/AskAuditService';
import { AskExecutorService } from './services/AskExecutorService';
import { AskRateLimitService } from './services/AskRateLimitService';
import { AskService } from './services/AskService';
import { GrantService } from './services/GrantService';

/**
 * @internal
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AskEntity, AskGrantEntity, AskAuditEntity, AskAnswerEntity]),
    SearchNextModule,
  ],
  providers: [
    AskService,
    GrantService,
    AskAuditService,
    AskRateLimitService,
    AskExecutorService,
    AskAnswerService,
  ],
  exports: [
    AskService,
    GrantService,
    AskAuditService,
    AskRateLimitService,
    AskExecutorService,
    AskAnswerService,
  ],
})
export class AsksModule {}

export { AskEntity, AskGrantEntity, AskAuditEntity, AskAnswerEntity };
export {
  AskService,
  GrantService,
  AskAuditService,
  AskRateLimitService,
  AskExecutorService,
  AskAnswerService,
};
export { evaluateGrant } from './grantMatch';
export { inferAnswerForm, buildDisclosedAnswer, formDisclosesItems } from './disclosure';
export {
  ASK_TRANSITIONS,
  TERMINAL_ASK_STATUSES,
  assertAskTransition,
  canTransitionAsk,
  isTerminalAskStatus,
  IllegalAskTransitionError,
} from './askStatus';

export type { Ask } from './entities/AskEntity';
export type { AskGrant } from './entities/AskGrantEntity';
export type { AskAudit } from './entities/AskAuditEntity';
export type { AskAnswer } from './entities/AskAnswerEntity';
export type {
  AskStatus,
  AskAuditOutcome,
  GrantMode,
  GrantDecision,
  AskQuery,
  AskGrantScope,
  GrantEvaluation,
  CreateAskDto,
  CreateAskGrantDto,
  RecordAskAuditDto,
  AnswerForm,
  AnswerSource,
  DisclosedItem,
  DisclosedAnswer,
  CreateAskAnswerDto,
} from './types';
