import { AuthenticationService } from './authentication-service';
import { EmbeddingsService, InternalEmbeddingsService } from './embeddings-service';
import { SignupService } from './signup-service';
import { UserService } from './user-service';
import { QuestionsService } from './questions-service';
import { AnswersService } from './answers-service';

export interface ServiceTypes {
  authenticate: AuthenticationService;
  embeddings: EmbeddingsService;
  internalEmbeddings: InternalEmbeddingsService;
  signup: SignupService;
  users: UserService;
  questions: QuestionsService;
  answers: AnswersService;
}

export {
  AuthenticationService,
  EmbeddingsService,
  InternalEmbeddingsService,
  SignupService,
  UserService,
  QuestionsService,
  AnswersService,
};
