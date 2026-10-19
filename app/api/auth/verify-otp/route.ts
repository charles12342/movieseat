import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyOtpRecord } from '@/lib/otp';

interface ProfileUpsertClient {
  from(table: string): {
    upsert(
      values: {
        id: string;
        email: string;
        full_name: string;
        updated_at: string;
      },
      options?: { onConflict?: string }
    ): Promise<{ error: { message: string } | null }>;
  };
}

/**
 * POST /api/auth/verify-otp
 * Verifies the 6-digit OTP code against HMAC-SHA256 hash.
 * If valid, marks the user account as email_confirmed in Supabase Auth.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, otp } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email address is required.' },
        { status: 400 }
      );
    }

    if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
      return NextResponse.json(
        { error: 'Verification code must be 6 digits.' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const cleanOtp = otp.trim();

    // Verify OTP hash with timing-safe comparison, lockout, and expiry checks
    const verification = await verifyOtpRecord(normalizedEmail, cleanOtp);

    if (!verification.success) {
      const status = verification.attemptsRemaining === 0 ? 429 : 400;
      return NextResponse.json(
        {
          error: verification.error,
          attemptsRemaining: verification.attemptsRemaining,
        },
        { status }
      );
    }

    // Confirm user in Supabase Auth if configured
    const isConfigured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
    );

    if (isConfigured) {
      try {
        const admin = createAdminClient();
        const { data: listData, error: listError } = await admin.auth.admin.listUsers();
        if (!listError && listData?.users) {
          const user = listData.users.find(
            (u) => u.email?.toLowerCase() === normalizedEmail
          );
          if (user) {
            await admin.auth.admin.updateUserById(user.id, {
              email_confirm: true,
            });

            try {
              await (admin as unknown as ProfileUpsertClient).from('profiles').upsert({
                id: user.id,
                email: normalizedEmail,
                full_name: (user.user_metadata?.full_name as string) || '',
                updated_at: new Date().toISOString(),
              }, { onConflict: 'id' });
            } catch {
              // Non-fatal if profiles table migration not yet executed
            }
          }
        }
      } catch (authErr) {
        console.warn('[Supabase Auth Confirm Catch]', authErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Account verified successfully. You may now sign in.',
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
