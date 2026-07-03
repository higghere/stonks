import { prisma } from '@stock-market/database';
import { Logger } from '@stock-market/logger';
import { MarketSessionInfo } from '../types';

export class ExchangeService {
  private static instance: ExchangeService;

  private constructor() {}

  public static getInstance(): ExchangeService {
    if (!ExchangeService.instance) {
      ExchangeService.instance = new ExchangeService();
    }
    return ExchangeService.instance;
  }

  // Parse Date parts in target timezone
  private getDatePartsInTimezone(date: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);

    return {
      year: getPart('year'),
      month: getPart('month'), // 1-indexed (1-12)
      day: getPart('day'),
      hour: getPart('hour'),
      minute: getPart('minute'),
      second: getPart('second'),
      dayOfWeek: date.toLocaleDateString('en-US', { timeZone, weekday: 'narrow' }), // "M", "T", "W" etc.
    };
  }

  // Checks if a date falls on a weekend
  public isWeekendInTimezone(date: Date, timeZone: string): boolean {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
    const day = formatter.format(date);
    return day === 'Sat' || day === 'Sun';
  }

  // Check if a specific date is a scheduled exchange holiday
  public async isHoliday(exchangeId: string, date: Date): Promise<boolean> {
    // Standard market holiday checks (e.g. New Year, Christmas, Thanksgiving, etc.)
    // For local dev simplicity, we check if there are overrides or standard dates.
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();

    // Mock holiday check
    if (month === 1 && day === 1) return true; // New Year
    if (month === 12 && day === 25) return true; // Christmas
    
    return false;
  }

  // Returns whether the target market exchange is open right now
  public async isMarketOpen(exchangeId: string): Promise<boolean> {
    const session = await this.getSessionInfo(exchangeId);
    return session.isOpen;
  }

  // Calculates active session state details
  public async getSessionInfo(exchangeId: string): Promise<MarketSessionInfo> {
    const exchange = await prisma.exchange.findUnique({
      where: { id: exchangeId },
    });

    if (!exchange) {
      Logger.warn(`Exchange not found: ${exchangeId}, defaulting to Closed.`);
      return {
        isOpen: false,
        sessionType: 'CLOSED',
        nextOpen: new Date(),
        nextClose: new Date(),
        timezone: 'UTC',
      };
    }

    const now = new Date();
    const parts = this.getDatePartsInTimezone(now, exchange.timezone);
    const isWeekend = this.isWeekendInTimezone(now, exchange.timezone);
    const holiday = await this.isHoliday(exchangeId, now);

    const [openHour, openMin] = exchange.openingTime.split(':').map(Number);
    const [closeHour, closeMin] = exchange.closingTime.split(':').map(Number);

    const currentHour = parts.hour;
    const currentMin = parts.minute;

    const currentMinutes = currentHour * 60 + currentMin;
    const openMinutes = openHour * 60 + openMin;
    const closeMinutes = closeHour * 60 + closeMin;

    const isWithinHours = currentMinutes >= openMinutes && currentMinutes < closeMinutes;
    const isOpen = !isWeekend && !holiday && isWithinHours;

    // Calculate Next Open and Next Close
    // Create base date matching local exchange date
    const localOpen = new Date(now);
    const localClose = new Date(now);

    // If it's closed or weekend, calculate the next session date
    // This is simple approximation for dev. In prod, we check a calendar database.
    let daysToAddForOpen = 0;
    let daysToAddForClose = 0;

    if (isWeekend) {
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: exchange.timezone, weekday: 'short' });
      const day = formatter.format(now);
      daysToAddForOpen = day === 'Sat' ? 2 : 1;
      daysToAddForClose = daysToAddForOpen;
    } else if (currentMinutes >= closeMinutes) {
      // Past closing, next open is tomorrow
      daysToAddForOpen = 1;
      daysToAddForClose = 1;
    }

    localOpen.setDate(localOpen.getDate() + daysToAddForOpen);
    localOpen.setHours(openHour, openMin, 0, 0);

    localClose.setDate(localClose.getDate() + daysToAddForClose);
    localClose.setHours(closeHour, closeMin, 0, 0);

    return {
      isOpen,
      sessionType: isOpen ? 'REGULAR' : 'CLOSED',
      nextOpen: localOpen,
      nextClose: localClose,
      timezone: exchange.timezone,
    };
  }
}
export default ExchangeService;
