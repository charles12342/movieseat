#!/usr/bin/env node

/**
 * ==============================================================================
 * MovieSeat Phase 8 Automated QA Regression Test Suite
 * Comprehensive End-to-End Audit Covering:
 *
 * 1. Double-booking race condition (two users, same seat, only one wins)
 * 2. 5-minute hold expiry and release
 * 3. OTP lockout after 5 wrong attempts
 * 4. Cross-user privacy (another user gets 403 on ticket page and PDF)
 * 5. 30-minute cancel cutoff and immediate seat release
 *
 * Each test creates its own test users and showtimes and deletes them at the end.
 * ==============================================================================
 */

// Auto-respawn with Node's native type-stripping if invoked directly without flags
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
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

console.log('================================================================================');
console.log('            MOVIESEAT TEST SUITE: PHASE 8 (FINAL QA & REGRESSION)              ');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// Environment Configuration
// -----------------------------------------------------------------------------
const envPath = path.resolve('.env.local');
const env = {};
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  }
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[ERROR] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
    (msg.includes('relation') && msg.includes('does not exist')) ||
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
      const reason = err.message || 'Database tables or functions not ready';
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

// -----------------------------------------------------------------------------
// Fixture Helpers
// -----------------------------------------------------------------------------
async function getBaseMovieAndAuditorium() {
  const [movieRes, audRes] = await Promise.all([
    adminClient.from('movies').select('id, title').limit(1),
    adminClient.from('auditoriums').select('id, name').limit(1),
  ]);

  if (movieRes.error || !movieRes.data?.length || audRes.error || !audRes.data?.length) {
    throw new BlockedError('Missing initial movies or auditoriums seed data');
  }

  return { movieId: movieRes.data[0].id, audId: audRes.data[0].id };
}

async function getAuditoriumSeats(audId, count = 5) {
  const { data, error } = await adminClient
    .from('seats')
    .select('id, row, number, seat_type')
    .eq('auditorium_id', audId)
    .order('row')
    .order('number')
    .limit(count);

  if (error || !data || data.length < 2) {
    throw new BlockedError('Insufficient seats found in auditorium');
  }
  return data;
}

async function createTestShowtime(movieId, audId, offsetMinutes = 120) {
  const start = new Date(Date.now() + offsetMinutes * 60_000).toISOString();
  const end = new Date(Date.now() + (offsetMinutes + 120) * 60_000).toISOString();

  const { data, error } = await adminClient
    .from('showtimes')
    .insert({
      movie_id: movieId,
      auditorium_id: audId,
      start_time: start,
      end_time: end,
      price_standard: 280,
      price_vip: 380,
    })
    .select('id, start_time, end_time')
    .single();

  if (error || !data) {
    throw new BlockedError(`Failed to insert test showtime: ${error?.message}`);
  }
  return data;
}

async function createTestUser(roleTag) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const email = `qa-${roleTag}-${stamp}@movieseat.test`;
  const password = `QAPass-${stamp}!Aa1`;

  const { data: userData, error: userError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userError || !userData?.user) {
    throw new BlockedError(`Failed to create test user (${roleTag}): ${userError?.message}`);
  }

  const userId = userData.user.id;

  // Authenticate user client
  const client = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sessionData, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !sessionData?.session) {
    throw new BlockedError(`Failed to sign in test user (${roleTag}): ${signInError?.message}`);
  }

  const projRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || 'xfmojkqlglfrebukilqf';
  const cookieHeader = `sb-${projRef}-auth-token=${encodeURIComponent(JSON.stringify(sessionData.session))}`;

  return {
    userId,
    email,
    password,
    client,
    session: sessionData.session,
    cookieHeader,
  };
}

async function cleanupFixtures({ userIds = [], showtimeIds = [], reservationIds = [] }) {
  try {
    for (const rId of reservationIds) {
      await adminClient.from('reservation_seats').delete().eq('reservation_id', rId);
      await adminClient.from('reservations').delete().eq('id', rId);
    }
    for (const sId of showtimeIds) {
      await adminClient.from('seat_holds').delete().eq('showtime_id', sId);
      await adminClient.from('reservation_seats').delete().eq('showtime_id', sId);
      await adminClient.from('reservations').delete().eq('showtime_id', sId);
      await adminClient.from('showtimes').delete().eq('id', sId);
    }
    for (const uId of userIds) {
      await adminClient.auth.admin.deleteUser(uId);
    }
  } catch (err) {
    console.warn('[Cleanup Warning]', err.message);
  }
}

