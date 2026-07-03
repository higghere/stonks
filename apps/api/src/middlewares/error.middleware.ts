import { Request, Response, NextFunction } from 'express';
import { Logger } from '@stock-market/logger';
import { AppErrorCode, AppErrorPayload } from '@stock-market/shared';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: any
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function errorMiddleware(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const code = err instanceof AppError ? err.code : AppErrorCode.INTERNAL_SERVER_ERROR;
  const message = err.message || 'An unexpected error occurred';
  const details = err.details || null;

  if (statusCode === 500) {
    Logger.error(`Unhandled system error: ${message}`, err, { path: req.path });
  } else {
    Logger.warn(`API validation warning [${code}] at ${req.path}: ${message}`, { details });
  }

  const payload: AppErrorPayload = {
    success: false,
    code,
    message,
  };

  if (details) {
    payload.details = details;
  }

  res.status(statusCode).json(payload);
}
