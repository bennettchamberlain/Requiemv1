import { AuthenticationService } from './authentication-service';
import { SignupService } from './signup-service';
import { UserService } from './user-service';

export interface ServiceTypes {
  authenticate: AuthenticationService;
  signup: SignupService;
  users: UserService;
}

export {
  AuthenticationService,
  SignupService,
  UserService,
};
