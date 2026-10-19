-- ==============================================================================
-- MovieSeat Database Schema
-- Cinema City Hall Single-Cinema Web Application
-- Core Stack: Supabase Postgres (RLS + Security Invoker + Security Definer RPCs)
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Clean existing schema if re-running
DROP VIEW IF EXISTS public.my_reservations CASCADE;
DROP TABLE IF EXISTS public.reservation_seats CASCADE;
DROP TABLE IF EXISTS public.reservations CASCADE;
DROP TABLE IF EXISTS public.seat_holds CASCADE;
DROP TABLE IF EXISTS public.showtime_templates CASCADE;
DROP TABLE IF EXISTS public.showtimes CASCADE;
DROP TABLE IF EXISTS public.seats CASCADE;
DROP TABLE IF EXISTS public.auditoriums CASCADE;
DROP TABLE IF EXISTS public.movies CASCADE;
DROP TABLE IF EXISTS public.otp_codes CASCADE;

-- -----------------------------------------------------------------------------
-- 1. Movies Catalog
-- -----------------------------------------------------------------------------
CREATE TABLE public.movies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tmdb_id INTEGER UNIQUE,
    title TEXT NOT NULL,
    overview TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    runtime INTEGER NOT NULL, -- minutes
    genres TEXT[] DEFAULT '{}',
    rating TEXT DEFAULT 'PG-13',
    format_badges TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. Auditoriums (Halls)
-- -----------------------------------------------------------------------------
CREATE TABLE public.auditoriums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    screen_type TEXT NOT NULL, -- 'Dolby Atmos', 'IMAX Laser', 'Standard'
    sound_system TEXT NOT NULL, -- 'Surround 7.1', '12-Channel IMAX Sound', 'Surround 5.1'
    total_seats INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. Seats (Physical Layout)
-- -----------------------------------------------------------------------------
CREATE TABLE public.seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auditorium_id UUID NOT NULL REFERENCES public.auditoriums(id) ON DELETE CASCADE,
    row TEXT NOT NULL,
    number INTEGER NOT NULL,
    seat_type TEXT NOT NULL DEFAULT 'standard', -- 'standard', 'vip'
    is_wheelchair BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_seat_position UNIQUE (auditorium_id, row, number)
);

-- -----------------------------------------------------------------------------
-- 4. Showtimes
-- -----------------------------------------------------------------------------
CREATE TABLE public.showtimes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
    auditorium_id UUID NOT NULL REFERENCES public.auditoriums(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    price_standard NUMERIC(10, 2) NOT NULL DEFAULT 280.00,
    price_vip NUMERIC(10, 2) NOT NULL DEFAULT 350.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. Showtime Templates (Daily Reseed Source)
-- -----------------------------------------------------------------------------
CREATE TABLE public.showtime_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
    auditorium_id UUID NOT NULL REFERENCES public.auditoriums(id) ON DELETE CASCADE,
    start_time_of_day TIME NOT NULL, -- e.g. '13:30:00'
    price_standard NUMERIC(10, 2) NOT NULL DEFAULT 280.00,
    price_vip NUMERIC(10, 2) NOT NULL DEFAULT 350.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. Seat Holds (5-Minute Temporary Hold Lock)
-- -----------------------------------------------------------------------------
CREATE TABLE public.seat_holds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    showtime_id UUID NOT NULL REFERENCES public.showtimes(id) ON DELETE CASCADE,
    seat_id UUID NOT NULL REFERENCES public.seats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT unique_seat_hold UNIQUE (showtime_id, seat_id)
);

-- Index for hold expiration cleanup
CREATE INDEX idx_seat_holds_expiry ON public.seat_holds(expires_at);

-- -----------------------------------------------------------------------------
-- 7. Reservations
-- -----------------------------------------------------------------------------
CREATE TABLE public.reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_code TEXT UNIQUE NOT NULL, -- Format: MS-YYYY-XXXXXX
    showtime_id UUID NOT NULL REFERENCES public.showtimes(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed')),
    total_amount NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ
);

CREATE INDEX idx_reservations_user ON public.reservations(user_id);
CREATE INDEX idx_reservations_ref ON public.reservations(reference_code);

