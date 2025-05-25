import type { Application } from './types';
import type { JobQueueService } from '../services/job-queue-service';

export async function configureJobQueue(app: Application): Promise<void> {
  const jobQueueService = app.get('jobQueueService') as JobQueueService;

  if (jobQueueService) {
    try {
      await jobQueueService.start();

      // Graceful shutdown handler
      const gracefulShutdown = async () => {
        console.log('Shutting down job queue...');
        await jobQueueService.stop();
        process.exit(0);
      };

      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGINT', gracefulShutdown);

    } catch (error) {
      console.error('Failed to start job queue service:', error);
      throw error;
    }
  }
}
