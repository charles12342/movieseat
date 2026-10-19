'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Timer,
  Loader2,
  X,
  User,
  Mail,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  Ticket,
} from 'lucide-react';
import type { SeatRecord } from '@/lib/seat-state';
import { formatCountdown, seatLabel, MAX_SEATS_PER_SELECTION } from '@/lib/seat-state';
import { formatPeso } from '@/lib/booking';

export interface TicketSummaryProps {
  movieTitle: string;
  posterUrl: string;
  auditoriumName: string;
  startLabel: string;
  priceStandard: number;
  priceVip: number;
}

export interface CustomerDefaults {
  name: string;
  email: string;
}

interface TicketSummarySidebarProps {
  summary: TicketSummaryProps;
  selectedSeats: SeatRecord[];
  onRemoveSeat: (seatId: string) => void;
  hasHold: boolean;
  urgent: boolean;
  remainingMs: number;
  isUpdatingHold: boolean;
  started: boolean;
  customerDefaults: CustomerDefaults;
  onConfirm: (customer: { name: string; email: string }) => Promise<void>;
  isConfirming: boolean;
  confirmError: string | null;
}

export default function TicketSummarySidebar({
  summary,
  selectedSeats,
  onRemoveSeat,
  hasHold,
  urgent,
  remainingMs,
  isUpdatingHold,
  started,
  customerDefaults,
  onConfirm,
  isConfirming,
  confirmError,
}: TicketSummarySidebarProps) {
  const [posterFailed, setPosterFailed] = useState(false);
  const [customerName, setCustomerName] = useState(customerDefaults.name);
  const [customerEmail, setCustomerEmail] = useState(customerDefaults.email);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Group seats by type for the price breakdown
  const standardSeats = selectedSeats.filter((s) => s.seat_type !== 'vip');
  const vipSeats = selectedSeats.filter((s) => s.seat_type === 'vip');

  const standardTotal = standardSeats.length * summary.priceStandard;
  const vipTotal = vipSeats.length * summary.priceVip;
  const grandTotal = standardTotal + vipTotal;

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const trimmedName = customerName.trim();
    const trimmedEmail = customerEmail.trim().toLowerCase();

    if (!trimmedName || trimmedName.length < 2) {
      setValidationError('Please enter your full name (minimum 2 characters).');
      return;
    }

    if (!trimmedEmail || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmedEmail)) {
      setValidationError('Please enter a valid email address for your ticket delivery.');
      return;
    }

    await onConfirm({ name: trimmedName, email: trimmedEmail });
  };

  const isButtonDisabled =
    selectedSeats.length === 0 ||
    !hasHold ||
    started ||
    isConfirming ||
    isUpdatingHold;

  return (
    <>
      {/* Desktop / Tablet Sidebar */}
      <aside
        id="checkout-card"
        className="bg-[#15161B] border border-[#23252E] rounded-2xl p-5 flex flex-col gap-5 lg:sticky lg:top-24 shadow-xl"
        aria-label="Order Summary and Checkout"
      >
        {/* Movie Title & Poster Header */}
        <div className="flex gap-4 items-start">
          <div className="relative w-16 h-24 rounded-lg overflow-hidden bg-[#0E0F13] border border-zinc-800 shrink-0">
            <Image
              src={posterFailed ? '/fallback-poster.svg' : summary.posterUrl}
              alt={`${summary.movieTitle} poster`}
              fill
              sizes="64px"
              className="object-cover"
              onError={() => setPosterFailed(true)}
            />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-amber-500 tracking-wider uppercase">
              TICKET SUMMARY
            </p>
            <h2 className="text-lg font-bold text-white leading-snug line-clamp-2">
              {summary.movieTitle}
            </h2>
            <p className="text-xs text-zinc-400 mt-1">{summary.auditoriumName}</p>
            <p className="text-xs text-zinc-300 font-medium">{summary.startLabel}</p>
          </div>
        </div>

        {/* Selected Seats Chips */}
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">Selected seats</span>
            <span className="font-semibold text-amber-500" id="selected-count">
              {selectedSeats.length} / {MAX_SEATS_PER_SELECTION}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap gap-2 min-h-7">
            {selectedSeats.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">No seats selected yet.</p>
            ) : (
              selectedSeats.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onRemoveSeat(s.id)}
                  disabled={started || isConfirming}
                  aria-label={`Remove seat ${seatLabel(s)}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 active:scale-95 transition-all disabled:opacity-60 shadow-sm"
                >
                  <span>{seatLabel(s)}</span>
                  {s.seat_type === 'vip' && (
                    <span className="text-[9px] uppercase px-1 py-0.2 bg-black/20 rounded font-black tracking-tight">
                      VIP
                    </span>
                  )}
                  <X className="w-3 h-3 ml-0.5" aria-hidden="true" />
                </button>
              ))
            )}
          </div>
        </div>

        {/* 5-Minute Hold Countdown */}
        {hasHold && (
          <div
            id="hold-countdown"
            role="timer"
            aria-live="polite"
            className={`rounded-xl border px-4 py-3 flex items-center justify-between transition-colors ${
              urgent
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                : 'bg-amber-500/10 border-amber-500/25 text-amber-200'
            }`}
          >
            <span className="flex items-center gap-2 text-xs font-medium">
              <Timer className="w-4 h-4 shrink-0" aria-hidden="true" />
              Seats held for
            </span>
            <span className="text-xl font-bold tabular-nums" data-testid="countdown">
              {formatCountdown(remainingMs)}
            </span>
          </div>
        )}

        {isUpdatingHold && (
          <p className="flex items-center gap-2 text-xs text-zinc-400" aria-live="polite">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" aria-hidden="true" />
            Updating your hold...
          </p>
        )}

        {/* Price Breakdown */}
        <div className="bg-[#101115] border border-[#1E2027] rounded-xl p-4 flex flex-col gap-2.5 text-xs">
          {standardSeats.length > 0 && (
            <div className="flex items-center justify-between text-zinc-300">
              <span>
                Standard ({standardSeats.length} × {formatPeso(summary.priceStandard)})
              </span>
              <span className="font-semibold text-white">{formatPeso(standardTotal)}</span>
            </div>
          )}

          {vipSeats.length > 0 && (
            <div className="flex items-center justify-between text-zinc-300">
              <span className="flex items-center gap-1.5">
                VIP Recliner ({vipSeats.length} × {formatPeso(summary.priceVip)})
              </span>
              <span className="font-semibold text-white">{formatPeso(vipTotal)}</span>
            </div>
          )}

          {selectedSeats.length === 0 && (
            <div className="flex items-center justify-between text-zinc-500">
              <span>Ticket Base</span>
              <span>₱0.00</span>
            </div>
          )}

          {/* Booking fee explicitly shown as FREE / PHP 0.00 */}
          <div className="flex items-center justify-between text-zinc-400">
            <span className="flex items-center gap-1">Booking Fee</span>
            <span className="font-semibold text-emerald-400" id="booking-fee-waived">
              FREE / PHP 0.00 (Waived)
            </span>
          </div>

          <div className="h-px bg-[#23252E] my-1" />

          {/* Grand Total */}
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold text-white">Total Amount</span>
            <span className="text-base font-extrabold text-amber-400" id="grand-total-amount">
              {formatPeso(grandTotal)}
            </span>
          </div>
        </div>

        {/* Customer Information Form */}
        <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="customer-name" className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Customer Full Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <input
                id="customer-name"
                name="customerName"
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Juan Dela Cruz"
                disabled={isConfirming}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0E0F13] border border-[#23252E] text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label htmlFor="customer-email" className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Email Address (for e-ticket delivery)
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <input
                id="customer-email"
                name="customerEmail"
                type="email"
                required
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="juan@example.com"
                disabled={isConfirming}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0E0F13] border border-[#23252E] text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-50"
              />
            </div>
          </div>

          {/* Simulated Payment Notice */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-200/90">
            <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold text-amber-300">Simulated Payment Notice</p>
              <p className="text-zinc-400 mt-0.5">
                Simulated checkout (no real payment required). Your reservation will be confirmed immediately.
              </p>
            </div>
          </div>

          {/* Validation or Confirmation Error Alerts */}
          {(validationError || confirmError) && (
            <div
              id="confirm-error-banner"
              role="alert"
              className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2 text-xs text-rose-300"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{validationError || confirmError}</span>
            </div>
          )}

          {/* Main Action Button */}
          <button
            id="confirm-reservation-button"
            type="submit"
            disabled={isButtonDisabled}
            className="w-full mt-2 py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2 cursor-pointer"
          >
            {isConfirming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-black" aria-hidden="true" />
                <span>Confirming Booking...</span>
              </>
            ) : selectedSeats.length === 0 ? (
              <span>Select Seats to Book</span>
            ) : (
              <span>Confirm Reservation ({formatPeso(grandTotal)})</span>
            )}
          </button>
        </form>
      </aside>

      {/* Sticky Mobile Summary Bar (< lg screens) */}
      <div
        id="mobile-sticky-summary"
        className="lg:hidden fixed bottom-0 inset-x-0 bg-[#15161B]/95 backdrop-blur-md border-t border-[#23252E] px-4 py-3 z-40 shadow-2xl flex items-center justify-between gap-3"
      >
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Ticket className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
            <span>
              {selectedSeats.length === 0
                ? 'No seats'
                : `${selectedSeats.length} seat${selectedSeats.length > 1 ? 's' : ''}`}
            </span>
            {hasHold && (
              <span className={`font-bold ml-1 ${urgent ? 'text-rose-400' : 'text-amber-400'}`}>
                • {formatCountdown(remainingMs)}
              </span>
            )}
          </div>
          <div className="text-base font-extrabold text-white truncate">
            {formatPeso(grandTotal)}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            const card = document.getElementById('checkout-card');
            if (card) {
              card.scrollIntoView({ behavior: 'smooth' });
              const nameInput = document.getElementById('customer-name');
              nameInput?.focus();
            }
          }}
          disabled={selectedSeats.length === 0 || started}
          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shrink-0 flex items-center gap-1.5 shadow-md active:scale-95 transition-all disabled:opacity-50"
        >
          <span>Proceed to Book</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
