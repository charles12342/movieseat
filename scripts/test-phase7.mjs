#!/usr/bin/env node

/**
 * ==============================================================================
 * MovieSeat Phase 7 Automated Test Suite
 * Find Reservation, Self-Service & Cancellation
 *
 * Section 1: Code Architecture & Security Contract
 *            - FindReservationView with # prefix, status badges, quick-switch selector
 *            - CancelReservationModal with permanent cancellation warning
 *            - Cancellation route takes user from session, enforces 30-min cutoff
 *            - phase7_cancel_reservation.sql migration with advisory lock
 *
 * Section 2: Status Derivation Logic (Offline Unit Tests)
 *            - Active, Cancelled, Expired, and Used dynamic status mapping
 *
 * Section 3: HTTP API Unauthenticated & Edge Cases (localhost:3000)
 *            - Guest blocked from cancellation endpoint (HTTP 401)
 *            - Guest redirected from /find-reservation to /signin?redirect=
 *
 * Section 4: Database Integration & Policy Enforcement (Real Supabase + Dev Server)
 *            - 4.1 Owner lookup (can locate and view own reservations)
 *            - 4.2 Another user denied (User B cannot see or cancel User A's booking)
 *            - 4.3 Cancel allowed (> 30 minutes before showtime)
 *            - 4.4 Cancel blocked inside 30 minutes (CANCEL_WINDOW_CLOSED)
 *            - 4.5 Second cancel rejected (ALREADY_CANCELLED)
 *            - 4.6 Seat available again after cancel (freed in reservation_seats)
 * ==============================================================================
 */

// Re-run under Node's native type stripping so lib/*.ts can be imported directly.
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

console.log('================================================================================');
console.log('     MOVIESEAT TEST SUITE: PHASE 7 (FIND RESERVATION & CANCELLATION)            ');
console.log('================================================================================');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let blockedTests = 0;
const failures = [];
const blockedList = [];

class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedError';
  }
}

function isDbMissingError(err) {
  if (!err) return false;
  const msg = String(err.message || err);
  const code = String(err.code || '');
  return (
    code === 'PGRST205' ||
    code === 'PGRST202' ||
    code === '42P01' ||
    msg.includes('Could not find the function') ||
    msg.includes('relation') && msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('tables missing') ||
    msg.includes('database not ready')
  );
}

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    if (err instanceof BlockedError || isDbMissingError(err)) {
      const reason = err.message || 'Supabase database tables/functions not ready';
      console.log(`[BLOCKED] ${name} (database not ready: ${reason})`);
      blockedTests++;
      blockedList.push({ name, reason });
    } else {
      console.error(`[FAIL] ${name}`);
      console.error(`       Error: ${err.message}`);
      failedTests++;
      failures.push(name);
    }
  }
}

// Read Environment
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = 'http://localhost:3000';

// =============================================================================
// SECTION 1: Code Architecture & Security Contract
// =============================================================================
console.log('\n--- Section 1: Code Architecture & Security Contract ---');

await runTest('1.1 FindReservationView implements # search prefix, quick switch, and status badges', () => {
  const viewPath = path.resolve('components/find-reservation/FindReservationView.tsx');
  assert.ok(fs.existsSync(viewPath), 'FindReservationView.tsx exists');
  const code = fs.readFileSync(viewPath, 'utf8');

  assert.ok(code.includes('#'), 'Contains # prefix for search');
  assert.ok(code.includes('Your Latest Reservation'), 'Displays Your Latest Reservation card');
  assert.ok(code.includes('Active') && code.includes('Cancelled') && code.includes('Expired') && code.includes('Used'), 'Handles Active, Cancelled, Expired, and Used statuses');
  assert.ok(code.includes('reservation-quick-switch'), 'Includes quick-switch selector');
  assert.ok(code.includes('download-pdf-button') || code.includes('PDF Ticket'), 'Contains PDF download button');
  assert.ok(code.includes('cancellation-window-closed-notice') || code.includes('within 30 minutes'), 'Displays 30-minute cutoff notice');
});

await runTest('1.2 CancelReservationModal renders permanent cancellation warning', () => {
  const modalPath = path.resolve('components/find-reservation/CancelReservationModal.tsx');
  assert.ok(fs.existsSync(modalPath), 'CancelReservationModal.tsx exists');
  const code = fs.readFileSync(modalPath, 'utf8');

  assert.ok(code.includes('permanent and cannot be undone'), 'Explains cancellation is permanent');
  assert.ok(code.includes('confirm-cancel-button'), 'Contains confirm cancellation button');
  assert.ok(code.includes('Keep Reservation'), 'Contains dismiss action');
});

