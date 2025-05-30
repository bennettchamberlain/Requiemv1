import { Entity, Column, PrimaryColumn } from 'typeorm';

import { User } from './types';

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

  toUser() {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
    } satisfies User;
  }
}
