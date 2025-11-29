import { type ExecutionContext, Injectable, InternalServerErrorException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    // This guard is specifically for HTTP controllers. If used elsewhere, it's
    // a developer error.
    if (context.getType<'graphql' | 'http'>() !== 'http') {
      throw new InternalServerErrorException('JwtAuthGuard can only be used with HTTP controllers');
    }

    return super.canActivate(context);
  }
}
