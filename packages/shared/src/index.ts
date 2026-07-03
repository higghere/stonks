export enum DomainEvent {
  ORDER_CREATED = 'order.created',
  ORDER_EXECUTION_TRIGGERED = 'order.execution_triggered',
  ORDER_CANCELLED = 'order.cancelled',
  ORDER_REJECTED = 'order.rejected',
  LEDGER_ENTRY_RECORDED = 'ledger.entry_recorded',
  POSITION_UPDATED = 'position.updated',
  PORTFOLIO_SNAPSHOT_CREATED = 'portfolio.snapshot_created',
  ALERT_TRIGGERED = 'alert.triggered',
}

export enum AssetType {
  STOCK = 'STOCK',
  ETF = 'ETF',
  INDEX = 'INDEX',
  REIT = 'REIT',
  MUTUAL_FUND = 'MUTUAL_FUND',
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
  TRAILING_STOP = 'TRAILING_STOP',
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

export enum AppErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  ROUTE_NOT_FOUND = 'ROUTE_NOT_FOUND',
  BAD_REQUEST = 'BAD_REQUEST',

  // Order & Execution Errors
  ORDER_INSUFFICIENT_FUNDS = 'ORDER_INSUFFICIENT_FUNDS',
  ORDER_MARKET_CLOSED = 'ORDER_MARKET_CLOSED',
  INVALID_TICKER = 'INVALID_TICKER',
  POSITION_NOT_FOUND = 'POSITION_NOT_FOUND',
  PRICE_UNAVAILABLE = 'PRICE_UNAVAILABLE',
  LIMIT_PRICE_INVALID = 'LIMIT_PRICE_INVALID',
  IDEMPOTENCY_KEY_MISSING = 'IDEMPOTENCY_KEY_MISSING',
  IDEMPOTENCY_REPLAY_FAILED = 'IDEMPOTENCY_REPLAY_FAILED',
  ORDER_TRANSITION_INVALID = 'ORDER_TRANSITION_INVALID',
}

export interface AppErrorPayload {
  success: boolean;
  code: AppErrorCode;
  message: string;
  details?: any;
}
