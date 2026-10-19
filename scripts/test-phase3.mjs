#!/usr/bin/env node

/**
 * ==============================================================================
 * MovieSeat Phase 3 Automated Test Suite
 * Tests:
 * 1. Asia/Manila Timezone & Showtime Past Validation (lib/time.ts)
 * 2. TMDB API Integration & Fallback Poster Resilience (lib/tmdb.ts)
 * 3. Phase 3 Components & Architecture Contract Verification
 * 4. Local Server Routes (/ and /api/showtimes/seats-open)
 * 5. Supabase Database State & Seed Verification
 * ==============================================================================
 */

// Auto-respawn with Node 22 native type-stripping if invoked directly without flags
if (!process.env.__MOVIESEAT_RUNNER) {
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', ...process.argv.slice(1)],
    {
      stdio: 'inherit',
      env: { ...process.env, __MOVIESEAT_RUNNER: '1' },
    }
  );
  process.exit(res.status ?? 0);
}

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

console.log('================================================================================');
console.log('         MOVIESEAT TEST SUITE: PHASE 3 (CATALOG & AUTO-RESEED)                 ');
console.log('================================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

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
  }
}

// -----------------------------------------------------------------------------
// Load environment variables from .env.local
// -----------------------------------------------------------------------------
const envPath = path.resolve('.env.local');
const env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  }
}

// =============================================================================
// Section 1: Asia/Manila Timezone & Time Helpers (lib/time.ts)
// =============================================================================
console.log('\n--- Section 1: Asia/Manila Timezone & Time Helpers ---');

await runTest('formatManilaClock formats time with AM/PM in Asia/Manila', async () => {
  const { formatManilaClock, CINEMA_TIMEZONE } = await import('../lib/time.ts');
  assert.equal(CINEMA_TIMEZONE, 'Asia/Manila');

  const testDate = new Date('2026-10-19T05:35:00.000Z'); // 1:35 PM in Manila (+8)
  const clock = formatManilaClock(testDate);
  assert.match(clock, /1:35\s*PM/i, 'Should format to 1:35 PM in Asia/Manila');
});

await runTest('getManilaDateString returns YYYY-MM-DD for Asia/Manila', async () => {
  const { getManilaDateString } = await import('../lib/time.ts');
  const d = new Date('2026-10-19T02:00:00.000Z'); // 10:00 AM Oct 19 Manila
  const dateStr = getManilaDateString(d);
  assert.equal(dateStr, '2026-10-19');
});

await runTest('isShowtimePast correctly detects past vs future screenings', async () => {
  const { isShowtimePast } = await import('../lib/time.ts');
  const pastTime = new Date(Date.now() - 60000).toISOString();
  const futureTime = new Date(Date.now() + 3600000).toISOString();

  assert.equal(isShowtimePast(pastTime), true, 'Past time must return true');
  assert.equal(isShowtimePast(futureTime), false, 'Future time must return false');
});

// =============================================================================
// Section 2: TMDB Server Integration & Fallback Poster (lib/tmdb.ts)
// =============================================================================
console.log('\n--- Section 2: TMDB Integration & Fallback Posters ---');

await runTest('Fallback poster SVG exists in public directory', async () => {
  const svgPath = path.resolve('public/fallback-poster.svg');
  assert.ok(fs.existsSync(svgPath), 'public/fallback-poster.svg must exist');
  const content = fs.readFileSync(svgPath, 'utf8');
  assert.ok(content.includes('<svg'), 'Fallback file must contain valid SVG');
});

await runTest('TMDB API successfully retrieves movie details for Dune 2', async () => {
  process.env.TMDB_API_KEY = env.TMDB_API_KEY;
  const { getTmdbMovieDetails } = await import('../lib/tmdb.ts');

  const details = await getTmdbMovieDetails(693134); // Dune: Part Two TMDB ID
  assert.ok(details, 'Details should be returned');
  assert.ok(details.posterUrl.includes('image.tmdb.org'), 'Poster URL should point to TMDB image CDN');
  assert.ok(details.posterUrl.endsWith('.jpg'), 'Poster URL should be a valid image path');
});

