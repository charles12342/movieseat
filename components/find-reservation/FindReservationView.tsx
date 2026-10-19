'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  Download,
  Ticket,
  Calendar,
  MapPin,
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Film,
  Loader2,
} from 'lucide-react';
import { formatPeso, formatSeatLabel } from '@/lib/booking';
import { createClient } from '@/lib/supabase/client';
import CancelReservationModal from './CancelReservationModal';

export interface ReservationSeatItem {
  id?: string;
  row: string;
  number: number;
  seat_type: string;
  price: number;
}

export interface ReservationItem {
  reservation_id: string;
  reference_code: string;
  status: string;
  total_amount: number;
  created_at: string;
  customer_name: string;
  customer_email: string;
  showtime_id: string;
  start_time: string;
  end_time: string;
  movie_id: string;
  movie_title: string;
  poster_path: string | null;
  runtime: number;
  rating: string | null;
  auditorium_id: string;
  auditorium_name: string;
  screen_type: string;
  sound_system: string;
  seats: ReservationSeatItem[];
}

export type DisplayStatus = 'Active' | 'Cancelled' | 'Expired' | 'Used';

/**
 * Cleans the reference code lookup input:
 * 1. Trims leading and trailing whitespace.
 * 2. Strips all leading '#' characters (whether single, duplicated '##', or separated by spaces).
 * 3. Converts to uppercase.
 * Note: '#' is strictly a visual UI prefix and never part of the reference_code search value.
 */
