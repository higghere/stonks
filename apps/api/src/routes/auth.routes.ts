import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthService } from '@stock-market/auth';
import { prisma } from '@stock-market/database';
import { Logger } from '@stock-market/logger';
import { AppErrorCode } from '@stock-market/shared';
import { AppError } from '../middlewares/error.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';
import { loginLimiter } from '../middlewares/rate-limit.middleware';

const router = Router();

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(1, 'Name is required'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string(),
});

// Helper: Get user permissions
async function getUserPermissions(roleId: string): Promise<string[]> {
  const rolePermissions = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permissionId: true },
  });
  return rolePermissions.map((rp: { permissionId: string }) => rp.permissionId);
}

// Helper: Setup cookie
const setRefreshTokenCookie = (res: Response, token: string) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// POST /register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'Email is already registered', 400);
    }

    const passwordHash = await AuthService.hashPassword(password);

    // Run creation inside a database transaction
    const { user, account } = await prisma.$transaction(async (tx: any) => {
      // 1. Create User
      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash,
          name,
          roleId: 'user',
        },
      });

      // 2. Create User Preference
      await tx.userPreference.create({
        data: {
          userId: newUser.id,
        },
      });

      // 3. Create Account
      const newAccount = await tx.account.create({
        data: {
          userId: newUser.id,
          cashBalance: 100000.00, // $100,000 starting cash
        },
      });

      // 4. Create Ledger Entry for Deposit
      const transaction = await tx.transaction.create({
        data: {
          accountId: newAccount.id,
          type: 'DEPOSIT',
          description: 'Initial paper trading account deposit',
        },
      });

      await tx.transactionEntry.create({
        data: {
          transactionId: transaction.id,
          accountId: newAccount.id,
          assetType: 'CASH',
          amount: 100000.00,
        },
      });

      return { user: newUser, account: newAccount };
    });

    const permissions = await getUserPermissions(user.roleId);
    
    // Create JWT Session
    const accessToken = AuthService.signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.roleId,
      permissions,
    });

    const refreshToken = AuthService.signRefreshToken({ userId: user.id });

    // Store refresh token in db
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    setRefreshTokenCookie(res, refreshToken);

    Logger.info(`User registered successfully: ${user.email}`);

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.roleId,
      },
      accessToken,
    });
  } catch (error) {
    next(error);
  }
});

// POST /login
router.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, 'Invalid email or password', 401);
    }

    const isValid = await AuthService.comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, 'Invalid email or password', 401);
    }

    const permissions = await getUserPermissions(user.roleId);

    const accessToken = AuthService.signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.roleId,
      permissions,
    });

    const refreshToken = AuthService.signRefreshToken({ userId: user.id });

    // Store refresh token in db
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    setRefreshTokenCookie(res, refreshToken);

    Logger.info(`User logged in: ${user.email}`);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.roleId,
      },
      accessToken,
    });
  } catch (error) {
    next(error);
  }
});

// POST /refresh
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, 'Refresh token missing', 401);
    }

    const dbToken = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!dbToken || dbToken.expiresAt < new Date()) {
      if (dbToken) {
        await prisma.refreshToken.delete({ where: { token } });
      }
      throw new AppError(AppErrorCode.UNAUTHORIZED, 'Invalid or expired session', 401);
    }

    const payload = AuthService.verifyRefreshToken(token);
    const user = dbToken.user;
    const permissions = await getUserPermissions(user.roleId);

    const accessToken = AuthService.signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.roleId,
      permissions,
    });

    res.json({
      success: true,
      accessToken,
    });
  } catch (error) {
    next(error);
  }
});

// POST /logout
router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (token) {
      await AuthService.revokeRefreshToken(token);
    }

    res.clearCookie('refreshToken');
    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
});

// GET /me
router.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  res.json({
    success: true,
    user: req.user,
  });
});

// --- OAuth Google Endpoints ---
router.get('/oauth/google', (req: Request, res: Response) => {
  const url = AuthService.getGoogleAuthUrl();
  res.json({ success: true, url });
});

