'use client';

import { Accessibility, Check, Clock, Lock, Star } from 'lucide-react';
import {
  aislePositions,
  groupSeatRows,
  seatLabel,
  type SeatRecord,
  type SeatState,
} from '@/lib/seat-state';

interface SeatMatrixProps {
  seats: SeatRecord[];
  states: Record<string, SeatState>;
  onSeatClick: (seatId: string) => void;
  /** Blocks every seat (e.g. the screening already started) */
  disabled?: boolean;
  vipPrice?: number;
}

const SEAT_BASE =
  'relative w-8 h-8 sm:w-9 sm:h-9 rounded-lg text-[10px] sm:text-[11px] font-semibold flex items-center justify-center ' +
  'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400';

function seatClasses(state: SeatState, isVip: boolean, disabled: boolean): string {
  switch (state) {
    case 'selected':
      return `${SEAT_BASE} bg-amber-500 text-black shadow-md shadow-amber-500/40 ring-1 ring-amber-300/60 ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-amber-400'
      }`;
    case 'held':
      return `${SEAT_BASE} bg-transparent text-amber-300/70 border border-dashed border-amber-500/50 cursor-not-allowed`;
    case 'reserved':
      return `${SEAT_BASE} bg-[#17181D] text-zinc-600 border border-[#1F2128] cursor-not-allowed`;
    default:
      return `${SEAT_BASE} ${
        isVip
          ? 'bg-[#2A2418] text-amber-200 border border-amber-500/30'
          : 'bg-[#272932] text-zinc-300 border border-transparent'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[#33353F] hover:text-white'}`;
  }
}

function stateWord(state: SeatState): string {
  switch (state) {
    case 'selected':
      return 'selected by you';
    case 'held':
      return 'held by another customer';
    case 'reserved':
      return 'already reserved';
    default:
      return 'available';
  }
}

