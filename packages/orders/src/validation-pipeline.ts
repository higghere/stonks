import { prisma } from '@stock-market/database';
import { MarketService } from '@stock-market/market';
import { ExchangeService } from '@stock-market/market';
import { AppErrorCode, OrderSide, OrderType } from '@stock-market/shared';
import { Decimal } from '@prisma/client/runtime/library';

export class ValidationError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: any
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ValidationContext {
  accountId: string;
  tickerId: string;
  side: string;
  type: string;
  quantity: number;
  price?: number; // limit price
  stopPrice?: number;
}

export class OrderValidationPipeline {
  private marketService = MarketService.getInstance();
  private exchangeService = ExchangeService.getInstance();

  public async validate(context: ValidationContext): Promise<{ currentPrice: number; exchangeId: string }> {
    // 1. Validate Account
    const account = await prisma.account.findUnique({
      where: { id: context.accountId },
    });
    if (!account) {
      throw new ValidationError(AppErrorCode.BAD_REQUEST, 'Account not found');
    }

    // 2. Validate Ticker
    const ticker = await prisma.ticker.findUnique({
      where: { id: context.tickerId },
      include: { exchange: true },
    });
    if (!ticker) {
      throw new ValidationError(AppErrorCode.INVALID_TICKER, `Ticker ${context.tickerId} is not supported on this platform`);
    }

    // 3. Validate Market Session
    const session = await this.exchangeService.getSessionInfo(ticker.exchangeId);
    if (!session.isOpen && context.type === OrderType.MARKET) {
      throw new ValidationError(AppErrorCode.ORDER_MARKET_CLOSED, `Market is closed for exchange ${ticker.exchangeId}`);
    }

    // 4. Validate Quantity
    if (context.quantity <= 0) {
      throw new ValidationError(AppErrorCode.BAD_REQUEST, 'Order quantity must be greater than zero');
    }

    // Check feature flags for fractional shares
    const fractionalFlag = await prisma.featureFlag.findUnique({
      where: { id: 'fractional_shares' },
    });
    const allowFractional = fractionalFlag?.enabled ?? false;

    if (!allowFractional && !Number.isInteger(context.quantity)) {
      throw new ValidationError(AppErrorCode.BAD_REQUEST, 'Fractional share trading is currently disabled');
    }

    // 5. Get current price
    let currentPrice = 0;
    try {
      const quote = await this.marketService.getQuote(context.tickerId);
      currentPrice = quote.price;
    } catch (err) {
      throw new ValidationError(AppErrorCode.PRICE_UNAVAILABLE, `Live price unavailable for ticker ${context.tickerId}`);
    }

    // 6. Validate Price Bounds for non-Market orders
    if (context.type === OrderType.LIMIT) {
      if (!context.price || context.price <= 0) {
        throw new ValidationError(AppErrorCode.LIMIT_PRICE_INVALID, 'Limit price must be greater than zero');
      }
    }

    if (context.type === OrderType.STOP || context.type === OrderType.STOP_LIMIT) {
      if (!context.stopPrice || context.stopPrice <= 0) {
        throw new ValidationError(AppErrorCode.BAD_REQUEST, 'Stop price must be greater than zero');
      }
    }

    // 7. Validate Buying Power for BUY orders
    if (context.side === OrderSide.BUY) {
      const executionPrice = context.type === OrderType.LIMIT ? context.price! : currentPrice;
      const orderValue = new Decimal(context.quantity).mul(new Decimal(executionPrice));
      
      if (account.cashBalance.lt(orderValue)) {
        throw new ValidationError(
          AppErrorCode.ORDER_INSUFFICIENT_FUNDS,
          'Insufficient buying power to execute this order',
          {
            required: orderValue.toNumber(),
            available: account.cashBalance.toNumber(),
          }
        );
      }
    }

    // 8. Validate inventory / margin for SELL orders
    if (context.side === OrderSide.SELL) {
      const position = await prisma.position.findUnique({
        where: {
          accountId_tickerId: {
            accountId: context.accountId,
            tickerId: context.tickerId,
          },
        },
      });

      const qtyExisting = position 
        ? (position.isShort ? position.quantity.negated() : position.quantity)
        : new Decimal(0);

      const qtyResulting = qtyExisting.sub(new Decimal(context.quantity));

      // If they own the stock and are just selling it (qtyResulting >= 0), it's a normal sell
      if (qtyResulting.lt(0)) {
        // Short selling is occurring
        const resultingShortQty = qtyResulting.negated();

        const executionPrice = context.type === OrderType.LIMIT ? context.price! : currentPrice;
        
        // Get current account margin status
        const marginStatus = await this.getAccountMarginStatus(context.accountId);

        const shortQtyChange = qtyExisting.lt(0) 
          ? new Decimal(context.quantity)
          : new Decimal(context.quantity).sub(qtyExisting);

        const smvChange = shortQtyChange.mul(new Decimal(executionPrice));
        const finalSMV = marginStatus.shortMarketValue.add(smvChange);

        const commission = new Decimal(2.00);
        const finalEquity = marginStatus.equity.sub(commission);

        // Initial Margin Requirement: 50% of the final short market value
        const initialMarginRequirement = finalSMV.mul(new Decimal(0.50));

        if (finalEquity.lt(initialMarginRequirement)) {
          throw new ValidationError(
            AppErrorCode.ORDER_INSUFFICIENT_FUNDS,
            `Insufficient initial margin to execute this short order. Required equity: $${initialMarginRequirement.toFixed(2)}, hypothetical equity: $${finalEquity.toFixed(2)}`,
            {
              required: initialMarginRequirement.toNumber(),
              available: finalEquity.toNumber(),
            }
          );
        }
      }
    }

    return { currentPrice, exchangeId: ticker.exchangeId };
  }

  public async getAccountMarginStatus(accountId: string): Promise<{
    equity: Decimal;
    shortMarketValue: Decimal;
    longMarketValue: Decimal;
    maintenanceRequirement: Decimal;
  }> {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: {
        positions: {
          include: {
            ticker: true,
          },
        },
      },
    });

    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    let cash = account.cashBalance;
    let longMarketValue = new Decimal(0);
    let shortMarketValue = new Decimal(0);
    let maintenanceRequirement = new Decimal(0);

    for (const pos of account.positions) {
      try {
        const quote = await this.marketService.getQuote(pos.tickerId);
        const price = new Decimal(quote.price);
        const qty = pos.quantity;

        if (pos.isShort) {
          const smv = qty.mul(price);
          shortMarketValue = shortMarketValue.add(smv);
          maintenanceRequirement = maintenanceRequirement.add(smv.mul(new Decimal(0.30)));
        } else {
          longMarketValue = longMarketValue.add(qty.mul(price));
        }
      } catch (err) {
        // Fallback to average price if quote is not available
        const price = pos.averagePrice;
        const qty = pos.quantity;

        if (pos.isShort) {
          const smv = qty.mul(price);
          shortMarketValue = shortMarketValue.add(smv);
          maintenanceRequirement = maintenanceRequirement.add(smv.mul(new Decimal(0.30)));
        } else {
          longMarketValue = longMarketValue.add(qty.mul(price));
        }
      }
    }

    const equity = cash.add(longMarketValue).sub(shortMarketValue);

    return {
      equity,
      shortMarketValue,
      longMarketValue,
      maintenanceRequirement,
    };
  }
}
export default OrderValidationPipeline;
