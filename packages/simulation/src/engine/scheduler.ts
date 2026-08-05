import { SimulationContext } from '@stock-market/simulation-common';
import { eventBus } from './event-bus';

/**
 * Updates the Simulation calendar dates and dispatches ticks across Daily,
 * Weekly, Monthly, Quarterly, and Yearly clock intervals.
 */
export function advanceCalendar(context: SimulationContext): SimulationContext {
  const updated = { ...context };
  
  updated.tick += 1;
  
  // Advance daily date
  const newDate = new Date(updated.calendar.date);
  newDate.setDate(newDate.getDate() + 1);
  updated.calendar.date = newDate;

  // Day names mapping
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  updated.calendar.dayName = days[newDate.getDay()];

  // Multi-clock flags
  updated.calendar.isQuarterEnd = updated.tick % 90 === 0;
  updated.calendar.isYearEnd = updated.tick % 365 === 0;
  updated.calendar.quarter = Math.floor((newDate.getMonth() / 3) + 1);
  updated.calendar.year = newDate.getFullYear();

  // Trigger Tick clocks on Event Bus
  eventBus.publish('DailyTick', updated);
  
  if (updated.tick % 7 === 0) {
    eventBus.publish('WeeklyTick', updated);
  }
  if (updated.tick % 30 === 0) {
    eventBus.publish('MonthlyTick', updated);
  }
  if (updated.calendar.isQuarterEnd) {
    eventBus.publish('QuarterlyTick', updated);
  }
  if (updated.calendar.isYearEnd) {
    eventBus.publish('YearlyTick', updated);
  }

  return updated;
}
