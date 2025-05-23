import { AuthenticationService as BaseAuthenticationService } from '@feathersjs/authentication';
import type { HookContext } from '@feathersjs/feathers';

export class AuthenticationService extends BaseAuthenticationService {
  static hooks = {
    after: {
      create: [
        (context: HookContext) => {
          delete context.result.authentication;

          return context;
        },
      ],
    },
  };
}
