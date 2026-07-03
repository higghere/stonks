import { OrderStatus } from '@stock-market/shared';

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [
    OrderStatus.PARTIALLY_FILLED,
    OrderStatus.FILLED,
    OrderStatus.CANCELLED,
    OrderStatus.REJECTED,
  ],
  [OrderStatus.PARTIALLY_FILLED]: [
    OrderStatus.FILLED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.FILLED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REJECTED]: [],
};

export class OrderStateMachine {
  public static validateTransition(current: string, next: string): void {
    const currentStatus = current as OrderStatus;
    const nextStatus = next as OrderStatus;

    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(nextStatus)) {
      throw new Error(`Invalid order status transition: ${current} -> ${next}`);
    }
  }
}
export default OrderStateMachine;
