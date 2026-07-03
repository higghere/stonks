import { Worker, Job } from 'bullmq';
import { prisma } from '@stock-market/database';
import { ConfigService } from '@stock-market/config';
import { Logger } from '@stock-market/logger';

export class NotificationWorker {
  private worker: Worker;

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

    this.worker = new Worker(
      'notification-queue',
      async (job: Job) => {
        if (job.name === 'price-alert') {
          await this.processPriceAlert(job.data);
        }
      },
      { connection }
    );

    this.worker.on('completed', (job) => {
      Logger.info(`Notification worker successfully completed job ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      Logger.error(`Notification worker failed job ${job?.id}`, err);
    });

    Logger.info('Notification BullMQ Worker started successfully');
  }

  private async processPriceAlert(data: any): Promise<void> {
    const { userId, symbol, condition, value, currentPrice } = data;

    Logger.info(`[WORKER] Delivering price alert notification for user ${userId}: ${symbol} is ${condition} ${value} (current: ${currentPrice})`);

    // Record the notification event in the database ActivityLog so the user can audit it
    await prisma.activityLog.create({
      data: {
        userId,
        message: `[ALERT] ${symbol} trigger hit! Price is ${condition.toLowerCase()} ${value} (Current: $${currentPrice.toFixed(2)})`,
      },
    });

    // In production, this would trigger email (e.g. Nodemailer) or SMS (Twilio) deliveries here
  }
}
