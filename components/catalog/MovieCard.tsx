'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Clock, Armchair, ChevronRight } from 'lucide-react';
import ShowtimePills, { CatalogShowtime } from './ShowtimePills';
import { formatManilaClock, isShowtimePast } from '@/lib/time';

export interface CatalogMovie {
  id: string;
  tmdb_id: number | null;
  title: string;
  overview: string | null;
  poster_path: string | null;
  posterUrl: string;
  runtime: number;
  genres: string[];
  rating: string | null;
  format_badges: string[];
}

interface MovieCardProps {
  movie: CatalogMovie;
  showtimes: CatalogShowtime[];
  seatsOpenMap: Record<string, number>;
}

/**
 * Styling helper for movie rating badges
 */
function getRatingBadgeClasses(rating: string | null): string {
  const r = (rating || 'PG-13').toUpperCase();
  if (r.includes('R') || r.includes('18')) {
    return 'bg-rose-900/90 text-rose-100 border border-rose-700/60 font-bold';
  }
  return 'bg-black/75 backdrop-blur-md text-white border border-white/20 font-semibold';
}

/**
 * Styling helper for audio / format badge
 */
function getFormatBadgeClasses(badge: string): string {
  const b = badge.toUpperCase();
  if (b.includes('IMAX')) {
    return 'bg-amber-500 text-black font-extrabold';
  }
  if (b.includes('ANIMATED')) {
    return 'bg-rose-700 text-white font-bold tracking-wider';
  }
  if (b.includes('INDIE') || b.includes('A24')) {
    return 'bg-blue-700 text-white font-bold tracking-wider';
  }
  return 'bg-zinc-800 text-amber-400 font-semibold border border-zinc-700';
}

export default function MovieCard({
  movie,
  showtimes,
  seatsOpenMap,
}: MovieCardProps) {
  const [imageError, setImageError] = useState(false);

  // Automatically select the first upcoming showtime, or the first showtime if none upcoming
  const defaultShowtimeId = useMemo(() => {
    if (!showtimes || showtimes.length === 0) return null;
    const firstUpcoming = showtimes.find((st) => !isShowtimePast(st.start_time));
    return firstUpcoming ? firstUpcoming.id : showtimes[0].id;
  }, [showtimes]);

  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string | null>(defaultShowtimeId);

  // Ensure current selection is valid for this card's showtimes list
  const activeShowtime = useMemo(() => {
    if (!showtimes || showtimes.length === 0) return null;
    return showtimes.find((st) => st.id === selectedShowtimeId) || showtimes[0];
  }, [showtimes, selectedShowtimeId]);

  const isCurrentPast = activeShowtime ? isShowtimePast(activeShowtime.start_time) : true;
  const currentOpenSeats = activeShowtime
    ? (seatsOpenMap[activeShowtime.id] ?? activeShowtime.auditorium?.total_seats ?? 50)
    : 0;

  const primaryFormatBadge = movie.format_badges && movie.format_badges.length > 0
    ? movie.format_badges[0]
    : null;

  const displayRating = (movie.rating || 'PG-13').toUpperCase().includes('R') && !movie.rating?.includes('PG')
    ? 'RATED R'
    : movie.rating || 'PG-13';

  return (
    <div className="bg-[#15161B] border border-[#23252E] rounded-2xl overflow-hidden hover:border-zinc-700/80 transition-all duration-200 p-5 flex flex-col md:flex-row gap-5 shadow-lg shadow-black/40">
      {/* Poster Column with Aspect Ratio 2/3 */}
      <div className="w-full md:w-44 shrink-0 relative aspect-[2/3] rounded-xl overflow-hidden bg-[#0E0F13] border border-zinc-800/80 select-none shadow-md">
        <Image
          src={imageError ? '/fallback-poster.svg' : movie.posterUrl || '/fallback-poster.svg'}
          alt={movie.title}
          fill
          sizes="(max-width: 768px) 100vw, 176px"
          priority={false}
          className="object-cover transition-transform duration-300 hover:scale-105"
          onError={() => setImageError(true)}
        />

        {/* Overlaid Badges (Top-Left) */}
        <div className="absolute top-2.5 left-2.5 flex flex-col gap-1.5 z-10">
          <span className={`text-[10px] sm:text-[11px] px-2 py-0.5 rounded shadow-sm ${getRatingBadgeClasses(movie.rating)}`}>
            {displayRating}
          </span>
          {primaryFormatBadge && (
            <span className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider shadow-sm ${getFormatBadgeClasses(primaryFormatBadge)}`}>
              {primaryFormatBadge}
            </span>
          )}
        </div>
      </div>

      {/* Movie Details & Screening Controls Column */}
      <div className="flex-1 flex flex-col justify-between gap-4 min-w-0">
        <div>
          {/* Genre and Runtime Header */}
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 flex-wrap">
            <span>{movie.genres?.join(' • ') || 'CINEMA FEATURE'}</span>
            <span className="text-zinc-600">•</span>
            <span className="flex items-center gap-1 text-zinc-300">
              <Clock className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              {movie.runtime} MIN
            </span>
          </div>

          {/* Movie Title */}
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-tight mb-2">
            {movie.title}
          </h2>

          {/* Synopsis */}
          <p className="text-xs sm:text-sm text-zinc-400 line-clamp-2 leading-relaxed mb-4">
            {movie.overview || 'Experience this feature screening in our premium sound and projection auditoriums.'}
          </p>

          {/* Showtime Selection Pills */}
          <ShowtimePills
            showtimes={showtimes}
            selectedShowtimeId={activeShowtime?.id || null}
            onSelectShowtime={(id) => setSelectedShowtimeId(id)}
          />
        </div>

        {/* Bottom Bar: Live Seats-Open Counter & Select Screening Button */}
        <div className="pt-3 border-t border-[#23252E] flex flex-wrap items-center justify-between gap-3 mt-auto">
          {/* Live Seats-Open Count */}
          <div className="flex items-center gap-2 text-xs text-zinc-300 font-medium">
            <Armchair className="w-4 h-4 text-zinc-400 shrink-0" />
            {activeShowtime ? (
              <span>
                <strong className={currentOpenSeats > 10 ? 'text-zinc-200' : 'text-amber-400'}>
                  {currentOpenSeats} Seats Open
                </strong>{' '}
                <span className="text-zinc-500">({formatManilaClock(new Date(activeShowtime.start_time))})</span>
              </span>
            ) : (
              <span className="text-zinc-500">No screenings available</span>
            )}
          </div>

          {/* Select Screening Action Button */}
          {activeShowtime && !isCurrentPast ? (
            <Link
              href={`/screenings/${activeShowtime.id}`}
              className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs sm:text-sm transition-all duration-150 shadow-md shadow-amber-500/20 hover:shadow-amber-500/30 transform active:scale-95"
            >
              <span>Select Screening</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-zinc-800/80 text-zinc-500 text-xs sm:text-sm font-semibold cursor-not-allowed select-none border border-zinc-800"
            >
              {isCurrentPast ? 'Screening Started' : 'Select Screening'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