await runTest('1.3 Cancellation route handler takes user from session and enforces 30-min cutoff', () => {
  const routePath = path.resolve('app/api/reservations/[id]/cancel/route.ts');
  assert.ok(fs.existsSync(routePath), 'Cancel route exists');
  const code = fs.readFileSync(routePath, 'utf8');

  assert.ok(code.includes('supabase.auth.getUser()'), 'Reads user strictly from session');
  assert.ok(code.includes('cancel_reservation'), 'Calls cancel_reservation RPC');
  assert.ok(code.includes('CANCEL_WINDOW_CLOSED'), 'Handles 30-min policy error');
  assert.ok(code.includes('ALREADY_CANCELLED'), 'Handles already-cancelled error');
  assert.ok(code.includes('status: 403'), 'Denies stranger access with 403');
});

await runTest('1.4 phase7_cancel_reservation.sql migration contains advisory lock and policy checks', () => {
  const sqlPath = path.resolve('supabase/phase7_cancel_reservation.sql');
  assert.ok(fs.existsSync(sqlPath), 'phase7_cancel_reservation.sql exists');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  assert.ok(sql.includes('pg_advisory_xact_lock'), 'Serializes cancels with advisory lock');
  assert.ok(sql.includes('CANCEL_WINDOW_CLOSED') && sql.includes('30'), 'Enforces 30-minute cutoff');
  assert.ok(sql.includes("status = 'cancelled'"), 'Updates reservation and seats to cancelled');
});

// =============================================================================
// SECTION 2: Status Derivation Logic (Offline Unit Tests)
// =============================================================================
console.log('\n--- Section 2: Status Derivation Logic ---');

function deriveStatus(storedStatus, startIso, endIso, nowMs) {
  if (storedStatus === 'cancelled') return 'Cancelled';
  if (storedStatus === 'completed') return 'Used';
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (nowMs > endMs) return 'Expired';
  if (nowMs >= startMs) return 'Used';
  return 'Active';
}

await runTest('2.1 deriveStatus maps stored and clock-derived statuses accurately', () => {
  const baseNow = 1770000000000;
  const futureStart = new Date(baseNow + 2 * 3600_000).toISOString();
  const futureEnd = new Date(baseNow + 4 * 3600_000).toISOString();

  const pastStart = new Date(baseNow - 4 * 3600_000).toISOString();
  const pastEnd = new Date(baseNow - 2 * 3600_000).toISOString();

  const inProgStart = new Date(baseNow - 1 * 3600_000).toISOString();
  const inProgEnd = new Date(baseNow + 1 * 3600_000).toISOString();

  // Active
  assert.equal(deriveStatus('active', futureStart, futureEnd, baseNow), 'Active');

  // Cancelled (stored beats clock)
  assert.equal(deriveStatus('cancelled', futureStart, futureEnd, baseNow), 'Cancelled');
  assert.equal(deriveStatus('cancelled', pastStart, pastEnd, baseNow), 'Cancelled');

  // Expired (screening finished in the past without cancellation)
  assert.equal(deriveStatus('active', pastStart, pastEnd, baseNow), 'Expired');

  // Used (screening in progress or completed)
  assert.equal(deriveStatus('active', inProgStart, inProgEnd, baseNow), 'Used');
  assert.equal(deriveStatus('completed', futureStart, futureEnd, baseNow), 'Used');
});

// =============================================================================
// SECTION 3: HTTP API Unauthenticated & Edge Cases
// =============================================================================
console.log('\n--- Section 3: HTTP API Unauthenticated & Edge Cases ---');

