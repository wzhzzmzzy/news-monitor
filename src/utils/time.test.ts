import { describe, it, expect } from 'vitest';
import { parseDateTime, createTimeRange, formatDate, getDatesInRange } from './time.js';

describe('Time Utilities', () => {
  describe('parseDateTime', () => {
    it('should parse valid yy-mm-dd hh:MM format', () => {
      const date = parseDateTime('26-02-13 08:30');
      expect(date).not.toBeNull();
      if (date) {
        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(1); // February is 1
        expect(date.getDate()).toBe(13);
        expect(date.getHours()).toBe(8);
        expect(date.getMinutes()).toBe(30);
      }
    });

    it('should return null for invalid format', () => {
      expect(parseDateTime('2026-02-13 08:30')).toBeNull();
      expect(parseDateTime('26-02-13')).toBeNull();
      expect(parseDateTime('invalid')).toBeNull();
    });
  });

  describe('createTimeRange', () => {
    it('should create a single-day range', () => {
      const range = createTimeRange('26-02-13 01:00', '26-02-13 23:00');
      expect(range.mode).toBe('single');
      expect(range.start).toBeInstanceOf(Date);
      expect(range.end).toBeInstanceOf(Date);
    });

    it('should create a historical range for multi-day', () => {
      const range = createTimeRange('26-02-10 10:00', '26-02-11 10:00');
      expect(range.mode).toBe('historical');
    });

    it('should use now as default end', () => {
      const range = createTimeRange('26-02-13 01:00');
      expect(range.end).toBeDefined();
      expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
    });

    it('should throw error for end < start', () => {
      expect(() => createTimeRange('26-02-13 10:00', '26-02-13 08:00')).toThrow('End time must be after start time');
    });

    it('should throw error for range > 7 days', () => {
      expect(() => createTimeRange('26-02-01 10:00', '26-02-10 10:00')).toThrow('Analysis range cannot exceed 7 days');
    });
  });

  describe('formatDate', () => {
    it('should format date correctly', () => {
      const date = new Date(2026, 1, 13);
      expect(formatDate(date)).toBe('2026-02-13');
    });
  });

  describe('getDatesInRange', () => {
    it('should return dates within range inclusive', () => {
      const start = new Date(2026, 1, 10);
      const end = new Date(2026, 1, 12);
      const dates = getDatesInRange(start, end);
      expect(dates).toEqual(['2026-02-10', '2026-02-11', '2026-02-12']);
    });
  });
});
