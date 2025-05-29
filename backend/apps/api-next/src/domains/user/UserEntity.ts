import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

import { User } from './types';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string; // Keep as string, safer for JS... questionable... claimed from ChatGPT

  @Column()
  external_id!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  toUser() {
    return {
      id: this.external_id,
      pk: this.id,
      name: this.name,
      email: this.email,
    } satisfies User;
  }
}
