-- ==============================================================================
-- Phase 4 migration: hardened hold_seats / release_holds
-- Run AFTER schema.sql (it only replaces two functions and sets their grants).
-- Safe to re-run: CREATE OR REPLACE + idempotent GRANT/REVOKE.
--
-- What changes versus schema.sql:
--   * SET search_path on both SECURITY DEFINER functions (no search_path hijack)
--   * hold_seats rejects showtimes that already started (SHOWTIME_STARTED)
--   * hold_seats rejects seats that do not belong to the showtime's auditorium
--   * hold_seats de-duplicates the seat list, then enforces the 6-seat cap
--   * hold_seats serialises per showtime with an advisory lock, so two people
--     clicking the same seat at the same instant get a clean SEAT_HELD for the
--     loser instead of a raw unique-constraint error
--   * a user only ever has ONE active selection: calling hold_seats replaces
--     all of that user's holds (on every showtime), so nobody can lock seats
--     across many screenings
--   * execute rights: authenticated only (guests are rejected twice: by the
--     grant and by the auth.uid() check inside the function)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.hold_seats(
    p_showtime_id UUID,
    p_seat_ids UUID[],
    p_session_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_showtime RECORD;
    v_unique_ids UUID[];
    v_seat_count INTEGER;
    v_valid_count INTEGER;
    v_expires_at TIMESTAMPTZ;
BEGIN
    -- Identity comes from the JWT only, never from a parameter.
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: You must be logged in to hold seats.';
    END IF;

    SELECT * INTO v_showtime FROM public.showtimes WHERE id = p_showtime_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_SHOWTIME: Showtime not found.';
    END IF;

    IF v_showtime.start_time <= NOW() THEN
        RAISE EXCEPTION 'SHOWTIME_STARTED: This screening has already started.';
    END IF;

    -- De-duplicate, drop NULLs, then enforce the 6-seat cap.
    SELECT COALESCE(array_agg(DISTINCT s), '{}'::UUID[])
      INTO v_unique_ids
      FROM unnest(p_seat_ids) AS s
     WHERE s IS NOT NULL;

    v_seat_count := COALESCE(array_length(v_unique_ids, 1), 0);
    IF v_seat_count < 1 THEN
        RAISE EXCEPTION 'INVALID_SELECTION: At least one seat must be selected.';
    END IF;
    IF v_seat_count > 6 THEN
        RAISE EXCEPTION 'SEAT_CAP_EXCEEDED: Maximum 6 seats allowed per reservation.';
    END IF;

    -- Every seat must physically exist in THIS showtime's auditorium.
    SELECT COUNT(*) INTO v_valid_count
      FROM public.seats
     WHERE id = ANY (v_unique_ids)
       AND auditorium_id = v_showtime.auditorium_id;
    IF v_valid_count <> v_seat_count THEN
        RAISE EXCEPTION 'INVALID_SEAT: One or more seats do not belong to this screening.';
    END IF;

    -- Serialise hold attempts per showtime (released automatically at commit).
    PERFORM pg_advisory_xact_lock(hashtext('hold_seats:' || p_showtime_id::TEXT));

    -- Sweep expired holds on the requested seats (expiry sends no event).
    DELETE FROM public.seat_holds
     WHERE showtime_id = p_showtime_id
       AND seat_id = ANY (v_unique_ids)
       AND expires_at <= NOW();

    -- Sold seats can never be held.
    IF EXISTS (
        SELECT 1 FROM public.reservation_seats
         WHERE showtime_id = p_showtime_id
           AND seat_id = ANY (v_unique_ids)
           AND status = 'reserved'
    ) THEN
        RAISE EXCEPTION 'SEAT_TAKEN: One or more selected seats have already been reserved.';
    END IF;

    -- Seats actively held by someone else.
    IF EXISTS (
        SELECT 1 FROM public.seat_holds
         WHERE showtime_id = p_showtime_id
           AND seat_id = ANY (v_unique_ids)
           AND user_id <> v_user_id
           AND expires_at > NOW()
    ) THEN
        RAISE EXCEPTION 'SEAT_HELD: One or more selected seats are currently held by another customer.';
    END IF;

    -- One active selection per user: replace ALL of this user's holds.
    -- If anything below raises, this DELETE rolls back with it, so a failed
    -- attempt never throws away the user's previous (still valid) holds.
    DELETE FROM public.seat_holds WHERE user_id = v_user_id;

    v_expires_at := NOW() + INTERVAL '5 minutes';

    BEGIN
        INSERT INTO public.seat_holds (showtime_id, seat_id, user_id, session_id, expires_at)
        SELECT p_showtime_id, s, v_user_id, left(COALESCE(p_session_id, 'unknown'), 64), v_expires_at
          FROM unnest(v_unique_ids) AS s;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'SEAT_HELD: One or more selected seats are currently held by another customer.';
    END;

    RETURN jsonb_build_object(
        'success', true,
        'expires_at', v_expires_at,
        'held_count', v_seat_count,
        'seat_ids', to_jsonb(v_unique_ids)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_holds(
    p_showtime_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_deleted_count INTEGER;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: You must be logged in to release seats.';
    END IF;

    DELETE FROM public.seat_holds
     WHERE showtime_id = p_showtime_id AND user_id = v_user_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object('success', true, 'released_count', v_deleted_count);
END;
$$;

-- Execute rights: signed-in users only.
REVOKE ALL ON FUNCTION public.hold_seats(UUID, UUID[], TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_holds(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hold_seats(UUID, UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_holds(UUID) TO authenticated;