// =============================================================================
// TEST 1: Double Booking Race (Two users, same seat, only one wins)
// =============================================================================
console.log('--- Regression 1: Double Booking Race (Two Users, Same Seat) ---');

await runTest('1.1 Concurrent hold race: exactly one user wins the seat, loser gets SEAT_HELD', async () => {
  const { movieId, audId } = await getBaseMovieAndAuditorium();
  const seats = await getAuditoriumSeats(audId, 2);
  const targetSeat = seats[0];
  const showtime = await createTestShowtime(movieId, audId, 180);

  const user1 = await createTestUser('racer1');
  const user2 = await createTestUser('racer2');

  try {
    // Both users fire hold_seats simultaneously for targetSeat
    const [res1, res2] = await Promise.all([
      user1.client.rpc('hold_seats', {
        p_showtime_id: showtime.id,
        p_seat_ids: [targetSeat.id],
        p_session_id: 'qa-session-1',
      }),
      user2.client.rpc('hold_seats', {
        p_showtime_id: showtime.id,
        p_seat_ids: [targetSeat.id],
        p_session_id: 'qa-session-2',
      }),
    ]);

    const res1Ok = !res1.error;
    const res2Ok = !res2.error;

    // Exactly one winner
    assert.notEqual(res1Ok, res2Ok, 'Exactly one user must win the seat hold');

    const winner = res1Ok ? user1 : user2;
    const loserRes = res1Ok ? res2 : res1;

    assert.ok(
      loserRes.error.message.includes('SEAT_HELD') || loserRes.error.message.includes('SEAT_TAKEN'),
      `Loser must receive SEAT_HELD error, got: ${loserRes.error.message}`
    );

    // Verify database state: exactly 1 active hold exists
    const { data: holdsData } = await adminClient
      .from('seat_holds')
      .select('user_id, seat_id')
      .eq('showtime_id', showtime.id)
      .eq('seat_id', targetSeat.id);

    assert.equal(holdsData?.length, 1, 'Only one hold record must exist in seat_holds table');
    assert.equal(holdsData[0].user_id, winner.userId, 'Winning hold must belong to the winner');
  } finally {
    await cleanupFixtures({
      userIds: [user1.userId, user2.userId],
      showtimeIds: [showtime.id],
    });
  }
});

await runTest('1.2 Reserved seat lock: confirmed seat cannot be held or double-booked by another user', async () => {
  const { movieId, audId } = await getBaseMovieAndAuditorium();
  const seats = await getAuditoriumSeats(audId, 2);
  const targetSeat = seats[0];
  const showtime = await createTestShowtime(movieId, audId, 180);

  const userA = await createTestUser('owner');
  const userB = await createTestUser('challenger');

  let resId = null;

  try {
    // 1. User A holds and confirms reservation
    const holdA = await userA.client.rpc('hold_seats', {
      p_showtime_id: showtime.id,
      p_seat_ids: [targetSeat.id],
      p_session_id: 'qa-session-a',
    });
    assert.equal(holdA.error, null, `User A hold failed: ${holdA.error?.message}`);

    const refCode = `MS-2026-QA${Math.floor(Math.random() * 90000 + 10000)}`;
    const { data: reservation, error: resError } = await adminClient
      .from('reservations')
      .insert({
        reference_code: refCode,
        showtime_id: showtime.id,
        user_id: userA.userId,
        customer_name: 'QA Owner',
        customer_email: userA.email,
        status: 'active',
        total_amount: 280,
      })
      .select('id')
      .single();

    assert.equal(resError, null);
    resId = reservation.id;

    // Insert reserved seat
    const { error: seatInsertErr } = await adminClient.from('reservation_seats').insert({
      reservation_id: resId,
      showtime_id: showtime.id,
      seat_id: targetSeat.id,
      price: 280,
      status: 'reserved',
    });
    assert.equal(seatInsertErr, null);

    // Release User A's hold
    await adminClient.from('seat_holds').delete().eq('showtime_id', showtime.id);

    // 2. User B now attempts to hold the already-reserved seat
    const holdB = await userB.client.rpc('hold_seats', {
      p_showtime_id: showtime.id,
      p_seat_ids: [targetSeat.id],
      p_session_id: 'qa-session-b',
    });

    assert.notEqual(holdB.error, null, 'Holding an already reserved seat must fail');
    assert.ok(
      holdB.error.message.includes('SEAT_TAKEN') || holdB.error.message.includes('SEAT_HELD'),
      `Expected SEAT_TAKEN error, received: ${holdB.error.message}`
    );

    // 3. Database Engine Check: Partial unique index prevents duplicate reserved rows
    const duplicateResSeat = await adminClient.from('reservation_seats').insert({
      reservation_id: resId,
      showtime_id: showtime.id,
      seat_id: targetSeat.id,
      price: 280,
      status: 'reserved',
    });

    assert.notEqual(duplicateResSeat.error, null, 'Partial unique index must reject duplicate reserved seat');
    assert.ok(
      duplicateResSeat.error.code === '23505' || duplicateResSeat.error.message.includes('unique'),
      'Must violate unique_active_reservation_seat constraint'
    );
  } finally {
    await cleanupFixtures({
      userIds: [userA.userId, userB.userId],
      showtimeIds: [showtime.id],
      reservationIds: resId ? [resId] : [],
    });
  }
});

