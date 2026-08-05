import { NotificationWorker } from './notification.worker';
import { PortfolioSnapshotWorker } from './portfolio.worker';
import { CatalogWorker } from './catalog.worker';
import { MatchingWorker } from './matching.worker';
import { Logger } from '@stock-market/logger';

export * from './notification.worker';
export * from './portfolio.worker';
export * from './catalog.worker';
export * from './matching.worker';

let notificationWorkerInstance: NotificationWorker | null = null;
let snapshotWorkerInstance: PortfolioSnapshotWorker | null = null;
let catalogWorkerInstance: CatalogWorker | null = null;
let matchingWorkerInstance: MatchingWorker | null = null;

/**
 * Initializes and starts all background queue worker engines
 */
export function initWorkers(): void {
  Logger.info('Initializing all background BullMQ workers...');

  if (!notificationWorkerInstance) {
    notificationWorkerInstance = new NotificationWorker();
  }

  if (!snapshotWorkerInstance) {
    snapshotWorkerInstance = new PortfolioSnapshotWorker();
  }

  if (!catalogWorkerInstance) {
    catalogWorkerInstance = new CatalogWorker();
    catalogWorkerInstance.start();
  }

  if (!matchingWorkerInstance) {
    matchingWorkerInstance = new MatchingWorker();
  }

  Logger.info('All background BullMQ workers initialized successfully');
}
