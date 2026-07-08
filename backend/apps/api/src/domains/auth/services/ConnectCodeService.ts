import { createHash, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { decrypt, encrypt } from '@ci/common/crypto';
import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import { ConnectCodeEntity } from '../entities/ConnectCodeEntity';

/** Raw code entropy in bytes → 256 bits, hex-encoded. */
const CODE_BYTE_LENGTH = 32;
/** Codes are single-use and consumed within one redirect round-trip; keep the window tight. */
const CODE_TTL_MS = 60_000;

/**
 * The payload recovered from a successfully-consumed connect code.
 */
export interface ConsumedConnectCode {
  /** The owning user the api key belongs to. */
  userId: string;
  /** The app URN the key was minted for. */
  appUrn: string;
  /** The raw (decrypted) api key — revealed exactly once, here. */
  key: string;
}

/**
 * Issues and redeems the short-lived, single-use authorization codes that
 * bridge the browser-side consent step and CI-Hub's server-to-server key
 * exchange (see {@link ConnectService}).
 *
 * Security properties:
 * - The raw code is high-entropy (256-bit) and stored only as a SHA-256 hash.
 * - The minted api key is stored field-encrypted; a DB read cannot recover it.
 * - Redemption is atomic and single-use (a conditional `used_at` update), so a
 *   replayed or concurrent exchange cannot mint two live sessions from one code.
 * - Codes expire quickly ({@link CODE_TTL_MS}); expired rows are swept lazily.
 */
@Injectable()
export class ConnectCodeService {
  constructor(
    @InjectRepository(ConnectCodeEntity)
    private readonly connectCodeRepository: Repository<ConnectCodeEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectCodeService.name);
  }

  /**
   * Issue a one-time code that maps to `key` for `(userId, appUrn)`.
   *
   * @returns the raw code to place in the redirect back to CI-Hub
   */
  async issue(userId: string, appUrn: string, key: string): Promise<string> {
    const rawCode = randomBytes(CODE_BYTE_LENGTH).toString('hex');

    const entity = this.connectCodeRepository.create({
      id: uuidv7(),
      hashed_code: this.hash(rawCode),
      encrypted_key: encrypt(key, config.auth.encryption.fieldKey),
      user_id: userId,
      app_urn: appUrn,
      expires_at: new Date(Date.now() + CODE_TTL_MS),
      used_at: null,
    });

    await this.connectCodeRepository.save(entity);

    this.logger.debug(`Issued connect code for app ${appUrn} (user ${userId})`);

    return rawCode;
  }

  /**
   * Redeem a raw code exactly once. Returns the decrypted payload, or `null`
   * when the code is unknown, expired, or already consumed.
   */
  async consume(rawCode: string): Promise<ConsumedConnectCode | null> {
    const hashedCode = this.hash(rawCode);

    const row = await this.connectCodeRepository.findOne({ where: { hashed_code: hashedCode } });

    if (!row) {
      this.logger.warn('Connect code exchange rejected: unknown code');

      return null;
    }

    if (row.used_at) {
      this.logger.warn(`Connect code exchange rejected: already used (app ${row.app_urn})`);

      return null;
    }

    if (row.expires_at < new Date()) {
      this.logger.warn(`Connect code exchange rejected: expired (app ${row.app_urn})`);

      return null;
    }

    // Atomically claim the code: only the first exchange flips used_at from NULL,
    // so concurrent/replayed exchanges of the same code cannot both succeed.
    const claim = await this.connectCodeRepository.update(
      { id: row.id, used_at: IsNull() },
      { used_at: new Date() },
    );

    if ((claim.affected ?? 0) === 0) {
      this.logger.warn(`Connect code exchange lost race: already claimed (app ${row.app_urn})`);

      return null;
    }

    this.logger.debug(`Connect code exchanged for app ${row.app_urn} (user ${row.user_id})`);

    return {
      userId: row.user_id,
      appUrn: row.app_urn,
      key: decrypt(row.encrypted_key, config.auth.encryption.fieldKey),
    };
  }

  /**
   * Delete expired codes. Intended to be called opportunistically; retention of
   * used codes is unnecessary once consumed, but expiry alone bounds the table.
   */
  async pruneExpired(): Promise<number> {
    const result = await this.connectCodeRepository.delete({ expires_at: LessThan(new Date()) });

    return result.affected ?? 0;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
