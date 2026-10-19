/**
 * Pure booking, calculation, validation, and email dispatch helpers.
 * Kept standalone with relative imports so it can be evaluated by Node directly in test suites.
 */

export interface SendConfirmationParams {
  toEmail: string;
  toName: string;
  referenceCode: string;
  movieTitle: string;
  cinema: string;
  showtime: string;
  seats: string;
  totalAmount: string | number;
}

export interface EmailDispatchResult {
  success: boolean;
  simulated?: boolean;
  messageId?: string;
  error?: string;
}

export const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export const DEFAULT_EMAIL_TIMEOUT_MS = 8000;

export interface ValidatedCustomer {
  customerName: string;
  customerEmail: string;
}

export interface CustomerValidationResult {
  valid: boolean;
  data?: ValidatedCustomer;
  error?: string;
}

/**
 * Validates patron contact details before checkout.
 */
export function validateCustomerInput(input: {
  customerName?: unknown;
  customerEmail?: unknown;
}): CustomerValidationResult {
  const name = typeof input?.customerName === 'string' ? input.customerName.trim() : '';
  const email = typeof input?.customerEmail === 'string' ? input.customerEmail.trim().toLowerCase() : '';

  if (!name || name.length < 2 || name.length > 100) {
    return {
      valid: false,
      error: 'Please enter a valid full name between 2 and 100 characters.',
    };
  }

  if (!email || !EMAIL_REGEX.test(email) || email.length > 254) {
    return {
      valid: false,
      error: 'Please enter a valid email address for ticket delivery.',
    };
  }

  return {
    valid: true,
    data: {
      customerName: name,
      customerEmail: email,
    },
  };
}

/**
 * Calculates the total booking amount given seat records and showtime prices.
 */
export function computeBookingTotal(
  seats: Array<{ seat_type: string }>,
  priceStandard: number,
  priceVip: number
): number {
  return seats.reduce((sum, seat) => {
    const isVip = seat.seat_type === 'vip';
    const price = isVip ? priceVip : priceStandard;
    return sum + price;
  }, 0);
}

/**
 * Formats a seat row and number into a concise label, e.g. "E5".
 */
export function formatSeatLabel(seat: { row: string; number: number }): string {
  return `${seat.row}${seat.number}`;
}

/**
 * Formats a list of seats into a comma-separated string, e.g. "A1, A2, B3".
 */
export function formatSeatList(seats: Array<{ row: string; number: number }>): string {
  return seats.map(formatSeatLabel).join(', ');
}

/**
 * Formats a numeric amount in Philippine Peso currency.
 */
export function formatPeso(amount: number): string {
  return `\u20B1${Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Checks whether an email belongs to an RFC 2606 reserved or automated testing domain.
 * Avoids consuming external EmailJS delivery quota during unit or integration testing.
 */
export function isUndeliverableEmail(email: string): boolean {
  const lower = (email || '').trim().toLowerCase();
  const atIdx = lower.lastIndexOf('@');
  if (atIdx === -1) return true;
  const domain = lower.slice(atIdx + 1);

  if (
    domain.endsWith('.test') ||
    domain.endsWith('.example') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.localhost') ||
    domain === 'test.com' ||
    domain === 'example.com' ||
    domain.startsWith('test-')
  ) {
    return true;
  }
  return false;
}

/**
 * Non-blocking email dispatcher.
 * Dispatches the confirmation email with an internal timeout race and robust error catching.
 * GUARANTEE: Never throws or interrupts the checkout transaction.
 */
export async function dispatchConfirmationEmail(
  params: SendConfirmationParams,
  options?: {
    timeoutMs?: number;
    sendFn?: (params: SendConfirmationParams) => Promise<EmailDispatchResult>;
  }
): Promise<EmailDispatchResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_EMAIL_TIMEOUT_MS;
  const send = options?.sendFn ?? (async () => ({ success: true, simulated: true }));

  // Short-circuit automated test emails
  if (isUndeliverableEmail(params.toEmail)) {
    console.info(`[Email Dispatch] Skipped external delivery for test address: ${params.toEmail}`);
    return { success: true, simulated: true };
  }

  try {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<EmailDispatchResult>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve({
          success: false,
          error: `Email dispatch timed out after ${timeoutMs}ms (booking remains confirmed)`,
        });
      }, timeoutMs);
    });

    const sendPromise = send(params).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Email dispatch error: ${msg}`,
      };
    });

    const result = await Promise.race([sendPromise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Email Dispatch Caught] ${msg}`);
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Maps PostgreSQL RPC exceptions or status codes into patron-friendly messages and HTTP codes.
 */
export function mapConfirmError(error: unknown): { status: number; code: string; message: string } {
  const rawMsg =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error || '');

  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  // 1. Seat Taken / Concurrency Conflict (partial unique index violation)
  if (rawMsg.includes('SEAT_TAKEN') || rawCode === '23505' || rawMsg.includes('unique_active_reservation_seat')) {
    return {
      status: 409,
      code: 'SEAT_TAKEN',
      message: 'One or more of your selected seats were just booked by another patron. The seat map has been updated.',
    };
  }

  // 2. Expired Holds
  if (rawMsg.includes('HOLD_EXPIRED')) {
    return {
      status: 409,
      code: 'HOLD_EXPIRED',
      message: 'Your 5-minute seat hold has expired. Please select your seats again.',
    };
  }

  // 3. Showtime Already Started
  if (rawMsg.includes('SHOWTIME_STARTED')) {
    return {
      status: 409,
      code: 'SHOWTIME_STARTED',
      message: 'This screening has already started and is no longer available for booking.',
    };
  }

  // 4. Seat Cap Exceeded
  if (rawMsg.includes('SEAT_CAP_EXCEEDED')) {
    return {
      status: 400,
      code: 'SEAT_CAP_EXCEEDED',
      message: 'You can reserve a maximum of 6 seats per booking.',
    };
  }

  // 5. Authentication Required
  if (rawMsg.includes('AUTH_REQUIRED')) {
    return {
      status: 401,
      code: 'AUTH_REQUIRED',
      message: 'Please sign in to confirm your booking.',
    };
  }

  // 6. Showtime Not Found
  if (rawMsg.includes('INVALID_SHOWTIME')) {
    return {
      status: 404,
      code: 'INVALID_SHOWTIME',
      message: 'The selected screening could not be found.',
    };
  }

  // 7. Validation Error
  if (rawMsg.includes('VALIDATION_ERROR')) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: rawMsg.replace('VALIDATION_ERROR: ', '').trim(),
    };
  }

  // 8. Database Tables Missing / Unapplied Migration
  if (rawCode === 'PGRST205' || rawCode === 'PGRST202' || rawMsg.includes('Could not find the function') || rawMsg.includes('relation') || rawMsg.includes('does not exist')) {
    return {
      status: 503,
      code: 'DATABASE_NOT_READY',
      message: 'The booking service is temporarily unavailable. Please try again shortly.',
    };
  }

  return {
    status: 500,
    code: 'CONFIRM_FAILED',
    message: 'Unable to confirm your reservation. If you were charged, please contact customer support.',
  };
}
