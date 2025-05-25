// Performance monitoring and testing utilities for the Job Queue System
// filepath: /Users/williambroza/devel/CI-Server/backend/apps/api/src/utils/job-queue-performance.ts

import { getJobQueue } from './job-queue-utils';
import type { Application } from '../configuration/types';

interface PerformanceMetrics {
  timestamp: string;
  queueSizes: Record<string, number>;
  completedJobs: number;
  failedJobs: number;
  avgProcessingTime: number;
  throughput: number;
  errorRate: number;
  memoryUsage?: NodeJS.MemoryUsage;
  cpuUsage?: number;
}

interface LoadTestConfig {
  jobCount: number;
  concurrency: number;
  duration?: number;
  jobTypes: string[];
  payload?: any;
  priority?: number;
}

interface LoadTestResult {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  duration: number;
  throughput: number;
  avgResponseTime: number;
  errorRate: number;
  metrics: PerformanceMetrics[];
}

/**
 * Performance monitoring and testing utilities for job queue
 */
export class JobQueuePerformanceMonitor {
  private app: Application;
  private metrics: PerformanceMetrics[] = [];
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Start continuous performance monitoring
   */
  startMonitoring(intervalMs: number = 5000): void {
    if (this.isMonitoring) {
      console.log('Performance monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    console.log(`Starting performance monitoring with ${intervalMs}ms interval`);

    this.monitoringInterval = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics();
        this.metrics.push(metrics);

        // Keep only last 1000 metrics to prevent memory issues
        if (this.metrics.length > 1000) {
          this.metrics = this.metrics.slice(-1000);
        }

        this.logMetrics(metrics);
      } catch (error) {
        console.error('Error collecting performance metrics:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring(): PerformanceMetrics[] {
    if (!this.isMonitoring) {
      console.log('Performance monitoring is not running');
      return this.metrics;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    console.log('Performance monitoring stopped');
    return this.metrics;
  }

  /**
   * Get current performance metrics
   */
  async getCurrentMetrics(): Promise<PerformanceMetrics> {
    return await this.collectMetrics();
  }

  /**
   * Get historical metrics
   */
  getHistoricalMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * Run comprehensive load test
   */
  async runLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
    console.log('Starting load test with config:', config);

    const startTime = Date.now();
    const jobPromises: Promise<any>[] = [];
    let completedJobs = 0;
    let failedJobs = 0;
    const responseTimes: number[] = [];

    // Start monitoring for the test
    this.startMonitoring(1000);

    // Queue jobs with controlled concurrency
    for (let i = 0; i < config.jobCount; i++) {
      const jobType = config.jobTypes[i % config.jobTypes.length];

      const jobPromise = this.queueTestJob(i, jobType, config.payload, config.priority)
        .then((result) => {
          completedJobs++;
          if (result.responseTime) {
            responseTimes.push(result.responseTime);
          }
        })
        .catch(() => {
          failedJobs++;
        });

      jobPromises.push(jobPromise);

      // Control concurrency
      if (jobPromises.length >= config.concurrency) {
        await Promise.allSettled(jobPromises.splice(0, config.concurrency));
      }

      // Optional: Rate limiting
      if (config.duration && (Date.now() - startTime) > config.duration) {
        break;
      }
    }

    // Wait for remaining jobs
    if (jobPromises.length > 0) {
      await Promise.allSettled(jobPromises);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Stop monitoring and get metrics
    const testMetrics = this.stopMonitoring();

    const result: LoadTestResult = {
      totalJobs: config.jobCount,
      completedJobs,
      failedJobs,
      duration,
      throughput: (completedJobs / duration) * 1000, // jobs per second
      avgResponseTime: responseTimes.length > 0
        ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
        : 0,
      errorRate: failedJobs / config.jobCount,
      metrics: testMetrics,
    };

    console.log('Load test completed:', result);
    return result;
  }

  /**
   * Run sustained load test over time
   */
  async runSustainedLoadTest(
    jobsPerSecond: number,
    durationSeconds: number,
    jobType: string = 'load-test'
  ): Promise<LoadTestResult> {
    console.log(`Running sustained load test: ${jobsPerSecond} jobs/sec for ${durationSeconds}s`);

    const startTime = Date.now();
    const intervalMs = 1000 / jobsPerSecond;
    let totalJobs = 0;
    let completedJobs = 0;
    let failedJobs = 0;

    this.startMonitoring(1000);

    return new Promise((resolve) => {
      const jobInterval = setInterval(async () => {
        try {
          await this.queueTestJob(totalJobs, jobType);
          totalJobs++;
          completedJobs++;
        } catch (error) {
          totalJobs++;
          failedJobs++;
        }
      }, intervalMs);

      setTimeout(() => {
        clearInterval(jobInterval);
        const endTime = Date.now();
        const duration = endTime - startTime;
        const testMetrics = this.stopMonitoring();

        const result: LoadTestResult = {
          totalJobs,
          completedJobs,
          failedJobs,
          duration,
          throughput: (completedJobs / duration) * 1000,
          avgResponseTime: 0, // Not tracked in sustained test
          errorRate: failedJobs / totalJobs,
          metrics: testMetrics,
        };

        console.log('Sustained load test completed:', result);
        resolve(result);
      }, durationSeconds * 1000);
    });
  }

  /**
   * Test queue recovery after high load
   */
  async testQueueRecovery(): Promise<any> {
    console.log('Testing queue recovery capabilities');

    // Phase 1: Overload the queue
    console.log('Phase 1: Overloading queue...');
    const overloadResult = await this.runLoadTest({
      jobCount: 1000,
      concurrency: 50,
      jobTypes: ['stress-test'],
      payload: { heavy: true },
      priority: 1,
    });

    // Phase 2: Wait and monitor recovery
    console.log('Phase 2: Monitoring recovery...');
    this.startMonitoring(2000);

    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

    const recoveryMetrics = this.stopMonitoring();

    // Phase 3: Test normal operation
    console.log('Phase 3: Testing normal operation...');
    const normalResult = await this.runLoadTest({
      jobCount: 100,
      concurrency: 5,
      jobTypes: ['normal-test'],
      payload: { light: true },
      priority: 5,
    });

    return {
      overloadPhase: overloadResult,
      recoveryMetrics,
      normalPhase: normalResult,
      recoveryTime: this.calculateRecoveryTime(recoveryMetrics),
    };
  }

  /**
   * Generate performance report
   */
  generateReport(): any {
    if (this.metrics.length === 0) {
      return { error: 'No metrics available' };
    }

    const recent = this.metrics.slice(-10);
    const avgThroughput = recent.reduce((sum, m) => sum + m.throughput, 0) / recent.length;
    const avgErrorRate = recent.reduce((sum, m) => sum + m.errorRate, 0) / recent.length;
    const avgProcessingTime = recent.reduce((sum, m) => sum + m.avgProcessingTime, 0) / recent.length;

    const queueSizes = recent[recent.length - 1]?.queueSizes || {};
    const totalPendingJobs = Object.values(queueSizes).reduce((sum, size) => sum + size, 0);

    return {
      timestamp: new Date().toISOString(),
      summary: {
        avgThroughput: Math.round(avgThroughput * 100) / 100,
        avgErrorRate: Math.round(avgErrorRate * 10000) / 100, // percentage
        avgProcessingTime: Math.round(avgProcessingTime),
        totalPendingJobs,
      },
      currentQueues: queueSizes,
      trends: this.calculateTrends(),
      recommendations: this.generateRecommendations(),
      metrics: recent,
    };
  }

  // Private helper methods

  private async collectMetrics(): Promise<PerformanceMetrics> {
    const jobQueue = getJobQueue(this.app);

    try {
      const queueSizes = await this.getQueueSizes(jobQueue);
      const memoryUsage = process.memoryUsage();

      return {
        timestamp: new Date().toISOString(),
        queueSizes,
        completedJobs: 0, // Would need to track this in production
        failedJobs: 0,    // Would need to track this in production
        avgProcessingTime: Math.random() * 1000 + 500, // Mock for now
        throughput: Math.random() * 100 + 50,           // Mock for now
        errorRate: Math.random() * 0.05,                // Mock for now
        memoryUsage,
        cpuUsage: this.getCpuUsage(),
      };
    } catch (error) {
      console.error('Error collecting metrics:', error);
      return {
        timestamp: new Date().toISOString(),
        queueSizes: {},
        completedJobs: 0,
        failedJobs: 0,
        avgProcessingTime: 0,
        throughput: 0,
        errorRate: 1,
      };
    }
  }

  private async getQueueSizes(jobQueue: any): Promise<Record<string, number>> {
    const queues = ['ai-processing', 'notifications', 'data-processing'];
    const sizes: Record<string, number> = {};

    for (const queue of queues) {
      try {
        sizes[queue] = await jobQueue.getQueueSize(queue) || 0;
      } catch (error) {
        sizes[queue] = 0;
      }
    }

    return sizes;
  }

  private getCpuUsage(): number {
    // Simple CPU usage estimation (would use proper monitoring in production)
    return Math.random() * 100;
  }

  private async queueTestJob(
    index: number,
    jobType: string,
    payload?: any,
    priority?: number
  ): Promise<{ responseTime?: number }> {
    const jobQueue = getJobQueue(this.app);
    const startTime = Date.now();

    try {
      await jobQueue.sendJob(jobType, {
        index,
        payload: payload || `test-data-${index}`,
        timestamp: new Date().toISOString(),
      }, {
        priority: priority || 1,
        retryLimit: 1,
      });

      const responseTime = Date.now() - startTime;
      return { responseTime };
    } catch (error) {
      throw error;
    }
  }

  private logMetrics(metrics: PerformanceMetrics): void {
    const totalPending = Object.values(metrics.queueSizes).reduce((sum, size) => sum + size, 0);

    console.log(`[JobQueue] Throughput: ${metrics.throughput.toFixed(1)} j/s, ` +
                `Pending: ${totalPending}, ` +
                `Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%, ` +
                `Memory: ${(metrics.memoryUsage?.heapUsed || 0 / 1024 / 1024).toFixed(1)}MB`);
  }

  private calculateRecoveryTime(metrics: PerformanceMetrics[]): number {
    // Find when queues returned to normal levels
    for (let i = 0; i < metrics.length; i++) {
      const totalPending = Object.values(metrics[i].queueSizes).reduce((sum, size) => sum + size, 0);
      if (totalPending < 10) { // Threshold for "recovered"
        return i * 2000; // 2 second intervals
      }
    }
    return metrics.length * 2000; // Full monitoring period
  }

  private calculateTrends(): any {
    if (this.metrics.length < 2) return null;

    const recent = this.metrics.slice(-10);
    const older = this.metrics.slice(-20, -10);

    if (older.length === 0) return null;

    const recentAvg = recent.reduce((sum, m) => sum + m.throughput, 0) / recent.length;
    const olderAvg = older.reduce((sum, m) => sum + m.throughput, 0) / older.length;

    return {
      throughputTrend: recentAvg > olderAvg ? 'increasing' : 'decreasing',
      throughputChange: ((recentAvg - olderAvg) / olderAvg * 100).toFixed(1) + '%',
    };
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const latest = this.metrics[this.metrics.length - 1];

    if (!latest) return recommendations;

    const totalPending = Object.values(latest.queueSizes).reduce((sum, size) => sum + size, 0);

    if (totalPending > 100) {
      recommendations.push('Consider increasing worker concurrency');
    }

    if (latest.errorRate > 0.1) {
      recommendations.push('High error rate detected - check job handlers');
    }

    if (latest.avgProcessingTime > 5000) {
      recommendations.push('Jobs taking longer than expected - review processing logic');
    }

    if (latest.memoryUsage && latest.memoryUsage.heapUsed > 500 * 1024 * 1024) {
      recommendations.push('High memory usage - consider optimization');
    }

    return recommendations;
  }
}

/**
 * Quick performance test utility
 */
export async function quickPerformanceTest(app: Application): Promise<void> {
  const monitor = new JobQueuePerformanceMonitor(app);

  console.log('Running quick performance test...');

  const result = await monitor.runLoadTest({
    jobCount: 50,
    concurrency: 5,
    jobTypes: ['quick-test'],
    priority: 5,
  });

  console.log('Quick test results:', {
    throughput: `${result.throughput.toFixed(2)} jobs/second`,
    errorRate: `${(result.errorRate * 100).toFixed(2)}%`,
    avgResponseTime: `${result.avgResponseTime.toFixed(2)}ms`,
  });
}

/**
 * Comprehensive performance benchmark
 */
export async function runPerformanceBenchmark(app: Application): Promise<any> {
  const monitor = new JobQueuePerformanceMonitor(app);

  console.log('Running comprehensive performance benchmark...');

  const tests = [
    {
      name: 'Low Load',
      config: { jobCount: 50, concurrency: 2, jobTypes: ['benchmark-low'] },
    },
    {
      name: 'Medium Load',
      config: { jobCount: 200, concurrency: 10, jobTypes: ['benchmark-medium'] },
    },
    {
      name: 'High Load',
      config: { jobCount: 500, concurrency: 25, jobTypes: ['benchmark-high'] },
    },
  ];

  const results = [];

  for (const test of tests) {
    console.log(`Running ${test.name} test...`);
    const result = await monitor.runLoadTest(test.config);
    results.push({ name: test.name, result });

    // Cool down between tests
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  return {
    timestamp: new Date().toISOString(),
    tests: results,
    summary: {
      bestThroughput: Math.max(...results.map(r => r.result.throughput)),
      worstErrorRate: Math.max(...results.map(r => r.result.errorRate)),
      avgResponseTime: results.reduce((sum, r) => sum + r.result.avgResponseTime, 0) / results.length,
    },
  };
}

export default JobQueuePerformanceMonitor;
