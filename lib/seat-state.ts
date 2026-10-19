// ==============================================================================
// Seat state + layout helpers (pure, no framework imports)
// The client derives every seat's state from three inputs plus the clock:
//   seat_holds (only rows whose expires_at is still in the future),
//   reservation_seats (status = 'reserved'), and "now".
// ==============================================================================

export const MAX_SEATS_PER_SELECTION = 6;
export const HOLD_DURATION_MS = 5 * 60 * 1000;

export type SeatState = 'available' | 'selected' | 'held' | 'reserved';

export interface SeatRecord {
  id: string;
  row: string;
  number: number;
  seat_type: 'standard' | 'vip';
  is_wheelchair: boolean;
}

export interface HoldRecord {
  seat_id: string;
  user_id: string;
  /** ISO string from Postgres, or epoch milliseconds */
  expires_at: string | number;
}

export interface ReservedRecord {
  seat_id: string;
  status?: string;
}

export function toMs(value: string | number): number {
  return typeof value === 'number' ? value : Date.parse(value);
}

/** A hold counts only while its expires_at is still in the future. */
export function isHoldActive(hold: HoldRecord, nowMs: number): boolean {
  const exp = toMs(hold.expires_at);
  return Number.isFinite(exp) && exp > nowMs;
}

export interface ComputeSeatStatesInput {
  seats: SeatRecord[];
  holds: HoldRecord[];
  reserved: ReservedRecord[] | string[];
  userId: string | null;
  /** Seats the user has clicked but the server has not confirmed yet */
  pendingSelection?: string[];
  nowMs: number;
}

/**
 * Priority: reserved > mine (active hold) > held by others (active hold)
 *           > pending local selection > available.
 */
export function computeSeatStates(input: ComputeSeatStatesInput): Record<string, SeatState> {
  const { seats, holds, reserved, userId, pendingSelection = [], nowMs } = input;

  const reservedIds = new Set<string>();
  for (const r of reserved) {
    if (typeof r === 'string') {
      reservedIds.add(r);
    } else if ((r.status ?? 'reserved') === 'reserved') {
      reservedIds.add(r.seat_id);
    }
  }

  const mineIds = new Set<string>();
  const othersIds = new Set<string>();
  for (const h of holds) {
    if (!isHoldActive(h, nowMs)) continue;
    if (userId && h.user_id === userId) mineIds.add(h.seat_id);
    else othersIds.add(h.seat_id);
  }

  const pending = new Set(pendingSelection);
  const states: Record<string, SeatState> = {};
  for (const seat of seats) {
    if (reservedIds.has(seat.id)) states[seat.id] = 'reserved';
    else if (mineIds.has(seat.id)) states[seat.id] = 'selected';
    else if (othersIds.has(seat.id)) states[seat.id] = 'held';
    else if (pending.has(seat.id)) states[seat.id] = 'selected';
    else states[seat.id] = 'available';
  }
  return states;
}

/** Selection rule shared by the UI (the database enforces the same cap). */
export function canAddSeat(currentSelection: string[], seatId: string): boolean {
  if (currentSelection.includes(seatId)) return true;
  return currentSelection.length < MAX_SEATS_PER_SELECTION;
}

export interface SeatRow {
  row: string;
  isVip: boolean;
  seats: SeatRecord[];
}

/** Groups seats into ordered rows. A row is VIP when every seat in it is VIP. */
export function groupSeatRows(seats: SeatRecord[]): SeatRow[] {
  const byRow = new Map<string, SeatRecord[]>();
  for (const s of seats) {
    const list = byRow.get(s.row) ?? [];
    list.push(s);
    byRow.set(s.row, list);
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([row, list]) => {
      const sorted = [...list].sort((a, b) => a.number - b.number);
      return { row, isVip: sorted.every((s) => s.seat_type === 'vip'), seats: sorted };
    });
}

/**
 * Aisle positions for a row with `count` seats: the row is split into
 * left wing | centre block | right wing.
 * 8 seats -> [2, 6] (2-4-2), 11 -> [3, 8] (3-5-3), 13 -> [3, 10] (3-7-3).
 * Returned numbers are "an aisle after the Nth seat".
 */
export function aislePositions(count: number): [number, number] {
  const wing = Math.max(1, Math.round(count * 0.25));
  return [wing, count - wing];
}

export type HoldErrorCode =
  | 'AUTH_REQUIRED'
  | 'SEAT_TAKEN'
  | 'SEAT_HELD'
  | 'SEAT_CAP_EXCEEDED'
  | 'SHOWTIME_STARTED'
  | 'INVALID_SHOWTIME'
  | 'INVALID_SELECTION'
  | 'INVALID_SEAT'
  | 'UNKNOWN';

const KNOWN_CODES: HoldErrorCode[] = [
  'AUTH_REQUIRED',
  'SEAT_TAKEN',
  'SEAT_HELD',
  'SEAT_CAP_EXCEEDED',
  'SHOWTIME_STARTED',
  'INVALID_SHOWTIME',
  'INVALID_SELECTION',
  'INVALID_SEAT',
];

/** Database errors look like "SEAT_TAKEN: One or more ..."; pull out the code. */
export function parseHoldError(message: string | null | undefined): HoldErrorCode {
  if (!message) return 'UNKNOWN';
  for (const code of KNOWN_CODES) {
    if (message.includes(code)) return code;
  }
  if (/permission denied/i.test(message)) return 'AUTH_REQUIRED';
  return 'UNKNOWN';
}

export function friendlyHoldMessage(code: HoldErrorCode): string {
  switch (code) {
    case 'SEAT_TAKEN':
      return 'Sorry, someone just booked one of those seats. The map has been refreshed.';
    case 'SEAT_HELD':
      return 'Another customer is holding one of those seats right now. The map has been refreshed.';
    case 'SEAT_CAP_EXCEEDED':
      return `You can select up to ${MAX_SEATS_PER_SELECTION} seats per reservation.`;
    case 'SHOWTIME_STARTED':
      return 'This screening has already started, so seats can no longer be held.';
    case 'AUTH_REQUIRED':
      return 'Please sign in to hold seats.';
    case 'INVALID_SEAT':
    case 'INVALID_SHOWTIME':
    case 'INVALID_SELECTION':
      return 'Those seats could not be held. Please reload the page and try again.';
    default:
      return "We couldn't update your seats. Please try again.";
  }
}

export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function seatLabel(seat: Pick<SeatRecord, 'row' | 'number'>): string {
  return `${seat.row}${seat.number}`;
}