export function cleanReferenceCode(input: string): string {
  return input
    .trim()
    .replace(/^[#\s]+/, '')
    .trim()
    .toUpperCase();
}

/**
 * Derives user-facing status from stored database status and screening timestamps.
 * Active, Cancelled (stored) vs Expired, Used (derived from showtime clock).
 */
export function deriveReservationStatus(
  storedStatus: string,
  startTimeIso: string,
  endTimeIso: string,
  nowMs: number = Date.now()
): DisplayStatus {
  if (storedStatus === 'cancelled') return 'Cancelled';
  if (storedStatus === 'completed') return 'Used';

  const startMs = new Date(startTimeIso).getTime();
  const endMs = new Date(endTimeIso).getTime();

  if (nowMs > endMs) return 'Expired';
  if (nowMs >= startMs) return 'Used';
  return 'Active';
}

interface FindReservationViewProps {
  initialReservations: ReservationItem[];
}

export default function FindReservationView({ initialReservations }: FindReservationViewProps) {
  const [reservations, setReservations] = useState<ReservationItem[]>(initialReservations);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [queriedResults, setQueriedResults] = useState<ReservationItem[] | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(
    initialReservations[0]?.reservation_id || ''
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = useState<string | null>(null);

  // Normalize search input: strips all leading '#', trims, converts to uppercase
  const cleanQuery = useMemo(() => cleanReferenceCode(searchQuery), [searchQuery]);

  // Handles lookup execution against my_reservations
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSearchMessage(null);

    const cleaned = cleanReferenceCode(searchQuery);

    // Rule 4: If the cleaned value is empty, show a friendly message and do not query.
    if (!cleaned) {
      setSearchMessage('Please enter a booking reference code to search.');
      setQueriedResults(null);
      setHasSearched(false);
      return;
    }

    // Rule 3: Search my_reservations by reference_code using the cleaned value, for example MS-2026-A4F92B.
    setIsSearching(true);
    setHasSearched(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('my_reservations')
        .select('*')
        .or(`reference_code.eq.${cleaned},reference_code.ilike.%${cleaned}%`)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[my_reservations search error]', error.message);
        const localMatches = reservations.filter((r) =>
          r.reference_code.toUpperCase().includes(cleaned)
        );
        setQueriedResults(localMatches);
        if (localMatches.length > 0) {
          setSelectedId(localMatches[0].reservation_id);
        }
      } else {
        const found = (data || []) as unknown as ReservationItem[];
        setQueriedResults(found);

        if (found.length > 0) {
          // Merge newly found items into reservations state
          setReservations((prev) => {
            const ids = new Set(prev.map((r) => r.reservation_id));
            const fresh = found.filter((item) => !ids.has(item.reservation_id));
            return [...fresh, ...prev];
          });
          setSelectedId(found[0].reservation_id);
        }
      }
    } catch (err) {
      console.error('[Search exception]', err);
      const localMatches = reservations.filter((r) =>
        r.reference_code.toUpperCase().includes(cleaned)
      );
      setQueriedResults(localMatches);
    } finally {
      setIsSearching(false);
    }
  };

  // Filter reservations matching search query or database query results
  const filteredReservations = useMemo(() => {
    if (queriedResults !== null) {
      return queriedResults;
    }
    if (!cleanQuery) return reservations;
    return reservations.filter((r) =>
      r.reference_code.toUpperCase().includes(cleanQuery)
    );
  }, [queriedResults, cleanQuery, reservations]);

  // Selected reservation details
  const selectedReservation = useMemo(() => {
    return (
      reservations.find((r) => r.reservation_id === selectedId) ||
      filteredReservations[0] ||
      null
    );
  }, [reservations, selectedId, filteredReservations]);

  // Derive status and 30-min policy cutoff
  const [nowMs] = useState(() => new Date().getTime());
  const displayStatus: DisplayStatus = selectedReservation
    ? deriveReservationStatus(
        selectedReservation.status,
        selectedReservation.start_time,
        selectedReservation.end_time,
        nowMs
      )
    : 'Active';

  const minutesUntilShowtime = selectedReservation
    ? (new Date(selectedReservation.start_time).getTime() - nowMs) / (60 * 1000)
    : 0;

  const isWithin30Minutes = minutesUntilShowtime < 30;
  const canCancel = displayStatus === 'Active' && !isWithin30Minutes;

  const handleCancelConfirm = async () => {
    if (!selectedReservation || isCancelling) return;
    setIsCancelling(true);
    setCancelError(null);
    setCancelSuccess(null);

    try {
      const res = await fetch(`/api/reservations/${selectedReservation.reservation_id}/cancel`, {
        method: 'POST',
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.message || data?.error || 'Failed to cancel reservation.');
      }

      // Update local state to mark reservation cancelled
      setReservations((prev) =>
        prev.map((r) =>
          r.reservation_id === selectedReservation.reservation_id
            ? { ...r, status: 'cancelled' }
            : r
        )
      );

      setCancelSuccess('Reservation cancelled successfully. Seats have been released.');
      setModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Cancellation failed';
      setCancelError(msg);
    } finally {
      setIsCancelling(false);
    }
  };

  const getStatusBadgeClass = (status: DisplayStatus) => {
    switch (status) {
      case 'Active':
        return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
      case 'Cancelled':
        return 'bg-rose-500/10 border-rose-500/30 text-rose-400';
      case 'Expired':
        return 'bg-zinc-800 border-zinc-700 text-zinc-400';
      case 'Used':
        return 'bg-sky-500/10 border-sky-500/30 text-sky-400';
    }
  };

  return (
    <div className="max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
      <title>Find Reservation • Self-Service | MovieSeat</title>
      <meta
        name="description"
        content="Lookup, view digital passes, download PDFs, and manage your MovieSeat cinema reservations."
      />

      {/* Header & Search Bar Card */}
      <div className="bg-[#15161B] border border-[#23252E] rounded-2xl p-6 sm:p-8 flex flex-col gap-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Find Reservation
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1">
              Look up your booking reference code or view your active passes.
            </p>
          </div>
          <span className="text-xs text-zinc-500 font-mono">
            {reservations.length} total booking{reservations.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Lookup Input with # Prefix */}
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-zinc-500 pointer-events-none">
              <Search className="w-4 h-4" aria-hidden="true" />
              <span className="font-mono font-bold text-amber-500">#</span>
            </div>
            <input
              id="find-reservation-input"
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchMessage(null);
                if (!e.target.value.trim()) {
                  setQueriedResults(null);
                  setHasSearched(false);
                }
              }}
              placeholder="MS-2026-XXXXXX"
              className="w-full pl-11 pr-4 py-3 rounded-xl bg-[#0E0F13] border border-[#23252E] text-white text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors uppercase"
            />
          </div>
          <button
            id="find-reservation-search-button"
            type="submit"
            disabled={isSearching}
            className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm transition-colors cursor-pointer shrink-0 flex items-center justify-center gap-2 shadow-md"
          >
            {isSearching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <Search className="w-4 h-4" aria-hidden="true" />
                <span>Search</span>
              </>
            )}
          </button>
        </form>

        {/* Friendly message if query was empty */}
        {searchMessage && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2 shadow-md"
          >
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span>{searchMessage}</span>
          </div>
        )}
      </div>

      {/* Alert Notices */}
      {cancelSuccess && (
        <div
          role="status"
          className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2.5 shadow-md"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{cancelSuccess}</span>
        </div>
      )}

      {cancelError && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5 shadow-md"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{cancelError}</span>
        </div>
      )}

      {/* Quick-Switch Selector for Multiple Bookings */}
      {reservations.length > 1 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Your Bookings ({reservations.length})
          </span>
          <div
            id="reservation-quick-switch"
            className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin"
          >
            {reservations.map((res) => {
              const resStatus = deriveReservationStatus(res.status, res.start_time, res.end_time, nowMs);
              const isSelected = res.reservation_id === selectedReservation?.reservation_id;

              return (
                <button
                  key={res.reservation_id}
                  type="button"
                  onClick={() => setSelectedId(res.reservation_id)}
                  className={`px-3 py-2 rounded-xl border text-xs font-medium shrink-0 flex items-center gap-2 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500/15 border-amber-500/50 text-white shadow-md'
                      : 'bg-[#15161B] border-[#23252E] text-zinc-400 hover:text-white hover:border-zinc-700'
                  }`}
                >
                  <span className="font-mono font-bold text-amber-400">{res.reference_code}</span>
                  <span className="text-zinc-500">•</span>
                  <span className="truncate max-w-[120px]">{res.movie_title}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${getStatusBadgeClass(
                      resStatus
                    )}`}
                  >
                    {resStatus}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {filteredReservations.length === 0 && (cleanQuery || hasSearched) ? (
        // Search Not Found Message
        <div className="bg-[#15161B] border border-[#23252E] rounded-2xl p-12 text-center flex flex-col items-center gap-3">
          <Ban className="w-8 h-8 text-zinc-500" aria-hidden="true" />
          <h3 className="text-lg font-bold text-white">No Reservation Found</h3>
          <p className="text-xs text-zinc-400 max-w-sm">
            No reservation found for this code under your account.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setQueriedResults(null);
              setHasSearched(false);
              setSearchMessage(null);
            }}
            className="mt-2 text-xs font-semibold text-amber-500 hover:text-amber-400 underline cursor-pointer"
          >
            Clear Search
          </button>
        </div>
      ) : reservations.length === 0 ? (
        // Empty State: No Bookings
        <div className="bg-[#15161B] border border-[#23252E] rounded-2xl p-12 text-center flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-zinc-800/80 flex items-center justify-center text-zinc-500">
            <Ticket className="w-6 h-6" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-bold text-white">No Reservations Yet</h3>
          <p className="text-xs text-zinc-400 max-w-sm">
            You don&apos;t have any cinema bookings right now. Explore what&apos;s currently playing and book your favorite seats!
          </p>
          <Link
            href="/"
            className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shadow-md transition-colors"
          >
            <Film className="w-4 h-4" aria-hidden="true" />
            <span>Browse Now Showing</span>
          </Link>
        </div>
      ) : selectedReservation ? (
        // "Your Latest Reservation" Card
        <div
          id="latest-reservation-card"
          className="bg-[#15161B] border border-[#23252E] rounded-2xl p-6 sm:p-8 flex flex-col gap-6 shadow-xl"
        >
          {/* Card Top: Label & Status Badge */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-[#23252E]">
            <div>
              <span className="text-[11px] font-bold text-amber-500 uppercase tracking-wider block">
                {reservations[0]?.reservation_id === selectedReservation.reservation_id
                  ? 'Your Latest Reservation'
                  : 'Selected Reservation'}
              </span>
              <p className="text-2xl sm:text-3xl font-black font-mono text-white tracking-wider mt-0.5">
                #{selectedReservation.reference_code}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span
                id="display-status-badge"
                className={`px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-wider ${getStatusBadgeClass(
                  displayStatus
                )}`}
              >
                {displayStatus}
              </span>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
            <div className="flex items-start gap-3">
              <Film className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-zinc-500 font-semibold uppercase tracking-wider">Movie Feature</p>
                <p className="text-base font-bold text-white mt-0.5">{selectedReservation.movie_title}</p>
                <p className="text-zinc-400 mt-0.5">{selectedReservation.auditorium_name} • Cinema City Hall</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-zinc-500 font-semibold uppercase tracking-wider">Screening Time</p>
                <p className="text-sm font-bold text-white mt-0.5">
                  {new Date(selectedReservation.start_time).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  at{' '}
                  {new Date(selectedReservation.start_time).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
                <p className="text-zinc-400 mt-0.5">
                  {selectedReservation.screen_type} • {selectedReservation.sound_system}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Ticket className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-zinc-500 font-semibold uppercase tracking-wider">
                  Reserved Seats ({selectedReservation.seats?.length || 0})
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {(selectedReservation.seats || []).map((s, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-md bg-[#1C1E26] border border-[#2A2C35] font-mono text-zinc-200 font-bold"
                    >
                      {formatSeatLabel(s)}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-zinc-500 font-semibold uppercase tracking-wider">Total Amount Paid</p>
                <p className="text-base font-extrabold text-amber-400 mt-0.5">
                  {formatPeso(selectedReservation.total_amount)}
                </p>
                <p className="text-zinc-400 mt-0.5">Patron: {selectedReservation.customer_name}</p>
              </div>
            </div>
          </div>

          {/* 30-Minute Cancellation Notice Banner */}
          {displayStatus === 'Active' && isWithin30Minutes && (
            <div
              id="cancellation-window-closed-notice"
              className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-200/90 flex items-center gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
              <span>
                Cancellation is prohibited within 30 minutes of showtime (cutoff policy active).
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#23252E]">
            <div className="flex items-center gap-3">
              {/* View Digital Pass */}
              <Link
                id="view-pass-button"
                href={`/ticket/${selectedReservation.reference_code}`}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black font-bold text-xs shadow-md active:scale-95 transition-all"
              >
                <span>View Digital Pass</span>
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>

              {/* Download PDF */}
              <a
                id="download-pdf-button"
                href={`/api/reservations/${selectedReservation.reservation_id}/pdf`}
                download={`MovieSeat-Ticket-${selectedReservation.reference_code}.pdf`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#1C1E26] hover:bg-[#23252E] border border-[#2A2C35] text-zinc-300 hover:text-white text-xs font-semibold transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                <span>PDF Ticket</span>
              </a>
            </div>

            {/* Cancel Button */}
            {displayStatus === 'Active' && (
              <button
                type="button"
                id="cancel-reservation-button"
                onClick={() => setModalOpen(true)}
                disabled={!canCancel}
                aria-label="Cancel this reservation"
                className={`px-4 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                  canCancel
                    ? 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10 active:scale-95 cursor-pointer'
                    : 'border-zinc-800 text-zinc-600 opacity-50 cursor-not-allowed'
                }`}
              >
                Cancel Reservation
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Cancellation Confirmation Modal */}
      {selectedReservation && (
        <CancelReservationModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onConfirm={handleCancelConfirm}
          isCancelling={isCancelling}
          reservation={{
            referenceCode: selectedReservation.reference_code,
            movieTitle: selectedReservation.movie_title,
            showtime: `${new Date(selectedReservation.start_time).toLocaleDateString()} at ${new Date(
              selectedReservation.start_time
            ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            seats: (selectedReservation.seats || []).map(formatSeatLabel).join(', ') || 'Seats',
            totalAmount: formatPeso(selectedReservation.total_amount),
          }}
        />
      )}
    </div>
  );
}
