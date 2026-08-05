import { SimulationContext } from '@stock-market/simulation-common';

export type EventCallback = (context: SimulationContext, data?: any) => void;

export class SimulationEventBus {
  private listeners: Record<string, EventCallback[]> = {};

  /**
   * Subscribe to a specific event type (e.g. 'DailyTick', 'FactoryClosed').
   */
  public subscribe(eventType: string, callback: EventCallback): void {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType].push(callback);
  }

  /**
   * Publish an event to all subscribers.
   */
  public publish(eventType: string, context: SimulationContext, data?: any): void {
    const callbacks = this.listeners[eventType] || [];
    for (const cb of callbacks) {
      try {
        cb(context, data);
      } catch (err) {
        context.logger.error(`Error in event listener for ${eventType}:`, err);
      }
    }
  }
}
export const eventBus = new SimulationEventBus();
