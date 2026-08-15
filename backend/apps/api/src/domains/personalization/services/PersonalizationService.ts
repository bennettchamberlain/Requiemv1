import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { PersonService, UserContextService } from '@ci/domains/memory';

import {
  type DecideActionInput,
  type PersonalizationActionKind,
  type PersonalizationDecision,
  type PersonalizationProfile,
  type TrustMode,
} from '../types';

const DEFAULT_TRUST_MODE: TrustMode = 'balanced';

/** Below this confidence, always ask the user before applying (all trust modes). */
export const ALWAYS_REVIEW_BELOW_CONFIDENCE = 0.7;

const GRAPH_CONNECTION_KINDS = new Set<PersonalizationActionKind>(['graph_edge', 'graph_entity']);

@Injectable()
export class PersonalizationService {
  private readonly profileCache = new Map<string, { profile: PersonalizationProfile; expiresAt: number }>();

  constructor(
    private readonly personService: PersonService,
    private readonly userContextService: UserContextService,
  ) {}

  invalidateCache(userId: string): void {
    this.profileCache.delete(userId);
  }

  async getProfile(userId: string): Promise<PersonalizationProfile> {
    const cached = this.profileCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.profile;
    }

    const context = { userId } as UserServiceContext;
    const selfIdentity = await this.userContextService.getSelfIdentity(userId);
    if (!selfIdentity) {
      return PersonalizationService.profileForTrustMode(DEFAULT_TRUST_MODE);
    }

    const self = await this.personService.findById(context, selfIdentity.entityId);
    const planner = (self?.properties?.planner ?? {}) as Record<string, unknown>;
    const rawTrust = planner.trust_mode;
    const trustMode: TrustMode =
      rawTrust === 'cautious' || rawTrust === 'balanced' || rawTrust === 'hands_off'
        ? rawTrust
        : DEFAULT_TRUST_MODE;

    const profile = PersonalizationService.profileForTrustMode(trustMode);
    this.profileCache.set(userId, { profile, expiresAt: Date.now() + 60_000 });

    return profile;
  }

  async getTrustMode(userId: string): Promise<TrustMode> {
    return (await this.getProfile(userId)).trustMode;
  }

  async updateTrustMode(context: UserServiceContext, trustMode: TrustMode): Promise<PersonalizationProfile> {
    const selfIdentity = await this.userContextService.getSelfIdentity(context.userId!);
    if (!selfIdentity) {
      throw new Error('Self entity not found');
    }

    const self = await this.personService.findById(context, selfIdentity.entityId);
    if (!self) {
      throw new Error('Self entity not found');
    }

    const properties = {
      ...(self.properties ?? {}),
      planner: {
        ...((self.properties?.planner as Record<string, unknown> | undefined) ?? {}),
        trust_mode: trustMode,
        source: 'settings',
      },
    };

    await this.personService.patch(context, self.id, { propertiesPatch: properties });
    this.invalidateCache(context.userId!);

    return PersonalizationService.profileForTrustMode(trustMode);
  }

  async decideAction(userId: string, input: DecideActionInput): Promise<PersonalizationDecision> {
    const profile = await this.getProfile(userId);

    return PersonalizationService.decide(profile, input);
  }

  static profileForTrustMode(trustMode: TrustMode): PersonalizationProfile {
    switch (trustMode) {
      case 'cautious':
        return {
          trustMode,
          autoPromoteThreshold: 1,
          autoSchedule: false,
          requireReviewForUserInput: true,
          feedActionLimit: 50,
          insightVolumeMultiplier: 0.5,
        };
      case 'hands_off':
        return {
          trustMode,
          autoPromoteThreshold: 0.7,
          autoSchedule: true,
          requireReviewForUserInput: false,
          feedActionLimit: 10,
          insightVolumeMultiplier: 1.5,
        };
      case 'balanced':
      default:
        return {
          trustMode,
          autoPromoteThreshold: 0.85,
          autoSchedule: false,
          requireReviewForUserInput: false,
          feedActionLimit: 25,
          insightVolumeMultiplier: 1,
        };
    }
  }

  static decide(profile: PersonalizationProfile, input: DecideActionInput): PersonalizationDecision {
    const { kind, confidence, hasUserInput = true } = input;
    const isGraphConnection = GRAPH_CONNECTION_KINDS.has(kind);
    const isLowConfidence = confidence < ALWAYS_REVIEW_BELOW_CONFIDENCE;

    if (isLowConfidence && hasUserInput) {
      return 'review';
    }

    if (profile.trustMode === 'cautious') {
      if (kind === 'insights_generation' || kind === 'feed_action') {
        return confidence >= profile.autoPromoteThreshold ? 'auto' : 'skip';
      }

      return hasUserInput ? 'review' : 'skip';
    }

    if (profile.trustMode === 'hands_off') {
      if (kind === 'schedule_accept' && !profile.autoSchedule) {
        return confidence >= 0.9 ? 'auto' : 'review';
      }

      return confidence >= profile.autoPromoteThreshold ? 'auto' : 'review';
    }

    // balanced — never auto-apply graph connections; only hands_off does at lower confidence.
    if (isGraphConnection) {
      return 'review';
    }

    if (kind === 'schedule_accept') {
      return profile.autoSchedule && confidence >= 0.9 ? 'auto' : 'review';
    }

    if (kind === 'inferred_fact') {
      return confidence >= profile.autoPromoteThreshold ? 'auto' : 'review';
    }

    if (confidence >= profile.autoPromoteThreshold) {
      return 'auto';
    }

    return kind === 'insights_generation' || kind === 'feed_action' ? 'skip' : 'review';
  }

  static thresholdForKind(profile: PersonalizationProfile, kind: PersonalizationActionKind): number {
    if (GRAPH_CONNECTION_KINDS.has(kind) && profile.trustMode !== 'hands_off') {
      return 1;
    }

    if (kind === 'schedule_accept') {
      return profile.autoSchedule ? 0.7 : 0.95;
    }

    return profile.autoPromoteThreshold;
  }
}
