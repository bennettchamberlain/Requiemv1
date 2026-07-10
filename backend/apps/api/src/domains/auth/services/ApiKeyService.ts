import { createHash, randomBytes } from 'crypto';

import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { SYSTEM_USER, type ServiceContext, type UserServiceContext } from '@ci/common/context';
import { MEMORY_SCOPE } from '@ci/common/decorators';

import { ApiKey, ApiKeyEntity } from '../entities/ApiKeyEntity';
import type { CreateApiKeyDto, CreateApiKeyResponse, UpdateApiKeyDto } from '../types';

const API_KEY_BYTE_LENGTH = 32;
const API_KEY_HEX_LENGTH = API_KEY_BYTE_LENGTH * 2;
const API_KEY_HEX_REGEX = /^[0-9a-f]+$/;
const PREFIX_LENGTH = 5;

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(ApiKeyEntity)
    private readonly apiKeyRepository: Repository<ApiKeyEntity>,
  ) {}

  async create(context: UserServiceContext, data: CreateApiKeyDto): Promise<CreateApiKeyResponse> {
    const rawKey = randomBytes(API_KEY_BYTE_LENGTH).toString('hex');
    const prefix = rawKey.substring(0, PREFIX_LENGTH);
    const hashedKey = this.hash(rawKey);

    const entity = this.apiKeyRepository.create({
      id: uuidv7(),
      name: data.name,
      prefix,
      hashed_key: hashedKey,
      scopes: data.scopes ?? [],
      expires_at: data.expires_at ? new Date(data.expires_at) : null,
      user_id: context.userId,
    });

    const saved = await this.apiKeyRepository.save(entity);

    return {
      ...ApiKeyEntity.toEgressType(saved),
      key: rawKey,
    };
  }

  /**
   * Mint an api key idempotently for a `(user, name)` pair, rotating any
   * existing key with the same name.
   *
   * The raw key is only ever revealed at creation time (it is stored hashed),
   * so re-provisioning cannot return a previously-issued secret — instead the
   * old key is deleted and a fresh one minted and returned. This keeps repeated
   * provision calls (e.g. the Hub reconnecting an app, or key rotation) from
   * accumulating dead rows while guaranteeing the caller always receives a
   * usable secret. Callers that only need "a key exists" should check
   * {@link findByName} first.
   *
   * @param context - the owning user
   * @param data - key attributes; `name` doubles as the idempotency key
   */
  async createOrRotate(context: UserServiceContext, data: CreateApiKeyDto): Promise<CreateApiKeyResponse> {
    try {
      await this.apiKeyRepository.delete({ user_id: context.userId, name: data.name });

      return await this.create(context, data);
    } catch (err) {
      // Two concurrent createOrRotate calls for the same (user, name) — e.g. a
      // re-consent racing the Hub's rotation sweep — can interleave delete/insert
      // so this insert trips the (user_id, name) unique index (idx_api_keys_user_id_app_name).
      // Retry once: the racing winner's row now exists, so our delete removes it
      // and the re-insert succeeds. Last-writer-wins is fine — both callers only
      // need a valid key to exist — and it turns a 500 into idempotent rotation.
      if (!this.isUniqueViolation(err)) {
        throw err;
      }

      await this.apiKeyRepository.delete({ user_id: context.userId, name: data.name });

      return this.create(context, data);
    }
  }

  /** Whether a caught error is a Postgres unique-violation (SQLSTATE 23505). */
  private isUniqueViolation(err: unknown): boolean {
    const code =
      (err as { code?: string; driverError?: { code?: string } } | null)?.code ??
      (err as { driverError?: { code?: string } } | null)?.driverError?.code;

    return code === '23505';
  }

  /**
   * Resolve the owning user id for a key by `name`, regardless of owner, or null
   * if no such key exists. Used by the trusted connect-rotate path: CI-Hub asks
   * to rotate "the key for app X" by its stable name without knowing the owning
   * `ci.users` id; this recovers it so the fresh key is minted under the same
   * user. Because `(user_id, name)` is unique for `app:%` names there is at most
   * one such row.
   */
  async findUserIdByName(name: string): Promise<string | null> {
    const key = await this.apiKeyRepository.findOne({ where: { name }, select: ['user_id'] });

    return key?.user_id ?? null;
  }

  /**
   * Look up a single api key by its `(user, name)` pair, or null if none exists.
   * Used to detect whether an app has already been provisioned before deciding
   * to mint or rotate.
   */
  async findByName(context: UserServiceContext, name: string): Promise<ApiKey | null> {
    const key = await this.apiKeyRepository.findOne({
      where: { user_id: context.userId, name },
    });

    return key ? ApiKeyEntity.toEgressType(key) : null;
  }

  async findAllByUser(context: ServiceContext): Promise<ApiKey[]> {
    const keys = await this.apiKeyRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && { user_id: context.userId }),
      },
      order: { created_at: 'DESC' },
    });

    return keys.map(ApiKeyEntity.toEgressType);
  }

  async findOneByUser(context: ServiceContext, keyId: string): Promise<ApiKey | null> {
    const key = await this.apiKeyRepository.findOne({
      where: {
        id: keyId,
        ...(context.userId !== SYSTEM_USER && { user_id: context.userId }),
      },
    });

    return key ? ApiKeyEntity.toEgressType(key) : null;
  }

  async update(context: ServiceContext, keyId: string, data: UpdateApiKeyDto): Promise<ApiKey | null> {
    const key = await this.apiKeyRepository.findOne({
      where: {
        id: keyId,
        ...(context.userId !== SYSTEM_USER && { user_id: context.userId }),
      },
    });

    if (!key) {
      return null;
    }

    // Hub-managed connection keys are revoked by the Hub via their stable
    // `app:<urn>` name (see removeByName). Renaming or re-scoping one out-of-band
    // would orphan that revoke and strand the key, so refuse those mutations here
    // — not just in the UI, which only hides the control. Deleting is still
    // allowed (a user may deliberately force-revoke). A no-op submit that echoes
    // the current name/scopes is tolerated so idempotent clients don't 403.
    if (this.isHubManagedKey(key)) {
      const renaming = data.name !== undefined && data.name !== key.name;
      const rescoping = data.scopes !== undefined && !this.sameScopes(data.scopes, key.scopes ?? []);

      if (renaming || rescoping) {
        throw new ForbiddenException(
          'This key is managed by Companion Hub and cannot be renamed or re-scoped. Disconnect the app from Hub instead.',
        );
      }
    }

    if (data.name !== undefined) {
      key.name = data.name;
    }

    if (data.scopes !== undefined) {
      key.scopes = data.scopes;
    }

    const saved = await this.apiKeyRepository.save(key);

    return ApiKeyEntity.toEgressType(saved);
  }

  /**
   * A Hub-managed connection key: minted by the connect flow, named `app:<urn>`
   * with the `memory` scope, and lifecycle-owned by CI-Hub (which revokes it by
   * that exact name). Mirrors the discriminator used in the API-keys UI.
   */
  private isHubManagedKey(key: Pick<ApiKeyEntity, 'name' | 'scopes'>): boolean {
    return key.name.startsWith('app:') && (key.scopes ?? []).includes(MEMORY_SCOPE);
  }

  /** Order-insensitive scope-set equality (scope lists are small). */
  private sameScopes(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false;
    }

    const other = new Set(b);

    return a.every((scope) => other.has(scope));
  }

  async remove(context: ServiceContext, keyId: string): Promise<boolean> {
    const result = await this.apiKeyRepository.delete({
      id: keyId,
      ...(context.userId !== SYSTEM_USER && { user_id: context.userId }),
    });

    return (result.affected ?? 0) > 0;
  }

  /**
   * Delete every api key with the given `name`, regardless of owner, returning
   * the number removed.
   *
   * This is a system-level revoke used by the trusted connect flow: CI-Hub (via
   * signed forward-auth) revokes "the key for app X" by its stable name
   * (`app:<urn>`) without knowing the owning `ci.users` id. Because
   * `(user_id, name)` is unique there is at most one row per user; on the
   * single-owner appliance that is exactly the app's key.
   */
  async removeByName(name: string): Promise<number> {
    const result = await this.apiKeyRepository.delete({ name });

    return result.affected ?? 0;
  }

  async validateKey(rawKey: string): Promise<{ userId: string; scopes: string[] } | null> {
    if (rawKey.length !== API_KEY_HEX_LENGTH || !API_KEY_HEX_REGEX.test(rawKey)) {
      return null;
    }

    const hashed = this.hash(rawKey);

    const key = await this.apiKeyRepository.findOne({
      where: { hashed_key: hashed },
      select: ['id', 'user_id', 'expires_at', 'scopes'],
    });

    if (!key) {
      return null;
    }

    if (key.expires_at && key.expires_at < new Date()) {
      return null;
    }

    await this.apiKeyRepository.update(key.id, { last_used_at: new Date() });

    // `scopes` drives least-privilege enforcement downstream (see ScopesGuard).
    // An empty array is a legacy full-access key, preserved as-is.
    return { userId: key.user_id, scopes: key.scopes ?? [] };
  }

  private hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }
}
