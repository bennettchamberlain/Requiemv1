import { createHash, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { ServiceContext } from '@ci/common/context';

import { ApiKeyEntity } from '../entities/ApiKeyEntity';
import type { ApiKeyResponse, CreateApiKeyDto, CreateApiKeyResponse, UpdateApiKeyDto } from '../types';

const API_KEY_BYTE_LENGTH = 32;
const PREFIX_LENGTH = 5;

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(ApiKeyEntity)
    private readonly apiKeyRepository: Repository<ApiKeyEntity>,
  ) {}

  async create(context: ServiceContext, data: CreateApiKeyDto): Promise<CreateApiKeyResponse> {
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
      user: { id: context.userId as string },
    });

    const saved = await this.apiKeyRepository.save(entity);

    return {
      id: saved.id,
      name: saved.name,
      prefix: saved.prefix,
      scopes: saved.scopes,
      expires_at: saved.expires_at,
      last_used_at: saved.last_used_at,
      created_at: saved.created_at,
      updated_at: saved.updated_at,
      key: rawKey,
    };
  }

  async findAllByUser(context: ServiceContext): Promise<ApiKeyResponse[]> {
    const keys = await this.apiKeyRepository.find({
      where: { user: { id: context.userId as string } },
      order: { created_at: 'DESC' },
    });

    return keys.map(this.toResponse);
  }

  async findOneByUser(context: ServiceContext, keyId: string): Promise<ApiKeyResponse | null> {
    const key = await this.apiKeyRepository.findOne({
      where: { id: keyId, user: { id: context.userId as string } },
    });

    return key ? this.toResponse(key) : null;
  }

  async update(
    context: ServiceContext,
    keyId: string,
    data: UpdateApiKeyDto,
  ): Promise<ApiKeyResponse | null> {
    const key = await this.apiKeyRepository.findOne({
      where: { id: keyId, user: { id: context.userId as string } },
    });

    if (!key) {
      return null;
    }

    if (data.name !== undefined) {
      key.name = data.name;
    }

    if (data.scopes !== undefined) {
      key.scopes = data.scopes;
    }

    const saved = await this.apiKeyRepository.save(key);

    return this.toResponse(saved);
  }

  async remove(context: ServiceContext, keyId: string): Promise<boolean> {
    const result = await this.apiKeyRepository.delete({
      id: keyId,
      user: { id: context.userId as string },
    });

    return (result.affected ?? 0) > 0;
  }

  async validateKey(rawKey: string): Promise<{ userId: string } | null> {
    const prefix = rawKey.substring(0, PREFIX_LENGTH);

    const candidates = await this.apiKeyRepository.find({
      where: { prefix },
      relations: ['user'],
    });

    const now = new Date();

    for (const candidate of candidates) {
      if (candidate.expires_at && candidate.expires_at < now) {
        continue;
      }

      const hashed = this.hash(rawKey);

      if (hashed === candidate.hashed_key) {
        candidate.last_used_at = now;
        await this.apiKeyRepository.save(candidate);

        return { userId: candidate.user!.id };
      }
    }

    return null;
  }

  private hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  private toResponse(entity: ApiKeyEntity): ApiKeyResponse {
    return {
      id: entity.id,
      name: entity.name,
      prefix: entity.prefix,
      scopes: entity.scopes,
      expires_at: entity.expires_at,
      last_used_at: entity.last_used_at,
      created_at: entity.created_at,
      updated_at: entity.updated_at,
    };
  }
}
