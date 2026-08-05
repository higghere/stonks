import { prisma } from '@stock-market/database';
import { Decimal } from '@prisma/client/runtime/library';
import { Logger } from '@stock-market/logger';
import { MarketService, ExchangeService } from '@stock-market/market';
import { OrderSide, OrderStatus, OrderType, DomainEvent } from '@stock-market/shared';
import { OrderStateMachine } from './state-machine';
import { OrderValidationPipeline, ValidationError } from './validation-pipeline';

export class MatchingEngine {
  private static instance: MatchingEngine;
  private validationPipeline = new OrderValidationPipeline();
  private marketService = MarketService.getInstance();
  private exchangeService = ExchangeService.getInstance();

  private constructor() {}

  public static getInstance(): MatchingEngine {
    if (!MatchingEngine.instance) {
      MatchingEngine.instance = new MatchingEngine();
    }
    return MatchingEngine.instance;
  }

  public getNormalRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  public calculateExecutionPrice(
    midPrice: number,
    volatility: number,
    side: OrderSide
  ): number {
    const spreadPct = Math.max(volatility * 0.05, 0.0001);
    const slippagePct = Math.abs(this.getNormalRandom()) * volatility * 0.1;

    if (side === OrderSide.BUY) {
      const askPrice = midPrice * (1 + spreadPct / 2);
      const finalPrice = askPrice * (1 + slippagePct);
      return parseFloat(finalPrice.toFixed(4));
    } else {
      const bidPrice = midPrice * (1 - spreadPct / 2);
      const finalPrice = bidPrice * (1 - slippagePct);
      return parseFloat(finalPrice.toFixed(4));
    }
  }

