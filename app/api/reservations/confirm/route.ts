import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendBookingConfirmationEmail } from '@/lib/emailjs';
import {
  validateCustomerInput,
  mapConfirmError,
  formatSeatList,
  formatPeso,
  dispatchConfirmationEmail,
} from '@/lib/booking';
import { CINEMA_TIMEZONE, formatManilaClock } from '@/lib/time';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ShowtimeMetaJoin {
  start_time: string;
  movies: { title: string } | Array<{ title: string }> | null;
  auditoriums: { name: string } | Array<{ name: string }> | null;
}

function extractOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * POST /api/reservations/confirm
 *
 * Strict security & privacy rules:
 * 1. Authenticated session required (reads user from session, never from body).
 * 2. Client sends ONLY { showtimeId, customerName, customerEmail }.
 * 3. Server alone validates active holds and calculates total from database pricing.
 * 4. Database partial unique index guards against race conditions (SEAT_TAKEN).
 * 5. Replay-safe against duplicate clicks / server crash.
 * 6. Non-blocking confirmation email dispatched via after().
 */
export async function POST(request: NextRequest) {
  // 1. Guard payload size
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > 8192) {
    return NextResponse.json(
      { error: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds allowable size.' },
      { status: 413 }
    );
  }

  // 2. Enforce authenticated session
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      {
        error: 'AUTH_REQUIRED',
        message: 'You must be signed in to complete and confirm your reservation.',
      },
      { status: 401 }
    );
  }

  // 3. Parse and validate request body
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'INVALID_REQUEST', message: 'Malformed JSON payload.' },
      { status: 400 }
    );
  }

  const showtimeId = String(body.showtimeId || body.showtime_id || '');
  if (!UUID_RE.test(showtimeId)) {
    return NextResponse.json(
      { error: 'INVALID_SHOWTIME_ID', message: 'A valid showtime UUID is required.' },
      { status: 400 }
    );
  }

  const validation = validateCustomerInput({
    customerName: body.customerName ?? body.customer_name,
    customerEmail: body.customerEmail ?? body.customer_email,
  });

  if (!validation.valid || !validation.data) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: validation.error },
      { status: 400 }
    );
  }

  const { customerName, customerEmail } = validation.data;

  // 4. Call confirm_reservation RPC
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error: rpcError } = await (supabase as any).rpc(
    'confirm_reservation',
    {
      p_showtime_id: showtimeId,
      p_customer_name: customerName,
      p_customer_email: customerEmail,
    }
  );

  if (rpcError) {
    const mapped = mapConfirmError(rpcError);
    return NextResponse.json(
      {
        error: mapped.code,
        message: mapped.message,
      },
      { status: mapped.status }
    );
  }

  const result = rpcData as {
    success: boolean;
    replayed?: boolean;
    reservation_id: string;
    reference_code: string;
    total_amount: number;
    seats: Array<{ seat_id: string; row: string; number: number; seat_type: string; price: number }>;
  };

  // 5. Non-blocking confirmation email dispatch
  // Only dispatch for fresh bookings, not for replayed duplicate requests
  if (!result.replayed) {
    after(async () => {
      try {
        const { data: stData } = await supabase
          .from('showtimes')
          .select('start_time, movies(title), auditoriums(name)')
          .eq('id', showtimeId)
          .maybeSingle();

        const st = stData as unknown as ShowtimeMetaJoin | null;
        const movie = extractOne(st?.movies);
        const auditorium = extractOne(st?.auditoriums);

        const movieTitle = movie?.title || 'Selected Feature';
        const cinema = auditorium?.name ? `${auditorium.name} \u2022 Cinema City Hall` : 'Cinema City Hall';

        let showtimeLabel = 'Today';
        if (st?.start_time) {
          const startDate = new Date(st.start_time);
          const dateStr = new Intl.DateTimeFormat('en-US', {
            timeZone: CINEMA_TIMEZONE,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }).format(startDate);
          showtimeLabel = `${dateStr} \u2022 ${formatManilaClock(startDate)}`;
        }

        const seatsFormatted = formatSeatList(result.seats || []);
        const totalFormatted = formatPeso(Number(result.total_amount));

        await dispatchConfirmationEmail(
          {
            toEmail: customerEmail,
            toName: customerName,
            referenceCode: result.reference_code,
            movieTitle,
            cinema,
            showtime: showtimeLabel,
            seats: seatsFormatted,
            totalAmount: totalFormatted,
          },
          { sendFn: sendBookingConfirmationEmail }
        );
      } catch (err: unknown) {
        console.error('[Confirmation Email Background Failure]', err);
      }
    });
  }

  // 6. Respond with confirmation details and ticket redirect path
  return NextResponse.json(
    {
      success: true,
      reference_code: result.reference_code,
      reservation_id: result.reservation_id,
      total_amount: Number(result.total_amount),
      seats: result.seats || [],
      already_confirmed: Boolean(result.replayed),
      redirect: `/ticket/${result.reference_code}`,
    },
    { status: 200 }
  );
}
