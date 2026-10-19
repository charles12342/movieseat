-- =============================================================================
-- MovieSeat Phase 7 Migration: Hardened cancel_reservation Function
-- Advisory transaction lock, race-condition protection, and 30-minute cutoff policy
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancel_reservation(
    p_reservation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_reservation RECORD;
    v_showtime RECORD;
    v_minutes_until_showtime NUMERIC;
BEGIN
    -- 1. Enforce authentication
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Authentication required to cancel a reservation.';
    END IF;

    -- 2. Advisory lock to serialize concurrent cancellation requests on the same reservation
    PERFORM pg_advisory_xact_lock(hashtext('cancel:' || p_reservation_id::text));

    -- 3. Fetch and lock reservation row
    SELECT * INTO v_reservation 
    FROM public.reservations 
    WHERE id = p_reservation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Reservation does not exist.';
    END IF;

    -- 4. Enforce strict user ownership
    IF v_reservation.user_id != v_user_id THEN
        RAISE EXCEPTION 'FORBIDDEN: You do not have permission to cancel this reservation.';
    END IF;

    -- 5. Guard against duplicate cancellations
    IF v_reservation.status = 'cancelled' THEN
        RAISE EXCEPTION 'ALREADY_CANCELLED: This reservation has already been cancelled.';
    END IF;

    -- 6. Fetch showtime to enforce the 30-minute policy cutoff
    SELECT * INTO v_showtime 
    FROM public.showtimes 
    WHERE id = v_reservation.showtime_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Showtime record not found.';
    END IF;

    -- 30-Minute Policy Check: (start_time - NOW()) in minutes
    v_minutes_until_showtime := EXTRACT(EPOCH FROM (v_showtime.start_time - NOW())) / 60;
    IF v_minutes_until_showtime < 30 THEN
        RAISE EXCEPTION 'CANCEL_WINDOW_CLOSED: Cancellations are prohibited within 30 minutes of showtime.';
    END IF;

    -- 7. Update reservation status to cancelled
    UPDATE public.reservations 
    SET status = 'cancelled',
        cancelled_at = NOW() 
    WHERE id = p_reservation_id;

    -- 8. Free seats immediately by marking status 'cancelled'
    -- The partial unique index (unique_active_reservation_seat) immediately frees the seats for other patrons.
    UPDATE public.reservation_seats 
    SET status = 'cancelled' 
    WHERE reservation_id = p_reservation_id;

    RETURN jsonb_build_object(
        'success', true,
        'reservation_id', p_reservation_id,
        'message', 'Reservation cancelled successfully and seats released.'
    );
END;
$$;

-- Security grants: Authenticated only
REVOKE ALL ON FUNCTION public.cancel_reservation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_reservation(UUID) TO authenticated;
