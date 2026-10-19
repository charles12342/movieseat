import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_CODE_RE = /^MS-\d{4}-[A-Z0-9]{6}$/i;

/**
 * POST /api/reservations/[id]/cancel
 *
 * Strict Security Rules:
 * 1. Takes user identity strictly from session (never request body).
 * 2. Only the owner can cancel (different user receives 403 Forbidden).
 * 3. 30-minute cutoff policy enforced at server and database level (CANCEL_WINDOW_CLOSED).
 * 4. Concurrent duplicate cancellations are serialized by advisory lock.
 * 5. Cancelling immediately frees seats for other patrons while keeping reservation history.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || (!UUID_RE.test(id) && !REF_CODE_RE.test(id))) {
    return NextResponse.json(
      { error: 'INVALID_ID', message: 'A valid reservation UUID or reference code is required.' },
      { status: 400 }
    );
  }

  // 1. Enforce session authentication
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'AUTH_REQUIRED', message: 'Please sign in to manage reservations.' },
      { status: 401 }
    );
  }

  // 2. Resolve reservation UUID if a reference code was provided
  let reservationId = id;
  if (REF_CODE_RE.test(id)) {
    const adminClient = createAdminClient();
    const { data: rawLookup } = await adminClient
      .from('reservations')
      .select('id, user_id')
      .eq('reference_code', id.toUpperCase())
      .maybeSingle();

    const refLookup = rawLookup as { id: string; user_id: string } | null;

    if (!refLookup) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Reservation not found.' },
        { status: 404 }
      );
    }

    if (refLookup.user_id !== user.id) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'You do not have permission to cancel this reservation.' },
        { status: 403 }
      );
    }

    reservationId = refLookup.id;
  }

  // 3. Call cancel_reservation RPC on the authenticated user client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcError } = await (supabase as any).rpc('cancel_reservation', {
    p_reservation_id: reservationId,
  });

  if (rpcError) {
    const msg = String(rpcError.message || '');

    if (msg.includes('CANCEL_WINDOW_CLOSED')) {
      return NextResponse.json(
        {
          error: 'CANCEL_WINDOW_CLOSED',
          message: 'Cancellations are strictly prohibited within 30 minutes of showtime.',
        },
        { status: 409 }
      );
    }

    if (msg.includes('ALREADY_CANCELLED')) {
      return NextResponse.json(
        {
          error: 'ALREADY_CANCELLED',
          message: 'This reservation has already been cancelled.',
        },
        { status: 409 }
      );
    }

    if (msg.includes('FORBIDDEN')) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'You do not have permission to cancel this reservation.',
        },
        { status: 403 }
      );
    }

    if (msg.includes('NOT_FOUND')) {
      return NextResponse.json(
        {
          error: 'NOT_FOUND',
          message: 'Reservation not found.',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: 'CANCEL_FAILED',
        message: msg || 'Failed to cancel reservation.',
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      reservationId,
      message: data?.message || 'Reservation cancelled successfully and seats released.',
    },
    { status: 200 }
  );
}
