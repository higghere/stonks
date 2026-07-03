import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ConfigService } from '@stock-market/config';
import { Logger } from '@stock-market/logger';
import { prisma } from '@stock-market/database';

const config = ConfigService.getInstance();

export interface AccessTokenPayload {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
}

export interface RefreshTokenPayload {
  userId: string;
}

export class AuthService {
  private static jwtSecret = config.get('JWT_SECRET');
  private static jwtExpiresIn = config.get('JWT_EXPIRES_IN');
  private static jwtRefreshSecret = config.get('JWT_REFRESH_SECRET');
  private static jwtRefreshExpiresIn = config.get('JWT_REFRESH_EXPIRES_IN');

  // Password Hashing
  public static async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  public static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // Token Generation
  public static signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, this.jwtSecret, { expiresIn: this.jwtExpiresIn as any });
  }

  public static verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return jwt.verify(token, this.jwtSecret) as AccessTokenPayload;
    } catch (error) {
      Logger.security('Access token verification failed', { error });
      throw new Error('Invalid or expired access token');
    }
  }

  public static signRefreshToken(payload: RefreshTokenPayload): string {
    return jwt.sign(payload, this.jwtRefreshSecret, { expiresIn: this.jwtRefreshExpiresIn as any });
  }

  public static verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return jwt.verify(token, this.jwtRefreshSecret) as RefreshTokenPayload;
    } catch (error) {
      Logger.security('Refresh token verification failed', { error });
      throw new Error('Invalid or expired refresh token');
    }
  }

  // Custom OAuth - Google
  public static getGoogleAuthUrl(): string {
    const clientId = process.env.GOOGLE_CLIENT_ID || 'mock-google-client-id';
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/oauth/google/callback';
    const scope = 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';
    
    // Check if it is a developer placeholder, if so bypass Google login screen and jump to local callback
    if (clientId === 'mock-google-client-id' || clientId === 'your-google-client-id' || !clientId) {
      return `${redirectUri}?code=mock-developer-google-code`;
    }
    
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;
  }

  public static async getGoogleUser(code: string): Promise<{ email: string; name: string; avatarUrl?: string }> {
    const clientId = process.env.GOOGLE_CLIENT_ID || 'mock-google-client-id';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || 'mock-google-client-secret';
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/oauth/google/callback';

    if (
      clientId === 'mock-google-client-id' ||
      clientId === 'your-google-client-id' ||
      !clientId ||
      code === 'mock-developer-google-code'
    ) {
      Logger.info('Using Mock Google OAuth profile');
      return {
        email: 'mock.google.user@example.com',
        name: 'Mock Google User',
        avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde'
      };
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      Logger.error('Failed to exchange Google OAuth code', errText);
      throw new Error('Google authentication failed');
    }

    const tokenData = await tokenResponse.json() as { access_token: string };
    
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!userResponse.ok) {
      Logger.error('Failed to fetch Google user profile');
      throw new Error('Google user retrieval failed');
    }

    const userData = await userResponse.json() as { email: string; name: string; picture?: string };
    return {
      email: userData.email,
      name: userData.name,
      avatarUrl: userData.picture
    };
  }

  // Custom OAuth - GitHub
  public static getGitHubAuthUrl(): string {
    const clientId = process.env.GITHUB_CLIENT_ID || 'mock-github-client-id';
    const redirectUri = process.env.GITHUB_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/oauth/github/callback';
    const scope = 'user:email read:user';
    
    if (clientId === 'mock-github-client-id' || clientId === 'your-github-client-id' || !clientId) {
      return `${redirectUri}?code=mock-developer-github-code`;
    }
    
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
  }

  public static async getGitHubUser(code: string): Promise<{ email: string; name: string; avatarUrl?: string }> {
    const clientId = process.env.GITHUB_CLIENT_ID || 'mock-github-client-id';
    const clientSecret = process.env.GITHUB_CLIENT_SECRET || 'mock-github-client-secret';

    if (
      clientId === 'mock-github-client-id' ||
      clientId === 'your-github-client-id' ||
      !clientId ||
      code === 'mock-developer-github-code'
    ) {
      Logger.info('Using Mock GitHub OAuth profile');
      return {
        email: 'mock.github.user@example.com',
        name: 'Mock GitHub User',
        avatarUrl: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61'
      };
    }

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code
      })
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      Logger.error('Failed to exchange GitHub OAuth code', errText);
      throw new Error('GitHub authentication failed');
    }

    const tokenData = await tokenResponse.json() as { access_token: string };

    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${tokenData.access_token}`,
        'User-Agent': 'stock-market-api-server'
      }
    });

    if (!userResponse.ok) {
      Logger.error('Failed to fetch GitHub user profile');
      throw new Error('GitHub user retrieval failed');
    }

    const userData = await userResponse.json() as { login: string; name?: string; avatar_url?: string };
    
    // GitHub user emails can be private, so fetch emails endpoint
    const emailsResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `token ${tokenData.access_token}`,
        'User-Agent': 'stock-market-api-server'
      }
    });

    let email = `${userData.login}@github.noreply.com`;
    if (emailsResponse.ok) {
      const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primaryEmail = emails.find(e => e.primary && e.verified);
      if (primaryEmail) {
        email = primaryEmail.email;
      }
    }

    return {
      email,
      name: userData.name || userData.login,
      avatarUrl: userData.avatar_url
    };
  }

  // Session Cleanup Job helper
  public static async revokeRefreshToken(token: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { token }
    });
  }
}
