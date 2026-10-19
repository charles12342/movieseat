import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getManilaDateString } from '@/lib/time';

/**
 * Route handler to fetch live seat availability counts for today's showtimes.
 * Used by the catalog client component upon receiving Supabase Realtime change notifications.
 */
export async function GET() {
  try {
    const supabase = await createClient();

    const todayManila = getManilaDateString(new Date());
    const startOfDay = `${todayManila}T00:00:00+08:00`;
    const endOfDay = `${todayManila}T23:59:59.999+08:00`;

    // 1. Fetch today's showtimes with their auditoriums
    const { data: rawShowtimes, error: stErr } = await supabase
      .from('showtimes')
      .select(`
        id,
        auditorium_id,
        auditoriums (
          total_seats
        )
      `)
      .gte('start_time', startOfDay)
      .lte('start_time', endOfDay);

    if (stErr || !rawShowtimes) {
      return NextResponse.json({ seatsOpenMap: {} }, { status: 200 });
    }

    const showtimes = rawShowtimes as Array<{
      id: string;
      auditorium_id: string;
      auditoriums: { total_seats: number } | Array<{ total_seats: number }> | null;
    }>;

    const showtimeIds = showtimes.map((st) => st.id);
    if (showtimeIds.length === 0) {
      return NextResponse.json({ seatsOpenMap: {} }, { status: 200 });
    }

    // 2. Fetch active holds and reserved seats
    const nowIso = new Date().toISOString();
    const [holdsRes, reservedRes] = await Promise.all([
      supabase
        .from('seat_holds')
        .select('showtime_id')
        .in('showtime_id', showtimeIds)
        .gt('expires_at', nowIso),
      supabase
        .from('reservation_seats')
        .select('showtime_id')
        .in('showtime_id', showtimeIds)
        .eq('status', 'reserved'),
    ]);

    // Count occupied per showtime
    const occupiedMap: Record<string, number> = {};
    for (const id of showtimeIds) {
      occupiedMap[id] = 0;
    }

    if (holdsRes.data) {
      for (const h of holdsRes.data as Array<{ showtime_id: string }>) {
        if (occupiedMap[h.showtime_id] !== undefined) {
          occupiedMap[h.showtime_id]++;
        }
      }
    }

    if (reservedRes.data) {
      for (const r of reservedRes.data as Array<{ showtime_id: string }>) {
        if (occupiedMap[r.showtime_id] !== undefined) {
          occupiedMap[r.showtime_id]++;
        }
      }
    }

    // Calculate open seats
    const seatsOpenMap: Record<string, number> = {};
    for (const st of showtimes) {
      const aud = Array.isArray(st.auditoriums) ? st.auditoriums[0] : st.auditoriums;
      const total = aud?.total_seats || 88;
      const occupied = occupiedMap[st.id] || 0;
      seatsOpenMap[st.id] = Math.max(0, total - occupied);
    }

    return NextResponse.json({ seatsOpenMap }, { status: 200 });
  } catch (err) {
    console.warn('[API /api/showtimes/seats-open] Error calculating seat availability:', err);
    return NextResponse.json({ seatsOpenMap: {} }, { status: 200 });
  }
}
