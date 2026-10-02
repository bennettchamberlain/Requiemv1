import { Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { type UserServiceContext } from '@ci/common/context';
import {
  PersonService,
  SELF_ENTITY_PROVISIONER,
  UserContextService,
  type SelfEntityProvisioner,
} from '@ci/domains/memory';

const CACHE_TTL_MS = 60_000;

interface ChatModelPreferences {
  /** The user's override, or `null` when they have never set one. */
  chatModel: string | null;
  /** Whether tool calling is enabled for this user's chat turns. Defaults true. */
  toolsEnabled: boolean;
  /** Whether extended thinking is enabled for this user's chat turns. Defaults true. */
  thinkingEnabled: boolean;
}

/**
 * Settings → Model: which chat model a user talks to, and their Tools /
 * Thinking toggles. Stored on the self person's `properties.planner`
 * (`chat_model`, `tools_enabled`, `thinking_enabled`) — the same bag
 * {@link ImageDescriptionPreferenceService} and PersonalizationService's
 * `trust_mode` already live in.
 *
 * Before this, all three were `localStorage` in the browser (`useModel.ts`):
 * they reset on a cleared profile or a new device, and a background job
 * (image description, thing vision) had no way to ask "which model does this
 * user actually want" — `OllamaService` fell back to a single appliance-wide
 * constant (`PROMPT_MODEL`, i.e. `llm.chatModel`) for everyone. `getChatModel`
 * returns the raw override — `null` means "no override", and the caller
 * (`OllamaService`) applies the `PROMPT_MODEL` fallback, so this service does
 * not need to import LlmCore and risk the cycle {@link
 * ImageDescriptionPreferenceService} already documents.
 *
 * `chatModel: null` is a real, settable state — not just "never touched" —
 * because a user who has picked a model over Settings should be able to say
 * "go back to whatever the appliance defaults to" without hand-typing it.
 */
@Injectable()
export class ChatModelPreferenceService {
  private readonly cache = new Map<string, { prefs: ChatModelPreferences; expiresAt: number }>();

  constructor(
    private readonly personService: PersonService,
    private readonly userContextService: UserContextService,
    /**
     * For {@link SELF_ENTITY_PROVISIONER}, resolved lazily — see its doc for why
     * it cannot be injected. Optional so a hand-built service (the unit tests)
     * still constructs; without it a user who has no self entity gets the old
     * error rather than a new one.
     */
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  async getChatModel(userId: string): Promise<string | null> {
    return (await this.getPreferences(userId)).chatModel;
  }

  async getToolsEnabled(userId: string): Promise<boolean> {
    return (await this.getPreferences(userId)).toolsEnabled;
  }

  async getThinkingEnabled(userId: string): Promise<boolean> {
    return (await this.getPreferences(userId)).thinkingEnabled;
  }

  async setChatModel(context: UserServiceContext, model: string | null): Promise<string | null> {
    const trimmed = model?.trim() || null;

    await this.writeLeaf(context, 'chat_model', trimmed);

    return trimmed;
  }

  async setToolsEnabled(context: UserServiceContext, enabled: boolean): Promise<boolean> {
    await this.writeLeaf(context, 'tools_enabled', enabled);

    return enabled;
  }

  async setThinkingEnabled(context: UserServiceContext, enabled: boolean): Promise<boolean> {
    await this.writeLeaf(context, 'thinking_enabled', enabled);

    return enabled;
  }

  private async writeLeaf(
    context: UserServiceContext,
    leaf: 'chat_model' | 'tools_enabled' | 'thinking_enabled',
    value: string | boolean | null,
  ): Promise<void> {
    const userId = context.userId!;
    const selfEntityId = await this.selfEntityIdFor(context);

    // A single-leaf write, like ImageDescriptionPreferenceService — never a
    // rebuilt `planner` object, which would clobber trust_mode or the other
    // two preferences this service itself owns if a concurrent write lands
    // between our read and our write.
    await this.personService.patchPropertyLeaves(context, selfEntityId, [
      { path: ['planner', leaf], value },
      { path: ['planner', 'source'], value: 'settings' },
    ]);

    this.invalidate(userId);
  }

  /**
   * The self entity these preferences live on, provisioned when the user has
   * none yet.
   *
   * `ci.users.entity_id` stays NULL until something self-anchored is ingested,
   * and nothing guarantees that ever happens — an account whose data came from
   * an import never gets one. That account could not pick a model at all:
   * `POST /personalization/chat-model` threw "Self entity not found" (a 500) on
   * every try — an iOS QA run logged six in a row — and the picker, which reverts
   * an optimistic selection when the write fails, snapped back to the default
   * each time. Reads are unaffected (no self entity reads as "no override"); this
   * is the write half. Provisioning is what graph ingest and the Places page
   * already do for the same gap.
   */
  private async selfEntityIdFor(context: UserServiceContext): Promise<string> {
    const selfIdentity = await this.userContextService.getSelfIdentity(context.userId!);

    if (selfIdentity) {
      return selfIdentity.entityId;
    }

    const provisioned = await this.selfEntityProvisioner()?.ensureSelfEntityForOwner(context);

    if (!provisioned) {
      throw new Error('Self entity not found');
    }

    return provisioned.id;
  }

  private selfEntityProvisioner(): SelfEntityProvisioner | null {
    try {
      return this.moduleRef?.get<SelfEntityProvisioner>(SELF_ENTITY_PROVISIONER, { strict: false }) ?? null;
    } catch {
      // No binding (a container without GraphModule): fall through to the
      // "no self entity" error, which names the actual problem.
      return null;
    }
  }

  private async getPreferences(userId: string): Promise<ChatModelPreferences> {
    const cached = this.cache.get(userId);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.prefs;
    }

    const prefs = await this.readPreferences(userId);

    this.cache.set(userId, { prefs, expiresAt: Date.now() + CACHE_TTL_MS });

    return prefs;
  }

  private async readPreferences(userId: string): Promise<ChatModelPreferences> {
    const selfIdentity = await this.userContextService.getSelfIdentity(userId);

    if (!selfIdentity) {
      return { chatModel: null, toolsEnabled: true, thinkingEnabled: true };
    }

    const context = { userId } as UserServiceContext;
    const self = await this.personService.findById(context, selfIdentity.entityId);
    const planner = (self?.properties?.planner ?? {}) as Record<string, unknown>;
    const chatModel =
      typeof planner.chat_model === 'string' && planner.chat_model.trim() ? planner.chat_model : null;

    return {
      chatModel,
      toolsEnabled: planner.tools_enabled !== false,
      thinkingEnabled: planner.thinking_enabled !== false,
    };
  }
}