  public async getExchangeRate(fromCurrency: string, toCurrency: string): Promise<number> {
    const from = fromCurrency.toUpperCase().trim();
    const to = toCurrency.toUpperCase().trim();

    if (from === to) return 1.0;

    const ticker1 = `${from}${to}=X`;
    try {
      const quote = await this.marketService.getQuote(ticker1);
      if (quote && quote.price > 0) {
        return quote.price;
      }
    } catch {
      const ticker2 = `${to}${from}=X`;
      try {
        const quote = await this.marketService.getQuote(ticker2);
        if (quote && quote.price > 0) {
          return 1.0 / quote.price;
        }
      } catch {
        // Fall back
      }
    }

    const usdRates: Record<string, number> = {
      USD: 1.0,
      EUR: 1.08,
      GBP: 1.28,
      JPY: 0.0065,
      CAD: 0.73,
      AUD: 0.66,
      CHF: 1.12,
      CNY: 0.14,
      INR: 0.012,
    };

    const fromRate = usdRates[from];
    const toRate = usdRates[to];

    if (fromRate && toRate) {
      return fromRate / toRate;
    }

    return 1.0;
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
    idempotencyKey?: string,
    source?: string
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
        source: source || 'USER',
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
    // 1. Fetch Order and ticker info (needed for spread/slippage and FX rate)
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { ticker: true, account: true },
    });
    if (!order || order.status !== OrderStatus.PENDING) {
      throw new Error('Order is not in PENDING state or not found');
    }

    // 2. Calculate volatility-driven bid/ask spread and random slippage
    const volatility = order.ticker.volatility || 0.02;
    const finalPrice = this.calculateExecutionPrice(executePrice, volatility, order.side as OrderSide);

    // 3. Get currency exchange rate (USD -> account base currency)
    const fxRate = await this.getExchangeRate('USD', order.account.baseCurrency);

    const commission = new Decimal(2.00); // Flat $2 commission per execution
    const totalCostNative = new Decimal(executeQuantity).mul(new Decimal(finalPrice));
    const totalCostBase = totalCostNative.mul(new Decimal(fxRate));
    
    // Perform transaction
    await prisma.$transaction(async (tx) => {
      // Re-fetch order for locking inside transaction
      const orderLock = await tx.order.findUnique({
        where: { id: orderId },
      });
      if (!orderLock || orderLock.status !== OrderStatus.PENDING) {
        throw new Error('Order is not in PENDING state or was updated by another process');
      }

      // Validate state machine change
      OrderStateMachine.validateTransition(orderLock.status, OrderStatus.FILLED);

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
        cashChange = totalCostBase.add(commission).negated(); // Buy costs cash + commission
      } else {
        cashChange = totalCostBase.sub(commission); // Sell returns cash minus commission
      }

      const newCashBalance = account.cashBalance.add(cashChange);
      if (order.side === OrderSide.BUY && newCashBalance.lt(0) && order.source !== 'LIQUIDATION') {
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
          price: new Decimal(finalPrice),
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
          description: `${order.side} ${executeQuantity} ${order.tickerId} at $${finalPrice} (FX Rate: ${fxRate})`,
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
          price: new Decimal(finalPrice),
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

      const executeQtyDec = new Decimal(executeQuantity);
      const executePriceDec = new Decimal(finalPrice);

      if (order.side === OrderSide.BUY) {
        if (!currentPosition) {
          const position = await tx.position.create({
            data: {
              accountId: account.id,
              tickerId: order.tickerId,
              quantity: executeQtyDec,
              averagePrice: executePriceDec,
              isShort: false,
            },
          });

          // Create new lot
          await tx.positionLot.create({
            data: {
              positionId: position.id,
              quantity: executeQtyDec,
              remainingQuantity: executeQtyDec,
              price: executePriceDec,
            }
          });
        } else if (!currentPosition.isShort) {
          const oldQty = currentPosition.quantity;
          const oldAvg = currentPosition.averagePrice;
          const newQty = oldQty.add(executeQtyDec);
          const newAvgPrice = oldQty.mul(oldAvg).add(executeQtyDec.mul(executePriceDec)).div(newQty);

          await tx.position.update({
            where: { id: currentPosition.id },
            data: {
              quantity: newQty,
              averagePrice: newAvgPrice,
            },
          });

          // Create new lot
          await tx.positionLot.create({
            data: {
              positionId: currentPosition.id,
              quantity: executeQtyDec,
              remainingQuantity: executeQtyDec,
              price: executePriceDec,
            }
          });
        } else {
          // Covering short position
          const oldQty = currentPosition.quantity;
          if (executeQtyDec.lt(oldQty)) {
            await tx.position.update({
              where: { id: currentPosition.id },
              data: {
                quantity: oldQty.sub(executeQtyDec),
              },
            });
          } else if (executeQtyDec.equals(oldQty)) {
            await tx.position.delete({
              where: { id: currentPosition.id },
            });
          } else {
            const remainderQty = executeQtyDec.sub(oldQty);
            await tx.position.delete({
              where: { id: currentPosition.id },
            });
            const position = await tx.position.create({
              data: {
                accountId: account.id,
                tickerId: order.tickerId,
                quantity: remainderQty,
                averagePrice: executePriceDec,
                isShort: false,
              },
            });

            // Create new lot for remainder long qty
            await tx.positionLot.create({
              data: {
                positionId: position.id,
                quantity: remainderQty,
                remainingQuantity: remainderQty,
                price: executePriceDec,
              }
            });
          }
        }
      } else {
        if (!currentPosition) {
          await tx.position.create({
            data: {
              accountId: account.id,
              tickerId: order.tickerId,
              quantity: executeQtyDec,
              averagePrice: executePriceDec,
              isShort: true,
              marginCallPrice: executePriceDec.mul(new Decimal(1.5 / 1.3)),
            },
          });
        } else if (currentPosition.isShort) {
          const oldQty = currentPosition.quantity;
          const oldAvg = currentPosition.averagePrice;
          const newQty = oldQty.add(executeQtyDec);
          const newAvgPrice = oldQty.mul(oldAvg).add(executeQtyDec.mul(executePriceDec)).div(newQty);

          await tx.position.update({
            where: { id: currentPosition.id },
            data: {
              quantity: newQty,
              averagePrice: newAvgPrice,
              marginCallPrice: newAvgPrice.mul(new Decimal(1.5 / 1.3)),
            },
          });
        } else {
          // Selling long position - need to match and decrement lots!
          // 1. Fetch user preferences to determine FIFO vs LIFO
          const userPref = await tx.userPreference.findUnique({
            where: { userId: order.account.userId }
          });
          const costBasisMethod = userPref?.costBasisMethod || 'FIFO';

          // 2. Fetch active lots ordered by acquiredAt asc (FIFO) or desc (LIFO)
          const lots = await tx.positionLot.findMany({
            where: { positionId: currentPosition.id, remainingQuantity: { gt: 0 } },
            orderBy: { acquiredAt: costBasisMethod === 'LIFO' ? 'desc' : 'asc' },
          });

          let qtyToMatch = executeQtyDec;
          for (const lot of lots) {
            if (qtyToMatch.isZero()) break;
            const lotQty = lot.remainingQuantity;
            if (lotQty.lte(qtyToMatch)) {
              await tx.positionLot.update({
                where: { id: lot.id },
                data: { remainingQuantity: 0 }
              });
              qtyToMatch = qtyToMatch.sub(lotQty);
            } else {
              await tx.positionLot.update({
                where: { id: lot.id },
                data: { remainingQuantity: lotQty.sub(qtyToMatch) }
              });
              qtyToMatch = new Decimal(0);
            }
          }

          const oldQty = currentPosition.quantity;
          if (executeQtyDec.lt(oldQty)) {
            await tx.position.update({
              where: { id: currentPosition.id },
              data: {
                quantity: oldQty.sub(executeQtyDec),
              },
            });
          } else if (executeQtyDec.equals(oldQty)) {
            await tx.position.delete({
              where: { id: currentPosition.id },
            });
          } else {
            const remainderQty = executeQtyDec.sub(oldQty);
            await tx.position.delete({
              where: { id: currentPosition.id },
            });
            await tx.position.create({
              data: {
                accountId: account.id,
                tickerId: order.tickerId,
                quantity: remainderQty,
                averagePrice: executePriceDec,
                isShort: true,
                marginCallPrice: executePriceDec.mul(new Decimal(1.5 / 1.3)),
              },
            });
          }
        }
      }

      Logger.info(`Order ${orderId} filled successfully at $${finalPrice}`);
    });
  }

  // Background matching query execution
  public async matchPendingOrders(): Promise<void> {
    const pendingOrders = await prisma.order.findMany({
      where: { status: OrderStatus.PENDING },
      include: { ticker: true },
    });

    // Run continuous margin checks
    await this.auditAccountsMargin();

    if (pendingOrders.length === 0) return;

    Logger.info(`Matching engine checking ${pendingOrders.length} pending orders...`);

    // Batch query quotes for all unique pending orders to avoid rate limits
    const uniqueTickers = Array.from(new Set(pendingOrders.map(o => o.tickerId)));
    let quotesMap: Record<string, any> = {};
    try {
      quotesMap = await this.marketService.getQuotes(uniqueTickers);
    } catch (err) {
      Logger.error('Failed to batch query quotes in matching engine', err);
    }

    for (const order of pendingOrders) {
      try {
        // Enforce market hours check
        const isExchangeOpen = await this.exchangeService.isMarketOpen(order.ticker.exchangeId);
        if (!isExchangeOpen) {
          Logger.info(`Exchange ${order.ticker.exchangeId} is closed. Skipping matching for order ${order.id}.`);
          continue;
        }

        const quote = quotesMap[order.tickerId];
        if (!quote) {
          Logger.warn(`Quote not available for ticker ${order.tickerId}. Skipping matching for order ${order.id}.`);
          continue;
        }
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

  public async auditAccountsMargin(): Promise<void> {
    const shortPositions = await prisma.position.findMany({
      where: { isShort: true },
      include: {
        account: true,
        ticker: true,
      },
    });

    if (shortPositions.length === 0) return;

    const accountsToAudit = new Map<string, typeof shortPositions>();
    for (const pos of shortPositions) {
      const list = accountsToAudit.get(pos.accountId) || [];
      list.push(pos);
      accountsToAudit.set(pos.accountId, list);
    }

    const now = new Date();

    for (const [accountId, positions] of accountsToAudit.entries()) {
      try {
        const marginStatus = await this.validationPipeline.getAccountMarginStatus(accountId);
        const { equity, shortMarketValue, maintenanceRequirement } = marginStatus;

        const account = positions[0].account;

        if (equity.lt(maintenanceRequirement)) {
          if (!account.marginCallActive) {
            const deadline = new Date(Date.now() + 15 * 60 * 1000); // 15-minute grace period
            
            await prisma.account.update({
              where: { id: accountId },
              data: {
                marginCallActive: true,
                marginCallAt: now,
                marginCallDeadline: deadline,
              },
            });

            await prisma.marginCallLog.create({
              data: {
                accountId,
                equityAtCall: equity,
                requiredEquity: maintenanceRequirement,
                triggeredAt: now,
              },
            });

            await prisma.activityLog.create({
              data: {
                userId: account.userId,
                message: `[MARGIN CALL] Account equity ($${equity.toFixed(2)}) is below maintenance margin requirement ($${maintenanceRequirement.toFixed(2)}). You have until ${deadline.toLocaleTimeString()} to resolve.`,
              },
            });

            Logger.warn(`[MARGIN AUDITOR] Margin call activated for account ${accountId}. Equity: $${equity}, Required: $${maintenanceRequirement}`);
          } else {
            const deadlinePassed = account.marginCallDeadline ? now >= account.marginCallDeadline : false;
            const hardLiquidation = equity.lt(0);

            if (deadlinePassed || hardLiquidation) {
              Logger.warn(`[MARGIN AUDITOR] Liquidation triggered for account ${accountId}. Deadline passed: ${deadlinePassed}, Hard liquidation: ${hardLiquidation}`);
              await this.liquidateShortPositions(accountId, positions, equity, maintenanceRequirement);
            }
          }
        } else {
          if (account.marginCallActive) {
            await prisma.account.update({
              where: { id: accountId },
              data: {
                marginCallActive: false,
                marginCallAt: null,
                marginCallDeadline: null,
              },
            });

            const unresolvedLog = await prisma.marginCallLog.findFirst({
              where: { accountId, resolvedAt: null },
              orderBy: { triggeredAt: 'desc' },
            });

            if (unresolvedLog) {
              await prisma.marginCallLog.update({
                where: { id: unresolvedLog.id },
                data: {
                  resolvedAt: now,
                  resolution: 'DEPOSITED',
                },
              });
            }

            await prisma.activityLog.create({
              data: {
                userId: account.userId,
                message: `[MARGIN RESOLVED] Account equity recovered above maintenance requirement. Margin call cleared.`,
              },
            });

            Logger.info(`[MARGIN AUDITOR] Margin call resolved for account ${accountId}. Equity: $${equity}`);
          }
        }
      } catch (err) {
        Logger.error(`[MARGIN AUDITOR] Failed to audit account ${accountId}`, err);
      }
    }
  }

  private async liquidateShortPositions(
    accountId: string,
    positions: any[],
    equity: Decimal,
    maintenanceRequirement: Decimal
  ): Promise<void> {
    const now = new Date();

    const unresolvedLog = await prisma.marginCallLog.findFirst({
      where: { accountId, resolvedAt: null },
      orderBy: { triggeredAt: 'desc' },
    });

    if (unresolvedLog) {
      await prisma.marginCallLog.update({
        where: { id: unresolvedLog.id },
        data: {
          resolvedAt: now,
          resolution: 'LIQUIDATED',
        },
      });
    }

    for (const pos of positions) {
      try {
        Logger.warn(`[MARGIN AUDITOR] Liquidating short position in ${pos.tickerId} for account ${accountId}. Quantity: ${pos.quantity}`);

        await this.submitOrder(
          accountId,
          pos.tickerId,
          OrderSide.BUY,
          OrderType.MARKET,
          pos.quantity.toNumber(),
          undefined,
          undefined,
          `liq-${pos.id}-${Date.now()}`,
          'LIQUIDATION'
        );

        await prisma.activityLog.create({
          data: {
            userId: pos.account.userId,
            message: `[LIQUIDATION] Automated liquidation triggered for short position in ${pos.tickerId}. Submitted market order to cover ${pos.quantity} shares.`,
          },
        });
      } catch (err) {
        Logger.error(`[MARGIN AUDITOR] Failed to liquidate short position in ${pos.tickerId} for account ${accountId}`, err);
      }
    }

    await prisma.account.update({
      where: { id: accountId },
      data: {
        marginCallActive: false,
        marginCallAt: null,
        marginCallDeadline: null,
      },
    });
  }
}
export default MatchingEngine;
