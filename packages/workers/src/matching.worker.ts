import { Worker, Job, Queue } from 'bullmq';
import { ConfigService } from '@stock-market/config';
import { Logger } from '@stock-market/logger';
import { MatchingEngine } from '@stock-market/orders';

export class MatchingWorker {
  private worker: Worker;
  private schedulerQueue: Queue;

  constructor() {
    const config = ConfigService.getInstance();
    const redisUrl = config.get('REDIS_URL') || 'redis://localhost:6379';

    let connection;
    try {
      const url = new URL(redisUrl);
      connection = {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        username: url.username || undefined,
        password: url.password || undefined,
      };
    } catch {
      connection = { host: '127.0.0.1', port: 6379 };
    }

    // 1. Initialize queue to schedule repeatable matching runs
    this.schedulerQueue = new Queue('matching-queue', { connection });

    // 2. Initialize worker to process matching executions
    this.worker = new Worker(
      'matching-queue',
      async (job: Job) => {
        if (job.name === 'match-orders') {
          await this.executeMatching();
        }
      },
      { connection }
    );

    this.worker.on('completed', (job) => {
      Logger.info(`Matching engine job completed: ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      Logger.error(`Matching engine job failed: ${job?.id}`, err);
    });

    this.schedulerQueue.on('error', (err) => {
      Logger.error('BullMQ Matching Scheduler Queue Error', err);
    });

    this.worker.on('error', (err) => {
      Logger.error('BullMQ Matching Worker Error', err);
    });

    // Schedule matching execution repeatable trigger (every 5 seconds)
    this.scheduleRepeatableMatching().catch((err) =>
      Logger.error('Failed to schedule repeatable matching job', err)
    );

    Logger.info('Matching Engine BullMQ Worker initialized');
  }

  private async scheduleRepeatableMatching(): Promise<void> {
    // Clean up any existing repeatable triggers of the same name to avoid duplicates on hot-reload restarts
    const repeatableJobs = await this.schedulerQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name === 'match-orders') {
        await this.schedulerQueue.removeRepeatableByKey(job.key);
      }
    }

    // Add repeating trigger (every 5 seconds)
    await this.schedulerQueue.add(
      'match-orders',
      {},
      {
        repeat: { every: 5000 },
      }
    );

    Logger.info('Matching engine repeating job scheduled (every 5 seconds)');
  }

  public async executeMatching(): Promise<void> {
    try {
      const matchingEngine = MatchingEngine.getInstance();
      await matchingEngine.matchPendingOrders();
    } catch (err) {
      Logger.error('Error during background order matching tick', err);
    }
  }
}