router.get('/oauth/google/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'OAuth authorization code missing', 400);
    }

    const profile = await AuthService.getGoogleUser(code);
    
    // Map profile to User
    let user = await prisma.user.findUnique({ where: { email: profile.email } });
    if (!user) {
      // Create user + preferences + trading account
      user = await prisma.$transaction(async (tx: any) => {
        const newUser = await tx.user.create({
          data: {
            email: profile.email,
            passwordHash: 'oauth-random-hash', // social login users do not use raw passwords
            name: profile.name,
            roleId: 'user',
            isEmailVerified: true,
          },
        });

        await tx.userPreference.create({
          data: { userId: newUser.id },
        });

        const newAccount = await tx.account.create({
          data: {
            userId: newUser.id,
            cashBalance: 100000.00,
          },
        });

        const transaction = await tx.transaction.create({
          data: {
            accountId: newAccount.id,
            type: 'DEPOSIT',
            description: 'OAuth initial paper trading account deposit',
          },
        });

        await tx.transactionEntry.create({
          data: {
            transactionId: transaction.id,
            accountId: newAccount.id,
            assetType: 'CASH',
            amount: 100000.00,
          },
        });

        return newUser;
      });
    }

    if (!user) {
      throw new AppError(AppErrorCode.INTERNAL_SERVER_ERROR, 'Failed to authenticate user profile', 500);
    }

    const permissions = await getUserPermissions(user.roleId);
    
    const accessToken = AuthService.signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.roleId,
      permissions,
    });

    const refreshToken = AuthService.signRefreshToken({ userId: user.id });

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    setRefreshTokenCookie(res, refreshToken);

    // Redirect to web application dashboard
    const webDashboardUrl = process.env.WEB_APP_URL || 'http://localhost:3000/dashboard';
    res.redirect(`${webDashboardUrl}?token=${accessToken}`);
  } catch (error) {
    next(error);
  }
});

// --- OAuth GitHub Endpoints ---
router.get('/oauth/github', (req: Request, res: Response) => {
  const url = AuthService.getGitHubAuthUrl();
  res.json({ success: true, url });
});

router.get('/oauth/github/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'OAuth authorization code missing', 400);
    }

    const profile = await AuthService.getGitHubUser(code);

    let user = await prisma.user.findUnique({ where: { email: profile.email } });
    if (!user) {
      user = await prisma.$transaction(async (tx: any) => {
        const newUser = await tx.user.create({
          data: {
            email: profile.email,
            passwordHash: 'oauth-random-hash',
            name: profile.name,
            roleId: 'user',
            isEmailVerified: true,
          },
        });

        await tx.userPreference.create({
          data: { userId: newUser.id },
        });

        const newAccount = await tx.account.create({
          data: {
            userId: newUser.id,
            cashBalance: 100000.00,
          },
        });

        const transaction = await tx.transaction.create({
          data: {
            accountId: newAccount.id,
            type: 'DEPOSIT',
            description: 'OAuth initial paper trading account deposit',
          },
        });

        await tx.transactionEntry.create({
          data: {
            transactionId: transaction.id,
            accountId: newAccount.id,
            assetType: 'CASH',
            amount: 100000.00,
          },
        });

        return newUser;
      });
    }

    if (!user) {
      throw new AppError(AppErrorCode.INTERNAL_SERVER_ERROR, 'Failed to authenticate user profile', 500);
    }

    const permissions = await getUserPermissions(user.roleId);

    const accessToken = AuthService.signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.roleId,
      permissions,
    });

    const refreshToken = AuthService.signRefreshToken({ userId: user.id });

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    setRefreshTokenCookie(res, refreshToken);

    const webDashboardUrl = process.env.WEB_APP_URL || 'http://localhost:3000/dashboard';
    res.redirect(`${webDashboardUrl}?token=${accessToken}`);
  } catch (error) {
    next(error);
  }
});

export const authRoutes = router;
export default authRoutes;
