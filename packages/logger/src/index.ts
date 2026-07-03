export type LogCategory = 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY' | 'API' | 'DATABASE';

const COLORS = {
  INFO: '\x1b[32m',     // Green
  WARNING: '\x1b[33m',  // Yellow
  ERROR: '\x1b[31m',    // Red
  SECURITY: '\x1b[35m', // Magenta
  API: '\x1b[36m',      // Cyan
  DATABASE: '\x1b[34m', // Blue
  RESET: '\x1b[0m'
};

export class Logger {
  private static isProduction = process.env.NODE_ENV === 'production';

  private static formatMessage(category: LogCategory, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    
    if (this.isProduction) {
      return JSON.stringify({
        timestamp,
        category,
        message,
        meta
      });
    }

    const color = COLORS[category] || COLORS.RESET;
    const metaStr = meta ? ` | Meta: ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${color}[${category}]${COLORS.RESET} ${message}${metaStr}`;
  }

  public static info(message: string, meta?: any): void {
    console.log(this.formatMessage('INFO', message, meta));
  }

  public static warn(message: string, meta?: any): void {
    console.warn(this.formatMessage('WARNING', message, meta));
  }

  public static error(message: string, error?: Error | any, meta?: any): void {
    const errorDetails = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : error;
    
    console.error(this.formatMessage('ERROR', message, { ...meta, error: errorDetails }));
  }

  public static security(message: string, meta?: any): void {
    console.warn(this.formatMessage('SECURITY', message, meta));
  }

  public static api(message: string, meta?: any): void {
    console.log(this.formatMessage('API', message, meta));
  }

  public static database(message: string, meta?: any): void {
    console.log(this.formatMessage('DATABASE', message, meta));
  }
}
