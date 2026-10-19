import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/redirect';
import FindReservationView, { type ReservationItem } from '@/components/find-reservation/FindReservationView';

export default async function FindReservationPage() {
  await connection();

  // 1. Session check: Guests are redirected to signin
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    const returnPath = safeRedirectPath('/find-reservation', '/');
    redirect(`/signin?redirect=${encodeURIComponent(returnPath)}`);
  }

  // 2. Query user's bookings from security-invoker view: my_reservations
  // RLS on reservations ensures a patron only ever reads their own bookings.
  const { data: bookingsData } = await supabase
    .from('my_reservations')
    .select('*')
    .order('created_at', { ascending: false });

  const initialReservations = (bookingsData ?? []) as unknown as ReservationItem[];

  return <FindReservationView initialReservations={initialReservations} />;
}
