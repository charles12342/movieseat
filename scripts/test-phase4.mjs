#!/usr/bin/env node

/**
 * ==============================================================================
 * MovieSeat Phase 4 Automated Test Suite
 * Interactive seat map, 5-minute holds and Realtime
 *
 * Section 1  Pure logic (offline): seat states, cap, layout, error parsing,
 *            internal-only redirect validation
 * Section 2  Code contract: files, wiring, migration content
 * Section 3  Database integration (needs schema.sql + seed.sql +
 *            phase4_hold_seats.sql applied):
 *              - two users holding the same seat (sequential and concurrent)
 *              - 6-seat cap
 *              - hold expiry
 *              - a guest being blocked from holding
 *              - replace / release, SEAT_TAKEN, started showtime, Realtime
 * Section 4  HTTP against the running dev server (http://localhost:3000)
 *
 * Nothing is mocked: DB tests run against the Supabase project in .env.local.
 * If the database prerequisites are missing, those tests FAIL with the reason.
 * ==============================================================================
 */

// Re-run under Node's native type stripping so lib/*.ts can be imported.
if (!process.env.__MOVIESEAT_RUNNER) {
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', ...process.argv.slice(1)],
    { stdio: 'inherit', env: { ...process.env, __MOVIESEAT_RUNNER: '1' } }
  );
  process.exit(res.status ?? 0);
}

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const seatLib = await import('../lib/seat-state.ts');
const redirectLib = await import('../lib/redirect.ts');
const {
  computeSeatStates,
  canAddSeat,
  groupSeatRows,
  aislePositions,
  parseHoldError,
  friendlyHoldMessage,
  formatCountdown,
  isHoldActive,
  MAX_SEATS_PER_SELECTION,
  HOLD_DURATION_MS,
} = seatLib;
const { safeRedirectPath } = redirectLib;

console.log('================================================================================');
console.log('     MOVIESEAT TEST SUITE: PHASE 4 (SEAT MAP, 5-MIN HOLDS & REALTIME)          ');
console.log('================================================================================');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    failedTests++;
    failures.push(name);
  }
}

// -----------------------------------------------------------------------------
// Environment
// -----------------------------------------------------------------------------
const env = {};
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i !== -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SERVICE_KEY, clientOpts);

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const exists = (p) => fs.existsSync(path.resolve(p));

// =============================================================================
// Section 1: Pure logic
// =============================================================================
console.log('\n--- Section 1: Pure logic (offline) ---');

const NOW = 1_800_000_000_000;
const iso = (ms) => new Date(ms).toISOString();

function makeSeats(auditorium, rows, perRow, vipRow, vipCount) {
  const seats = [];
  for (const r of rows) {
    for (let n = 1; n <= perRow; n++) {
      seats.push({ id: `${auditorium}-${r}${n}`, row: r, number: n, seat_type: 'standard', is_wheelchair: false });
    }
  }
  for (let n = 1; n <= vipCount; n++) {
    seats.push({ id: `${auditorium}-${vipRow}${n}`, row: vipRow, number: n, seat_type: 'vip', is_wheelchair: false });
  }
  return seats;
}

await runTest('Seat state: available / selected (mine) / held (others) / reserved are all derived correctly', () => {
  const seats = makeSeats('x', ['A'], 6, 'B', 0);
  const states = computeSeatStates({
    seats,
    userId: 'me',
    nowMs: NOW,
    holds: [
      { seat_id: 'x-A1', user_id: 'me', expires_at: iso(NOW + 60_000) },
      { seat_id: 'x-A2', user_id: 'other', expires_at: iso(NOW + 60_000) },
    ],
    reserved: [{ seat_id: 'x-A3', status: 'reserved' }],
  });
  assert.equal(states['x-A1'], 'selected');
  assert.equal(states['x-A2'], 'held');
  assert.equal(states['x-A3'], 'reserved');
  assert.equal(states['x-A4'], 'available');
});

await runTest('Seat state: an expired hold (expires_at in the past) no longer blocks the seat', () => {
  const seats = makeSeats('x', ['A'], 3, 'B', 0);
  const holds = [
    { seat_id: 'x-A1', user_id: 'other', expires_at: iso(NOW - 1) },
    { seat_id: 'x-A2', user_id: 'me', expires_at: iso(NOW) }, // exactly now = expired
  ];
  const states = computeSeatStates({ seats, holds, reserved: [], userId: 'me', nowMs: NOW });
  assert.equal(states['x-A1'], 'available', "other user's expired hold must read as available");
  assert.equal(states['x-A2'], 'available', 'my expired hold must stop being selected');
  assert.equal(isHoldActive(holds[0], NOW), false);
});

await runTest('Seat state: the SAME hold flips to available purely because the clock moves (no event needed)', () => {
  const seats = makeSeats('x', ['A'], 2, 'B', 0);
  const holds = [{ seat_id: 'x-A1', user_id: 'other', expires_at: iso(NOW + HOLD_DURATION_MS) }];
  const before = computeSeatStates({ seats, holds, reserved: [], userId: 'me', nowMs: NOW });
  const after = computeSeatStates({ seats, holds, reserved: [], userId: 'me', nowMs: NOW + HOLD_DURATION_MS + 1 });
  assert.equal(before['x-A1'], 'held');
  assert.equal(after['x-A1'], 'available');
});

