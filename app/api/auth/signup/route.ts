import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateOtp,
  saveOtpRecord,
  checkResendRateLimit,
} from '@/lib/otp';
import { sendOtpEmail } from '@/lib/emailjs';

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
 * POST /api/auth/signup
 * Handles patron registration with server-side email verification.
 * Disables public client-side signups by issuing administrative creation and unverified state.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fullName, email, password } = body;

    // Validation
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
      return NextResponse.json(
        { error: 'Full name is required.' },
        { status: 400 }
      );
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'A valid email address is required.' },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters in length.' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const cleanName = fullName.trim();

    // Check resend / creation rate limits
    const rateCheck = await checkResendRateLimit(normalizedEmail);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.error, cooldownRemaining: rateCheck.cooldownRemaining },
        { status: 429 }
      );
    }

    const admin = createAdminClient();
    const isConfigured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
    );

    let isExistingUnverified = false;

    if (isConfigured) {
      try {
        // Attempt administrative user creation
        const { data: createData, error: createError } = await admin.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: false,
          user_metadata: {
            full_name: cleanName,
          },
        });

        if (createData?.user) {
          try {
            await (admin as unknown as ProfileUpsertClient).from('profiles').upsert({
              id: createData.user.id,
              email: normalizedEmail,
              full_name: cleanName,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'id' });
          } catch {
            // Non-fatal if profiles table migration not yet executed
          }
        }

        if (createError) {
          // Check if user already exists
          const { data: listData } = await admin.auth.admin.listUsers();
          const existingUser = listData?.users?.find(
            (u) => u.email?.toLowerCase() === normalizedEmail
          );

          if (existingUser) {
            // Unverified Account Recovery
            if (!existingUser.email_confirmed_at) {
              isExistingUnverified = true;
              // Update credentials and metadata for unverified account
              await admin.auth.admin.updateUserById(existingUser.id, {
                password,
                user_metadata: {
                  full_name: cleanName,
                },
              });

              try {
                await (admin as unknown as ProfileUpsertClient).from('profiles').upsert({
                  id: existingUser.id,
                  email: normalizedEmail,
                  full_name: cleanName,
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'id' });
              } catch {
                // Non-fatal if profiles table migration not yet executed
              }
            } else {
              // Account already verified
              return NextResponse.json(
                { error: 'An account with this email address already exists. Please sign in.' },
                { status: 400 }
              );
            }
          } else {
            console.error('[Admin CreateUser Error]', createError.message);
            return NextResponse.json(
              { error: createError.message || 'Failed to create account.' },
              { status: 400 }
            );
          }
        }
      } catch (authErr: unknown) {
        console.warn('[Supabase Auth Server Catch]', authErr);
      }
    }

    // Generate 6-digit OTP
    const otp = generateOtp();

    // Save hashed OTP with 5-minute expiry in database (or dev fallback store)
    await saveOtpRecord(normalizedEmail, otp);

    // Send verification email via EmailJS (or log in dev)
    await sendOtpEmail({
      toEmail: normalizedEmail,
      toName: cleanName,
      otpCode: otp,
      expiresIn: '5 minutes',
    });

    const responseMessage = isExistingUnverified
      ? 'Unverified account detected: password updated and a fresh verification code has been sent.'
      : 'Account created! Please check your email for the 6-digit verification code.';

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
      message: responseMessage,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