-- -----------------------------------------------------------------------------
-- 8. Reservation Seats (Permanent Allocations)
-- -----------------------------------------------------------------------------
CREATE TABLE public.reservation_seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
    showtime_id UUID NOT NULL REFERENCES public.showtimes(id) ON DELETE CASCADE,
    seat_id UUID NOT NULL REFERENCES public.seats(id) ON DELETE CASCADE,
    price NUMERIC(10, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PARTIAL UNIQUE INDEX: Concurrency double-booking guard
-- Guarantees race conditions cannot corrupt seat states while allowing seat reuse after cancellation
CREATE UNIQUE INDEX unique_active_reservation_seat 
ON public.reservation_seats(showtime_id, seat_id) 
WHERE status = 'reserved';

-- -----------------------------------------------------------------------------
-- 9. OTP Codes (Server-side Authentication & Rate-limiting)
-- -----------------------------------------------------------------------------
CREATE TABLE public.otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL, -- HMAC-SHA256
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER DEFAULT 0,
    is_used BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_otp_codes_lookup ON public.otp_codes(email, expires_at);

-- -----------------------------------------------------------------------------
-- 10. Security Invoker View: my_reservations
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.my_reservations 
WITH (security_invoker = true) AS
SELECT 
    r.id AS reservation_id,
    r.reference_code,
    r.status,
    r.total_amount,
    r.created_at,
    r.cancelled_at,
    r.customer_name,
    r.customer_email,
    r.user_id,
    st.id AS showtime_id,
    st.start_time,
    st.end_time,
    m.id AS movie_id,
    m.title AS movie_title,
    m.poster_path,
    m.runtime,
    m.rating,
    a.id AS auditorium_id,
    a.name AS auditorium_name,
    a.screen_type,
    a.sound_system,
    COALESCE(
        json_agg(
            json_build_object(
                'seat_id', s.id,
                'row', s.row,
                'number', s.number,
                'seat_type', s.seat_type,
                'price', rs.price
            )
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'::json
    ) AS seats
FROM public.reservations r
JOIN public.showtimes st ON r.showtime_id = st.id
JOIN public.movies m ON st.movie_id = m.id
JOIN public.auditoriums a ON st.auditorium_id = a.id
LEFT JOIN public.reservation_seats rs ON r.id = rs.reservation_id AND rs.status = 'reserved'
LEFT JOIN public.seats s ON rs.seat_id = s.id
GROUP BY r.id, st.id, m.id, a.id;

-- -----------------------------------------------------------------------------
-- 11. Row-Level Security (RLS) Configuration
-- -----------------------------------------------------------------------------
ALTER TABLE public.movies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoriums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.showtimes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.showtime_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seat_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

-- Public read policies for catalog data
CREATE POLICY "Public read movies" ON public.movies FOR SELECT USING (true);
CREATE POLICY "Public read auditoriums" ON public.auditoriums FOR SELECT USING (true);
CREATE POLICY "Public read seats" ON public.seats FOR SELECT USING (true);
CREATE POLICY "Public read showtimes" ON public.showtimes FOR SELECT USING (true);

-- Realtime seat status reads (active holds and active reservation seats)
CREATE POLICY "Public read active seat_holds" ON public.seat_holds 
FOR SELECT USING (expires_at > NOW());

CREATE POLICY "Public read reservation_seats" ON public.reservation_seats 
FOR SELECT USING (true);

-- User-isolated policies for reservations
CREATE POLICY "Users read own reservations" ON public.reservations 
FOR SELECT USING (auth.uid() = user_id);

-- ZERO CLIENT DIRECT WRITES:
-- Public and authenticated roles CANNOT insert/update/delete directly on booking tables.
-- All writes MUST execute through SECURITY DEFINER RPC functions.

-- -----------------------------------------------------------------------------
-- 12. Stored Procedures & SECURITY DEFINER Functions
-- -----------------------------------------------------------------------------

-- Helper: Generate unique reference code (MS-YYYY-XXXXXX)
CREATE OR REPLACE FUNCTION public.generate_reservation_reference()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_year TEXT;
    v_random TEXT;
    v_ref TEXT;
    v_exists BOOLEAN;
BEGIN
    v_year := to_char(NOW() AT TIME ZONE 'Asia/Manila', 'YYYY');
    LOOP
        v_random := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
        v_ref := 'MS-' || v_year || '-' || v_random;
        SELECT EXISTS(SELECT 1 FROM public.reservations WHERE reference_code = v_ref) INTO v_exists;
        IF NOT v_exists THEN
            RETURN v_ref;
        END IF;
    END LOOP;
END;
$$;

-- Function: Hold seats (5-minute TTL lock, max 6 seats cap)
CREATE OR REPLACE FUNCTION public.hold_seats(
    p_showtime_id UUID,
    p_seat_ids UUID[],
    p_session_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_seat_id UUID;
    v_expires_at TIMESTAMPTZ;
    v_seat_count INTEGER;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: You must be logged in to hold seats.';
    END IF;

    -- Validate max 6 seats rule
    v_seat_count := array_length(p_seat_ids, 1);
    IF v_seat_count IS NULL OR v_seat_count < 1 THEN
        RAISE EXCEPTION 'INVALID_SELECTION: At least one seat must be selected.';
    END IF;
    IF v_seat_count > 6 THEN
        RAISE EXCEPTION 'SEAT_CAP_EXCEEDED: Maximum 6 seats allowed per reservation.';
    END IF;

    -- Clean up any existing holds for this user on this showtime
    DELETE FROM public.seat_holds 
    WHERE showtime_id = p_showtime_id AND user_id = v_user_id;

    -- Set expiration to exactly 5 minutes from now
    v_expires_at := NOW() + INTERVAL '5 minutes';

    -- Attempt to insert hold for each seat
    FOREACH v_seat_id IN ARRAY p_seat_ids
    LOOP
        -- Check if already reserved
        IF EXISTS (
            SELECT 1 FROM public.reservation_seats 
            WHERE showtime_id = p_showtime_id 
              AND seat_id = v_seat_id 
              AND status = 'reserved'
        ) THEN
            RAISE EXCEPTION 'SEAT_TAKEN: One or more selected seats have already been reserved.';
        END IF;

        -- Check if active hold exists by another user
        IF EXISTS (
            SELECT 1 FROM public.seat_holds 
            WHERE showtime_id = p_showtime_id 
              AND seat_id = v_seat_id 
              AND user_id != v_user_id 
              AND expires_at > NOW()
        ) THEN
            RAISE EXCEPTION 'SEAT_HELD: One or more selected seats are currently held by another customer.';
        END IF;

        -- Clean up expired hold on this seat if any
        DELETE FROM public.seat_holds 
        WHERE showtime_id = p_showtime_id AND seat_id = v_seat_id AND expires_at <= NOW();

        -- Insert fresh hold
        INSERT INTO public.seat_holds (showtime_id, seat_id, user_id, session_id, expires_at)
        VALUES (p_showtime_id, v_seat_id, v_user_id, p_session_id, v_expires_at);
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'expires_at', v_expires_at,
        'held_count', v_seat_count
    );
END;
$$;

-- Function: Release holds
CREATE OR REPLACE FUNCTION public.release_holds(
    p_showtime_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_deleted_count INTEGER;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthenticated');
    END IF;

    DELETE FROM public.seat_holds
    WHERE showtime_id = p_showtime_id AND user_id = v_user_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'released_count', v_deleted_count
    );
END;
$$;

-- Function: Confirm reservation (Convert holds to permanent booking)
CREATE OR REPLACE FUNCTION public.confirm_reservation(
    p_showtime_id UUID,
    p_customer_name TEXT,
    p_customer_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_reference_code TEXT;
    v_reservation_id UUID;
    v_hold RECORD;
    v_total_amount NUMERIC(10,2) := 0.00;
    v_seat_price NUMERIC(10,2);
    v_showtime RECORD;
    v_holds_found INTEGER := 0;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: User must be authenticated to confirm a reservation.';
    END IF;

    -- Fetch showtime pricing
    SELECT * INTO v_showtime FROM public.showtimes WHERE id = p_showtime_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_SHOWTIME: Showtime not found.';
    END IF;

    -- Check if showtime has already started
    IF v_showtime.start_time <= NOW() THEN
        RAISE EXCEPTION 'SHOWTIME_STARTED: Cannot book seats for a past or running screening.';
    END IF;

    -- Lock and verify user holds for this showtime
    FOR v_hold IN 
        SELECT h.seat_id, s.seat_type 
        FROM public.seat_holds h
        JOIN public.seats s ON h.seat_id = s.id
        WHERE h.showtime_id = p_showtime_id 
          AND h.user_id = v_user_id 
          AND h.expires_at > NOW()
    LOOP
        v_holds_found := v_holds_found + 1;
        IF v_hold.seat_type = 'vip' THEN
            v_total_amount := v_total_amount + v_showtime.price_vip;
        ELSE
            v_total_amount := v_total_amount + v_showtime.price_standard;
        END IF;
    END LOOP;

    IF v_holds_found = 0 THEN
        RAISE EXCEPTION 'HOLD_EXPIRED: Your seat hold has expired or was not found.';
    END IF;

    -- Generate reference
    v_reference_code := public.generate_reservation_reference();

    -- Create reservation record
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
        p_customer_name,
        p_customer_email,
        'active',
        v_total_amount
    ) RETURNING id INTO v_reservation_id;

    -- Allocate reservation_seats
    FOR v_hold IN 
        SELECT h.seat_id, s.seat_type 
        FROM public.seat_holds h
        JOIN public.seats s ON h.seat_id = s.id
        WHERE h.showtime_id = p_showtime_id 
          AND h.user_id = v_user_id 
          AND h.expires_at > NOW()
    LOOP
        IF v_hold.seat_type = 'vip' THEN
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
            v_hold.seat_id,
            v_seat_price,
            'reserved'
        );
    END LOOP;

    -- Remove holds
    DELETE FROM public.seat_holds 
    WHERE showtime_id = p_showtime_id AND user_id = v_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'reservation_id', v_reservation_id,
        'reference_code', v_reference_code,
        'total_amount', v_total_amount
    );
