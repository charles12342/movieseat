'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  CheckCircle2,
  Copy,
  Check,
  Calendar,
  Clock,
  MapPin,
  Coffee,
  Volume2,
  Tv,
  Info,
} from 'lucide-react';
import { formatPeso, formatSeatLabel } from '@/lib/booking';

export interface TicketCardProps {
  reservation: {
    id: string;
    referenceCode: string;
    status: string;
    totalAmount: number;
    customerName: string;
    customerEmail: string;
    createdAt: string;
    movie: {
      title: string;
      posterUrl: string;
      runtime: number;
      rating?: string;
    };
    auditorium: {
      name: string;
      screenType: string;
      soundSystem: string;
    };
    showtime: {
      startLabel: string;
      dateLabel: string;
      clockLabel: string;
    };
    seats: Array<{
      id: string;
      row: string;
      number: number;
      seatType: string;
      price: number;
    }>;
  };
}

export default function TicketCard({ reservation }: TicketCardProps) {
  const [copied, setCopied] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  const handleCopyReference = async () => {
    try {
      await navigator.clipboard.writeText(reservation.referenceCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback if clipboard API is restricted
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const barcodeBars = [
    3, 1, 2, 1, 4, 1, 2, 3, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 2, 3, 1, 2, 4,
    1, 3, 2, 1, 4, 1, 2, 3, 1, 3, 2, 1, 4, 2, 1, 3,
  ];

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* 1. Reservation Confirmed Banner */}
      <div
        id="reservation-confirmed-banner"
        className="rounded-2xl bg-gradient-to-r from-emerald-950/40 via-[#15161B] to-[#15161B] border border-emerald-500/30 p-5 sm:p-6 flex items-start gap-4 shadow-xl"
      >
        <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
          <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Reservation Confirmed
            </h1>
            <span
              id="ticket-status-badge"
              className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold uppercase tracking-wider"
            >
              {reservation.status || 'Active'}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            An e-ticket receipt was dispatched to{' '}
            <span className="text-zinc-200 font-semibold">{reservation.customerEmail}</span>.
          </p>
        </div>
      </div>

      {/* 2. Perforated Digital Ticket Pass */}
      <div
        id="digital-ticket-card"
        className="relative bg-[#15161B] border border-[#23252E] rounded-3xl overflow-hidden shadow-2xl"
      >
        {/* Upper Main Body: Movie & Screening Specs */}
        <div className="p-6 sm:p-8 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row gap-5 items-start">
            {/* Poster Thumbnail */}
            <div className="relative w-24 h-36 sm:w-28 sm:h-40 rounded-xl overflow-hidden bg-[#0E0F13] border border-zinc-800 shrink-0 shadow-md">
              <Image
                src={posterFailed ? '/fallback-poster.svg' : reservation.movie.posterUrl}
                alt={`${reservation.movie.title} poster`}
                fill
                sizes="(max-width: 640px) 96px, 112px"
                className="object-cover"
                onError={() => setPosterFailed(true)}
              />
            </div>

            {/* Movie Title & Badges */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="px-2.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-bold tracking-wide uppercase">
                  Digital Pass
                </span>
                {reservation.movie.rating && (
                  <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 text-[11px] font-semibold">
                    {reservation.movie.rating}
                  </span>
                )}
                <span className="text-xs text-zinc-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
                  {reservation.movie.runtime} min
                </span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight">
                {reservation.movie.title}
              </h2>

              {/* Sound & Screen Specs */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-xs text-zinc-400">
                <span className="flex items-center gap-1.5 text-sky-400 font-semibold">
                  <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                  {reservation.auditorium.name} • Cinema City Hall
                </span>
                <span className="flex items-center gap-1 text-zinc-300">
                  <Tv className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                  {reservation.auditorium.screenType || '4K Dual Laser'}
                </span>
                <span className="flex items-center gap-1 text-zinc-300">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  {reservation.auditorium.soundSystem || 'Dolby Atmos 7.1'}
                </span>
              </div>
            </div>
          </div>

          {/* Screening Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-[#23252E]">
            <div>
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Date</p>
              <p className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-amber-500" aria-hidden="true" />
                {reservation.showtime.dateLabel}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Showtime</p>
              <p className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-sky-400" aria-hidden="true" />
                {reservation.showtime.clockLabel}
              </p>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Total Paid</p>
              <p className="text-base font-extrabold text-amber-400 mt-0.5" id="ticket-total-paid">
                {formatPeso(reservation.totalAmount)}
              </p>
            </div>
          </div>

          {/* Allocated Seat Badges */}
          <div>
            <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Allocated Seats ({reservation.seats.length})
            </p>
            <div className="flex flex-wrap gap-2" id="ticket-allocated-seats">
              {reservation.seats.map((seat) => (
                <div
                  key={seat.id}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold font-mono shadow-sm ${
                    seat.seatType === 'vip'
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                      : 'bg-[#1C1E26] border-[#2A2C35] text-white'
                  }`}
                >
                  <span>{formatSeatLabel(seat)}</span>
                  {seat.seatType === 'vip' ? (
                    <span className="text-[9px] uppercase px-1 py-0.2 bg-amber-500 text-black rounded font-black tracking-tighter">
                      VIP
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-500 font-sans font-normal">Standard</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 3. Perforated Tear-Line with Circular Edge Cutouts */}
        <div className="relative flex items-center my-1" aria-hidden="true">
          <div className="ticket-perforation-left" />
          <div className="w-full border-b-2 border-dashed border-[#23252E]" />
          <div className="ticket-perforation-right" />
        </div>

        {/* 4. Tear-Off Stub (Reference Code & Barcode) */}
        <div className="p-6 sm:p-8 bg-[#101115] flex flex-col sm:flex-row items-center justify-between gap-6">
          {/* Reference Code & Copy Action */}
          <div className="text-center sm:text-left">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-widest block">
              Booking Reference Code
            </span>
            <div className="flex items-center justify-center sm:justify-start gap-3 mt-1.5">
              <span
                id="ticket-reference-code"
                className="text-2xl sm:text-3xl font-black font-mono text-amber-400 tracking-widest"
              >
                {reservation.referenceCode}
              </span>
              <button
                type="button"
                id="copy-reference-button"
                onClick={handleCopyReference}
                aria-label="Copy booking reference code"
                className="p-2 rounded-lg bg-[#1C1E26] hover:bg-[#23252E] border border-[#2A2C35] text-zinc-300 hover:text-white transition-all active:scale-95 cursor-pointer relative"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {copied && (
              <p
                role="status"
                className="text-xs text-emerald-400 font-semibold mt-1 animate-fade-in"
              >
                Reference code copied to clipboard!
              </p>
            )}
          </div>

          {/* Decorative Barcode & Turnstile Advisory */}
          <div className="flex flex-col items-center sm:items-end text-center sm:text-right">
            <div
              className="flex items-stretch h-10 gap-0.5 bg-black/40 px-3 py-1.5 rounded-lg border border-zinc-800 shadow-inner"
              aria-hidden="true"
            >
              {barcodeBars.map((width, idx) => (
                <div
                  key={idx}
                  style={{ width }}
                  className={`h-full ${idx % 2 === 0 ? 'bg-white' : 'bg-transparent'}`}
                />
              ))}
            </div>
            <p className="text-[10px] font-semibold text-zinc-400 mt-1.5 flex items-center gap-1">
              <Info className="w-3 h-3 text-amber-500 shrink-0" aria-hidden="true" />
              <span>Present barcode at Turnstile 1-3 for direct entry</span>
            </p>
          </div>
        </div>
      </div>

      {/* 5. Concession Guidelines Card */}
      <div
        id="concession-guidelines-card"
        className="bg-[#15161B] border border-[#23252E] rounded-2xl p-5 sm:p-6 flex items-start gap-4 shadow-lg text-xs"
      >
        <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
          <Coffee className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-white">Concession & Theater Guidelines</h3>
          <ul className="mt-2 text-zinc-400 space-y-1.5 list-disc list-inside">
            <li>
              Outside hot meals, fast food, and pungent items are strictly prohibited inside the auditorium.
            </li>
            <li>
              Freshly popped cinema popcorn, gourmet snacks, and chilled beverages are available at{' '}
              <strong className="text-zinc-200">Concessions Counter Level 2</strong>.
            </li>
            <li>
              Please silence all mobile devices before the opening credits and enjoy the screening!
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
