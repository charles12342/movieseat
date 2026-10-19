'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface CancelReservationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isCancelling: boolean;
  reservation: {
    referenceCode: string;
    movieTitle: string;
    showtime: string;
    seats: string;
    totalAmount: string;
  };
}

export default function CancelReservationModal({
  open,
  onClose,
  onConfirm,
  isCancelling,
  reservation,
}: CancelReservationModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isCancelling) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isCancelling, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-modal-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md bg-[#15161B] border border-[#23252E] rounded-2xl p-6 shadow-2xl relative flex flex-col gap-5 text-left"
      >
        {/* Dismiss Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isCancelling}
          aria-label="Close cancellation modal"
          className="absolute top-4 right-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        {/* Warning Icon & Header */}
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="cancel-modal-title" className="text-lg font-bold text-white">
              Cancel Reservation?
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              This action is permanent and cannot be undone.
            </p>
          </div>
        </div>

        {/* Booking Summary Box */}
        <div className="bg-[#101115] border border-[#1E2027] rounded-xl p-4 flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between text-zinc-400">
            <span>Reference Code</span>
            <span className="font-mono font-bold text-amber-400 text-sm">
              {reservation.referenceCode}
            </span>
          </div>
          <div className="flex items-center justify-between text-zinc-300">
            <span>Movie</span>
            <span className="font-semibold text-white truncate max-w-[200px]">
              {reservation.movieTitle}
            </span>
          </div>
          <div className="flex items-center justify-between text-zinc-400">
            <span>Showtime</span>
            <span className="text-zinc-200">{reservation.showtime}</span>
          </div>
          <div className="flex items-center justify-between text-zinc-400">
            <span>Seats to Release</span>
            <span className="font-mono text-zinc-200 font-semibold">{reservation.seats}</span>
          </div>
        </div>

        {/* Policy Warning */}
        <p className="text-xs text-rose-300/90 bg-rose-500/5 border border-rose-500/20 p-3 rounded-xl leading-relaxed">
          Cancelling will immediately release your seats so other moviegoers can book them.
          Note that cancellations are prohibited within 30 minutes of showtime.
        </p>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 mt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isCancelling}
            className="px-4 py-2.5 rounded-xl bg-[#1C1E26] hover:bg-[#23252E] text-zinc-300 hover:text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            Keep Reservation
          </button>

          <button
            type="button"
            id="confirm-cancel-button"
            onClick={onConfirm}
            disabled={isCancelling}
            className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold shadow-lg shadow-rose-600/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            {isCancelling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Cancelling...</span>
              </>
            ) : (
              <span>Yes, Cancel Booking</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