await runTest('Seat state: reservation_seats only counts when status = reserved; reserved beats any hold', () => {
  const seats = makeSeats('x', ['A'], 3, 'B', 0);
  const states = computeSeatStates({
    seats,
    userId: 'me',
    nowMs: NOW,
    holds: [{ seat_id: 'x-A1', user_id: 'me', expires_at: iso(NOW + 5000) }],
    reserved: [
      { seat_id: 'x-A1', status: 'reserved' },
      { seat_id: 'x-A2', status: 'cancelled' },
    ],
  });
  assert.equal(states['x-A1'], 'reserved');
  assert.equal(states['x-A2'], 'available', 'cancelled reservation seats are free again');
});

await runTest('Guest (userId null) never sees any seat as "selected" from other users\' holds', () => {
  const seats = makeSeats('x', ['A'], 2, 'B', 0);
  const states = computeSeatStates({
    seats,
    userId: null,
    nowMs: NOW,
    holds: [{ seat_id: 'x-A1', user_id: 'someone', expires_at: iso(NOW + 5000) }],
    reserved: [],
  });
  assert.equal(states['x-A1'], 'held');
});

await runTest('UI cap: 6 seats can be selected, the 7th is refused (canAddSeat)', () => {
  assert.equal(MAX_SEATS_PER_SELECTION, 6);
  const six = ['1', '2', '3', '4', '5', '6'];
  assert.equal(canAddSeat(six.slice(0, 5), '6'), true);
  assert.equal(canAddSeat(six, '7'), false, 'seventh seat must be refused');
  assert.equal(canAddSeat(six, '3'), true, 'deselecting an already-selected seat stays allowed');
});

await runTest('Layout: 254 seats = Cinema 1 (88) + Cinema 2 (102) + Cinema 3 (64), each with a VIP recliner row', () => {
  const c1 = makeSeats('c1', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], 11, 'H', 11);
  const c2 = makeSeats('c2', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], 13, 'H', 11);
  const c3 = makeSeats('c3', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], 8, 'H', 8);
  assert.equal(c1.length, 88);
  assert.equal(c2.length, 102);
  assert.equal(c3.length, 64);
  assert.equal(c1.length + c2.length + c3.length, 254);
  for (const seats of [c1, c2, c3]) {
    const rows = groupSeatRows(seats);
    assert.equal(rows.length, 8, 'rows A-H');
    assert.deepEqual(rows.map((r) => r.row), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    assert.equal(rows.filter((r) => r.isVip).map((r) => r.row).join(), 'H', 'only row H is the VIP recliner row');
  }
});

await runTest('Layout: aisle gaps split each row into wing | centre | wing (8 -> 2-4-2, 11 -> 3-5-3, 13 -> 3-7-3)', () => {
  assert.deepEqual(aislePositions(8), [2, 6]);
  assert.deepEqual(aislePositions(11), [3, 8]);
  assert.deepEqual(aislePositions(13), [3, 10]);
});

await runTest('Layout: seats inside a row are ordered by seat number even if the database returns them shuffled', () => {
  const shuffled = makeSeats('x', ['A'], 5, 'B', 0).reverse();
  const rows = groupSeatRows(shuffled);
  assert.deepEqual(rows[0].seats.map((s) => s.number), [1, 2, 3, 4, 5]);
});

await runTest('Hold errors: database messages map to codes and friendly text (SEAT_TAKEN etc.)', () => {
  assert.equal(parseHoldError('SEAT_TAKEN: One or more selected seats have already been reserved.'), 'SEAT_TAKEN');
  assert.equal(parseHoldError('SEAT_HELD: held by another customer'), 'SEAT_HELD');
  assert.equal(parseHoldError('SEAT_CAP_EXCEEDED: Maximum 6'), 'SEAT_CAP_EXCEEDED');
  assert.equal(parseHoldError('SHOWTIME_STARTED: already started'), 'SHOWTIME_STARTED');
  assert.equal(parseHoldError('AUTH_REQUIRED: log in'), 'AUTH_REQUIRED');
  assert.equal(parseHoldError('permission denied for function hold_seats'), 'AUTH_REQUIRED');
  assert.equal(parseHoldError('something unexpected'), 'UNKNOWN');
  assert.match(friendlyHoldMessage('SEAT_TAKEN'), /someone just booked/i);
  assert.ok(!/SEAT_TAKEN|exception|postgres/i.test(friendlyHoldMessage('SEAT_TAKEN')), 'no raw error text for users');
});

await runTest('Countdown formatting: 5:00 down to 0:00, never negative', () => {
  assert.equal(formatCountdown(HOLD_DURATION_MS), '5:00');
  assert.equal(formatCountdown(61_000), '1:01');
  assert.equal(formatCountdown(999), '0:01');
  assert.equal(formatCountdown(-5000), '0:00');
});

