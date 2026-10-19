'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import AuditoriumFilter, { Auditorium } from './AuditoriumFilter';
import MovieCard, { CatalogMovie } from './MovieCard';
import { CatalogShowtime } from './ShowtimePills';
import { createClient } from '@/lib/supabase/client';

interface CatalogViewProps {
  movies: CatalogMovie[];
  showtimes: CatalogShowtime[];
  auditoriums: Auditorium[];
  initialSeatsOpenMap: Record<string, number>;
}

export default function CatalogView({
  movies,
  showtimes,
  auditoriums,
  initialSeatsOpenMap,
}: CatalogViewProps) {
  const [selectedAuditoriumId, setSelectedAuditoriumId] = useState<string | null>(null);
  const [realtimeOverrides, setRealtimeOverrides] = useState<Record<string, number>>({});

  // Merge initial server-rendered counts with live realtime overrides
  const seatsOpenMap = useMemo(() => {
    return { ...initialSeatsOpenMap, ...realtimeOverrides };
  }, [initialSeatsOpenMap, realtimeOverrides]);

  // Refresh live seat occupancy counts
  const refreshSeatCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/showtimes/seats-open');
      if (res.ok) {
        const data = await res.json();
        if (data?.seatsOpenMap) {
          setRealtimeOverrides(data.seatsOpenMap);
        }
      }
    } catch (err) {
      console.warn('[CatalogView] Error refreshing live seat counts:', err);
    }
  }, []);

  // Supabase Realtime Subscription: seat_holds & reservation_seats
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel('catalog-seats-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'seat_holds' },
        () => {
          refreshSeatCounts();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservation_seats' },
        () => {
          refreshSeatCounts();
        }
      )
      .subscribe();

    // 30-second interval fallback check in case of network drops
    const interval = setInterval(refreshSeatCounts, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [refreshSeatCounts]);

  // Selected auditorium object if filtered
  const activeAuditorium = useMemo(() => {
    if (!selectedAuditoriumId) return null;
    return auditoriums.find((a) => a.id === selectedAuditoriumId) || null;
  }, [auditoriums, selectedAuditoriumId]);

  // Filter showtimes and movies based on auditorium selection
  const { filteredMovies, showtimesByMovie } = useMemo(() => {
    // Group showtimes by movie_id
    const map: Record<string, CatalogShowtime[]> = {};
    for (const st of showtimes) {
      if (selectedAuditoriumId && st.auditorium_id !== selectedAuditoriumId) {
        continue;
      }
      if (!map[st.movie_id]) {
        map[st.movie_id] = [];
      }
      map[st.movie_id].push(st);
    }

    // Only keep movies that have active showtimes under current filter
    const activeMovies = movies.filter((m) => map[m.id] && map[m.id].length > 0);

    return {
      filteredMovies: activeMovies,
      showtimesByMovie: map,
    };
  }, [movies, showtimes, selectedAuditoriumId]);

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
      {/* 1. Auditorium Filter Bar */}
      <AuditoriumFilter
        auditoriums={auditoriums}
        selectedAuditoriumId={selectedAuditoriumId}
        onSelectAuditorium={setSelectedAuditoriumId}
      />

      {/* 2. Catalog Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3 border-b border-[#23252E] pb-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Now Showing
          </h1>
          <span className="text-xs text-zinc-400 font-medium">
            {filteredMovies.length} {filteredMovies.length === 1 ? 'Title' : 'Titles'} Available{' '}
            {activeAuditorium ? `in ${activeAuditorium.name}` : 'Today'}
          </span>
        </div>

        {/* Realtime Live Indicator */}
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-500 tracking-wide select-none">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
          <span className="uppercase text-[11px] font-bold">Real-Time Seat Availability Active</span>
        </div>
      </div>

      {/* 3. 2x2 Movie Cards Grid */}
      {filteredMovies.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredMovies.map((movie) => (
            <MovieCard
              key={movie.id}
              movie={movie}
              showtimes={showtimesByMovie[movie.id] || []}
              seatsOpenMap={seatsOpenMap}
            />
          ))}
        </div>
      ) : (
        <div className="bg-[#15161B] border border-[#23252E] rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-full bg-zinc-800/80 border border-zinc-700/80 flex items-center justify-center text-zinc-400">
            🎬
          </div>
          <div className="max-w-md">
            <h3 className="text-lg font-bold text-white mb-1">No Screenings Found</h3>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              {activeAuditorium
                ? `There are no scheduled showtimes in ${activeAuditorium.name} today. Try selecting 'All Auditoriums'.`
                : 'No screenings are currently available for today. Please check back shortly.'}
            </p>
          </div>
          {selectedAuditoriumId && (
            <button
              type="button"
              onClick={() => setSelectedAuditoriumId(null)}
              className="mt-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold transition-all"
            >
              Show All Auditoriums
            </button>
          )}
        </div>
      )}
    </div>
  );
}
