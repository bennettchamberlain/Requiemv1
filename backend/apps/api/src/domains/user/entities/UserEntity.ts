import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../types';

@Entity('users')
export class UserEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  @Column()
  onboarded!: boolean;

  @Column({ type: 'uuid', name: 'entity_id', nullable: true })
  entityId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  toUser() {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      onboarded: this.onboarded,
    } satisfies User;
  }
}