await runTest('Redirect: internal paths are accepted', () => {
  assert.equal(safeRedirectPath('/screenings/abc-123'), '/screenings/abc-123');
  assert.equal(safeRedirectPath('/screenings/abc?x=1#y'), '/screenings/abc?x=1#y');
  assert.equal(safeRedirectPath('/'), '/');
});

await runTest('Redirect: full URLs, protocol-relative, backslash, javascript: and control-char tricks are all rejected', () => {
  const evil = [
    'https://evil.com',
    'http://evil.com/x',
    '//evil.com',
    '///evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    'javascript:alert(1)',
    'data:text/html,hi',
    'evil.com',
    'screenings/abc',
    '/\t/evil.com',
    '/\n/evil.com',
    ' //evil.com',
    '/%0a/evil.com/..//x'.replace('%0a', '\n'),
    '/%5Cevil.com'.replace('%5C', '\\'),
    '',
    null,
    undefined,
  ];
  for (const v of evil) {
    assert.equal(safeRedirectPath(v), '/', `must reject ${JSON.stringify(v)}`);
  }
  assert.equal(safeRedirectPath('https://evil.com', '/fallback'), '/fallback', 'custom fallback is honoured');
});

// =============================================================================
// Section 2: Code contract
// =============================================================================
console.log('\n--- Section 2: Code contract ---');

await runTest('Screening page: awaits params and connection(), is Suspense-wrapped, has breadcrumb, 404 for bad ids', () => {
  const f = 'app/screenings/[showtimeId]/page.tsx';
  assert.ok(exists(f), `${f} must exist`);
  const code = read(f);
  assert.match(code, /await params/);
  assert.match(code, /await connection\(\)/);
  assert.match(code, /from 'next\/server'/);
  assert.match(code, /<Suspense/);
  assert.match(code, /aria-label="Breadcrumb"/);
  assert.match(code, /notFound\(\)/);
  assert.ok(!/export const dynamic\b/.test(code), 'segment config "dynamic" is incompatible with cacheComponents');
});

await runTest('Advisory banner and curved glowing arc (cinema-screen-glow) are present', () => {
  const code = read('components/reservation/ScreeningReservationClient.tsx');
  assert.match(code, /double-booking protection/i);
  assert.match(code, /cinema-screen-glow/);
  assert.ok(read('app/globals.css').includes('.cinema-screen-glow'), 'CSS class must exist');
});

await runTest('SeatMatrix: row labels, aisle gaps, VIP Recliners divider and 4-state legend', () => {
  const code = read('components/reservation/SeatMatrix.tsx');
  assert.match(code, /VIP Recliners/);
  assert.match(code, /aislePositions/);
  assert.match(code, /groupSeatRows/);
  for (const label of ['Available', 'Selected', 'Held by others', 'Reserved']) {
    assert.ok(code.includes(label), `legend must include "${label}"`);
  }
});

await runTest('Client: Realtime on seat_holds + reservation_seats, auto-reconnect, re-fetch after reconnect', () => {
  const code = read('components/reservation/ScreeningReservationClient.tsx');
  assert.match(code, /table: 'seat_holds'/);
  assert.match(code, /table: 'reservation_seats'/);
  assert.match(code, /CHANNEL_ERROR/);
  assert.match(code, /scheduleReconnect/);
  assert.match(code, /status === 'SUBSCRIBED'[\s\S]{0,300}refreshSeats\(\)/, 'must re-fetch seat data when (re)subscribed');
});

await runTest('Client: expiry is checked on a timer (expiry sends no Realtime event) and countdown uses database expires_at', () => {
  const code = read('components/reservation/ScreeningReservationClient.tsx');
  assert.match(code, /setInterval/);
  assert.match(code, /now >= exp/);
  assert.match(code, /expires_at/);
  assert.match(code, /offsetRef/, 'countdown must use server-clock offset, not trust the device clock');
});

