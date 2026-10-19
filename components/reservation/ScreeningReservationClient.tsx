'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Info,
  ShieldCheck,
  Video,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import {
  canAddSeat,
  computeSeatStates,
  friendlyHoldMessage,
  isHoldActive,
  parseHoldError,
  seatLabel,
  toMs,
  type HoldRecord,
  type ReservedRecord,
  type SeatRecord,
} from '@/lib/seat-state';
import SeatMatrix, { SeatLegend } from './SeatMatrix';
import GuestAuthModal from './GuestAuthModal';
import TicketSummarySidebar, { type CustomerDefaults } from './TicketSummarySidebar';

// -----------------------------------------------------------------------------
// State machine
//   browsing -> pending (clicked, waiting to sync) -> held (server confirmed)
//   held -> expired (5 minutes passed) -> browsing (user picks again)
// -----------------------------------------------------------------------------
type Phase = 'browsing' | 'pending' | 'held' | 'expired';
type NoticeKind = 'error' | 'warn' | 'info';

interface Notice {
  id: number;
  kind: NoticeKind;
  text: string;
}

interface MachineState {
  phase: Phase;
  /** What the user wants held (local intent, reconciled with the server) */
  selected: string[];
  /** Database expires_at (server-clock epoch ms) of the current hold */
  expiresAt: number | null;
  notice: Notice | null;
}

type Action =
  | { type: 'TOGGLE'; seatId: string }
  | { type: 'SYNC_OK'; expiresAt: number }
  | { type: 'SYNC_RELEASED' }
  | { type: 'RESET'; selected: string[]; expiresAt: number | null; notice?: Notice | null }
  | { type: 'PRUNE'; selected: string[]; notice: Notice }
  | { type: 'EXPIRED'; notice: Notice }
  | { type: 'NOTICE'; notice: Notice }
  | { type: 'CLEAR_NOTICE'; id: number };

function reducer(state: MachineState, action: Action): MachineState {
  switch (action.type) {
    case 'TOGGLE': {
      const selected = state.selected.includes(action.seatId)
        ? state.selected.filter((id) => id !== action.seatId)
        : [...state.selected, action.seatId];
      return { ...state, selected, phase: 'pending', notice: null };
    }
    case 'SYNC_OK':
      return { ...state, phase: 'held', expiresAt: action.expiresAt };
    case 'SYNC_RELEASED':
      return { ...state, phase: 'browsing', expiresAt: null };
    case 'RESET':
      return {
        phase: action.selected.length > 0 ? 'held' : 'browsing',
        selected: action.selected,
        expiresAt: action.selected.length > 0 ? action.expiresAt : null,
        notice: action.notice ?? null,
      };
    case 'PRUNE':
      return {
        ...state,
        selected: action.selected,
        phase: action.selected.length > 0 ? state.phase : 'browsing',
        expiresAt: action.selected.length > 0 ? state.expiresAt : null,
        notice: action.notice,
      };
    case 'EXPIRED':
      return { phase: 'expired', selected: [], expiresAt: null, notice: action.notice };
    case 'NOTICE':
      return { ...state, notice: action.notice };
    case 'CLEAR_NOTICE':
      return state.notice?.id === action.id ? { ...state, notice: null } : state;
    default:
      return state;
  }
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------
export interface ScreeningSummary {
  movieTitle: string;
  posterUrl: string;
  auditoriumName: string;
  startLabel: string;
  priceStandard: number;
  priceVip: number;
}

interface ScreeningReservationClientProps {
  showtimeId: string;
  startTimeMs: number;
  serverNowMs: number;
  seats: SeatRecord[];
  initialHolds: HoldRecord[];
  initialReserved: string[];
  initialUserId: string | null;
  summary: ScreeningSummary;
  customerDefaults?: CustomerDefaults;
}

type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

const getClient = () => createClient() as unknown as SupabaseClient;

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}

