import { connection } from 'next/server';
import { notFound, redirect, forbidden } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CINEMA_TIMEZONE, formatManilaClock } from '@/lib/time';
import { getTmdbMovieDetails } from '@/lib/tmdb';
import { safeRedirectPath } from '@/lib/redirect';
import TicketCard from '@/components/ticket/TicketCard';
import TicketActions from '@/components/ticket/TicketActions';

interface TicketPageProps {
  params: Promise<{ reference: string }>;
}

interface ShowtimeMetaJoin {
  id: string;
  start_time: string;
  end_time: string;
  movies: {
    id: string;
    title: string;
    tmdb_id: number | null;
    poster_path: string | null;
    runtime: number;
    rating: string;
  } | Array<{
    id: string;
    title: string;
    tmdb_id: number | null;
    poster_path: string | null;
    runtime: number;
    rating: string;
  }> | null;
  auditoriums: {
    id: string;
    name: string;
    screen_type: string;
    sound_system: string;
  } | Array<{
    id: string;
    name: string;
    screen_type: string;
    sound_system: string;
  }> | null;
}

interface ReservationSeatsJoin {
  seat_id: string;
  price: number;
  seats: {
    id: string;
    row: string;
    number: number;
    seat_type: string;
  } | null;
}

interface FullReservationPageRow {
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

export default async function TicketPage({ params }: TicketPageProps) {
  await connection();
  const { reference } = await params;

  if (!reference || typeof reference !== 'string') {
    notFound();
  }

  const cleanReference = reference.trim().toUpperCase();

  // 1. Session check: Guests are redirected to signin with safe redirect path
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    const returnPath = safeRedirectPath(`/ticket/${encodeURIComponent(cleanReference)}`, '/');
    redirect(`/signin?redirect=${encodeURIComponent(returnPath)}`);
  }

  // 2. Fetch reservation with admin client to verify existence and check ownership
  const adminClient = createAdminClient();
  const { data: rawRes, error: dbError } = await adminClient
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
        id,
        start_time,
        end_time,
        movies ( id, title, tmdb_id, poster_path, runtime, rating ),
        auditoriums ( id, name, screen_type, sound_system )
      ),
      reservation_seats (
        seat_id,
        price,
        seats ( id, row, number, seat_type )
      )
    `)
    .eq('reference_code', cleanReference)
    .maybeSingle();

  const resData = rawRes as unknown as FullReservationPageRow | null;

  if (dbError || !resData) {
    notFound();
  }

  // 3. Strict Ownership Verification (403 Forbidden if not the ticket owner)
  if (resData.user_id !== user.id) {
    forbidden();
  }

  const st = resData.showtimes as unknown as ShowtimeMetaJoin | null;
  const movie = extractOne(st?.movies);
  const auditorium = extractOne(st?.auditoriums);

  // 4. Resolve TMDB poster metadata
  const tmdb = await getTmdbMovieDetails(movie?.tmdb_id ?? null, {
    posterPath: movie?.poster_path,
    title: movie?.title,
    runtime: movie?.runtime,
  });

  // 5. Format showtime and seats
  let dateLabel = 'Today';
  let clockLabel = '12:00 PM';
  if (st?.start_time) {
    const startDate = new Date(st.start_time);
    dateLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: CINEMA_TIMEZONE,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(startDate);
    clockLabel = formatManilaClock(startDate);
  }

  const rawSeats = (resData.reservation_seats || []) as unknown as ReservationSeatsJoin[];
  const seats = rawSeats
    .map((rs) => ({
      id: rs.seats?.id || rs.seat_id,
      row: rs.seats?.row || '?',
      number: rs.seats?.number || 0,
      seatType: rs.seats?.seat_type || 'standard',
      price: Number(rs.price || 0),
    }))
    .sort((a, b) => a.row.localeCompare(b.row) || a.number - b.number);

  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
      <title>{`Ticket ${resData.reference_code} | MovieSeat`}</title>
      <meta
        name="description"
        content={`Confirmed digital admission pass for ${movie?.title || 'movie screening'} at Cinema City Hall.`}
      />

      {/* Top Navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center justify-between text-sm">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to Now Showing</span>
        </Link>
        <span className="text-xs text-zinc-500 font-mono">
          Ref: {resData.reference_code}
        </span>
      </nav>

      {/* Ticket Pass Component */}
      <TicketCard
        reservation={{
          id: resData.id,
          referenceCode: resData.reference_code,
          status: resData.status,
          totalAmount: Number(resData.total_amount),
          customerName: resData.customer_name,
          customerEmail: resData.customer_email,
          createdAt: resData.created_at,
          movie: {
            title: movie?.title || 'Selected Feature',
            posterUrl: tmdb.posterUrl,
            runtime: movie?.runtime || 120,
            rating: movie?.rating || 'PG-13',
          },
          auditorium: {
            name: auditorium?.name || 'Main Hall',
            screenType: auditorium?.screen_type || '4K Laser Projection',
            soundSystem: auditorium?.sound_system || 'Dolby Atmos 7.1',
          },
          showtime: {
            startLabel: `${dateLabel} \u2022 ${clockLabel}`,
            dateLabel,
            clockLabel,
          },
          seats,
        }}
      />

      {/* Ticket Action Buttons */}
      <TicketActions reservationId={resData.id} referenceCode={resData.reference_code} />
    </div>
  );
}