await runTest('Client: hold_seats never receives a user id; selection changes call hold_seats / release_holds', () => {
  const code = read('components/reservation/ScreeningReservationClient.tsx');
  const call = code.match(/rpc\('hold_seats',\s*\{([\s\S]*?)\}\)/);
  assert.ok(call, 'hold_seats rpc call must exist');
  assert.ok(!/user_id|userId/i.test(call[1]), 'hold_seats arguments must not contain any user id');
  assert.match(code, /rpc\('release_holds'/);
});

await runTest('Client: guest is stopped at the modal BEFORE any hold is attempted; started showtime blocks holding', () => {
  const code = read('components/reservation/ScreeningReservationClient.tsx');
  const handler = code.slice(code.indexOf('const handleSeatClick'));
  const modalAt = handler.indexOf('setModalOpen(true)');
  const toggleAt = handler.indexOf("type: 'TOGGLE'");
  assert.ok(modalAt > -1 && toggleAt > -1 && modalAt < toggleAt, 'modal check must come before TOGGLE/hold');
  assert.match(handler, /if \(started\)/);
  assert.match(code, /SEAT_TAKEN|friendlyHoldMessage/);
});

await runTest('GuestAuthModal: explains the 5-minute hold and links to /signin?redirect= using the safe validator', () => {
  const code = read('components/reservation/GuestAuthModal.tsx');
  assert.match(code, /safeRedirectPath/);
  assert.match(code, /\/signin\?redirect=/);
  assert.match(code, /minutes/);
  assert.match(code, /role="dialog"/);
});

await runTest('Sign-in page validates ?redirect= with safeRedirectPath (no raw router.push of user input)', () => {
  const code = read('app/signin/page.tsx');
  assert.match(code, /safeRedirectPath\(searchParams\.get\('redirect'\)\)/);
  assert.ok(!/redirectParam\s*=\s*searchParams\.get\('redirect'\)\s*\|\|/.test(code), 'old unvalidated line must be gone');
});

await runTest('Migration enforces rules in the database: cap, started showtime, auth.uid(), search_path, advisory lock, grants', () => {
  const sql = read('supabase/phase4_hold_seats.sql');
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /SEAT_CAP_EXCEEDED/);
  assert.match(sql, /v_seat_count > 6/);
  assert.match(sql, /SHOWTIME_STARTED/);
  assert.match(sql, /SET search_path/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /unique_violation/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.hold_seats[\s\S]*anon/);
  assert.match(sql, /INTERVAL '5 minutes'/);
  assert.ok(!/p_user_id/.test(sql), 'no user id parameter anywhere');
});

await runTest('Phase 5 is NOT started: no checkout route, confirm endpoint or price summary component exists', () => {
  assert.ok(!exists('app/api/reservations'), 'app/api/reservations must not exist yet');
  assert.ok(!exists('components/reservation/TicketSummarySidebar.tsx'), 'TicketSummarySidebar must not exist yet');
});

// =============================================================================
// Section 3: Database integration
// =============================================================================
console.log('\n--- Section 3: Database integration (real Supabase, two real users) ---');

let ctx = null;
let ctxError = null;
const createdUserIds = [];
const createdShowtimeIds = [];

async function buildContext() {
  if (ctx) return ctx;
  if (ctxError) throw ctxError;
  try {
    // 1. Schema + seed must exist
    const movies = await admin.from('movies').select('id').limit(1);
    if (movies.error) {
      throw new Error(
        `Database prerequisite missing: ${movies.error.message}. Apply supabase/schema.sql, supabase/seed.sql and supabase/phase4_hold_seats.sql in the Supabase SQL Editor.`
      );
    }
    const auds = await admin.from('auditoriums').select('id, name, total_seats').order('name');
    if (auds.error || !auds.data?.length) throw new Error('Database prerequisite missing: auditoriums are empty (run seed.sql).');
    const aud = auds.data[0];
    const seatsRes = await admin
      .from('seats')
      .select('id, row, number, seat_type')
      .eq('auditorium_id', aud.id)
      .order('row')
      .order('number');
    if (seatsRes.error || (seatsRes.data?.length ?? 0) < 8) throw new Error('Database prerequisite missing: seats are empty (run seed.sql).');
    const otherAud = auds.data[1];
    const otherSeat = otherAud
      ? (await admin.from('seats').select('id').eq('auditorium_id', otherAud.id).limit(1)).data?.[0]
      : null;

    const movie = movies.data[0];

    // 2. Dedicated test showtimes (future + already started) so tests never depend on the clock of the seed data
    const mk = async (startOffsetMs, endOffsetMs) => {
      const r = await admin
        .from('showtimes')
        .insert({
          movie_id: movie.id,
          auditorium_id: aud.id,
          start_time: new Date(Date.now() + startOffsetMs).toISOString(),
          end_time: new Date(Date.now() + endOffsetMs).toISOString(),
        })
        .select('id')
        .single();
      if (r.error) throw new Error(`could not create test showtime: ${r.error.message}`);
      createdShowtimeIds.push(r.data.id);
      return r.data.id;
    };
    const futureId = await mk(3 * 3600_000, 5 * 3600_000);
    const startedId = await mk(-10 * 60_000, 2 * 3600_000);

    // 3. Two real users + a guest client
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const makeUser = async (label) => {
      const email = `phase4-${label}-${stamp}@movieseat.test`;
      const password = `Ph4se-${stamp}-Aa1!`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw new Error(`could not create test user: ${created.error.message}`);
      createdUserIds.push(created.data.user.id);
      const client = createClient(SUPABASE_URL, ANON_KEY, clientOpts);
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error) throw new Error(`could not sign in test user: ${signed.error.message}`);
      return { id: created.data.user.id, client };
    };
    const userA = await makeUser('a');
    const userB = await makeUser('b');
    const guest = createClient(SUPABASE_URL, ANON_KEY, clientOpts);

    ctx = { aud, seats: seatsRes.data, otherSeat, movie, futureId, startedId, userA, userB, guest, otherAud };
    return ctx;
  } catch (e) {
    ctxError = e;
    throw e;
  }
}

