import { AuthenticationService } from './authentication-service';
import { EmbeddingsService, InternalEmbeddingsService } from './embeddings-service';
import JobQueueService from './job-queue-service';
import { JobsService, ScheduledJobsService } from './jobs-service';
import { LLMService, LLMChatService, LLMJobService, LLMUtilityService } from './llm-service';
import { SignupService } from './signup-service';
import { UserService } from './user-service';

export interface ServiceTypes {
  authenticate: AuthenticationService;
  embeddings: EmbeddingsService;
  internalEmbeddings: InternalEmbeddingsService;
  jobQueue: JobQueueService;
  jobs: JobsService;
  scheduledJobs: ScheduledJobsService;
  llm: LLMService;
  llmChat: LLMChatService;
  llmJobs: LLMJobService;
  llmUtility: LLMUtilityService;
  signup: SignupService;
  users: UserService;
}

export {
  AuthenticationService,
  EmbeddingsService,
  InternalEmbeddingsService,
  JobQueueService,
  JobsService,
  ScheduledJobsService,
  LLMService,
  LLMChatService,
  LLMJobService,
  LLMUtilityService,
  SignupService,
  UserService,
};
