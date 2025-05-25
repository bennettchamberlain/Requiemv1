import { JWTStrategy } from '@feathersjs/authentication';
import { LocalStrategy } from '@feathersjs/authentication-local';

import {
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
} from '../services';

import {
  setupJobAdminService,
  setupHealthCheckService,
  setupDashboardService,
} from '../services/job-admin-api.service';

import type { Application } from './types';

export function configure(app: Application) {
  const db = app.get('postgresqlClient');
  const authenticationService = new AuthenticationService(app);

  authenticationService.register('jwt', new JWTStrategy());
  authenticationService.register('local', new LocalStrategy());

  // Initialize job queue service and store it in app configuration
  const jobQueueService = new JobQueueService(app);
  app.set('jobQueueService', jobQueueService);

  app.use('users', new UserService(db));
  app.use('signup', new SignupService(app));
  app.use('authenticate', authenticationService);
  app.use('embeddings', new EmbeddingsService(app));
  app.use('internalEmbeddings', new InternalEmbeddingsService(db));
  app.use('jobs', new JobsService(app));
  app.use('scheduledJobs', new ScheduledJobsService(app));
  app.use('llm', new LLMService(app));
  app.use('llmChat', new LLMChatService(app));
  app.use('llmJobs', new LLMJobService(app));
  app.use('llmUtility', new LLMUtilityService(app));

  // Setup admin and monitoring services
  setupJobAdminService(app);
  setupHealthCheckService(app);
  setupDashboardService(app);

  app.service('users').hooks(UserService.hooks);
  app.service('authenticate').hooks(AuthenticationService.hooks);
  app.service('embeddings').hooks(EmbeddingsService.hooks);
  app.service('jobs').hooks(JobsService.hooks);
  app.service('scheduledJobs').hooks(ScheduledJobsService.hooks);
  app.service('llm').hooks(LLMService.hooks);
  app.service('llmChat').hooks(LLMChatService.hooks);
  app.service('llmJobs').hooks(LLMJobService.hooks);

  // Store job queue service for later access
  app.set('jobQueueService', jobQueueService);
}
