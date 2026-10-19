'use client';

import { formatManilaClock, isShowtimePast } from '@/lib/time';

export interface CatalogShowtime {
  id: string;
  movie_id: string;
  auditorium_id: string;
  start_time: string;
  end_time: string;
  price_standard: number;
  price_vip: number;
  auditorium?: {
    id: string;
    name: string;
    screen_type: string;
    sound_system?: string;
    total_seats?: number;
  };
}

interface ShowtimePillsProps {
  showtimes: CatalogShowtime[];
  selectedShowtimeId: string | null;
  onSelectShowtime: (showtimeId: string) => void;
}

/**
 * Derives clean short badge text for auditorium / format
 * E.g. "Cinema 1 • Dolby Atmos" -> "Cinema 1" or "Cinema 1 • Atmos"
 * E.g. "Cinema 2 • IMAX Laser" -> "Cinema 2 IMAX"
 * E.g. "Cinema 3 • Standard" -> "Cinema 3 • Surround 5.1"
 */
function formatAuditoriumLabel(showtime: CatalogShowtime): string {
  if (!showtime.auditorium) return '';
  const name = showtime.auditorium.name;
  if (name.includes('Cinema 1')) {
    return 'Cinema 1';
  }
  if (name.includes('Cinema 2')) {
    return 'Cinema 2 IMAX';
  }
  if (name.includes('Cinema 3')) {
    return showtime.auditorium.sound_system
      ? `Cinema 3 • ${showtime.auditorium.sound_system}`
      : 'Cinema 3';
  }
  return name;
}

export default function ShowtimePills({
  showtimes,
  selectedShowtimeId,
  onSelectShowtime,
}: ShowtimePillsProps) {
  if (!showtimes || showtimes.length === 0) {
    return (
      <div className="py-2 text-xs text-zinc-500 italic">
        No showtimes available for this auditorium today.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold text-zinc-400 tracking-wider uppercase select-none">
        Showtimes & Formats:
      </div>

      <div className="flex flex-wrap gap-2.5">
        {showtimes.map((st) => {
          const isPast = isShowtimePast(st.start_time);
          const isSelected = selectedShowtimeId === st.id;
          const timeFormatted = formatManilaClock(new Date(st.start_time));
          const audLabel = formatAuditoriumLabel(st);
          const priceDisplay = `₱${Math.round(st.price_standard)}`;

          if (isPast) {
            return (
              <button
                key={st.id}
                type="button"
                disabled
                title="This screening has already started"
                className="px-3 py-2 rounded-xl bg-[#14151B]/60 border border-zinc-800/40 text-left opacity-35 cursor-not-allowed select-none transition-all flex flex-col min-w-[110px]"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-400 line-through">
                    {timeFormatted}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-medium">
                    {priceDisplay}
                  </span>
                </div>
                <div className="text-[10px] text-zinc-600 truncate mt-0.5">
                  {audLabel} (Ended)
                </div>
              </button>
            );
          }

          return (
            <button
              key={st.id}
              type="button"
              onClick={() => onSelectShowtime(st.id)}
              className={`px-3 py-2 rounded-xl text-left transition-all duration-150 flex flex-col min-w-[110px] cursor-pointer ${
                isSelected
                  ? 'bg-amber-500/10 border-2 border-amber-500 text-white shadow-md shadow-amber-500/15 ring-1 ring-amber-500/30 transform scale-[1.02]'
                  : 'bg-[#1C1E26] border border-zinc-800/80 text-zinc-200 hover:border-zinc-700 hover:bg-[#232532]'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-xs font-bold ${isSelected ? 'text-amber-400' : 'text-white'}`}>
                  {timeFormatted}
                </span>
                <span className="text-[11px] text-amber-500 font-bold tracking-tight">
                  {priceDisplay}
                </span>
              </div>
              <div className="text-[10px] text-zinc-400 truncate mt-0.5 font-medium">
                {audLabel}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
