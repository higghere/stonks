import { prisma } from '@stock-market/database';
import { Decimal } from '@prisma/client/runtime/library';
import { Logger } from '@stock-market/logger';
import { MarketService } from '@stock-market/market';
import { OrderSide, OrderStatus, OrderType, DomainEvent } from '@stock-market/shared';
import { OrderStateMachine } from './state-machine';
import { OrderValidationPipeline, ValidationError } from './validation-pipeline';

export class MatchingEngine {
  private static instance: MatchingEngine;
  private validationPipeline = new OrderValidationPipeline();
  private marketService = MarketService.getInstance();

  private constructor() {}

  public static getInstance(): MatchingEngine {
    if (!MatchingEngine.instance) {
      MatchingEngine.instance = new MatchingEngine();
    }
    return MatchingEngine.instance;
  }

  // Submit and immediately process order writes
  public async submitOrder(
    accountId: string,
    tickerId: string,
    side: OrderSide,
    type: OrderType,
    quantity: number,
    price?: number,
    stopPrice?: number,
    idempotencyKey?: string
  ): Promise<any> {
    // 1. Check Idempotency Key if provided
    if (idempotencyKey) {
      const existing = await prisma.order.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        Logger.info(`Idempotency match found for order key: ${idempotencyKey}`);
        return { success: true, orderId: existing.id, status: existing.status, replayed: true };
      }
    }

    // 2. Validate Order
    const { currentPrice } = await this.validationPipeline.validate({
      accountId,
      tickerId,
      side,
      type,
      quantity,
      price,
      stopPrice,
    });

    // 3. Create PENDING Order
    const order = await prisma.order.create({
      data: {
        accountId,
        tickerId,
        side,
        type,
        status: OrderStatus.PENDING,
        quantity: new Decimal(quantity),
        price: price ? new Decimal(price) : null,
        stopPrice: stopPrice ? new Decimal(stopPrice) : null,
        idempotencyKey: idempotencyKey || null,
      },
    });

    Logger.info(`Order ${order.id} submitted as PENDING`);

    // 4. Process immediate execution for MARKET orders
    if (type === OrderType.MARKET) {
      await this.executeOrder(order.id, currentPrice, quantity);
      const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
      return { success: true, orderId: order.id, status: updatedOrder?.status };
    }

    // 5. Process immediate execution check for LIMIT orders
    if (type === OrderType.LIMIT && price) {
      const isBuyMatch = side === OrderSide.BUY && currentPrice <= price;
      const isSellMatch = side === OrderSide.SELL && currentPrice >= price;

      if (isBuyMatch || isSellMatch) {
        await this.executeOrder(order.id, currentPrice, quantity);
        const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
        return { success: true, orderId: order.id, status: updatedOrder?.status };
      }
    }

