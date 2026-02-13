import { parse, isValid, isSameDay, differenceInDays, startOfDay } from 'date-fns';
import type { TimeRange } from '../types/index.js';

/**
 * Parses a string in 'yy-mm-dd hh:MM' format.
 * Supports space, underscore, or 'T' as separator.
 */
export function parseDateTime(input: string): Date | null {
  const normalized = input.replace(/[ _T]/, ' ');
  const date = parse(normalized, 'yy-MM-dd HH:mm', new Date());
  return isValid(date) ? date : null;
}

/**
 * Validates and constructs a TimeRange.
 * Default end is now.
 * Range limit: 7 days.
 */
export function createTimeRange(startStr: string, endStr?: string): TimeRange {
  const start = parseDateTime(startStr);
  if (!start) {
    throw new Error(`Invalid start time format: ${startStr}. Expected 'yy-mm-dd hh:MM'`);
  }

  let end: Date;
  if (endStr) {
    const parsedEnd = parseDateTime(endStr);
    if (!parsedEnd) {
      throw new Error(`Invalid end time format: ${endStr}. Expected 'yy-mm-dd hh:MM'`);
    }
    end = parsedEnd;
  } else {
    end = new Date();
  }

  if (end < start) {
    throw new Error('End time must be after start time');
  }

  const daysDiff = differenceInDays(end, start);
  if (daysDiff > 7) {
    throw new Error('Analysis range cannot exceed 7 days');
  }

  const mode = isSameDay(start, end) ? 'single' : 'historical';

  return { start, end, mode };
}

/**
 * Returns formatted date string YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get all YYYY-MM-DD dates between start and end (inclusive)
 */
export function getDatesInRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  let current = startOfDay(start);
  const last = startOfDay(end);

  while (current <= last) {
    dates.push(formatDate(current));
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}