const hold = (who, showtimeId, seatIds, session = 'phase4-test') =>
  who.client.rpc('hold_seats', { p_showtime_id: showtimeId, p_seat_ids: seatIds, p_session_id: session });

async function clearHolds(showtimeId) {
  await admin.from('seat_holds').delete().eq('showtime_id', showtimeId);
}

await runTest('Setup: schema, seed, test showtimes and two verified users are available', async () => {
  const c = await buildContext();
  assert.ok(c.seats.length >= 8);
  assert.notEqual(c.userA.id, c.userB.id);
});

await runTest('Seed: auditoriums have 88 / 102 / 64 seats (254 total)', async () => {
  await buildContext();
  const { data, error } = await admin.from('seats').select('id', { count: 'exact', head: false });
  if (error) throw new Error(error.message);
  assert.equal(data.length, 254, `expected 254 seats, found ${data.length}`);
  const per = await admin.from('auditoriums').select('name, total_seats').order('name');
  assert.deepEqual(per.data.map((a) => a.total_seats).sort((a, b) => a - b), [64, 88, 102]);
});

await runTest('TWO USERS, SAME SEAT: A holds it, B is refused with SEAT_HELD, only A owns the row', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const seat = c.seats[0].id;

  const a = await hold(c.userA, c.futureId, [seat]);
  assert.equal(a.error, null, `A should hold the seat: ${a.error?.message}`);

  const b = await hold(c.userB, c.futureId, [seat]);
  assert.ok(b.error, 'B must be refused');
  assert.equal(parseHoldError(b.error.message), 'SEAT_HELD', `unexpected error: ${b.error.message}`);

  const rows = await admin.from('seat_holds').select('user_id').eq('showtime_id', c.futureId).eq('seat_id', seat);
  assert.equal(rows.data.length, 1, 'exactly one hold row for the seat');
  assert.equal(rows.data[0].user_id, c.userA.id, 'owner must be A (taken from auth.uid())');
});

await runTest('TWO USERS, SAME INSTANT: concurrent hold on one seat -> exactly one winner, loser gets clean SEAT_HELD', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const seat = c.seats[1].id;

  const [ra, rb] = await Promise.all([hold(c.userA, c.futureId, [seat]), hold(c.userB, c.futureId, [seat])]);
  const winners = [ra, rb].filter((r) => !r.error);
  const losers = [ra, rb].filter((r) => r.error);
  assert.equal(winners.length, 1, `exactly one request must win (got ${winners.length})`);
  assert.equal(losers.length, 1);
  assert.equal(parseHoldError(losers[0].error.message), 'SEAT_HELD', `loser error: ${losers[0].error.message}`);
  assert.ok(!/duplicate key|unique constraint/i.test(losers[0].error.message), 'no raw constraint error leaks to the user');
  const rows = await admin.from('seat_holds').select('id').eq('showtime_id', c.futureId).eq('seat_id', seat);
  assert.equal(rows.data.length, 1);
});

await runTest('Identity cannot be spoofed: hold_seats has no user-id parameter, passing one is rejected', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const r = await c.userA.client.rpc('hold_seats', {
    p_showtime_id: c.futureId,
    p_seat_ids: [c.seats[2].id],
    p_session_id: 'x',
    p_user_id: c.userB.id,
  });
  assert.ok(r.error, 'extra p_user_id argument must not be accepted');
  const rows = await admin.from('seat_holds').select('id').eq('showtime_id', c.futureId);
  assert.equal(rows.data.length, 0, 'nothing may be held as a side effect');
});

await runTest('6-SEAT CAP: 6 seats are accepted', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const ids = c.seats.slice(10, 16).map((s) => s.id);
  const r = await hold(c.userA, c.futureId, ids);
  assert.equal(r.error, null, `6 seats must be allowed: ${r.error?.message}`);
  assert.equal(r.data.held_count, 6);
});

await runTest('6-SEAT CAP: 7 seats are rejected inside the database (SEAT_CAP_EXCEEDED) and nothing is held', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const ids = c.seats.slice(20, 27).map((s) => s.id);
  assert.equal(ids.length, 7);
  const r = await hold(c.userA, c.futureId, ids);
  assert.ok(r.error, '7 seats must be rejected by hold_seats itself, not only by the UI');
  assert.equal(parseHoldError(r.error.message), 'SEAT_CAP_EXCEEDED', r.error.message);
  const rows = await admin.from('seat_holds').select('id').eq('showtime_id', c.futureId).eq('user_id', c.userA.id);
  assert.equal(rows.data.length, 0, 'a rejected request must hold zero seats');
});

