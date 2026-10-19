import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import TicketPdfDocument from '@/components/ticket/TicketPdfDocument';
import { CINEMA_TIMEZONE, formatManilaClock } from '@/lib/time';
import { formatPeso, formatSeatList } from '@/lib/booking';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_CODE_RE = /^MS-\d{4}-[A-Z0-9]{6}$/i;

interface ShowtimeMetaJoin {
  start_time: string;
  end_time: string;
  movies: { title: string; rating?: string; runtime?: number } | Array<{ title: string; rating?: string; runtime?: number }> | null;
  auditoriums: { name: string; screen_type?: string; sound_system?: string } | Array<{ name: string; screen_type?: string; sound_system?: string }> | null;
}

interface ReservationSeatsJoin {
  seat_id: string;
  price: number;
  seats: { row: string; number: number; seat_type: string } | null;
}

interface FullReservationRow {
  id: string;
  reference_code: string;
  user_id: string;
  customer_name: string;
  customer_email: string;
  status: string;
  total_amount: number;
  created_at: string;
  showtimes: ShowtimeMetaJoin | null;
  reservation_seats: ReservationSeatsJoin[] | null;
}

function extractOne<T>(val: T | T[] | null): T | null {
  return Array.isArray(val) ? (val[0] ?? null) : val;
}

/**
 * GET /api/reservations/[id]/pdf
 * Generates and downloads the digital PDF admission ticket.
 *
 * Strict Security Rules:
 * 1. Takes user identity strictly from session (never client body or headers).
 * 2. Strict Privacy Isolation: User B receives 403 Forbidden when requesting User A's ticket.
 * 3. Guest receives 401 Unauthorized.
 * 4. Response headers enforce no-cache so sensitive tickets are never cached in shared proxies.
 * 5. Historical tickets (ended movies) are fully accessible for download.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || (!UUID_RE.test(id) && !REF_CODE_RE.test(id))) {
    return NextResponse.json(
      { error: 'INVALID_ID', message: 'A valid reservation ID or reference code is required.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-cache, no-store, must-revalidate' } }
    );
  }

  // 1. Session Auth Check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'AUTH_REQUIRED', message: 'Please sign in to download your ticket PDF.' },
      { status: 401, headers: { 'Cache-Control': 'private, no-cache, no-store, must-revalidate' } }
    );
  }

  // 2. Fetch reservation details with elevated admin client to verify ownership
  const adminClient = createAdminClient();
  const query = adminClient
    .from('reservations')
    .select(`
      id,
      reference_code,
      user_id,
      customer_name,
      customer_email,
      status,
      total_amount,
      created_at,
      showtimes (
        start_time,
        end_time,
        movies ( title, rating, runtime ),
        auditoriums ( name, screen_type, sound_system )
      ),
      reservation_seats (
        seat_id,
        price,
        seats ( row, number, seat_type )
      )
    `);

  const { data: rawData, error: dbError } = UUID_RE.test(id)
    ? await query.eq('id', id).maybeSingle()
    : await query.eq('reference_code', id.toUpperCase()).maybeSingle();

  const reservation = rawData as unknown as FullReservationRow | null;

  if (dbError || !reservation) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'Reservation not found.' },
      { status: 404, headers: { 'Cache-Control': 'private, no-cache, no-store, must-revalidate' } }
    );
  }

  // 3. Strict Ownership Verification (403 Forbidden for different user)
  if (reservation.user_id !== user.id) {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        message: 'You do not have permission to access or download this reservation ticket.',
      },
      { status: 403, headers: { 'Cache-Control': 'private, no-cache, no-store, must-revalidate' } }
    );
  }

  // 4. Format ticket information
  const st = reservation.showtimes as unknown as ShowtimeMetaJoin | null;
  const movie = extractOne(st?.movies);
  const auditorium = extractOne(st?.auditoriums);

  let showtimeDate = 'Today';
  let showtimeClock = '12:00 PM';
  if (st?.start_time) {
    const d = new Date(st.start_time);
    showtimeDate = new Intl.DateTimeFormat('en-US', {
      timeZone: CINEMA_TIMEZONE,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
    showtimeClock = formatManilaClock(d);
  }

  const rawSeats = (reservation.reservation_seats || []) as unknown as ReservationSeatsJoin[];
  const seatItems = rawSeats
    .map((rs) => rs.seats)
    .filter((s): s is { row: string; number: number; seat_type: string } => Boolean(s));

  const seatsString = formatSeatList(seatItems);
  const totalAmountString = formatPeso(Number(reservation.total_amount));

  // 5. Render PDF document to buffer
  const pdfBuffer = await renderToBuffer(
    TicketPdfDocument({
      ticket: {
        referenceCode: reservation.reference_code,
        customerName: reservation.customer_name,
        customerEmail: reservation.customer_email,
        movieTitle: movie?.title || 'Movie Screening',
        auditoriumName: auditorium?.name ? `${auditorium.name} \u2022 Cinema City Hall` : 'Cinema City Hall',
        screenType: auditorium?.screen_type || '4K Laser Projection',
        soundSystem: auditorium?.sound_system || 'Dolby Atmos 7.1',
        showtimeDate,
        showtimeClock,
        seats: seatsString || 'Reserved',
        seatsCount: seatItems.length,
        totalAmount: totalAmountString,
        status: (reservation.status || 'CONFIRMED').toUpperCase(),
      },
    })
  );

  // 6. Return response with strict no-cache headers and application/pdf content type
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="MovieSeat-Ticket-${reservation.reference_code}.pdf"`,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
