export interface LoginDto {
  username: string;
  password: string;
}

export interface JwtPayload {
  sub: string;
}
