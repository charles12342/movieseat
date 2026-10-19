# MovieSeat: Supabase & Services Setup Guide

## 1. Supabase Postgres Setup
1. Create a project at [supabase.com](https://supabase.com).
2. Go to the **SQL Editor** in your Supabase dashboard.
3. Open and run `supabase/schema.sql`.
4. Open and run `supabase/seed.sql`.
   - Then open and run `supabase/phase4_hold_seats.sql` (hardens `hold_seats` / `release_holds`; required for the seat map).
   - Then open and run `supabase/phase5_confirm_reservation.sql` (hardens `confirm_reservation` with idempotent replay and SEAT_TAKEN handling).
   - Then open and run `supabase/phase7_cancel_reservation.sql` (hardens `cancel_reservation` with advisory lock and 30-min policy enforcement).
5. Under **Project Settings -> API**, copy:
   - Project URL -> `NEXT_PUBLIC_SUPABASE_URL`
   - Anon / Public Key -> `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role secret -> `SUPABASE_SERVICE_ROLE_KEY`
6. Under **Authentication -> Configuration -> Providers -> Email**:
   - Ensure Email provider is enabled.
   - For security isolation per Plan, disable client-side direct signups ("Enable Signup: OFF"). Server-side routes will use `auth.admin.createUser`.

## 2. Realtime Verification
1. Under **Database -> Publications**, ensure `supabase_realtime` includes:
   - `seat_holds`
   - `reservation_seats`

## 3. EmailJS Setup
1. Create an EmailJS account at [emailjs.com](https://www.emailjs.com).
2. Add an Email Service (e.g. Gmail or custom SMTP).
3. Create two Email Templates using the files in `email-templates/`:
   - `otp-template.html` -> set template ID to `EMAILJS_OTP_TEMPLATE_ID`
   - `confirmation-template.html` -> set template ID to `EMAILJS_CONFIRM_TEMPLATE_ID`
4. Under **Account -> API Keys**, retrieve:
   - Public Key -> `EMAILJS_PUBLIC_KEY`
   - Private Key -> `EMAILJS_PRIVATE_KEY`

## 4. Local Environment
Create `.env.local` inside `movieseat/my-app/` with all required keys from Section 7 of `PLAN.md`.