END;
$$;

-- Function: Cancel reservation (30-Minute cutoff policy)
CREATE OR REPLACE FUNCTION public.cancel_reservation(
    p_reservation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_reservation RECORD;
    v_showtime RECORD;
    v_minutes_until_showtime NUMERIC;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Authentication required.';
    END IF;

    -- Fetch reservation
    SELECT * INTO v_reservation 
    FROM public.reservations 
    WHERE id = p_reservation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Reservation does not exist.';
    END IF;

    IF v_reservation.user_id != v_user_id THEN
        RAISE EXCEPTION 'FORBIDDEN: You do not have permission to cancel this reservation.';
    END IF;

    IF v_reservation.status = 'cancelled' THEN
        RAISE EXCEPTION 'ALREADY_CANCELLED: This reservation has already been cancelled.';
    END IF;

    -- Fetch showtime
    SELECT * INTO v_showtime 
    FROM public.showtimes 
    WHERE id = v_reservation.showtime_id;

    -- 30-Minute Policy Check: start_time - now()
    v_minutes_until_showtime := EXTRACT(EPOCH FROM (v_showtime.start_time - NOW())) / 60;
    IF v_minutes_until_showtime < 30 THEN
        RAISE EXCEPTION 'CANCEL_WINDOW_CLOSED: Cancellations are prohibited within 30 minutes of showtime.';
    END IF;

    -- Update reservation status
    UPDATE public.reservations 
    SET status = 'cancelled', cancelled_at = NOW() 
    WHERE id = p_reservation_id;

    -- Free seats by marking status 'cancelled'
    -- Partial index will immediately allow re-booking
    UPDATE public.reservation_seats 
    SET status = 'cancelled' 
    WHERE reservation_id = p_reservation_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Reservation successfully cancelled and seats released.'
    );