await runTest('TMDB fetch does not crash on invalid TMDB ID and returns fallback', async () => {
  const { getTmdbMovieDetails, FALLBACK_POSTER_URL } = await import('../lib/tmdb.ts');

  const details = await getTmdbMovieDetails(999999999, {
    title: 'Unknown Film',
    runtime: 120,
  });

  assert.ok(details, 'Should return fallback object without throwing');
  assert.equal(details.posterUrl, FALLBACK_POSTER_URL, 'Should fall back to FALLBACK_POSTER_URL');
});

// =============================================================================
// Section 3: Phase 3 Components & Architecture Contract
// =============================================================================
console.log('\n--- Section 3: Phase 3 Components & Architecture Verification ---');

await runTest('components/catalog/MovieCard.tsx exists with required elements', async () => {
  const file = path.resolve('components/catalog/MovieCard.tsx');
  assert.ok(fs.existsSync(file), 'MovieCard.tsx must exist');
  const code = fs.readFileSync(file, 'utf8');
  assert.ok(code.includes('Select Screening'), 'Must contain Select Screening button');
  assert.ok(code.includes('/screenings/'), 'Must link to /screenings/[showtimeId]');
  assert.ok(code.includes('Seats Open'), 'Must display live seats-open count');
  assert.ok(code.includes('ShowtimePills'), 'Must render ShowtimePills');
  assert.ok(code.includes('fallback-poster'), 'Must handle fallback poster');
});

await runTest('components/catalog/ShowtimePills.tsx exists and dims past showtimes', async () => {
  const file = path.resolve('components/catalog/ShowtimePills.tsx');
  assert.ok(fs.existsSync(file), 'ShowtimePills.tsx must exist');
  const code = fs.readFileSync(file, 'utf8');
  assert.ok(code.includes('isShowtimePast'), 'Must use isShowtimePast');
  assert.ok(code.includes('disabled'), 'Must disable past showtimes');
  assert.ok(code.includes('opacity'), 'Must dim past showtimes');
});

await runTest('components/catalog/AuditoriumFilter.tsx exists with 3 cinema halls', async () => {
  const file = path.resolve('components/catalog/AuditoriumFilter.tsx');
  assert.ok(fs.existsSync(file), 'AuditoriumFilter.tsx must exist');
  const code = fs.readFileSync(file, 'utf8');
  assert.ok(code.includes('All Auditoriums'), 'Must support All Auditoriums');
  assert.ok(code.includes('bg-blue-400') || code.includes('blue'), 'Must include Cinema 1 Dolby Atmos indicator');
  assert.ok(code.includes('bg-amber-400') || code.includes('amber'), 'Must include Cinema 2 IMAX indicator');
  assert.ok(code.includes('bg-emerald-400') || code.includes('emerald'), 'Must include Cinema 3 Standard indicator');
});

await runTest('components/catalog/CatalogView.tsx subscribes to Supabase Realtime', async () => {
  const file = path.resolve('components/catalog/CatalogView.tsx');
  assert.ok(fs.existsSync(file), 'CatalogView.tsx must exist');
  const code = fs.readFileSync(file, 'utf8');
  assert.ok(code.includes('seat_holds'), 'Must subscribe to seat_holds Realtime');
  assert.ok(code.includes('reservation_seats'), 'Must subscribe to reservation_seats Realtime');
  assert.ok(code.includes('/api/showtimes/seats-open'), 'Must refresh live seat counts');
});

await runTest('app/page.tsx opts into dynamic rendering via connection()', async () => {
  const file = path.resolve('app/page.tsx');
  assert.ok(fs.existsSync(file), 'app/page.tsx must exist');
  const code = fs.readFileSync(file, 'utf8');
  assert.ok(code.includes("import { connection } from 'next/server'"), 'Must import connection()');
  assert.ok(code.includes('await connection()'), 'Must call await connection()');
  assert.ok(!code.includes("export const dynamic = 'force-dynamic'"), 'Must NOT use deprecated dynamic segment config');
  assert.ok(code.includes('reseed_today'), 'Must implement auto-reseed call');
});