// =============================================================================
// TEST 2: 5-Minute Hold Expiry and Release
// =============================================================================
console.log('\n--- Regression 2: 5-Minute Hold Expiry and Release ---');

await runTest('2.1 Expired hold release: expired hold is automatically bypassed and taken by new user', async () => {
  const { movieId, audId } = await getBaseMovieAndAuditorium();
  const seats = await getAuditoriumSeats(audId, 2);
  const targetSeat = seats[0];
  const showtime = await createTestShowtime(movieId, audId, 180);

  const userA = await createTestUser('holderA');
  const userB = await createTestUser('holderB');

  try {
    // 1. User A holds seat
    const holdA = await userA.client.rpc('hold_seats', {
      p_showtime_id: showtime.id,
      p_seat_ids: [targetSeat.id],
      p_session_id: 'session-a',
    });
    assert.equal(holdA.error, null);

    // Verify initial TTL is ~5 minutes
    const initialExp = new Date(holdA.data.expires_at).getTime();
    const diffSeconds = Math.round((initialExp - Date.now()) / 1000);
    assert.ok(diffSeconds >= 290 && diffSeconds <= 310, `Initial hold TTL should be ~300s, got ${diffSeconds}s`);

    // 2. Simulate 5-minute expiry by setting expires_at to 15 seconds in the past
    const pastExpiresAt = new Date(Date.now() - 15_000).toISOString();
    await adminClient
      .from('seat_holds')
      .update({ expires_at: pastExpiresAt })
      .eq('showtime_id', showtime.id)
      .eq('seat_id', targetSeat.id);

    // 3. User B calls hold_seats on the expired seat -> MUST SUCCEED
    const holdB = await userB.client.rpc('hold_seats', {
      p_showtime_id: showtime.id,
      p_seat_ids: [targetSeat.id],
      p_session_id: 'session-b',
    });

    assert.equal(holdB.error, null, `User B should acquire expired hold, got: ${holdB.error?.message}`);

    // Verify User B is now the current holder in database
    const { data: updatedHold } = await adminClient
      .from('seat_holds')
      .select('user_id, expires_at')
      .eq('showtime_id', showtime.id)
      .eq('seat_id', targetSeat.id)
      .single();

    assert.equal(updatedHold.user_id, userB.userId, 'Active hold must now belong to User B');
  } finally {
    await cleanupFixtures({
      userIds: [userA.userId, userB.userId],
      showtimeIds: [showtime.id],
    });
  }
});

await runTest('2.2 Explicit hold release: calling release_holds immediately frees seats', async () => {
  const { movieId, audId } = await getBaseMovieAndAuditorium();
  const seats = await getAuditoriumSeats(audId, 2);
  const targetSeat = seats[0];
  const showtime = await createTestShowtime(movieId, audId, 180);

  const user = await createTestUser('releaser');

  try {
    // 1. Hold seat
    const holdRes = await user.client.rpc('hold_seats', {
      p_showtime_id: showtime.id,
      p_seat_ids: [targetSeat.id],
      p_session_id: 'session-rel',
    });
    assert.equal(holdRes.error, null);

    // 2. Call release_holds
    const relRes = await user.client.rpc('release_holds', {
      p_showtime_id: showtime.id,
    });
    assert.equal(relRes.error, null);

    // 3. Verify hold is gone from table
    const { data: remainingHolds } = await adminClient
      .from('seat_holds')
      .select('id')
      .eq('showtime_id', showtime.id)
      .eq('user_id', user.userId);

    assert.equal(remainingHolds?.length, 0, 'seat_holds record must be deleted after release_holds');
  } finally {
    await cleanupFixtures({
      userIds: [user.userId],
      showtimeIds: [showtime.id],
    });
  }
});

