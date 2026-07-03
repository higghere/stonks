import { Worker, Job, Queue } from 'bullmq';
import { prisma } from '@stock-market/database';
import { ConfigService } from '@stock-market/config';
import { Logger } from '@stock-market/logger';
import { PortfolioService } from '@stock-market/portfolio';

export class PortfolioSnapshotWorker {
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

    // 1. Initialize queue to schedule repeatable nightly snapshot runs
    this.schedulerQueue = new Queue('portfolio-snapshot-queue', { connection });

    // 2. Initialize worker to process snapshot executions
    this.worker = new Worker(
      'portfolio-snapshot-queue',
      async (job: Job) => {
        if (job.name === 'nightly-snapshot') {
          await this.executeSnapshots();
        }
      },
      { connection }
    );

    this.worker.on('completed', (job) => {
      Logger.info(`Portfolio snapshot job completed: ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      Logger.error(`Portfolio snapshot job failed: ${job?.id}`, err);
    });

    // Schedule snapshot execution repeatable cron (every night at midnight: 0 0 * * *)
    this.scheduleNightlySnapshots().catch((err) =>
      Logger.error('Failed to schedule repeatable nightly portfolio snapshots', err)
    );

    Logger.info('Portfolio Snapshot BullMQ Worker initialized');
  }

  private async scheduleNightlySnapshots(): Promise<void> {
    // Clean up any existing repeatable triggers of the same name to avoid duplicates on hot-reload restarts
    const repeatableJobs = await this.schedulerQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name === 'nightly-snapshot') {
        await this.schedulerQueue.removeRepeatableByKey(job.key);
      }
    }

    // Add nightly repeating trigger (every night at 00:00)
    await this.schedulerQueue.add(
      'nightly-snapshot',
      {},
      {
        repeat: { pattern: '0 0 * * *' },
      }
    );

    Logger.info('Nightly portfolio snapshot cron scheduled repeatable job (0 0 * * *)');
  }

  /**
   * Main snapshot business logic execution loop
   */
  public async executeSnapshots(): Promise<void> {
    Logger.info('Starting nightly portfolio snapshots job...');

    const accounts = await prisma.account.findMany({
      select: { userId: true },
    });

    const portfolioService = PortfolioService.getInstance();
    const now = new Date();

    for (const acc of accounts) {
      try {
        const valuation = await portfolioService.getPortfolioValuation(acc.userId);

        await prisma.portfolioSnapshot.create({
          data: {
            accountId: valuation.account.id,
            snapshotDate: now,
            totalValue: valuation.account.netAssetValue,
            cash: valuation.account.cashBalance,
            holdingsJson: valuation.positions as any,
          },
        });

        Logger.info(`Recorded portfolio snapshot for account ${valuation.account.id} (NAV: $${valuation.account.netAssetValue})`);
      } catch (err) {
        Logger.error(`Failed to capture snapshot for user ${acc.userId}`, err);
      }
    }

    Logger.info('Nightly portfolio snapshots completed successfully!');
  }
}
