import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { UserContextService } from '@ci/domains/memory';

import type { ContextResult } from '../types';

/**
 * L0 — static user profile block.
 *
 * Fetches a snapshot of the user's knowledge graph (name, relationships,
 * preferences, dossier) via UserContextService and formats it as a markdown
 * block suitable for injection into the agent system prompt.
 *
 * This is called once per session (system_prompt_block), not per turn.
 */
@Injectable()
export class ContextService {
  constructor(
    private readonly userContextService: UserContextService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ContextService.name);
  }

  async getContext(context: UserServiceContext): Promise<ContextResult> {
    try {
      const userCtx = await this.userContextService.getUserContextForLLM(context.userId);

      if (!userCtx) {
        return { block: '' };
      }

      const block = this.userContextService.formatContextForSystemPrompt(userCtx);

      return { block };
    } catch (err) {
      this.logger.warn(`L0 context failed for user ${context.userId}: ${err}`);

      return { block: '' };
    }
  }
}