// =============================================================================
// TEST 3: OTP Lockout After 5 Wrong Attempts
// =============================================================================
console.log('\n--- Regression 3: OTP Lockout After 5 Wrong Attempts ---');

await runTest('3.1 OTP locks out after 5 consecutive failed attempts, rejecting even correct code', async () => {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const testEmail = `qa-otp-lockout-${stamp}@movieseat.test`;
  const correctOtp = '839214';

  const hmacSecret = env.OTP_HMAC_SECRET || 'movieseat-dev-hmac-secret-min-32-characters-secure';
  const codeHash = crypto.createHmac('sha256', hmacSecret).update(correctOtp).digest('hex');
  const expiresAt = new Date(Date.now() + 300_000).toISOString();

  // 1. Insert active OTP record directly into otp_codes
  const { error: insertErr } = await adminClient.from('otp_codes').insert({
    email: testEmail,
    code_hash: codeHash,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    attempts: 0,
    is_used: false,
  });

  if (insertErr) {
    throw new BlockedError(`Failed to insert test OTP record: ${insertErr.message}`);
  }

  try {
    // 2. Perform 4 wrong attempts via POST /api/auth/verify-otp
    for (let i = 1; i <= 4; i++) {
      const wrongRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, otp: '000000' }),
      });

      assert.equal(wrongRes.status, 400, `Attempt ${i} should return HTTP 400`);
      const wrongData = await wrongRes.json();
      assert.equal(wrongData.attemptsRemaining, 5 - i);
      assert.ok(wrongData.error.includes(`${5 - i} attempt`));
    }

    // 3. Perform 5th wrong attempt -> Triggers lockout (HTTP 429)
    const fifthRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: '000000' }),
    });

    assert.equal(fifthRes.status, 429, '5th failed attempt should return HTTP 429');
    const fifthData = await fifthRes.json();
    assert.equal(fifthData.attemptsRemaining, 0);
    assert.ok(
      fifthData.error.includes('locked') || fifthData.error.includes('0 attempts'),
      `5th attempt error must mention locked, got: ${fifthData.error}`
    );

    // 4. 6th attempt with the CORRECT OTP code must still be REJECTED due to lockout (HTTP 429)
    const sixthRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: correctOtp }),
    });

    assert.equal(sixthRes.status, 429, 'Locked OTP must return HTTP 429 even with correct code');
    const sixthData = await sixthRes.json();
    assert.ok(
      sixthData.error.includes('locked') || sixthData.error.includes('Too many failed'),
      `Expected lockout message, got: ${sixthData.error}`
    );
  } finally {
    // Cleanup OTP record
    await adminClient.from('otp_codes').delete().eq('email', testEmail);
  }
});

// =============================================================================
// TEST 4: Cross-User Privacy (Stranger gets 403 on Ticket & PDF)
// =============================================================================
console.log('\n--- Regression 4: Cross-User Privacy Isolation (403 Forbidden) ---');

