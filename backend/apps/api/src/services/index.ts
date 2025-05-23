import { AuthenticationService } from './authentication-service';
import { EmbeddingsService, InternalEmbeddingsService } from './embeddings-service';
import { SignupService } from './signup-service';
import { UserService } from './user-service';

export interface ServiceTypes {
  authenticate: AuthenticationService;
  embeddings: EmbeddingsService;
  internalEmbeddings: InternalEmbeddingsService;
  signup: SignupService;
  users: UserService;
}

export {
  AuthenticationService,
  EmbeddingsService,
  InternalEmbeddingsService,
  SignupService,
  UserService,
};
