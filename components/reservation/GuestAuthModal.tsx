'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { LogIn, Timer, UserPlus, X } from 'lucide-react';
import { safeRedirectPath } from '@/lib/redirect';
import { HOLD_DURATION_MS } from '@/lib/seat-state';

interface GuestAuthModalProps {
  open: boolean;
  onClose: () => void;
  /** Internal path to return to after signing in, e.g. /screenings/abc */
  redirectPath: string;
}

export default function GuestAuthModal({ open, onClose, redirectPath }: GuestAuthModalProps) {
  const primaryRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Never trust the value: only internal paths survive.
  const safePath = safeRedirectPath(redirectPath, '/');
  const signInHref = `/signin?redirect=${encodeURIComponent(safePath)}`;
  const minutes = Math.round(HOLD_DURATION_MS / 60000);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-auth-title"
      id="guest-auth-modal"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md bg-[#15161B] border border-[#2A2C35] rounded-2xl p-6 shadow-2xl shadow-black/60">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400 mb-4">
          <Timer className="w-5 h-5" aria-hidden="true" />
        </div>

        <h2 id="guest-auth-title" className="text-lg font-bold text-white">
          Sign in to hold your seats
        </h2>
        <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
          Anyone can look at the seat map. To pick seats, we need to know who is holding them. Once you sign in,
          your seats are locked to you for <strong className="text-zinc-200">{minutes} minutes</strong> so nobody
          else can book them while you check out.
        </p>
        <p className="mt-2 text-xs text-zinc-500">We will bring you back to this screening afterwards.</p>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Link
            ref={primaryRef}
            id="guest-auth-signin"
            href={signInHref}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold transition-colors"
          >
            <LogIn className="w-4 h-4" aria-hidden="true" />
            Sign in
          </Link>
          <Link
            id="guest-auth-signup"
            href="/signup"
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold transition-colors"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            Create account
          </Link>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Keep browsing the seat map
        </button>
      </div>
    </div>
  );
}
