import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load environmental values from .env if present
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('4000'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/stock_market?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  
  JWT_SECRET: z.string().default('supersecretjwttokenkeyfordevelopmentonly'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().default('supersecretjwtrefreshkeyfordevelopmentonly'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  
  MEILI_HOST: z.string().default('http://localhost:7700'),
  MEILI_MASTER_KEY: z.string().default('meiliMasterKey'),
  
  FINNHUB_API_KEY: z.string().optional(),
  POLYGON_API_KEY: z.string().optional(),
  TWELVEDATA_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export class ConfigService {
  private static instance: ConfigService;
  private readonly config: Config;

  private constructor() {
    const parsed = configSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('❌ Invalid environment configuration:');
      console.error(JSON.stringify(parsed.error.format(), null, 2));
      throw new Error('Invalid environment configuration');
    }
    this.config = parsed.data;
  }

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  public get<T extends keyof Config>(key: T): Config[T] {
    return this.config[key];
  }
}