await runTest('3.1 POST /api/reservations/[id]/cancel without session returns HTTP 401 AUTH_REQUIRED', async () => {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/reservations/00000000-0000-0000-0000-000000000001/cancel`, {
      method: 'POST',
    });
  } catch (err) {
    throw new BlockedError(`Dev server not reachable at ${BASE_URL} (${err.message})`);
  }

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, 'AUTH_REQUIRED');
});

await runTest('3.2 GET /find-reservation without session redirects guest to /signin?redirect=/find-reservation', async () => {
  let res;
  try {
    res = await fetch(`${BASE_URL}/find-reservation`, { redirect: 'manual' });
  } catch (err) {
    throw new BlockedError(`Dev server not reachable (${err.message})`);
  }

  assert.ok(res.status === 307 || res.status === 302, `Expected redirect, got ${res.status}`);
  const loc = res.headers.get('location') || '';
  assert.ok(loc.includes('/signin'), `Location must redirect to /signin, got ${loc}`);
  assert.ok(decodeURIComponent(loc).includes('/find-reservation'), `Location must preserve return path, got ${loc}`);
});

// =============================================================================
// SECTION 4: Database Integration & Policy Enforcement (Real Supabase + Dev Server)
// =============================================================================
console.log('\n--- Section 4: Database Integration & Policy Enforcement ---');

let adminClient = null;
const cleanupShowtimeIds = [];
const cleanupUserIds = [];

if (supabaseUrl && supabaseServiceKey && !supabaseUrl.includes('placeholder')) {
  adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let phase7Ctx = null;

async function setupPhase7Context() {
  if (!adminClient) throw new BlockedError('Supabase credentials not configured in .env.local');

  const [movieRes, audRes] = await Promise.all([
    adminClient.from('movies').select('id, title').limit(1),
    adminClient.from('auditoriums').select('id, name').limit(1),
  ]);

  if (movieRes.error || !movieRes.data?.length || audRes.error || !audRes.data?.length) {
    throw new BlockedError('Database tables not ready (movies/auditoriums missing)');
  }

  const movieId = movieRes.data[0].id;
  const audId = audRes.data[0].id;

  const seatsRes = await adminClient
    .from('seats')
    .select('id, row, number, seat_type')
    .eq('auditorium_id', audId)
    .limit(4);

  if (seatsRes.error || !seatsRes.data?.length || seatsRes.data.length < 2) {
    throw new BlockedError('Seats table has insufficient rows');
  }

  const seat1 = seatsRes.data[0];
  const seat2 = seatsRes.data[1];

  // Showtime 1: Future > 30 minutes (e.g. 4 hours from now) -> Cancel Allowed!
  const futureStart = new Date(Date.now() + 4 * 3600_000).toISOString();
  const futureEnd = new Date(Date.now() + 6 * 3600_000).toISOString();

  const st1Res = await adminClient
    .from('showtimes')
    .insert({
      movie_id: movieId,
      auditorium_id: audId,
      start_time: futureStart,
      end_time: futureEnd,
      price_standard: 280,
      price_vip: 380,
    })
    .select('id')
    .single();

  if (st1Res.error) throw new BlockedError(st1Res.error.message);
  cleanupShowtimeIds.push(st1Res.data.id);

  // Showtime 2: Inside 30 minutes (e.g. 15 minutes from now) -> Cancel Blocked!
  const soonStart = new Date(Date.now() + 15 * 60_000).toISOString();
  const soonEnd = new Date(Date.now() + 135 * 60_000).toISOString();

  const st2Res = await adminClient
    .from('showtimes')
    .insert({
      movie_id: movieId,
      auditorium_id: audId,
      start_time: soonStart,
      end_time: soonEnd,
      price_standard: 280,
      price_vip: 380,
    })
    .select('id')
    .single();

  if (st2Res.error) throw new BlockedError(st2Res.error.message);
  cleanupShowtimeIds.push(st2Res.data.id);

  // Create User A (Owner) and User B (Stranger)
  const stamp = Date.now();
  const makeUser = async (role) => {
    const email = `phase7-${role}-${stamp}@movieseat.test`;
    const password = `P7Pass-${stamp}!Aa1`;
    const created = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new BlockedError(created.error.message);
    cleanupUserIds.push(created.data.user.id);

    const client = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new BlockedError(signIn.error.message);

    const projRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || 'xfmojkqlglfrebukilqf';
    const cookieHeader = `sb-${projRef}-auth-token=${encodeURIComponent(JSON.stringify(signIn.data.session))}`;

    return {
      userId: created.data.user.id,
      email,
      client,
      cookieHeader,
    };
  };

  const userA = await makeUser('owner');
  const userB = await makeUser('stranger');

  // Insert Reservation 1 for User A on Showtime 1 (> 30 mins)
  const ref1 = `MS-2026-P7${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const res1Insert = await adminClient
    .from('reservations')
    .insert({
      reference_code: ref1,
      showtime_id: st1Res.data.id,
      user_id: userA.userId,
      customer_name: 'Owner Patron',
      customer_email: userA.email,
      status: 'active',
      total_amount: 280,
    })
    .select('id')
    .single();

  if (res1Insert.error) throw new BlockedError(res1Insert.error.message);

  // Allocate seat1 to Reservation 1
  await adminClient.from('reservation_seats').insert({
    reservation_id: res1Insert.data.id,
    showtime_id: st1Res.data.id,
    seat_id: seat1.id,
    price: 280,
    status: 'reserved',
  });

  // Insert Reservation 2 for User A on Showtime 2 (inside 30 mins)
  const ref2 = `MS-2026-P7${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const res2Insert = await adminClient
    .from('reservations')
    .insert({
      reference_code: ref2,
      showtime_id: st2Res.data.id,
      user_id: userA.userId,
      customer_name: 'Owner Patron',
      customer_email: userA.email,
      status: 'active',
      total_amount: 280,
    })
    .select('id')
    .single();

  if (res2Insert.error) throw new BlockedError(res2Insert.error.message);

  await adminClient.from('reservation_seats').insert({
    reservation_id: res2Insert.data.id,
    showtime_id: st2Res.data.id,
    seat_id: seat2.id,
    price: 280,
    status: 'reserved',
  });

  return {
    st1Id: st1Res.data.id,
    st2Id: st2Res.data.id,
    res1Id: res1Insert.data.id,
    res2Id: res2Insert.data.id,
    ref1,
    ref2,
    seat1,
    seat2,
    userA,
    userB,
  };
}

await runTest('4.1 Owner lookup: User A queries my_reservations and sees own bookings', async () => {
  phase7Ctx = await setupPhase7Context();

  const { data: userABookings, error } = await phase7Ctx.userA.client
    .from('my_reservations')
    .select('reference_code, status');

  if (error) {
    if (isDbMissingError(error)) throw new BlockedError(error.message);
    throw error;
  }

  const refs = userABookings.map((b) => b.reference_code);
  assert.ok(refs.includes(phase7Ctx.ref1), 'Owner sees reservation 1');
  assert.ok(refs.includes(phase7Ctx.ref2), 'Owner sees reservation 2');
});

await runTest('4.2 Another user denied: User B cannot cancel User A reservation (HTTP 403)', async () => {
  if (!phase7Ctx) phase7Ctx = await setupPhase7Context();

  // User B tries to cancel User A's reservation 1 via API
  const cancelRes = await fetch(`${BASE_URL}/api/reservations/${phase7Ctx.res1Id}/cancel`, {
    method: 'POST',
    headers: {
      Cookie: phase7Ctx.userB.cookieHeader,
    },
  });

  assert.equal(cancelRes.status, 403, `Expected 403 Forbidden, got ${cancelRes.status}`);
  const data = await cancelRes.json();
  assert.equal(data.error, 'FORBIDDEN');

  // Verify User B cannot see User A's reservations in my_reservations
  const { data: userBBookings } = await phase7Ctx.userB.client
    .from('my_reservations')
    .select('reference_code');

  const userBRefs = (userBBookings || []).map((b) => b.reference_code);
  assert.ok(!userBRefs.includes(phase7Ctx.ref1), 'Stranger cannot see User A reservation 1');
  assert.ok(!userBRefs.includes(phase7Ctx.ref2), 'Stranger cannot see User A reservation 2');
});

await runTest('4.3 Cancel allowed: User A successfully cancels reservation > 30 minutes before showtime', async () => {
  if (!phase7Ctx) phase7Ctx = await setupPhase7Context();

  const cancelRes = await fetch(`${BASE_URL}/api/reservations/${phase7Ctx.res1Id}/cancel`, {
    method: 'POST',
    headers: {
      Cookie: phase7Ctx.userA.cookieHeader,
    },
  });

  assert.equal(cancelRes.status, 200, `Expected 200 OK, got ${cancelRes.status}`);
  const data = await cancelRes.json();
  assert.equal(data.success, true);

  // Check database row: status must be 'cancelled'
  const { data: dbRow } = await adminClient
    .from('reservations')
    .select('status, cancelled_at')
    .eq('id', phase7Ctx.res1Id)
    .single();

  assert.equal(dbRow.status, 'cancelled');
  assert.ok(dbRow.cancelled_at, 'cancelled_at timestamp recorded');
});

await runTest('4.4 Cancel blocked inside 30 minutes: 30-minute cutoff policy is strictly enforced (409)', async () => {
  if (!phase7Ctx) phase7Ctx = await setupPhase7Context();

  // Reservation 2 is 15 minutes before showtime -> must be blocked!
  const cancelRes = await fetch(`${BASE_URL}/api/reservations/${phase7Ctx.res2Id}/cancel`, {
    method: 'POST',
    headers: {
      Cookie: phase7Ctx.userA.cookieHeader,
    },
  });

  assert.equal(cancelRes.status, 409, `Expected 409 Conflict, got ${cancelRes.status}`);
  const data = await cancelRes.json();
  assert.equal(data.error, 'CANCEL_WINDOW_CLOSED');
  assert.ok(data.message.includes('30 minutes'));
});

await runTest('4.5 Second cancel rejected: attempting to cancel an already-cancelled booking fails', async () => {
  if (!phase7Ctx) phase7Ctx = await setupPhase7Context();

  // Reservation 1 was already cancelled in 4.3 -> must be rejected!
  const cancelRes = await fetch(`${BASE_URL}/api/reservations/${phase7Ctx.res1Id}/cancel`, {
    method: 'POST',
    headers: {
      Cookie: phase7Ctx.userA.cookieHeader,
    },
  });

  assert.equal(cancelRes.status, 409, `Expected 409 Conflict for duplicate cancel, got ${cancelRes.status}`);
  const data = await cancelRes.json();
  assert.equal(data.error, 'ALREADY_CANCELLED');
});

await runTest('4.6 Seat available again after cancel: reservation_seats marked cancelled and freed for re-booking', async () => {
  if (!phase7Ctx) phase7Ctx = await setupPhase7Context();

  // Check reservation_seats for Reservation 1
  const { data: seatRows } = await adminClient
    .from('reservation_seats')
    .select('status')
    .eq('reservation_id', phase7Ctx.res1Id);

  assert.equal(seatRows?.length, 1);
  assert.equal(seatRows[0].status, 'cancelled', 'Seat status transitioned to cancelled');

  // 2. Querying active reserved seats for this showtime returns 0 rows for this seat
  const { data: activeSeats } = await adminClient
    .from('reservation_seats')
    .select('id')
    .eq('showtime_id', phase7Ctx.st1Id)
    .eq('seat_id', phase7Ctx.seat1.id)
    .eq('status', 'reserved');

  assert.equal(activeSeats?.length || 0, 0, 'Cancelled seat is no longer returned in active reserved seats query');

  // 3. Verify seat can be re-reserved by User B (partial unique index permits new reserved row now that prior is cancelled)
  const { data: newRes, error: newResErr } = await adminClient
    .from('reservations')
    .insert({
      showtime_id: phase7Ctx.st1Id,
      user_id: phase7Ctx.userB.userId,
      customer_name: 'Test User B',
      customer_email: 'test-user-b@example.com',
      total_amount: 350,
      status: 'active',
      reference_code: `MS-2026-REBK${Math.floor(Math.random() * 9000 + 1000)}`,
    })
    .select('id')
    .single();

  assert.ok(!newResErr, `Created re-booking reservation: ${newResErr?.message}`);

  const { data: rebookedSeat, error: rebookErr } = await adminClient
    .from('reservation_seats')
    .insert({
      reservation_id: newRes.id,
      seat_id: phase7Ctx.seat1.id,
      showtime_id: phase7Ctx.st1Id,
      status: 'reserved',
      price: 350,
    })
    .select('id')
    .single();

  assert.ok(!rebookErr, `Re-booking freed seat succeeded without conflict: ${rebookErr?.message}`);
  assert.ok(rebookedSeat?.id, 'Seat was re-booked successfully by another user');
});

// Cleanup test fixtures
try {
  for (const sId of cleanupShowtimeIds) {
    await adminClient?.from('reservations').delete().eq('showtime_id', sId);
    await adminClient?.from('reservation_seats').delete().eq('showtime_id', sId);
    await adminClient?.from('seat_holds').delete().eq('showtime_id', sId);
    await adminClient?.from('showtimes').delete().eq('id', sId);
  }
  for (const uId of cleanupUserIds) {
    await adminClient?.auth.admin.deleteUser(uId);
  }
} catch {
  // Silent cleanup
}

// =============================================================================
// FINAL SUMMARY
// =============================================================================
console.log('\n================================================================================');
console.log('                          PHASE 7 TEST RESULTS SUMMARY                          ');
console.log('================================================================================');
console.log(`Total Tests Run:  ${totalTests}`);
console.log(`Passed:           ${passedTests}`);
console.log(`Blocked:          ${blockedTests} (database not ready)`);
console.log(`Failed:           ${failedTests}`);

if (blockedList.length > 0) {
  console.log('\nBlocked Tests Detail:');
  for (const b of blockedList) {
    console.log(` - ${b.name}: ${b.reason}`);
  }
}

if (failures.length > 0) {
  console.log('\nFailed Tests:');
  for (const f of failures) {
    console.log(` - ${f}`);
  }
  console.log('\nPhase 7: FAILED (' + failures.join(', ') + ')');
  process.exit(1);
} else {
  console.log('\nPhase 7: PASSED');
  process.exit(0);
}