export default function ScreeningReservationClient({
  showtimeId,
  startTimeMs,
  serverNowMs,
  seats,
  initialHolds,
  initialReserved,
  initialUserId,
  summary,
  customerDefaults,
}: ScreeningReservationClientProps) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(initialUserId);
  const [holds, setHolds] = useState<HoldRecord[]>(initialHolds);
  const [reserved, setReserved] = useState<string[]>(initialReserved);
  const [nowMs, setNowMs] = useState<number>(serverNowMs);
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [modalOpen, setModalOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const confirmingRef = useRef(false);

  const [machine, dispatch] = useReducer(reducer, undefined, (): MachineState => {
    const mine = initialHolds.filter(
      (h) => initialUserId && h.user_id === initialUserId && isHoldActive(h, serverNowMs)
    );
    return {
      phase: mine.length > 0 ? 'held' : 'browsing',
      selected: mine.map((h) => h.seat_id),
      expiresAt: mine.length > 0 ? Math.min(...mine.map((h) => toMs(h.expires_at))) : null,
      notice: null,
    };
  });

  // Latest values for timers / async callbacks (written in an effect, never in render)
  const selectedRef = useRef<string[]>(machine.selected);
  const expiresAtRef = useRef<number | null>(machine.expiresAt);
  const userIdRef = useRef<string | null>(userId);
  const offsetRef = useRef(0); // serverNow - clientNow
  const seatsRef = useRef(seats);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeSeqRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedRef.current = machine.selected;
    expiresAtRef.current = machine.expiresAt;
    userIdRef.current = userId;
    seatsRef.current = seats;
  });

  const seatById = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats]);
  const started = nowMs >= startTimeMs;

  const makeNotice = useCallback((kind: NoticeKind, text: string): Notice => {
    noticeSeqRef.current += 1;
    return { id: noticeSeqRef.current, kind, text };
  }, []);

  // Auto-dismiss notices
  const noticeId = machine.notice?.id;
  useEffect(() => {
    if (noticeId === undefined) return;
    const t = setTimeout(() => dispatch({ type: 'CLEAR_NOTICE', id: noticeId }), 8000);
    return () => clearTimeout(t);
  }, [noticeId]);

  // ---------------------------------------------------------------------------
  // Seat data (re-fetched on every Realtime event and after every reconnect)
  // ---------------------------------------------------------------------------
  const refreshSeats = useCallback(async (): Promise<{
    holds: HoldRecord[];
    reserved: string[];
  } | null> => {
    try {
      const supabase = getClient();
      const [holdsRes, reservedRes] = await Promise.all([
        supabase.from('seat_holds').select('seat_id, user_id, expires_at').eq('showtime_id', showtimeId),
        supabase
          .from('reservation_seats')
          .select('seat_id, status')
          .eq('showtime_id', showtimeId)
          .eq('status', 'reserved'),
      ]);
      if (holdsRes.error || reservedRes.error) return null;

      const nextHolds = (holdsRes.data ?? []) as HoldRecord[];
      const nextReserved = ((reservedRes.data ?? []) as ReservedRecord[]).map((r) => r.seat_id);
      setHolds(nextHolds);
      setReserved(nextReserved);

      // Someone else got a seat we were about to hold: drop it and say so.
      const now = Date.now() + offsetRef.current;
      const states = computeSeatStates({
        seats: seatsRef.current,
        holds: nextHolds,
        reserved: nextReserved,
        userId: userIdRef.current,
        pendingSelection: [],
        nowMs: now,
      });
      const current = selectedRef.current;
      const lost = current.filter((id) => states[id] === 'reserved' || states[id] === 'held');
      if (lost.length > 0) {
        const names = lost
          .map((id) => seatsRef.current.find((s) => s.id === id))
          .filter((s): s is SeatRecord => Boolean(s))
          .map(seatLabel);
        dispatch({
          type: 'PRUNE',
          selected: current.filter((id) => !lost.includes(id)),
          notice: makeNotice(
            'warn',
            `${joinLabels(names)} ${names.length > 1 ? 'were' : 'was'} just taken by someone else.`
          ),
        });
      }
      return { holds: nextHolds, reserved: nextReserved };
    } catch {
      return null;
    }
  }, [showtimeId, makeNotice]);

  // ---------------------------------------------------------------------------
  // Clock: server-offset time, 1s tick. A hold that simply expires sends NO
  // Realtime event, so seat states and my own countdown are re-derived here.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    offsetRef.current = serverNowMs - Date.now();
    const id = setInterval(() => {
      const now = Date.now() + offsetRef.current;
      setNowMs(now);

      const exp = expiresAtRef.current;
      if (exp !== null && now >= exp && selectedRef.current.length > 0) {
        expiresAtRef.current = null; // fire once
        dispatch({
          type: 'EXPIRED',
          notice: makeNotice(
            'warn',
            'Your 5-minute hold expired and the seats were released. Pick them again to continue.'
          ),
        });
        void getClient()
          .rpc('release_holds', { p_showtime_id: showtimeId })
          .then(() => refreshSeats());
      }
    }, 1000);
    return () => clearInterval(id);
  }, [serverNowMs, showtimeId, makeNotice, refreshSeats]);

  // ---------------------------------------------------------------------------
  // Auth changes (sign in / out in another tab)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const supabase = getClient();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // ---------------------------------------------------------------------------
  // Realtime on seat_holds + reservation_seats, with automatic reconnect.
  // DELETE events cannot be filtered by showtime, so we listen unfiltered and
  // re-fetch (debounced) for anything that could concern this screening.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const supabase = getClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let live = false;

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refreshSeats(), 120);
    };

    const onChange = (payload: { eventType: string; new: Record<string, unknown> }) => {
      if (payload.eventType !== 'DELETE') {
        const sid = payload.new?.showtime_id;
        if (typeof sid === 'string' && sid !== showtimeId) return;
      }
      scheduleRefresh();
    };

    const scheduleReconnect = () => {
      if (cancelled || retryTimer) return;
      const delay = Math.min(15000, 1000 * 2 ** attempt);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled) return;
      if (channel) {
        const old = channel;
        channel = null; // old channel's status callbacks are now ignored
        void supabase.removeChannel(old);
      }
      const ch = supabase
        .channel(`screening-${showtimeId}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_holds' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reservation_seats' }, onChange);
      channel = ch;
      ch.subscribe((status) => {
        if (cancelled || channel !== ch) return;
        if (status === 'SUBSCRIBED') {
          attempt = 0;
          live = true;
          setConnection('live');
          // Anything could have changed while we were away: re-fetch.
          void refreshSeats();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          live = false;
          setConnection('reconnecting');
          scheduleReconnect();
        }
      });
    };

    connect();

    // Safety nets: poll while the socket is down, refresh on focus / network return.
    const poll = setInterval(() => {
      if (!live) void refreshSeats();
    }, 10000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSeats();
    };
    const onOnline = () => {
      void refreshSeats();
      if (!live) scheduleReconnect();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [showtimeId, refreshSeats]);

  // ---------------------------------------------------------------------------
  // Syncing the selection to the database (hold_seats / release_holds)
  // ---------------------------------------------------------------------------
  const resetFromServer = useCallback(
    async (notice: Notice | null) => {
      const data = await refreshSeats();
      const now = Date.now() + offsetRef.current;
      const mine = (data?.holds ?? []).filter(
        (h) => userIdRef.current && h.user_id === userIdRef.current && isHoldActive(h, now)
      );
      dispatch({
        type: 'RESET',
        selected: mine.map((h) => h.seat_id),
        expiresAt: mine.length > 0 ? Math.min(...mine.map((h) => toMs(h.expires_at))) : null,
        notice,
      });
    },
    [refreshSeats]
  );

  const handleSyncError = useCallback(
    async (err: unknown) => {
      const message = (err as { message?: string } | null)?.message;
      const code = parseHoldError(message);
      if (code === 'AUTH_REQUIRED') {
        dispatch({ type: 'RESET', selected: [], expiresAt: null, notice: null });
        setModalOpen(true);
        return;
      }
      const kind: NoticeKind = code === 'SEAT_TAKEN' || code === 'SEAT_HELD' ? 'warn' : 'error';
      await resetFromServer(makeNotice(kind, friendlyHoldMessage(code)));
    },
    [resetFromServer, makeNotice]
  );

  const runSync = useCallback(async () => {
    if (inFlightRef.current) {
      dirtyRef.current = true; // run again once the current request finishes
      return;
    }
    inFlightRef.current = true;
    try {
      do {
        dirtyRef.current = false;
        const ids = selectedRef.current;
        const supabase = getClient();

        if (ids.length === 0) {
          const { error } = await supabase.rpc('release_holds', { p_showtime_id: showtimeId });
          if (error) throw error;
          if (!dirtyRef.current) dispatch({ type: 'SYNC_RELEASED' });
        } else {
          if (!sessionIdRef.current) sessionIdRef.current = crypto.randomUUID();
          // Identity is NOT sent: the function reads auth.uid() itself.
          const { data, error } = await supabase.rpc('hold_seats', {
            p_showtime_id: showtimeId,
            p_seat_ids: ids,
            p_session_id: sessionIdRef.current,
          });
          if (error) throw error;
          const expiresAt = Date.parse((data as { expires_at: string }).expires_at);
          if (!dirtyRef.current) dispatch({ type: 'SYNC_OK', expiresAt });
        }
      } while (dirtyRef.current);
      void refreshSeats();
    } catch (err) {
      dirtyRef.current = false;
      await handleSyncError(err);
    } finally {
      inFlightRef.current = false;
    }
  }, [showtimeId, refreshSeats, handleSyncError]);

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => void runSync(), 300);
  }, [runSync]);

  useEffect(
    () => () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Derived seat states (reserved > mine > held by others > pending > available)
  // ---------------------------------------------------------------------------
  const seatStates = useMemo(
    () =>
      computeSeatStates({
        seats,
        holds,
        reserved,
        userId,
        pendingSelection: machine.selected,
        nowMs,
      }),
    [seats, holds, reserved, userId, machine.selected, nowMs]
  );

  const handleSeatClick = useCallback(
    (seatId: string) => {
      if (started) {
        dispatch({
          type: 'NOTICE',
          notice: makeNotice('error', friendlyHoldMessage('SHOWTIME_STARTED')),
        });
        return;
      }
      const state = seatStates[seatId];
      if (state === 'reserved' || state === 'held') {
        dispatch({
          type: 'NOTICE',
          notice: makeNotice('warn', 'That seat is no longer available.'),
        });
        void refreshSeats();
        return;
      }
      // Guests can browse freely, but holding needs an account.
      if (!userId) {
        setModalOpen(true);
        return;
      }
      if (!machine.selected.includes(seatId) && !canAddSeat(machine.selected, seatId)) {
        dispatch({
          type: 'NOTICE',
          notice: makeNotice('info', friendlyHoldMessage('SEAT_CAP_EXCEEDED')),
        });
        return;
      }
      dispatch({ type: 'TOGGLE', seatId });
      scheduleSync();
    },
    [started, seatStates, userId, machine.selected, makeNotice, refreshSeats, scheduleSync]
  );

  const closeModal = useCallback(() => setModalOpen(false), []);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  const selectedSeats = useMemo(
    () =>
      machine.selected
        .map((id) => seatById.get(id))
        .filter((s): s is SeatRecord => Boolean(s))
        .sort((a, b) => a.row.localeCompare(b.row) || a.number - b.number),
    [machine.selected, seatById]
  );
  const selectedLabels = selectedSeats.map(seatLabel);
  const remainingMs = machine.expiresAt ? Math.max(0, machine.expiresAt - nowMs) : 0;
  const hasHold = machine.expiresAt !== null && selectedSeats.length > 0;
  const urgent = hasHold && remainingMs <= 60_000;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start pb-24 lg:pb-0">
      <div className="flex flex-col gap-5 min-w-0">
        {/* Double-booking protection advisory */}
        <div
          id="hold-advisory"
          className="bg-[#15161B] border border-[#23252E] rounded-2xl px-5 py-4 flex items-start gap-3"
        >
          <ShieldCheck className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">Real-time double-booking protection active</p>
            <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">
              {hasHold ? (
                <>
                  {selectedLabels.length > 1 ? 'Seats' : 'Seat'}{' '}
                  <strong className="text-amber-400">{joinLabels(selectedLabels)}</strong>{' '}
                  {selectedLabels.length > 1 ? 'are' : 'is'} temporarily locked for your session.
                </>
              ) : (
                'Seats you pick are locked to you for 5 minutes. Everyone else sees them as held.'
              )}
            </p>
          </div>
          <div
            id="realtime-status"
            className={`shrink-0 flex items-center gap-1.5 text-[11px] font-medium ${
              connection === 'live' ? 'text-emerald-400' : 'text-amber-400'
            }`}
            aria-live="polite"
          >
            {connection === 'live' ? (
              <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Reconnecting'}
            </span>
          </div>
        </div>

        {/* Notices */}
        <div aria-live="polite">
          {started && (
            <div
              id="showtime-started-alert"
              className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-xl px-4 py-3 text-sm flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              This screening has already started, so seats can no longer be held.
            </div>
          )}
          {machine.notice && (
            <div
              id="seat-notice"
              data-kind={machine.notice.kind}
              className={`mt-3 first:mt-0 rounded-xl px-4 py-3 text-sm flex items-start gap-2.5 border ${
                machine.notice.kind === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                  : machine.notice.kind === 'warn'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                    : 'bg-sky-500/10 border-sky-500/30 text-sky-200'
              }`}
            >
              {machine.notice.kind === 'info' ? (
                <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <span className="flex-1">{machine.notice.text}</span>
              <button
                type="button"
                aria-label="Dismiss message"
                onClick={() => dispatch({ type: 'CLEAR_NOTICE', id: machine.notice!.id })}
                className="opacity-70 hover:opacity-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Screen arc + seat map */}
        <section
          aria-label="Seat map"
          className="bg-[#101115] border border-[#1E2027] rounded-2xl px-3 sm:px-6 pt-8 pb-6 overflow-hidden"
        >
          <div className="mx-auto w-full max-w-[560px]">
            <p className="text-center text-[11px] tracking-[0.3em] text-zinc-300 font-semibold">
              AUDITORIUM SCREEN
            </p>
            <div className="cinema-screen-glow h-12 mt-2" aria-hidden="true" />
            <p className="-mt-6 mb-8 text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5">
              <Video className="w-3.5 h-3.5" aria-hidden="true" />
              4K Dual Laser Projection Arc
            </p>
          </div>

          <SeatMatrix
            seats={seats}
            states={seatStates}
            onSeatClick={handleSeatClick}
            disabled={started}
            vipPrice={summary.priceVip}
          />

          <div className="mt-8">
            <SeatLegend />
          </div>
        </section>
      </div>

      <TicketSummarySidebar
        summary={summary}
        selectedSeats={selectedSeats}
        onRemoveSeat={handleSeatClick}
        hasHold={hasHold}
        urgent={urgent}
        remainingMs={remainingMs}
        isUpdatingHold={machine.phase === 'pending'}
        started={started}
        customerDefaults={customerDefaults ?? { name: '', email: '' }}
        onConfirm={async (customer) => {
          if (confirmingRef.current) return;
          if (!userId) {
            setModalOpen(true);
            return;
          }
          if (started) {
            setConfirmError('This screening has already started.');
            return;
          }
          if (selectedSeats.length === 0 || !hasHold) {
            setConfirmError('No active seats held. Please select seats.');
            return;
          }

          confirmingRef.current = true;
          setIsConfirming(true);
          setConfirmError(null);

          try {
            const res = await fetch('/api/reservations/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                showtimeId,
                customerName: customer.name,
                customerEmail: customer.email,
              }),
            });

            const data = await res.json().catch(() => null);

            if (!res.ok || !data?.success) {
              const errMsg = data?.message || data?.error || 'Failed to confirm reservation.';
              setConfirmError(errMsg);

              if (data?.error === 'SEAT_TAKEN' || data?.error === 'HOLD_EXPIRED') {
                await refreshSeats();
                dispatch({
                  type: 'RESET',
                  selected: [],
                  expiresAt: null,
                  notice: makeNotice('error', errMsg),
                });
              }
              return;
            }

            if (data?.redirect) {
              router.push(data.redirect);
            }
          } catch (netErr: unknown) {
            const msg = netErr instanceof Error ? netErr.message : 'Network connection failure';
            setConfirmError(`Connection error: ${msg}. Your seats remain held; you may retry confirmation.`);
          } finally {
            setIsConfirming(false);
            confirmingRef.current = false;
          }
        }}
        isConfirming={isConfirming}
        confirmError={confirmError}
      />

      <GuestAuthModal open={modalOpen} onClose={closeModal} redirectPath={`/screenings/${showtimeId}`} />
    </div>
  );
}