await runTest('6-SEAT CAP: a failed over-cap request does not destroy the user\'s previous valid hold', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const first = await hold(c.userA, c.futureId, [c.seats[30].id, c.seats[31].id]);
  assert.equal(first.error, null);
  const over = await hold(c.userA, c.futureId, c.seats.slice(32, 39).map((s) => s.id));
  assert.ok(over.error);
  const rows = await admin.from('seat_holds').select('seat_id').eq('showtime_id', c.futureId).eq('user_id', c.userA.id);
  assert.equal(rows.data.length, 2, 'previous holds must survive the failed attempt');
});

await runTest('6-SEAT CAP: duplicated ids are de-duplicated (7 ids, 6 distinct seats = allowed, 6 rows)', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const six = c.seats.slice(40, 46).map((s) => s.id);
  const r = await hold(c.userA, c.futureId, [...six, six[0]]);
  assert.equal(r.error, null, r.error?.message);
  const rows = await admin.from('seat_holds').select('id').eq('showtime_id', c.futureId).eq('user_id', c.userA.id);
  assert.equal(rows.data.length, 6);
});

await runTest('Replace on change: holding a new selection replaces the old one (one user cannot lock many seats)', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  assert.equal((await hold(c.userA, c.futureId, [c.seats[50].id, c.seats[51].id])).error, null);
  assert.equal((await hold(c.userA, c.futureId, [c.seats[52].id])).error, null);
  const rows = await admin.from('seat_holds').select('seat_id').eq('showtime_id', c.futureId).eq('user_id', c.userA.id);
  assert.deepEqual(rows.data.map((r) => r.seat_id), [c.seats[52].id], 'old holds must be gone');
});

await runTest('Replace across screenings: holding on another showtime releases the user\'s first screening hold', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const other = await admin
    .from('showtimes')
    .insert({
      movie_id: c.movie.id,
      auditorium_id: c.aud.id,
      start_time: new Date(Date.now() + 8 * 3600_000).toISOString(),
      end_time: new Date(Date.now() + 10 * 3600_000).toISOString(),
    })
    .select('id')
    .single();
  assert.equal(other.error, null);
  createdShowtimeIds.push(other.data.id);

  assert.equal((await hold(c.userA, c.futureId, [c.seats[60].id])).error, null);
  assert.equal((await hold(c.userA, other.data.id, [c.seats[60].id])).error, null);
  const first = await admin.from('seat_holds').select('id').eq('showtime_id', c.futureId).eq('user_id', c.userA.id);
  assert.equal(first.data.length, 0, 'hold on the first screening must be released');
});

await runTest('release_holds frees the seat for other users', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const seat = c.seats[3].id;
  assert.equal((await hold(c.userA, c.futureId, [seat])).error, null);
  const rel = await c.userA.client.rpc('release_holds', { p_showtime_id: c.futureId });
  assert.equal(rel.error, null, rel.error?.message);
  const b = await hold(c.userB, c.futureId, [seat]);
  assert.equal(b.error, null, `B should now be able to hold the seat: ${b.error?.message}`);
});

await runTest('HOLD LENGTH: expires_at is ~5 minutes after the call, returned by the database', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const before = Date.now();
  const r = await hold(c.userA, c.futureId, [c.seats[4].id]);
  assert.equal(r.error, null, r.error?.message);
  const remaining = Date.parse(r.data.expires_at) - before;
  assert.ok(remaining > 290_000 && remaining < 310_000, `expected ~300s, got ${Math.round(remaining / 1000)}s`);
  const row = await admin.from('seat_holds').select('expires_at').eq('showtime_id', c.futureId).eq('seat_id', c.seats[4].id).single();
  assert.equal(Date.parse(row.data.expires_at), Date.parse(r.data.expires_at), 'stored expires_at matches the response');
});

await runTest('HOLD EXPIRY: once expires_at passes, others can take the seat and guests no longer see the hold', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const seat = c.seats[5].id;
  assert.equal((await hold(c.userA, c.futureId, [seat])).error, null);

  // Visible to everyone while active
  const live = await c.guest.from('seat_holds').select('seat_id').eq('showtime_id', c.futureId).eq('seat_id', seat);
  assert.equal(live.data?.length, 1, 'active hold must be visible to the public seat map');

  // Time passes (the row is NOT deleted - exactly like a real expiry, which sends no event)
  const aged = await admin
    .from('seat_holds')
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq('showtime_id', c.futureId)
    .eq('seat_id', seat);
  assert.equal(aged.error, null);
  const stillThere = await admin.from('seat_holds').select('id').eq('showtime_id', c.futureId).eq('seat_id', seat);
  assert.equal(stillThere.data.length, 1, 'expired row still physically exists (no cleanup event)');

  const hidden = await c.guest.from('seat_holds').select('seat_id').eq('showtime_id', c.futureId).eq('seat_id', seat);
  assert.equal(hidden.data?.length, 0, 'RLS must hide holds whose expires_at is in the past');

  const states = computeSeatStates({
    seats: [{ id: seat, row: 'A', number: 1, seat_type: 'standard', is_wheelchair: false }],
    holds: [{ seat_id: seat, user_id: c.userA.id, expires_at: new Date(Date.now() - 1000).toISOString() }],
    reserved: [],
    userId: c.userB.id,
    nowMs: Date.now(),
  });
  assert.equal(states[seat], 'available', 'client derives "available" from expires_at alone');

  const b = await hold(c.userB, c.futureId, [seat]);
  assert.equal(b.error, null, `B must be able to hold after expiry: ${b.error?.message}`);
  const owner = await admin.from('seat_holds').select('user_id').eq('showtime_id', c.futureId).eq('seat_id', seat);
  assert.equal(owner.data.length, 1);
  assert.equal(owner.data[0].user_id, c.userB.id);
});