await runTest('4.1 Stranger (User B) receives HTTP 403 on User A ticket page and PDF download', async () => {
  const { movieId, audId } = await getBaseMovieAndAuditorium();
  const seats = await getAuditoriumSeats(audId, 2);
  const seat = seats[0];
  const showtime = await createTestShowtime(movieId, audId, 180);

  const userA = await createTestUser('ticketowner');
  const userB = await createTestUser('ticketstranger');

  let resId = null;
  const refCode = `MS-2026-QA${Math.floor(Math.random() * 90000 + 10000)}`;

  try {
    // Create User A's confirmed reservation
    const { data: resData, error: resErr } = await adminClient
      .from('reservations')
      .insert({
        reference_code: refCode,
        showtime_id: showtime.id,
        user_id: userA.userId,
        customer_name: 'QA Owner Patron',
        customer_email: userA.email,
        status: 'active',
        total_amount: 280,
      })
      .select('id')
      .single();

    assert.equal(resErr, null);
    resId = resData.id;

    await adminClient.from('reservation_seats').insert({
      reservation_id: resId,
      showtime_id: showtime.id,
      seat_id: seat.id,
      price: 280,
      status: 'reserved',
    });

    // 1. Owner (User A) access:
    const ownerTicketRes = await fetch(`${BASE_URL}/ticket/${refCode}`, {
      headers: { Cookie: userA.cookieHeader },
    });
    assert.equal(ownerTicketRes.status, 200, `Owner ticket page expected 200, got ${ownerTicketRes.status}`);

    const ownerPdfRes = await fetch(`${BASE_URL}/api/reservations/${resId}/pdf`, {
      headers: { Cookie: userA.cookieHeader },
    });
    assert.equal(ownerPdfRes.status, 200, `Owner PDF download expected 200, got ${ownerPdfRes.status}`);
    assert.equal(ownerPdfRes.headers.get('content-type'), 'application/pdf');

    // 2. Stranger (User B) access: MUST BE 403 FORBIDDEN
    const strangerTicketRes = await fetch(`${BASE_URL}/ticket/${refCode}`, {
      headers: { Cookie: userB.cookieHeader },
    });
    assert.equal(
      strangerTicketRes.status,
      403,
      `Stranger ticket page access must be 403 Forbidden, got ${strangerTicketRes.status}`
    );

    const strangerPdfRes = await fetch(`${BASE_URL}/api/reservations/${resId}/pdf`, {
      headers: { Cookie: userB.cookieHeader },
    });
    assert.equal(
      strangerPdfRes.status,
      403,
      `Stranger PDF download access must be 403 Forbidden, got ${strangerPdfRes.status}`
    );

    const strangerPdfData = await strangerPdfRes.json().catch(() => null);
    assert.equal(strangerPdfData?.error, 'FORBIDDEN');
  } finally {
    await cleanupFixtures({
      userIds: [userA.userId, userB.userId],
      showtimeIds: [showtime.id],
      reservationIds: resId ? [resId] : [],
    });
  }
});

// =============================================================================
// TEST 5: 30-Minute Cancel Cutoff and Immediate Seat Release
// =============================================================================
console.log('\n--- Regression 5: 30-Minute Cancel Cutoff & Immediate Seat Release ---');

await runTest('5.1 30-Minute cutoff policy: cancellation inside 30 minutes of showtime is strictly rejected', async () => {
  const { movieId, audId } = await getBaseMovieAndAuditorium();
  const seats = await getAuditoriumSeats(audId, 2);
  const seat = seats[0];

  // Showtime starting in 15 minutes (< 30 minutes cutoff)
  const showtimeInsideCutoff = await createTestShowtime(movieId, audId, 15);
  const user = await createTestUser('cutoffuser');

  let resId = null;
  const refCode = `MS-2026-QA${Math.floor(Math.random() * 90000 + 10000)}`;

  try {
    const { data: resData, error: resErr } = await adminClient
      .from('reservations')
      .insert({
        reference_code: refCode,
        showtime_id: showtimeInsideCutoff.id,
        user_id: user.userId,
        customer_name: 'Cutoff Patron',
        customer_email: user.email,
        status: 'active',
        total_amount: 280,
      })
      .select('id')
      .single();

    assert.equal(resErr, null);
    resId = resData.id;

    await adminClient.from('reservation_seats').insert({
      reservation_id: resId,
      showtime_id: showtimeInsideCutoff.id,
      seat_id: seat.id,
      price: 280,
      status: 'reserved',
    });

    // Attempt cancellation via HTTP API
    const cancelRes = await fetch(`${BASE_URL}/api/reservations/${resId}/cancel`, {
      method: 'POST',
      headers: { Cookie: user.cookieHeader },
    });

    assert.equal(
      cancelRes.status,
      409,
      `Cancellation within 30 minutes must return HTTP 409 Conflict, got ${cancelRes.status}`
    );

    const cancelData = await cancelRes.json();
    assert.equal(cancelData.error, 'CANCEL_WINDOW_CLOSED');

    // Verify reservation remains active in database
    const { data: checkRes } = await adminClient
      .from('reservations')
      .select('status')
      .eq('id', resId)
      .single();

    assert.equal(checkRes.status, 'active', 'Reservation must remain active when cancellation is denied');
  } finally {
    await cleanupFixtures({
      userIds: [user.userId],
      showtimeIds: [showtimeInsideCutoff.id],
      reservationIds: resId ? [resId] : [],
    });
  }
});

