export interface LoginDto {
  username: string;
  password: string;
}

export interface JwtPayload {
  sub: string;
}

export interface SignedRequest extends Request {
  userId: string;
}

export interface SessionMetadata {
  ip?: string;
  userAgent?: string;
}