await runTest('GUEST BLOCKED: an anonymous client cannot call hold_seats and no hold is created', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const seat = c.seats[6].id;
  const r = await c.guest.rpc('hold_seats', { p_showtime_id: c.futureId, p_seat_ids: [seat], p_session_id: 'guest' });
  assert.ok(r.error, 'guest hold must fail');
  assert.equal(parseHoldError(r.error.message), 'AUTH_REQUIRED', `unexpected error: ${r.error.message}`);
  const rows = await admin.from('seat_holds').select('id').eq('showtime_id', c.futureId);
  assert.equal(rows.data.length, 0, 'no hold may exist after a guest attempt');
});

await runTest('GUEST BLOCKED: guests cannot release holds or write seat_holds directly either', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const seat = c.seats[7].id;
  assert.equal((await hold(c.userA, c.futureId, [seat])).error, null);

  const rel = await c.guest.rpc('release_holds', { p_showtime_id: c.futureId });
  assert.ok(rel.error, 'guest release must fail');

  const del = await c.guest.from('seat_holds').delete().eq('showtime_id', c.futureId);
  const ins = await c.guest.from('seat_holds').insert({
    showtime_id: c.futureId,
    seat_id: c.seats[8].id,
    user_id: c.userA.id,
    session_id: 'x',
    expires_at: new Date(Date.now() + 300000).toISOString(),
  });
  assert.ok(ins.error, 'guest direct INSERT must fail');
  void del;
  const rows = await admin.from('seat_holds').select('seat_id').eq('showtime_id', c.futureId);
  assert.deepEqual(rows.data.map((r) => r.seat_id), [seat], "A's hold must be untouched");
});

await runTest('GUEST CAN LOOK: anonymous users can read seats, active holds and reserved seats for the map', async () => {
  const c = await buildContext();
  const seats = await c.guest.from('seats').select('id').eq('auditorium_id', c.aud.id);
  assert.ok(seats.data?.length > 0, 'guest must read seats');
  const holds = await c.guest.from('seat_holds').select('seat_id, expires_at').eq('showtime_id', c.futureId);
  assert.equal(holds.error, null);
  const res = await c.guest.from('reservation_seats').select('seat_id').eq('showtime_id', c.futureId);
  assert.equal(res.error, null);
});

await runTest('STARTED SHOWTIME: holding is rejected with SHOWTIME_STARTED', async () => {
  const c = await buildContext();
  const r = await hold(c.userA, c.startedId, [c.seats[0].id]);
  assert.ok(r.error, 'must be blocked');
  assert.equal(parseHoldError(r.error.message), 'SHOWTIME_STARTED', `needs phase4_hold_seats.sql applied. Got: ${r.error.message}`);
  const rows = await admin.from('seat_holds').select('id').eq('showtime_id', c.startedId);
  assert.equal(rows.data.length, 0);
});

await runTest('SEAT_TAKEN: a reserved (sold) seat cannot be held', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const seat = c.seats[9].id;
  const ref = `MS-TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const resv = await admin
    .from('reservations')
    .insert({
      reference_code: ref,
      showtime_id: c.futureId,
      user_id: c.userA.id,
      customer_name: 'Phase4 Test',
      customer_email: 'phase4@movieseat.test',
      status: 'active',
      total_amount: 280,
    })
    .select('id')
    .single();
  assert.equal(resv.error, null, resv.error?.message);
  const rs = await admin
    .from('reservation_seats')
    .insert({ reservation_id: resv.data.id, showtime_id: c.futureId, seat_id: seat, price: 280, status: 'reserved' });
  assert.equal(rs.error, null, rs.error?.message);

  try {
    const r = await hold(c.userB, c.futureId, [seat]);
    assert.ok(r.error, 'sold seat must be refused');
    assert.equal(parseHoldError(r.error.message), 'SEAT_TAKEN', r.error.message);
  } finally {
    await admin.from('reservations').delete().eq('id', resv.data.id); // cascades reservation_seats
  }
});

await runTest('INVALID_SEAT: a seat from a different auditorium cannot be held for this showtime', async () => {
  const c = await buildContext();
  if (!c.otherSeat) throw new Error('needs at least two auditoriums in seed data');
  const r = await hold(c.userA, c.futureId, [c.otherSeat.id]);
  assert.ok(r.error);
  assert.equal(parseHoldError(r.error.message), 'INVALID_SEAT', r.error.message);
});

await runTest('REALTIME: a subscriber receives an event when someone else holds a seat', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  const watcher = createClient(SUPABASE_URL, ANON_KEY, clientOpts);
  let channel;
  try {
    let resolveEvent;
    const gotEvent = new Promise((resolve) => (resolveEvent = resolve));
    const subscribed = new Promise((resolve, reject) => {
      channel = watcher
        .channel(`phase4-test-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_holds' }, (p) => resolveEvent(p))
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') resolve();
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`realtime ${status}${err ? ': ' + err.message : ''}`));
        });
    });
    await Promise.race([subscribed, new Promise((_, rej) => setTimeout(() => rej(new Error('realtime subscribe timed out (is seat_holds in the supabase_realtime publication?)')), 10000))]);

    assert.equal((await hold(c.userA, c.futureId, [c.seats[12].id])).error, null);
    const payload = await Promise.race([
      gotEvent,
      new Promise((_, rej) => setTimeout(() => rej(new Error('no Realtime event received within 10s')), 10000)),
    ]);
    assert.ok(payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE');
  } finally {
    if (channel) await watcher.removeChannel(channel);
  }
});