function SeatButton({
  seat,
  state,
  disabled,
  onSeatClick,
}: {
  seat: SeatRecord;
  state: SeatState;
  disabled: boolean;
  onSeatClick: (seatId: string) => void;
}) {
  const isVip = seat.seat_type === 'vip';
  // Mine stays clickable (to deselect) unless the whole map is blocked.
  const blocked = disabled || state === 'held' || state === 'reserved';
  const label = seatLabel(seat);

  return (
    <button
      type="button"
      data-seat-id={seat.id}
      data-seat-state={state}
      disabled={blocked}
      aria-pressed={state === 'selected'}
      aria-label={`Seat ${label}${isVip ? ' VIP recliner' : ''}${seat.is_wheelchair ? ', wheelchair space' : ''}, ${stateWord(state)}`}
      title={`${label} · ${stateWord(state)}`}
      onClick={() => onSeatClick(seat.id)}
      className={seatClasses(state, isVip, disabled)}
    >
      {state === 'selected' ? (
        <Check className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
      ) : state === 'reserved' ? (
        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
      ) : state === 'held' ? (
        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
      ) : (
        <span>{label}</span>
      )}
      {seat.is_wheelchair && state === 'available' && (
        <Accessibility
          className="absolute -top-1 -right-1 w-3 h-3 text-sky-300 bg-[#0B0B0D] rounded-full"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

function Aisle() {
  return <div className="w-4 sm:w-6 flex justify-center" aria-hidden="true"><div className="w-px h-6 bg-[#2A2C35]" /></div>;
}

function RowSeats({
  seats,
  states,
  disabled,
  onSeatClick,
}: {
  seats: SeatRecord[];
  states: Record<string, SeatState>;
  disabled: boolean;
  onSeatClick: (seatId: string) => void;
}) {
  const [leftAisle, rightAisle] = aislePositions(seats.length);
  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {seats.map((seat, i) => (
        <div key={seat.id} className="flex items-center gap-1.5 sm:gap-2">
          <SeatButton
            seat={seat}
            state={states[seat.id] ?? 'available'}
            disabled={disabled}
            onSeatClick={onSeatClick}
          />
          {(i + 1 === leftAisle || i + 1 === rightAisle) && i + 1 < seats.length && <Aisle />}
        </div>
      ))}
    </div>
  );
}

export default function SeatMatrix({
  seats,
  states,
  onSeatClick,
  disabled = false,
  vipPrice,
}: SeatMatrixProps) {
  const rows = groupSeatRows(seats);
  const standardRows = rows.filter((r) => !r.isVip);
  const vipRows = rows.filter((r) => r.isVip);

  // Column numbers come from the widest standard row.
  const widest = standardRows.reduce<SeatRecord[]>(
    (acc, r) => (r.seats.length > acc.length ? r.seats : acc),
    []
  );

  return (
    <div className="w-full flex flex-col items-center">
      {/* Mobile Horizontal Swipe Hint */}
      <div
        id="seat-matrix-swipe-hint"
        className="sm:hidden flex items-center justify-center gap-1.5 py-1 px-3 mb-2.5 rounded-full bg-zinc-800/80 border border-zinc-700/60 text-[11px] text-zinc-300 font-medium select-none shadow-sm"
        aria-hidden="true"
      >
        <span className="text-amber-400 font-bold">←</span>
        <span>Swipe horizontally to browse all seats</span>
        <span className="text-amber-400 font-bold">→</span>
      </div>

      <div
        className="w-full flex flex-col items-center gap-2 overflow-x-auto touch-pan-x overscroll-x-contain scroll-smooth pb-3 select-none"
        role="group"
        aria-label="Seat map"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="min-w-max flex flex-col items-center gap-2 px-2">
          {/* Column numbers */}
          {widest.length > 0 && (
            <div className="flex items-center gap-3 mb-1" aria-hidden="true">
              <div className="w-5" />
              <div className="flex items-center gap-1.5 sm:gap-2">
              {widest.map((s, i) => {
                const [l, r] = aislePositions(widest.length);
                return (
                  <div key={s.id} className="flex items-center gap-1.5 sm:gap-2">
                    <div className="w-8 sm:w-9 text-center text-[10px] text-zinc-500 font-medium">{s.number}</div>
                    {(i + 1 === l || i + 1 === r) && i + 1 < widest.length && <div className="w-4 sm:w-6" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Standard rows */}
        {standardRows.map((r) => (
          <div key={r.row} className="flex items-center gap-3">
            <div className="w-5 text-center text-[11px] font-semibold text-zinc-500" aria-hidden="true">
              {r.row}
            </div>
            <RowSeats seats={r.seats} states={states} disabled={disabled} onSeatClick={onSeatClick} />
          </div>
        ))}

        {/* VIP recliners */}
        {vipRows.length > 0 && (
          <>
            <div className="w-full flex items-center gap-3 my-3" role="separator" aria-label="VIP recliners">
              <div className="flex-1 h-px bg-[#2A2C35]" />
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400 tracking-wide">
                <Star className="w-3.5 h-3.5 fill-amber-400" aria-hidden="true" />
                VIP Recliners{typeof vipPrice === 'number' ? ` · ₱${Math.round(vipPrice)}` : ''}
              </div>
              <div className="flex-1 h-px bg-[#2A2C35]" />
            </div>
            {vipRows.map((r) => (
              <div key={r.row} className="flex items-center gap-3">
                <div className="w-5 text-center text-[11px] font-semibold text-amber-400" aria-hidden="true">
                  {r.row}
                </div>
                <RowSeats seats={r.seats} states={states} disabled={disabled} onSeatClick={onSeatClick} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  </div>
);
}

/** Four-state legend shown under the map. */
export function SeatLegend() {
  const items: Array<{ label: string; swatch: string; icon?: React.ReactNode }> = [
    { label: 'Available', swatch: 'bg-[#272932]' },
    { label: 'Selected (yours)', swatch: 'bg-amber-500', icon: <Check className="w-3 h-3 text-black" strokeWidth={3} /> },
    { label: 'Held by others', swatch: 'border border-dashed border-amber-500/60', icon: <Clock className="w-3 h-3 text-amber-300/80" /> },
    { label: 'Reserved (sold)', swatch: 'bg-[#17181D] border border-[#1F2128]', icon: <Lock className="w-3 h-3 text-zinc-600" /> },
  ];
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-300" aria-label="Seat legend">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          <span className={`w-5 h-5 rounded-md flex items-center justify-center ${it.swatch}`} aria-hidden="true">
            {it.icon}
          </span>
          {it.label}
        </li>
      ))}
    </ul>
  );
}
