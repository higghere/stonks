import rateLimit from 'express-rate-limit';
import { AppErrorCode } from '@stock-market/shared';
import { AppError } from './error.middleware';

export const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new AppError(AppErrorCode.FORBIDDEN, 'Too many login attempts. Please try again after a minute.', 429));
  },
});

export const orderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new AppError(AppErrorCode.FORBIDDEN, 'Order rate limit exceeded. Please slow down.', 429));
  },
});

export const quoteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new AppError(AppErrorCode.FORBIDDEN, 'Quote requests limit exceeded.', 429));
  },
});

export const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new AppError(AppErrorCode.FORBIDDEN, 'Search requests limit exceeded.', 429));
  },
});

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new AppError(AppErrorCode.FORBIDDEN, 'Too many requests. Please try again later.', 429));
  },
});
