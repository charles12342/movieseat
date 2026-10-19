-- =============================================================================
-- MovieSeat Phase 5 Migration: Hardened confirm_reservation Function
-- Idempotent double-click replay, SEAT_TAKEN exception handling, and transaction safety
-- =============================================================================

CREATE OR REPLACE FUNCTION public.confirm_reservation(
    p_showtime_id UUID,
    p_customer_name TEXT,
    p_customer_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_reference_code TEXT;
    v_reservation_id UUID;
    v_showtime RECORD;
    v_existing RECORD;
    v_total_amount NUMERIC(10,2) := 0.00;
    v_seat_price NUMERIC(10,2);
    v_clean_name TEXT;
    v_clean_email TEXT;
    v_held_count INTEGER := 0;
    v_seats_json JSONB := '[]'::jsonb;
    v_seat_record RECORD;
BEGIN
    -- 1. Enforce authentication
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: User must be authenticated to confirm a reservation.';
    END IF;

    -- 2. Validate input parameters
    v_clean_name := BTRIM(p_customer_name);
    v_clean_email := LOWER(BTRIM(p_customer_email));

    IF v_clean_name IS NULL OR LENGTH(v_clean_name) < 2 OR LENGTH(v_clean_name) > 100 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Full name must be between 2 and 100 characters.';
    END IF;

    IF v_clean_email IS NULL OR v_clean_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' OR LENGTH(v_clean_email) > 254 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: A valid email address is required for ticket delivery.';
    END IF;

    -- 3. Take advisory transaction lock scoped to (user, showtime) to serialize concurrent confirms
    PERFORM pg_advisory_xact_lock(hashtext('confirm:' || v_user_id::text || ':' || p_showtime_id::text));

    -- 4. Verify showtime exists and has not started
    SELECT * INTO v_showtime FROM public.showtimes WHERE id = p_showtime_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_SHOWTIME: Showtime not found.';
    END IF;

    IF v_showtime.start_time <= NOW() THEN
        RAISE EXCEPTION 'SHOWTIME_STARTED: Cannot book seats for a past or running screening.';
    END IF;

    -- 5. Lock and collect active holds owned by this user for this showtime
    CREATE TEMP TABLE IF NOT EXISTS _my_active_holds (
        seat_id UUID PRIMARY KEY,
        row TEXT,
        number INTEGER,
        seat_type TEXT
    ) ON COMMIT DROP;
    TRUNCATE TABLE _my_active_holds;

    INSERT INTO _my_active_holds (seat_id, row, number, seat_type)
    SELECT h.seat_id, s.row, s.number, s.seat_type
    FROM public.seat_holds h
    JOIN public.seats s ON h.seat_id = s.id
    WHERE h.showtime_id = p_showtime_id
      AND h.user_id = v_user_id
      AND h.expires_at > NOW()
    FOR UPDATE OF h;

    SELECT COUNT(*) INTO v_held_count FROM _my_active_holds;

    -- 6. Double-click & retry protection:
    -- If no active holds exist, check if an active reservation was just created by this user
    -- within the last 2 minutes for this showtime (e.g. from an immediate duplicate click or network retry).
    IF v_held_count = 0 THEN
        SELECT r.id, r.reference_code, r.total_amount
        INTO v_existing
        FROM public.reservations r
        WHERE r.user_id = v_user_id
          AND r.showtime_id = p_showtime_id
          AND r.status = 'active'
          AND r.created_at >= (NOW() - INTERVAL '2 minutes')
        ORDER BY r.created_at DESC
        LIMIT 1;

        IF FOUND THEN
            -- Retrieve seat details for the existing reservation
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'seat_id', rs.seat_id,
                        'row', s.row,
                        'number', s.number,
                        'seat_type', s.seat_type,
                        'price', rs.price
                    ) ORDER BY s.row, s.number
                ),
                '[]'::jsonb
            )
            INTO v_seats_json
            FROM public.reservation_seats rs
            JOIN public.seats s ON rs.seat_id = s.id
            WHERE rs.reservation_id = v_existing.id;

            RETURN jsonb_build_object(
                'success', true,
                'replayed', true,
                'reservation_id', v_existing.id,
                'reference_code', v_existing.reference_code,
                'total_amount', v_existing.total_amount,
                'seats', v_seats_json
            );
        END IF;

        RAISE EXCEPTION 'HOLD_EXPIRED: Your seat hold has expired or was not found.';
    END IF;

    -- 7. Enforce maximum 6 seats limit
    IF v_held_count > 6 THEN
        RAISE EXCEPTION 'SEAT_CAP_EXCEEDED: Cannot reserve more than 6 seats per transaction.';
    END IF;

    -- 8. Pre-check: Are any of these held seats already booked by someone else?
    IF EXISTS (
        SELECT 1
        FROM public.reservation_seats rs
        JOIN _my_active_holds ah ON rs.seat_id = ah.seat_id
        WHERE rs.showtime_id = p_showtime_id
          AND rs.status = 'reserved'
    ) THEN
        RAISE EXCEPTION 'SEAT_TAKEN: One or more of your selected seats have already been booked by another patron.';
    END IF;

    -- 9. Compute server total amount
    SELECT SUM(
        CASE WHEN ah.seat_type = 'vip' THEN v_showtime.price_vip
             ELSE v_showtime.price_standard
        END
    ) INTO v_total_amount
    FROM _my_active_holds ah;

    -- 10. Generate reservation reference code (MS-YYYY-XXXXXX)
    v_reference_code := public.generate_reservation_reference();

    -- 11. Create permanent reservation record
    INSERT INTO public.reservations (
        reference_code,
        showtime_id,
        user_id,
        customer_name,
        customer_email,
        status,
        total_amount
    ) VALUES (
        v_reference_code,
        p_showtime_id,
        v_user_id,
        v_clean_name,
        v_clean_email,
        'active',
        v_total_amount
    ) RETURNING id INTO v_reservation_id;

    -- 12. Allocate reservation_seats with exception handling for partial unique index
    BEGIN
        FOR v_seat_record IN SELECT * FROM _my_active_holds ORDER BY row, number LOOP
            IF v_seat_record.seat_type = 'vip' THEN
                v_seat_price := v_showtime.price_vip;
            ELSE
                v_seat_price := v_showtime.price_standard;
            END IF;

            INSERT INTO public.reservation_seats (
                reservation_id,
                showtime_id,
                seat_id,
                price,
                status
            ) VALUES (
                v_reservation_id,
                p_showtime_id,
                v_seat_record.seat_id,
                v_seat_price,
                'reserved'
            );
        END LOOP;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'SEAT_TAKEN: One or more of your selected seats have already been booked by another patron.';
    END;

    -- 13. Release user's holds for this showtime
    DELETE FROM public.seat_holds
    WHERE showtime_id = p_showtime_id AND user_id = v_user_id;

    -- 14. Build seats array for the response
    SELECT jsonb_agg(
        jsonb_build_object(
            'seat_id', ah.seat_id,
            'row', ah.row,
            'number', ah.number,
            'seat_type', ah.seat_type,
            'price', CASE WHEN ah.seat_type = 'vip' THEN v_showtime.price_vip ELSE v_showtime.price_standard END
        ) ORDER BY ah.row, ah.number
    )
    INTO v_seats_json
    FROM _my_active_holds ah;

    RETURN jsonb_build_object(
        'success', true,
        'replayed', false,
        'reservation_id', v_reservation_id,
        'reference_code', v_reference_code,
        'total_amount', v_total_amount,
        'seats', v_seats_json
    );
END;
$$;

-- Security: authenticated users only
REVOKE ALL ON FUNCTION public.confirm_reservation(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_reservation(UUID, TEXT, TEXT) TO authenticated;
