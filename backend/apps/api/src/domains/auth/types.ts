export interface LoginDto {
  username: string;
  password: string;
}

export interface SignupDto {
  name: string;
  email: string;
  password: string;
  signup_code?: string;
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

export interface UpdateSignupCodeDto {
  used?: boolean;
}

export interface RotationResult {
  sessionToken: string | null;
}
