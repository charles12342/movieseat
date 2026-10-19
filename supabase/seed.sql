-- ==============================================================================
-- MovieSeat Initial Seed Data
-- 4 Movies, 3 Auditoriums, 254 Physical Seats, 13 Daily Showtime Templates
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- 1. Insert 4 Movies
-- -----------------------------------------------------------------------------
INSERT INTO public.movies (id, tmdb_id, title, overview, poster_path, runtime, genres, rating, format_badges)
VALUES
(
    '11111111-1111-1111-1111-111111111111',
    693134,
    'Dune: Part Two',
    'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
    '/8b8R8l88Qje9dn9OE8PY05Nx1.jpg',
    166,
    ARRAY['Sci-Fi', 'Adventure'],
    'PG-13',
    ARRAY['4K IMAX', 'Dolby Atmos']
),
(
    '22222222-2222-2222-2222-222222222222',
    569094,
    'Spider-Man: Across the Spider-Verse',
    'Miles Morales catapults across the Multiverse alongside a team of Spider-People.',
    '/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg',
    140,
    ARRAY['Animation', 'Action'],
    'PG',
    ARRAY['ANIMATED', 'Surround 5.1']
),
(
    '33333333-3333-3333-3333-333333333333',
    872585,
    'Oppenheimer',
    'The story of J. Robert Oppenheimer and the moral weight of the atomic bomb.',
    '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    180,
    ARRAY['Drama', 'History'],
    'R',
    ARRAY['70MM IMAX', 'Dolby Atmos']
),
(
    '44444444-4444-4444-4444-444444444444',
    666277,
    'Past Lives',
    'Two childhood friends reunite in New York for one fateful week.',
    '/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg',
    106,
    ARRAY['Romance', 'Drama'],
    'PG-13',
    ARRAY['A24 INDIE', 'Surround 5.1']
)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    tmdb_id = EXCLUDED.tmdb_id,
    runtime = EXCLUDED.runtime,
    rating = EXCLUDED.rating;

-- -----------------------------------------------------------------------------
-- 2. Insert 3 Auditoriums
-- -----------------------------------------------------------------------------
INSERT INTO public.auditoriums (id, name, screen_type, sound_system, total_seats)
VALUES
(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Cinema 1 • Dolby Atmos',
    'Dolby Atmos',
    'Surround 7.1',
    88
),
(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'Cinema 2 • IMAX Laser',
    'IMAX Laser',
    '12-Channel IMAX Sound',
    102
),
(
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'Cinema 3 • Standard',
    'Standard',
    'Surround 5.1',
    64
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    screen_type = EXCLUDED.screen_type,
    sound_system = EXCLUDED.sound_system,
    total_seats = EXCLUDED.total_seats;

-- -----------------------------------------------------------------------------
-- 3. Populate 254 Seats
-- Cinema 1: Rows A-G (11 seats/row = 77 standard) + Row H (11 VIP seats) = 88 seats
-- Cinema 2: Rows A-G (13 seats/row = 91 standard) + Row H (11 VIP seats) = 102 seats
-- Cinema 3: Rows A-G (8 seats/row = 56 standard) + Row H (8 VIP seats) = 64 seats
-- Total = 88 + 102 + 64 = 254 seats
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    r TEXT;
    n INT;
BEGIN
    -- Cinema 1 (88 seats)
    FOREACH r IN ARRAY ARRAY['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] LOOP
        FOR n IN 1..11 LOOP
            INSERT INTO public.seats (auditorium_id, row, number, seat_type, is_wheelchair)
            VALUES (
                'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                r,
                n,
                CASE WHEN r = 'H' THEN 'vip' ELSE 'standard' END,
                (r = 'A' AND n IN (1, 11))
            )
            ON CONFLICT (auditorium_id, row, number) DO NOTHING;
        END LOOP;
    END LOOP;

    -- Cinema 2 (102 seats: Rows A-G have 13 seats = 91; Row H has 11 VIP = 11; Total = 102)
    FOREACH r IN ARRAY ARRAY['A', 'B', 'C', 'D', 'E', 'F', 'G'] LOOP
        FOR n IN 1..13 LOOP
            INSERT INTO public.seats (auditorium_id, row, number, seat_type, is_wheelchair)
            VALUES (
                'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                r,
                n,
                'standard',
                (r = 'A' AND n IN (1, 13))
            )
            ON CONFLICT (auditorium_id, row, number) DO NOTHING;
        END LOOP;
    END LOOP;
    FOR n IN 1..11 LOOP
        INSERT INTO public.seats (auditorium_id, row, number, seat_type, is_wheelchair)
        VALUES (
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            'H',
            n,
            'vip',
            false
        )
        ON CONFLICT (auditorium_id, row, number) DO NOTHING;
    END LOOP;

    -- Cinema 3 (64 seats: Rows A-H with 8 seats/row = 64)
    FOREACH r IN ARRAY ARRAY['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] LOOP
        FOR n IN 1..8 LOOP
            INSERT INTO public.seats (auditorium_id, row, number, seat_type, is_wheelchair)
            VALUES (
                'cccccccc-cccc-cccc-cccc-cccccccccccc',
                r,
                n,
                CASE WHEN r = 'H' THEN 'vip' ELSE 'standard' END,
                (r = 'A' AND n IN (1, 8))
            )
            ON CONFLICT (auditorium_id, row, number) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Showtime Templates (13 Daily Screenings across 3 Halls)
-- -----------------------------------------------------------------------------
INSERT INTO public.showtime_templates (movie_id, auditorium_id, start_time_of_day, price_standard, price_vip)
VALUES
-- Cinema 1 (Dolby Atmos)
('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '13:30:00', 280.00, 350.00), -- Dune 2
('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '16:45:00', 280.00, 350.00), -- Dune 2
('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '19:00:00', 280.00, 350.00), -- Oppenheimer
('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22:15:00', 280.00, 350.00), -- Dune 2 Late

-- Cinema 2 (IMAX Laser)
('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11:30:00', 350.00, 420.00), -- Oppenheimer
('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '15:00:00', 350.00, 420.00), -- Oppenheimer
('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '18:15:00', 350.00, 420.00), -- Dune 2
('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '21:30:00', 350.00, 420.00), -- Dune 2

-- Cinema 3 (Standard)
('44444444-4444-4444-4444-444444444444', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '10:30:00', 250.00, 320.00), -- Past Lives
('44444444-4444-4444-4444-444444444444', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '13:00:00', 250.00, 320.00), -- Past Lives
('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '14:00:00', 250.00, 320.00), -- Spider-Man
('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '17:30:00', 250.00, 320.00), -- Spider-Man
('44444444-4444-4444-4444-444444444444', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '18:00:00', 250.00, 320.00); -- Past Lives

-- -----------------------------------------------------------------------------
-- 5. Trigger Initial Reseed for Today
-- -----------------------------------------------------------------------------
SELECT public.reseed_today();
