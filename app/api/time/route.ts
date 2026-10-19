import { NextResponse } from 'next/server';
import { CINEMA_TIMEZONE } from '@/lib/time';

export async function GET() {
  const now = new Date();

  return NextResponse.json({
    serverTimeIso: now.toISOString(),
    serverTimeMs: now.getTime(),
    timezone: CINEMA_TIMEZONE,
  });
}