await runTest('app/api/showtimes/seats-open/route.ts route handler exists', async () => {
  const file = path.resolve('app/api/showtimes/seats-open/route.ts');
  assert.ok(fs.existsSync(file), 'API route must exist');
  const code = fs.readFileSync(file, 'utf8');
  assert.ok(code.includes('export async function GET'), 'Must export GET handler');
  assert.ok(code.includes('seatsOpenMap'), 'Must return seatsOpenMap');
});

// =============================================================================
// Section 4: Live Server Endpoints
// =============================================================================
console.log('\n--- Section 4: Local Server HTTP Verification ---');

await runTest('GET http://localhost:3000/ returns HTTP 200 with catalog UI', async () => {
  const res = await fetch('http://localhost:3000/');
  assert.equal(res.status, 200, 'Home page must return 200 OK');
  const html = await res.text();
  assert.ok(html.includes('Now Showing'), 'HTML must include Now Showing header');
  assert.ok(html.includes('Auditorium'), 'HTML must include Auditorium filter bar');
});

await runTest('GET http://localhost:3000/api/showtimes/seats-open returns HTTP 200 JSON', async () => {
  const res = await fetch('http://localhost:3000/api/showtimes/seats-open');
  assert.equal(res.status, 200, 'API endpoint must return 200 OK');
  const json = await res.json();
  assert.ok(json && typeof json.seatsOpenMap === 'object', 'Response must contain seatsOpenMap object');
});

// =============================================================================
// Section 5: Supabase Database State & Seed Verification
// =============================================================================
console.log('\n--- Section 5: Supabase Schema & Seed Verification ---');

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
);

await runTest('Supabase movies table applied and contains data', async () => {
  const { data, error } = await supabase.from('movies').select('id, title, tmdb_id');
  if (error) {
    throw new Error(`movies table not found or query error: ${error.message}`);
  }
  assert.ok(data && data.length > 0, `movies table is empty (count=${data?.length})`);
});

await runTest('Supabase auditoriums table applied and contains 3 auditoriums', async () => {
  const { data, error } = await supabase.from('auditoriums').select('id, name');
  if (error) {
    throw new Error(`auditoriums table not found: ${error.message}`);
  }
  assert.ok(data && data.length >= 3, `Expected at least 3 auditoriums, found ${data?.length}`);
});

await runTest('Supabase showtime_templates table applied and contains templates', async () => {
  const { data, error } = await supabase.from('showtime_templates').select('id');
  if (error) {
    throw new Error(`showtime_templates table not found: ${error.message}`);
  }
  assert.ok(data && data.length > 0, `showtime_templates is empty (count=${data?.length})`);
});

await runTest("Supabase today's showtimes exist in showtimes table", async () => {
  const { getManilaDateString } = await import('../lib/time.ts');
  const todayManila = getManilaDateString(new Date());
  const startOfDay = `${todayManila}T00:00:00+08:00`;
  const endOfDay = `${todayManila}T23:59:59.999+08:00`;

  const { data, error } = await supabase
    .from('showtimes')
    .select('id, start_time')
    .gte('start_time', startOfDay)
    .lte('start_time', endOfDay);

  if (error) {
    throw new Error(`showtimes query error: ${error.message}`);
  }
  assert.ok(data && data.length > 0, `No showtimes found for today (${todayManila})`);
});

await runTest('Supabase reseed_today() RPC function exists and is executable', async () => {
  const { error } = await supabase.rpc('reseed_today');
  if (error) {
    throw new Error(`reseed_today() RPC failed: ${error.message}`);
  }
});

// =============================================================================
// Summary Report
// =============================================================================
console.log('\n================================================================================');
console.log('                          PHASE 3 TEST SUMMARY                                  ');
console.log('================================================================================');
console.log(`Total Tests  : ${totalTests}`);
console.log(`Passed Tests : ${passedTests}`);
console.log(`Failed Tests : ${failedTests}`);
console.log(`Success Rate : ${Math.round((passedTests / totalTests) * 100)}%`);
console.log('================================================================================\n');

process.exit(failedTests > 0 ? 1 : 0);