// =============================================================================
// Section 4: HTTP against the dev server
// =============================================================================
console.log('\n--- Section 4: HTTP (running dev server) ---');

// NOTE: the page streams inside <Suspense>, so the HTTP status line (200) is sent
// before notFound() runs. What is guaranteed is the not-found UI + noindex and
// that no seat map is rendered. We assert exactly that.
await runTest('GET /screenings/<invalid id> renders the not-found page (noindex, no seat map)', async () => {
  const res = await fetch(`${BASE_URL}/screenings/not-a-uuid`);
  const html = await res.text();
  assert.ok(/noindex/.test(html), 'not-found response must carry robots noindex');
  assert.ok(!html.includes('data-seat-id='), 'no seat map for an invalid id');
  assert.ok(/could not be found|404/i.test(html), 'not-found content must be present');
});

await runTest('GET /screenings/<unknown valid uuid> renders not-found or the friendly unavailable page (never a seat map)', async () => {
  const res = await fetch(`${BASE_URL}/screenings/00000000-0000-4000-8000-000000000000`);
  const html = await res.text();
  assert.ok(!html.includes('data-seat-id='), 'no seat map for an unknown showtime');
  assert.ok(
    /noindex/.test(html) || html.includes('seat map is unavailable'),
    'must be the not-found page or the friendly unavailable page'
  );
});

await runTest('GUEST can load the screening page and sees every seat of the auditorium, the legend and the advisory', async () => {
  const c = await buildContext();
  const res = await fetch(`${BASE_URL}/screenings/${c.futureId}`);
  assert.equal(res.status, 200, `got ${res.status}`);
  const html = await res.text();
  const seatCount = (html.match(/data-seat-id=/g) || []).length;
  assert.equal(seatCount, c.aud.total_seats, `expected ${c.aud.total_seats} seat buttons, found ${seatCount}`);
  assert.ok(html.includes('double-booking protection'), 'advisory banner');
  assert.ok(html.includes('VIP Recliners'), 'VIP row divider');
  assert.ok(html.includes('cinema-screen-glow'), 'projection arc');
  for (const label of ['Available', 'Held by others', 'Reserved']) assert.ok(html.includes(label), `legend ${label}`);
  assert.ok(html.includes('Breadcrumb'), 'breadcrumb');
});

await runTest('Screening page marks held and reserved seats for a guest (state comes from the database)', async () => {
  const c = await buildContext();
  await clearHolds(c.futureId);
  assert.equal((await hold(c.userA, c.futureId, [c.seats[13].id])).error, null);
  const res = await fetch(`${BASE_URL}/screenings/${c.futureId}`);
  const html = await res.text();
  assert.ok(html.includes('data-seat-state="held"'), 'a held seat must render in the held state for other viewers');
});

// =============================================================================
// Cleanup (always)
// =============================================================================
console.log('\n--- Cleanup ---');
try {
  for (const id of createdShowtimeIds) {
    await admin.from('seat_holds').delete().eq('showtime_id', id);
    await admin.from('reservations').delete().eq('showtime_id', id);
    await admin.from('showtimes').delete().eq('id', id);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`Removed ${createdShowtimeIds.length} test showtime(s) and ${createdUserIds.length} test user(s).`);
} catch (e) {
  console.warn(`Cleanup warning: ${e.message}`);
}

console.log('\n================================================================================');
console.log('                          PHASE 4 TEST SUMMARY                                  ');
console.log('================================================================================');
console.log(`Total Tests  : ${totalTests}`);
console.log(`Passed Tests : ${passedTests}`);
console.log(`Failed Tests : ${failedTests}`);
console.log(`Success Rate : ${Math.round((passedTests / totalTests) * 100)}%`);
if (failures.length) {
  console.log('\nFailed tests:');
  for (const f of failures) console.log(`  - ${f}`);
}
console.log('================================================================================\n');

process.exit(failedTests > 0 ? 1 : 0);