    return { success: true, orderId: order.id, status: OrderStatus.PENDING };
  }

  // Process double-entry transactional matches
  public async executeOrder(orderId: string, executePrice: number, executeQuantity: number): Promise<void> {
    const commission = new Decimal(2.00); // Flat $2 commission per execution
    const totalCost = new Decimal(executeQuantity).mul(new Decimal(executePrice));
    
    // Perform transaction
    await prisma.$transaction(async (tx) => {
      // 1. Fetch Order and lock it
      const order = await tx.order.findUnique({
        where: { id: orderId },
      });
      if (!order || order.status !== OrderStatus.PENDING) {
        throw new Error('Order is not in PENDING state');
      }

      // Validate state machine change
      OrderStateMachine.validateTransition(order.status, OrderStatus.FILLED);

      // 2. Fetch Account for Optimistic Lock check
      const account = await tx.account.findUnique({
        where: { id: order.accountId },
      });
      if (!account) {
        throw new Error('Trading Account not found');
      }

      // Calculate cash balance modification
      let cashChange = new Decimal(0);
      if (order.side === OrderSide.BUY) {
        cashChange = totalCost.add(commission).negated(); // Buy costs cash + commission
      } else {
        cashChange = totalCost.sub(commission); // Sell returns cash minus commission
      }

      const newCashBalance = account.cashBalance.add(cashChange);
      if (order.side === OrderSide.BUY && newCashBalance.lt(0)) {
        throw new Error('Insufficient funds to finalize execution transaction');
      }

      // 3. Update Account Cash with Optimistic Version lock
      const updateResult = await tx.account.updateMany({
        where: {
          id: account.id,
          version: account.version,
        },
        data: {
          cashBalance: newCashBalance,
          version: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        throw new Error('Concurrency lock conflict: Account was updated by another process. Retrying.');
      }

      // 4. Create Execution Row
      await tx.execution.create({
        data: {
          orderId,
          price: new Decimal(executePrice),
          quantity: new Decimal(executeQuantity),
          commission,
        },
      });

      // 5. Update Order Status
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.FILLED,
        },
      });

      // 6. Write Double-Entry Accounting Ledger
      const transaction = await tx.transaction.create({
        data: {
          accountId: account.id,
          type: 'TRADE',
          description: `${order.side} ${executeQuantity} ${order.tickerId} at $${executePrice}`,
        },
      });

      // Entry 1: Cash ledger entry
      await tx.transactionEntry.create({
        data: {
          transactionId: transaction.id,
          accountId: account.id,
          assetType: 'CASH',
          amount: cashChange,
        },
      });

      // Entry 2: Ticker share ledger entry
      const shareQtyChange = order.side === OrderSide.BUY 
        ? new Decimal(executeQuantity) 
        : new Decimal(executeQuantity).negated();

      await tx.transactionEntry.create({
        data: {
          transactionId: transaction.id,
          accountId: account.id,
          assetType: 'TICKER',
          tickerId: order.tickerId,
          amount: shareQtyChange,
          price: new Decimal(executePrice),
        },
      });

      // 7. Update Position Projection (Read-Model)
      const currentPosition = await tx.position.findUnique({
        where: {
          accountId_tickerId: {
            accountId: account.id,
            tickerId: order.tickerId,
          },
        },
      });

      if (order.side === OrderSide.BUY) {
        if (currentPosition) {
          const oldQty = currentPosition.quantity;
          const oldAvg = currentPosition.averagePrice;
          const newQty = oldQty.add(new Decimal(executeQuantity));
          
          // Weighted average price calculation:
          // newAvg = ((oldQty * oldAvg) + (execQty * execPrice)) / newQty
          const newAvgPrice = oldQty.mul(oldAvg).add(new Decimal(executeQuantity).mul(new Decimal(executePrice))).div(newQty);

          await tx.position.update({
            where: { id: currentPosition.id },
            data: {
              quantity: newQty,
              averagePrice: newAvgPrice,
            },
          });
        } else {
          await tx.position.create({
            data: {
              accountId: account.id,
              tickerId: order.tickerId,
              quantity: new Decimal(executeQuantity),
              averagePrice: new Decimal(executePrice),
            },
          });
        }
      } else {
        // SELL Order Position update
        if (!currentPosition) {
          throw new Error('Inventory projection mismatch: Position record missing during sell execution');
        }

        const newQty = currentPosition.quantity.sub(new Decimal(executeQuantity));
        if (newQty.lt(0)) {
          throw new Error('Inventory projection mismatch: Position would fall below zero');
        }

        if (newQty.isZero()) {
          await tx.position.delete({
            where: { id: currentPosition.id },
          });
        } else {
          await tx.position.update({
            where: { id: currentPosition.id },
            data: {
              quantity: newQty,
            },
          });
        }
      }

      Logger.info(`Order ${orderId} filled successfully at $${executePrice}`);
    });
  }

  // Background matching query execution
  public async matchPendingOrders(): Promise<void> {
    const pendingOrders = await prisma.order.findMany({
      where: { status: OrderStatus.PENDING },
    });

    if (pendingOrders.length === 0) return;

    Logger.info(`Matching engine checking ${pendingOrders.length} pending orders...`);

    for (const order of pendingOrders) {
      try {
        const quote = await this.marketService.getQuote(order.tickerId);
        const currentPrice = quote.price;

        let shouldExecute = false;

        if (order.type === OrderType.LIMIT) {
          const limitPrice = order.price!.toNumber();
          if (order.side === OrderSide.BUY && currentPrice <= limitPrice) {
            shouldExecute = true;
          } else if (order.side === OrderSide.SELL && currentPrice >= limitPrice) {
            shouldExecute = true;
          }
        } else if (order.type === OrderType.STOP) {
          const stopPrice = order.stopPrice!.toNumber();
          if (order.side === OrderSide.BUY && currentPrice >= stopPrice) {
            shouldExecute = true;
          } else if (order.side === OrderSide.SELL && currentPrice <= stopPrice) {
            shouldExecute = true;
          }
        }

        if (shouldExecute) {
          Logger.info(`Matching criteria met for order ${order.id}. Executing...`);
          await this.executeOrder(order.id, currentPrice, order.quantity.toNumber());
        }
      } catch (err) {
        Logger.error(`Matching engine check failed on order ${order.id}`, err);
      }
    }
  }
}
export default MatchingEngine;
