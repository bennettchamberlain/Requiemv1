import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'ci', name: 'users' })
export class UserEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  @Column({ type: 'uuid', name: 'entity_id', nullable: true })
  entityId?: string | null;

  @Column()
  onboarded!: boolean;

  /**
   * IANA zone name. The single source of truth for "the user's day" — planning
   * day boundaries, habit rollover and the owner-local job enqueuer all read it
   * from here rather than keeping their own copy.
   */
  @Column({ type: 'text', nullable: true })
  timezone!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  static toEgressType(entity: UserEntity): User {
    return {
      id: entity.id,
      name: entity.name,
      email: entity.email,
      entityId: entity.entityId,
      onboarded: entity.onboarded,
      timezone: entity.timezone,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

export type User = Readonly<Omit<UserEntity, 'password'>>;
