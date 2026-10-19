import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AlertTriangle, ChevronRight, Clapperboard } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { CINEMA_TIMEZONE, formatManilaClock, getManilaDateString } from '@/lib/time';
import { getTmdbMovieDetails } from '@/lib/tmdb';
import type { HoldRecord, SeatRecord } from '@/lib/seat-state';
import ScreeningReservationClient from '@/components/reservation/ScreeningReservationClient';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ShowtimeRow {
  id: string;
  auditorium_id: string;
  start_time: string;
  end_time: string;
  price_standard: number;
  price_vip: number;
  movies: MovieJoin | MovieJoin[] | null;
  auditoriums: AuditoriumJoin | AuditoriumJoin[] | null;
}
interface MovieJoin {
  id: string;
  title: string;
  tmdb_id: number | null;
  poster_path: string | null;
  runtime: number;
}
interface AuditoriumJoin {
  id: string;
  name: string;
  screen_type: string;
  sound_system: string;
  total_seats: number;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** "Today, Oct 19" when it is today in Manila, otherwise "Tue, Oct 20" */
function formatShowDay(startIso: string, nowMs: number): string {
  const start = new Date(startIso);
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: CINEMA_TIMEZONE,
    month: 'short',
    day: 'numeric',
  }).format(start);
  if (getManilaDateString(start) === getManilaDateString(new Date(nowMs))) {
    return `Today, ${short}`;
  }
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: CINEMA_TIMEZONE, weekday: 'short' }).format(start);
  return `${weekday}, ${short}`;
}

function ScreeningSkeleton() {
  return (
    <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6 animate-pulse">
      <div className="h-11 rounded-xl bg-[#15161B] border border-[#23252E]" />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="flex flex-col gap-5">
          <div className="h-20 rounded-2xl bg-[#15161B] border border-[#23252E]" />
          <div className="h-[520px] rounded-2xl bg-[#101115] border border-[#1E2027]" />
        </div>
        <div className="h-80 rounded-2xl bg-[#15161B] border border-[#23252E]" />
      </div>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="max-w-xl w-full mx-auto px-4 py-20 text-center flex flex-col items-center gap-4">
      <AlertTriangle className="w-8 h-8 text-amber-400" aria-hidden="true" />
      <h1 className="text-xl font-bold text-white">The seat map is unavailable right now</h1>
      <p className="text-sm text-zinc-400">We couldn&apos;t load this screening. Please try again in a moment.</p>
      <Link href="/" className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold">
        Back to Now Showing
      </Link>
    </div>
  );
}

async function ScreeningContent({ params }: { params: Promise<{ showtimeId: string }> }) {
  const { showtimeId } = await params;
  await connection(); // everything below depends on the live request

  if (!UUID_RE.test(showtimeId)) notFound();

  const supabase = await createClient();

  const { data: showtimeData, error: showtimeError } = await supabase
    .from('showtimes')
    .select(
      `id, auditorium_id, start_time, end_time, price_standard, price_vip,
       movies ( id, title, tmdb_id, poster_path, runtime ),
       auditoriums ( id, name, screen_type, sound_system, total_seats )`
    )
    .eq('id', showtimeId)
    .maybeSingle();

  if (showtimeError) return <Unavailable />;
  if (!showtimeData) notFound();

  const showtime = showtimeData as unknown as ShowtimeRow;
  const movie = one(showtime.movies);
  const auditorium = one(showtime.auditoriums);
  if (!movie || !auditorium) notFound();

  const [seatsRes, holdsRes, reservedRes, userRes, tmdb] = await Promise.all([
    supabase
      .from('seats')
      .select('id, row, number, seat_type, is_wheelchair')
      .eq('auditorium_id', showtime.auditorium_id),
    supabase.from('seat_holds').select('seat_id, user_id, expires_at').eq('showtime_id', showtimeId),
    supabase
      .from('reservation_seats')
      .select('seat_id')
      .eq('showtime_id', showtimeId)
      .eq('status', 'reserved'),
    supabase.auth.getUser(),
    getTmdbMovieDetails(movie.tmdb_id, { posterPath: movie.poster_path, title: movie.title, runtime: movie.runtime }),
  ]);

  if (seatsRes.error || !seatsRes.data) return <Unavailable />;

  const seats = seatsRes.data as unknown as SeatRecord[];
  const holds = (holdsRes.data ?? []) as unknown as HoldRecord[];
  const reserved = ((reservedRes.data ?? []) as unknown as Array<{ seat_id: string }>).map((r) => r.seat_id);
  const user = userRes.data?.user ?? null;
  const userId = user?.id ?? null;
  const customerDefaults = {
    name:
      (user?.user_metadata?.full_name as string) ||
      (user?.user_metadata?.name as string) ||
      (user?.email ? user.email.split('@')[0] : ''),
    email: user?.email || '',
  };

  const serverNowMs = new Date().getTime();
  const startLabel = `${formatShowDay(showtime.start_time, serverNowMs)} \u2022 ${formatManilaClock(
    new Date(showtime.start_time)
  )}`;

  return (
    <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
      <title>{`${movie.title} \u2013 Select seats | MovieSeat`}</title>
      <meta
        name="description"
        content={`Choose your seats for ${movie.title} at Cinema City Hall. Seats are held for 5 minutes while you check out.`}
      />

      {/* Breadcrumb header */}
      <nav
        aria-label="Breadcrumb"
        className="bg-[#15161B] border border-[#23252E] rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      >
        <Clapperboard className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
        <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
          Now Showing
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-zinc-600" aria-hidden="true" />
        <h1 className="font-semibold text-white">{movie.title}</h1>
        <span className="text-zinc-600" aria-hidden="true">/</span>
        <span className="text-zinc-300">{startLabel}</span>
        <span className="text-xs font-semibold text-sky-300 tracking-wide uppercase">{auditorium.name}</span>
        <span className="text-xs font-semibold text-amber-400">
          {`\u20B1${Math.round(Number(showtime.price_standard))} / ticket`}
        </span>
      </nav>

      <ScreeningReservationClient
        showtimeId={showtime.id}
        startTimeMs={new Date(showtime.start_time).getTime()}
        serverNowMs={serverNowMs}
        seats={seats}
        initialHolds={holds}
        initialReserved={reserved}
        initialUserId={userId}
        customerDefaults={customerDefaults}
        summary={{
          movieTitle: movie.title,
          posterUrl: tmdb.posterUrl,
          auditoriumName: auditorium.name,
          startLabel,
          priceStandard: Number(showtime.price_standard),
          priceVip: Number(showtime.price_vip),
        }}
      />
    </div>
  );
}

export default function ScreeningPage({ params }: { params: Promise<{ showtimeId: string }> }) {
  return (
    <Suspense fallback={<ScreeningSkeleton />}>
      <ScreeningContent params={params} />
    </Suspense>
  );
}