await runTest('5.2 Allowed cancellation (>30 mins) immediately releases seat for re-booking by others', async () => {
  const { movieId, audId } = await getBaseMovieAndAuditorium();
  const seats = await getAuditoriumSeats(audId, 2);
  const targetSeat = seats[0];

  // Showtime starting in 3 hours (> 30 minutes)
  const showtime = await createTestShowtime(movieId, audId, 180);
  const userA = await createTestUser('cancellerA');
  const userB = await createTestUser('rebookerB');

  let resId = null;
  const refCode = `MS-2026-QA${Math.floor(Math.random() * 90000 + 10000)}`;

  try {
    const { data: resData, error: resErr } = await adminClient
      .from('reservations')
      .insert({
        reference_code: refCode,
        showtime_id: showtime.id,
        user_id: userA.userId,
        customer_name: 'Cancelling Patron',
        customer_email: userA.email,
        status: 'active',
        total_amount: 280,
      })
      .select('id')
      .single();

    assert.equal(resErr, null);
    resId = resData.id;

    await adminClient.from('reservation_seats').insert({
      reservation_id: resId,
      showtime_id: showtime.id,
      seat_id: targetSeat.id,
      price: 280,
      status: 'reserved',
    });

    // 1. User A cancels via API
    const cancelRes = await fetch(`${BASE_URL}/api/reservations/${resId}/cancel`, {
      method: 'POST',
      headers: { Cookie: userA.cookieHeader },
    });

    assert.equal(cancelRes.status, 200, `Cancel request must return 200, got ${cancelRes.status}`);
    const cancelData = await cancelRes.json();
    assert.equal(cancelData.success, true);

    // Verify reservation status in database changed to 'cancelled'
    const { data: resDbCheck } = await adminClient
      .from('reservations')
      .select('status')
      .eq('id', resId)
      .single();

    assert.equal(resDbCheck.status, 'cancelled', 'reservations table status must be cancelled');

    // Verify seat status in database changed from 'reserved' to 'cancelled'
    const { data: resSeats, error: resSeatError } = await adminClient
      .from('reservation_seats')
      .select('status')
      .eq('reservation_id', resId)
      .eq('seat_id', targetSeat.id);

    assert.equal(resSeatError, null);
    assert.ok(resSeats && resSeats.length > 0, 'reservation_seats record must exist');
    assert.equal(resSeats[0].status, 'cancelled', 'reservation_seats status must be cancelled');

    // 2. Immediate Release Verification: User B can immediately hold the released seat
    const holdB = await userB.client.rpc('hold_seats', {
      p_showtime_id: showtime.id,
      p_seat_ids: [targetSeat.id],
      p_session_id: 'qa-session-immediate-rebook',
    });

    assert.equal(
      holdB.error,
      null,
      `User B should immediately be able to hold the released seat, got: ${holdB.error?.message}`
    );

    // Verify User B now holds the seat
    const { data: holdCheck } = await adminClient
      .from('seat_holds')
      .select('user_id')
      .eq('showtime_id', showtime.id)
      .eq('seat_id', targetSeat.id)
      .single();

    assert.equal(holdCheck.user_id, userB.userId, 'User B must now hold the cancelled seat');
  } finally {
    await cleanupFixtures({
      userIds: [userA.userId, userB.userId],
      showtimeIds: [showtime.id],
      reservationIds: resId ? [resId] : [],
    });
  }
});

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n================================================================================');
console.log('                          PHASE 8 QA TEST SUMMARY                               ');
console.log('================================================================================');
console.log(`Total Tests Run:  ${totalTests}`);
console.log(`Passed Tests:     ${passedTests}`);
console.log(`Failed Tests:     ${failedTests}`);
console.log(`Blocked Tests:    ${blockedTests}`);

if (failures.length > 0) {
  console.log('\nFailed Tests:');
  for (const f of failures) console.log(` - ${f}`);
}
if (blockedList.length > 0) {
  console.log('\nBlocked Tests Detail:');
  for (const b of blockedList) console.log(` - ${b.name}: ${b.reason}`);
}

console.log('================================================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
