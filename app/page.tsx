import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getManilaDateString } from '@/lib/time';
import { getTmdbMovieDetails, FALLBACK_POSTER_URL } from '@/lib/tmdb';
import CatalogView from '@/components/catalog/CatalogView';
import type { CatalogMovie } from '@/components/catalog/MovieCard';
import type { CatalogShowtime } from '@/components/catalog/ShowtimePills';
import type { Auditorium } from '@/components/catalog/AuditoriumFilter';

interface RawShowtimeRow {
  id: string;
  movie_id: string;
  auditorium_id: string;
  start_time: string;
  end_time: string;
  price_standard: number;
  price_vip: number;
  auditoriums?: {
    id: string;
    name: string;
    screen_type: string;
    sound_system?: string;
    total_seats?: number;
  } | Array<{
    id: string;
    name: string;
    screen_type: string;
    sound_system?: string;
    total_seats?: number;
  }> | null;
}

interface RawMovieRow {
  id: string;
  tmdb_id: number | null;
  title: string;
  overview: string | null;
  poster_path: string | null;
  runtime: number;
  genres: string[] | null;
  rating: string | null;
  format_badges: string[] | null;
}

export default async function Home() {
  // Opt-in to dynamic rendering in Next.js 16 via connection()
  await connection();

  const supabase = await createClient();

  const todayManila = getManilaDateString(new Date());
  const startOfDay = `${todayManila}T00:00:00+08:00`;
  const endOfDay = `${todayManila}T23:59:59.999+08:00`;

  let auditoriums: Auditorium[] = [];
  let rawShowtimes: RawShowtimeRow[] = [];
  let rawMovies: RawMovieRow[] = [];

  try {
    // 1. Fetch all auditoriums
    const { data: audData } = await supabase
      .from('auditoriums')
      .select('id, name, screen_type, sound_system, total_seats')
      .order('name', { ascending: true });

    if (audData) {
      auditoriums = audData;
    }

    // 2. Fetch today's showtimes in Asia/Manila timezone
    const { data: stData } = await supabase
      .from('showtimes')
      .select(`
        id,
        movie_id,
        auditorium_id,
        start_time,
        end_time,
        price_standard,
        price_vip,
        auditoriums (
          id,
          name,
          screen_type,
          sound_system,
          total_seats
        )
      `)
      .gte('start_time', startOfDay)
      .lte('start_time', endOfDay)
      .order('start_time', { ascending: true });

    rawShowtimes = (stData as unknown as RawShowtimeRow[]) || [];

    // 3. Auto-Reseed: If no showtimes exist for today, trigger reseed_today() and reload
    if (rawShowtimes.length === 0) {
      console.log('[Catalog] No showtimes for today in Asia/Manila. Triggering auto-reseed...');
      const { error: reseedErr } = await supabase.rpc('reseed_today');
      if (!reseedErr) {
        // Reload showtimes after reseed
        const { data: reloadedSt } = await supabase
          .from('showtimes')
          .select(`
            id,
            movie_id,
            auditorium_id,
            start_time,
            end_time,
            price_standard,
            price_vip,
            auditoriums (
              id,
              name,
              screen_type,
              sound_system,
              total_seats
            )
          `)
          .gte('start_time', startOfDay)
          .lte('start_time', endOfDay)
          .order('start_time', { ascending: true });

        if (reloadedSt) {
          rawShowtimes = reloadedSt as unknown as RawShowtimeRow[];
        }
      }
    }

    // 4. Fetch movies
    const { data: mData } = await supabase
      .from('movies')
      .select('id, tmdb_id, title, overview, poster_path, runtime, genres, rating, format_badges');

    rawMovies = (mData as unknown as RawMovieRow[]) || [];
  } catch (err) {
    console.warn('[Catalog] Database query exception (tables may need schema setup):', err);
  }

  // 5. Fetch TMDB metadata for each movie on the server (server-side only)
  const movies: CatalogMovie[] = await Promise.all(
    rawMovies.map(async (movie) => {
      const tmdb = await getTmdbMovieDetails(movie.tmdb_id, {
        posterPath: movie.poster_path,
        title: movie.title,
        runtime: movie.runtime,
        overview: movie.overview,
      });

      return {
        id: movie.id,
        tmdb_id: movie.tmdb_id,
        title: movie.title,
        overview: movie.overview || tmdb.overview || '',
        poster_path: movie.poster_path,
        posterUrl: tmdb.posterUrl || FALLBACK_POSTER_URL,
        runtime: movie.runtime || tmdb.runtime || 120,
        genres: movie.genres || [],
        rating: movie.rating || 'PG-13',
        format_badges: movie.format_badges || [],
      };
    })
  );

  // 6. Map showtimes data
  const showtimes: CatalogShowtime[] = rawShowtimes.map((st) => {
    const aud = Array.isArray(st.auditoriums) ? st.auditoriums[0] : st.auditoriums;
    return {
      id: st.id,
      movie_id: st.movie_id,
      auditorium_id: st.auditorium_id,
      start_time: st.start_time,
      end_time: st.end_time,
      price_standard: Number(st.price_standard),
      price_vip: Number(st.price_vip),
      auditorium: aud
        ? {
            id: aud.id,
            name: aud.name,
            screen_type: aud.screen_type,
            sound_system: aud.sound_system,
            total_seats: aud.total_seats,
          }
        : undefined,
    };
  });

  // 7. Calculate initial live seats-open count for today's showtimes
  const showtimeIds = showtimes.map((s) => s.id);
  const initialSeatsOpenMap: Record<string, number> = {};

  if (showtimeIds.length > 0) {
    try {
      const nowIso = new Date().toISOString();
      const [holdsRes, reservedRes] = await Promise.all([
        supabase
          .from('seat_holds')
          .select('showtime_id')
          .in('showtime_id', showtimeIds)
          .gt('expires_at', nowIso),
        supabase
          .from('reservation_seats')
          .select('showtime_id')
          .in('showtime_id', showtimeIds)
          .eq('status', 'reserved'),
      ]);

      const occupiedMap: Record<string, number> = {};
      for (const id of showtimeIds) occupiedMap[id] = 0;

      if (holdsRes.data) {
        for (const h of holdsRes.data as Array<{ showtime_id: string }>) {
          if (occupiedMap[h.showtime_id] !== undefined) occupiedMap[h.showtime_id]++;
        }
      }
      if (reservedRes.data) {
        for (const r of reservedRes.data as Array<{ showtime_id: string }>) {
          if (occupiedMap[r.showtime_id] !== undefined) occupiedMap[r.showtime_id]++;
        }
      }

      for (const st of showtimes) {
        const total = st.auditorium?.total_seats ?? 88;
        const occupied = occupiedMap[st.id] || 0;
        initialSeatsOpenMap[st.id] = Math.max(0, total - occupied);
      }
    } catch (err) {
      console.warn('[Catalog] Error computing initial seat occupancy:', err);
    }
  }

  return (
    <CatalogView
      movies={movies}
      showtimes={showtimes}
      auditoriums={auditoriums}
      initialSeatsOpenMap={initialSeatsOpenMap}
    />
  );
}
