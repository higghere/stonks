import { Queue } from 'bullmq';
import { EventEmitter } from 'events';
import { ConfigService } from '@stock-market/config';
import { Logger } from '@stock-market/logger';

export interface AlertTriggerPayload {
  alertId: string;
  userId: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW';
  value: number;
  currentPrice: number;
}

export class NotificationService {
  private static instance: NotificationService;
  private queue: Queue;
  public events = new EventEmitter();

  private constructor() {
    const config = ConfigService.getInstance();
    const redisUrl = config.get('REDIS_URL') || 'redis://localhost:6379';

    try {
      const url = new URL(redisUrl);
      const connection = {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        username: url.username || undefined,
        password: url.password || undefined,
      };

      this.queue = new Queue('notification-queue', { connection });
      this.queue.on('error', (err) => Logger.error('BullMQ Notification Queue connection error', err));
      Logger.info('Notification BullMQ queue initialized successfully');
    } catch (err) {
      Logger.error('Failed to parse REDIS_URL for BullMQ connection, falling back to defaults', err);
      this.queue = new Queue('notification-queue', {
        connection: { host: '127.0.0.1', port: 6379 },
      });
      this.queue.on('error', (err) => Logger.error('BullMQ Notification Queue connection error', err));
    }
  }

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Pushes a triggered alert task onto the BullMQ queue and triggers local WebSocket event listeners
   */
  public async sendAlertNotification(payload: AlertTriggerPayload): Promise<void> {
    try {
      // 1. Push to persistent BullMQ queue
      await this.queue.add('price-alert', payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });

      Logger.info(`Added price-alert job to BullMQ queue for user ${payload.userId} on ${payload.symbol}`);

      // 2. Emit event locally for immediate Socket.io real-time push
      this.events.emit('alert-triggered', payload);
    } catch (err) {
      Logger.error(`Failed to dispatch alert notification for user ${payload.userId}`, err);
    }
  }
}
