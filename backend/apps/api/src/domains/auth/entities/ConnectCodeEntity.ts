import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * A short-lived, single-use authorization code for the app-connect flow.
 *
 * Mirrors the `ci.connect_codes` table. The raw connect code is never stored —
 * only its SHA-256 hash — and the minted api key is stored field-encrypted
 * (`encrypted_key`), so a database read alone cannot recover a usable secret.
 * A row is valid until `expires_at` and is consumed (`used_at` set) by the
 * single exchange call.
 */
@Entity({ schema: 'ci', name: 'connect_codes' })
export class ConnectCodeEntity {
  @PrimaryColumn('uuid')
  id!: string;

  /** SHA-256 hex of the raw code handed to the browser. */
  @Column({ type: 'text' })
  hashed_code!: string;

  /** The minted api key, field-encrypted (AES-256-GCM). Revealed once on exchange. */
  @Column({ type: 'text' })
  encrypted_key!: string;

  /** Owning user (the consenting appliance owner). */
  @Column({ type: 'uuid' })
  user_id!: string;

  /** The app (URN) the key was minted for; asserted on exchange. */
  @Column({ type: 'text' })
  app_urn!: string;

  @Column({ type: 'timestamptz' })
  expires_at!: Date;

  /** Set the moment the code is exchanged; a non-null value means "already used". */
  @Column({ type: 'timestamptz', nullable: true })
  used_at!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
