export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface CreateUserDto {
  name: string;
  email: string;
  password: string;
}

export interface UpdateUserDto {
  id?: string;
  name?: string;
  email?: string;
  password?: string;
}
