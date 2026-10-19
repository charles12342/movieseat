// ==============================================================================
// MovieSeat Time Utilities - Asia/Manila (UTC+8) Strict Timezone Enforcement
// ==============================================================================

export const CINEMA_TIMEZONE = 'Asia/Manila';

/**
 * Returns formatted clock string in Asia/Manila timezone (e.g. "5:35 PM")
 */
export function formatManilaClock(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CINEMA_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Returns full date in Asia/Manila timezone (e.g. "Monday, October 19, 2026")
 */
export function formatManilaDateLong(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CINEMA_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/**
 * Returns ISO date-only string in Asia/Manila (e.g. "2026-10-19")
 */
export function getManilaDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CINEMA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Determines if a showtime has already begun according to Asia/Manila server time
 */
export function isShowtimePast(startTime: string | Date): boolean {
  const start = typeof startTime === 'string' ? new Date(startTime).getTime() : startTime.getTime();
  const now = Date.now();
  return start <= now;
}

/**
 * Checks if a reservation is eligible for cancellation (30-Minute Cutoff Policy)
 */
export function canCancelReservation(showtimeStart: string | Date): {
  allowed: boolean;
  minutesRemaining: number;
} {
  const start = typeof showtimeStart === 'string' ? new Date(showtimeStart).getTime() : showtimeStart.getTime();
  const now = Date.now();
  const diffMinutes = Math.floor((start - now) / (1000 * 60));

  return {
    allowed: diffMinutes >= 30,
    minutesRemaining: diffMinutes,
  };
}
