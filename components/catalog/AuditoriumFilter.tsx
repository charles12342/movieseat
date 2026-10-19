'use client';

import { Film } from 'lucide-react';

export interface Auditorium {
  id: string;
  name: string;
  screen_type: string;
  sound_system?: string;
  total_seats?: number;
}

interface AuditoriumFilterProps {
  auditoriums: Auditorium[];
  selectedAuditoriumId: string | null;
  onSelectAuditorium: (id: string | null) => void;
}

/**
 * Returns dot accent color matching the cinema hall specifications:
 * - Cinema 1 (Dolby Atmos) -> Blue
 * - Cinema 2 (IMAX Laser) -> Amber / Gold
 * - Cinema 3 (Standard) -> Emerald
 */
function getAuditoriumDotColor(screenType: string): string {
  if (screenType.toLowerCase().includes('atmos') || screenType.toLowerCase().includes('dolby')) {
    return 'bg-blue-400';
  }
  if (screenType.toLowerCase().includes('imax')) {
    return 'bg-amber-400';
  }
  return 'bg-emerald-400';
}

export default function AuditoriumFilter({
  auditoriums,
  selectedAuditoriumId,
  onSelectAuditorium,
}: AuditoriumFilterProps) {
  return (
    <div className="bg-[#15161B] border border-[#23252E] rounded-xl p-3 flex flex-wrap items-center gap-3 text-xs shadow-sm">
      <span className="text-zinc-400 font-semibold uppercase tracking-wider flex items-center gap-1.5 pl-2 select-none">
        <Film className="w-3.5 h-3.5 text-amber-500" />
        Auditorium:
      </span>

      <div className="flex flex-wrap items-center gap-2">
        {/* All Auditoriums Pill */}
        <button
          type="button"
          onClick={() => onSelectAuditorium(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            selectedAuditoriumId === null
              ? 'bg-zinc-800 text-white shadow-sm ring-1 ring-zinc-700'
              : 'bg-[#1C1E26] text-zinc-400 hover:text-white border border-zinc-800/80 hover:bg-zinc-800/60'
          }`}
        >
          All Auditoriums
        </button>

        {/* Dynamic Auditoriums Pills */}
        {auditoriums.map((auditorium) => {
          const isSelected = selectedAuditoriumId === auditorium.id;
          const dotColor = getAuditoriumDotColor(auditorium.screen_type);

          return (
            <button
              key={auditorium.id}
              type="button"
              onClick={() => onSelectAuditorium(auditorium.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all ${
                isSelected
                  ? 'bg-zinc-800 text-white shadow-sm ring-1 ring-zinc-700'
                  : 'bg-[#1C1E26] text-zinc-300 hover:text-white border border-zinc-800/80 hover:bg-zinc-800/60'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              <span>{auditorium.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
