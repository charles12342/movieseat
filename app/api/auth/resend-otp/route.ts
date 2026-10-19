import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateOtp,
  saveOtpRecord,
  checkResendRateLimit,
} from '@/lib/otp';
import { sendOtpEmail } from '@/lib/emailjs';

/**
 * POST /api/auth/resend-otp
 * Dispatches a fresh 6-digit OTP code to the requested email.
 * Strictly enforces a 60-second cooldown and a maximum of 5 requests per hour.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email address is required.' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Enforce 60s cooldown and 5/hr rate limits
    const rateCheck = await checkResendRateLimit(normalizedEmail);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.error, cooldownRemaining: rateCheck.cooldownRemaining },
        { status: 429 }
      );
    }

    const isConfigured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
    );

    let recipientName = 'MovieSeat Patron';

    if (isConfigured) {
      try {
        const admin = createAdminClient();
        const { data: listData } = await admin.auth.admin.listUsers();
        const user = listData?.users?.find(
          (u) => u.email?.toLowerCase() === normalizedEmail
        );

        if (user) {
          if (user.email_confirmed_at) {
            return NextResponse.json(
              { error: 'This account is already verified. Please proceed to sign in.' },
              { status: 400 }
            );
          }
          recipientName = (user.user_metadata?.full_name as string) || recipientName;
        }
      } catch (authErr) {
        console.warn('[Supabase Resend User Check Catch]', authErr);
      }
    }

    // Generate fresh 6-digit OTP
    const otp = generateOtp();

    // Store hashed OTP with 5-min TTL
    await saveOtpRecord(normalizedEmail, otp);

    // Send via EmailJS (or simulated dev log)
    await sendOtpEmail({
      toEmail: normalizedEmail,
      toName: recipientName,
      otpCode: otp,
      expiresIn: '5 minutes',
    });

    return NextResponse.json({
      success: true,
      message: 'A fresh verification code has been dispatched to your email.',
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
