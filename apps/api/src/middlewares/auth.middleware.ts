import { Request, Response, NextFunction } from 'express';
import { AuthService, AccessTokenPayload } from '@stock-market/auth';
import { AppErrorCode } from '@stock-market/shared';
import { AppError } from './error.middleware';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError(AppErrorCode.UNAUTHORIZED, 'Authentication token missing or invalid format', 401));
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = AuthService.verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error: any) {
    next(new AppError(AppErrorCode.UNAUTHORIZED, error.message || 'Token verification failed', 401));
  }
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError(AppErrorCode.UNAUTHORIZED, 'Authentication required', 401));
    }

    const hasPermission = req.user.permissions.includes(permission) || req.user.permissions.includes('admin:all');
    if (!hasPermission) {
      return next(new AppError(AppErrorCode.FORBIDDEN, 'Insufficient privileges to perform this action', 403));
    }

    next();
  };
}