END;
$$;

-- Function: Reseed today's showtimes (Asia/Manila time zone)
CREATE OR REPLACE FUNCTION public.reseed_today()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_manila_today DATE;
    v_template RECORD;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_movie RECORD;
    v_count INTEGER := 0;
BEGIN
    -- Determine current date in Asia/Manila (UTC+8)
    v_manila_today := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;

    -- Clean any existing showtimes for today that have NO active reservations
    DELETE FROM public.showtimes st
    WHERE (st.start_time AT TIME ZONE 'Asia/Manila')::DATE = v_manila_today
      AND NOT EXISTS (
          SELECT 1 FROM public.reservations r 
          WHERE r.showtime_id = st.id AND r.status = 'active'
      );

    -- Insert showtimes from showtime_templates
    FOR v_template IN SELECT * FROM public.showtime_templates LOOP
        -- Calculate timestamps
        v_start := (v_manila_today::TEXT || ' ' || v_template.start_time_of_day::TEXT)::TIMESTAMPTZ;
        SELECT * INTO v_movie FROM public.movies WHERE id = v_template.movie_id;
        v_end := v_start + (v_movie.runtime || ' minutes')::INTERVAL;

        -- Insert only if not already exists
        IF NOT EXISTS (
            SELECT 1 FROM public.showtimes 
            WHERE movie_id = v_template.movie_id 
              AND auditorium_id = v_template.auditorium_id 
              AND start_time = v_start
        ) THEN
            INSERT INTO public.showtimes (
                movie_id,
                auditorium_id,
                start_time,
                end_time,
                price_standard,
                price_vip
            ) VALUES (
                v_template.movie_id,
                v_template.auditorium_id,
                v_start,
                v_end,
                v_template.price_standard,
                v_template.price_vip
            );
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'date', v_manila_today,
        'showtimes_created', v_count
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. Enable Realtime Publications
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seat_holds;
EXCEPTION WHEN duplicate_object THEN
    -- Table already in publication
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_seats;
EXCEPTION WHEN duplicate_object THEN
    -- Table already in publication
END $$;
