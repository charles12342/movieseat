import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * MovieSeat OTP & Security Configuration
 * Strictly enforces parameters specified in PLAN.md
 */
export const OTP_CONFIG = {
  LENGTH: 6,
  EXPIRY_MINUTES: 5,
  EXPIRY_SECONDS: 5 * 60, // 300 seconds
  MAX_ATTEMPTS: 5,
  RESEND_COOLDOWN_SECONDS: 60,
  MAX_RESENDS_PER_HOUR: 5,
} as const;

/**
 * In-memory fallback store for development/testing when Supabase credentials are not configured.
 */
interface OtpRecord {
  id: string;
  email: string;
  code_hash: string;
  created_at: string;
  expires_at: string;
  attempts: number;
  is_used: boolean;
}

const devOtpStore = new Map<string, OtpRecord[]>();

interface OtpQueryHelper {
  from(table: string): {
    select(columns?: string): {
      eq(col: string, val: string): {
        gte(col: string, val: string): {
          order(col: string, opts: { ascending: boolean }): Promise<{
            data: Array<{ created_at: string }> | null;
            error: { message: string } | null;
          }>;
        };
        eq(col: string, val: boolean): {
          order(col: string, opts: { ascending: boolean }): {
            limit(count: number): Promise<{
              data: OtpRecord[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
    insert(row: Partial<OtpRecord>): Promise<{ error: { message: string } | null }>;
    update(values: Partial<OtpRecord>): {
      eq(col: string, val: string | number): {
        eq(col: string, val: string | boolean): Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

/**
 * Returns the HMAC secret key.
 * Falls back to a secure development string if OTP_HMAC_SECRET is not set.
 */
function getHmacSecret(): string {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL: OTP_HMAC_SECRET must be set in production environment.');
    }
    return 'movieseat-dev-hmac-secret-min-32-characters-secure';
  }
  return secret;
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP code.
 * Range: '100000' to '999999'
 */
export function generateOtp(): string {
  const code = crypto.randomInt(100000, 1000000);
  return code.toString();
}

/**
 * Computes an HMAC-SHA256 keyed hash of the given OTP string.
 * Plain-text OTPs are NEVER persisted.
 */
export function hashOtp(otp: string): string {
  const secret = getHmacSecret();
  return crypto.createHmac('sha256', secret).update(otp.trim()).digest('hex');
}

/**
 * Performs a timing-safe comparison between a user-supplied OTP and the stored HMAC hash.
 * Protects against timing-based side-channel attacks.
 */
export function verifyOtpHash(userOtp: string, storedHash: string): boolean {
  if (!userOtp || !storedHash) return false;

  const computedHash = hashOtp(userOtp);

  const computedBuffer = Buffer.from(computedHash, 'hex');
  const storedBuffer = Buffer.from(storedHash, 'hex');

  if (computedBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedBuffer, storedBuffer);
}

/**
 * Helper to calculate expiry date 5 minutes from now in ISO string.
 */
export function getOtpExpiresAt(): string {
  const expires = new Date(Date.now() + OTP_CONFIG.EXPIRY_SECONDS * 1000);
  return expires.toISOString();
}

/**
 * Helper to check if an ISO timestamp is in the past.
 */
export function isOtpExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && key && !url.includes('placeholder') && !key.includes('placeholder'));
}

/**
 * Enforces rate limiting on OTP requests:
 * 1. 60-second cooldown from the most recent request.
 * 2. Maximum 5 requests per hour.
 */
export async function checkResendRateLimit(email: string): Promise<{
  allowed: boolean;
  error?: string;
  cooldownRemaining?: number;
}> {
  const normalizedEmail = email.toLowerCase().trim();
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

  if (isSupabaseConfigured()) {
    try {
      const admin = createAdminClient() as unknown as OtpQueryHelper;
      const { data, error } = await admin
        .from('otp_codes')
        .select('created_at')
        .eq('email', normalizedEmail)
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('[Supabase OTP Rate Check Fallback]', error.message);
      } else if (data && data.length > 0) {
        // Check 60s cooldown against most recent request
        const mostRecent = new Date(data[0].created_at).getTime();
        const secondsPassed = Math.floor((now - mostRecent) / 1000);
        if (secondsPassed < OTP_CONFIG.RESEND_COOLDOWN_SECONDS) {
          const cooldownRemaining = OTP_CONFIG.RESEND_COOLDOWN_SECONDS - secondsPassed;
          return {
            allowed: false,
            error: `Please wait ${cooldownRemaining} seconds before requesting a new code.`,
            cooldownRemaining,
          };
        }

        // Check hourly limit
        if (data.length >= OTP_CONFIG.MAX_RESENDS_PER_HOUR) {
          return {
            allowed: false,
            error: `Maximum OTP requests exceeded (${OTP_CONFIG.MAX_RESENDS_PER_HOUR} per hour). Please try again later.`,
          };
        }
      }
      return { allowed: true };
    } catch {
      // Fall through to dev memory store
    }
  }

  // Fallback Dev In-Memory Rate Check
  const records = devOtpStore.get(normalizedEmail) || [];
  const recentRecords = records.filter(
    (r) => new Date(r.created_at).getTime() >= now - 60 * 60 * 1000
  );

  if (recentRecords.length > 0) {
    const mostRecent = new Date(recentRecords[recentRecords.length - 1].created_at).getTime();
    const secondsPassed = Math.floor((now - mostRecent) / 1000);
    if (secondsPassed < OTP_CONFIG.RESEND_COOLDOWN_SECONDS) {
      const cooldownRemaining = OTP_CONFIG.RESEND_COOLDOWN_SECONDS - secondsPassed;
      return {
        allowed: false,
        error: `Please wait ${cooldownRemaining} seconds before requesting a new code.`,
        cooldownRemaining,
      };
    }

    if (recentRecords.length >= OTP_CONFIG.MAX_RESENDS_PER_HOUR) {
      return {
        allowed: false,
        error: `Maximum OTP requests exceeded (${OTP_CONFIG.MAX_RESENDS_PER_HOUR} per hour). Please try again later.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Stores a new hashed OTP record in the database.
 * Invalidates any existing unverified OTP records for the email.
 */
export async function saveOtpRecord(
  email: string,
  otp: string
): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();
  const code_hash = hashOtp(otp);
  const created_at = new Date().toISOString();
  const expires_at = getOtpExpiresAt();

  if (isSupabaseConfigured()) {
    try {
      const admin = createAdminClient() as unknown as OtpQueryHelper;

      // Invalidate active codes for this email
      await admin
        .from('otp_codes')
        .update({ is_used: true })
        .eq('email', normalizedEmail)
        .eq('is_used', false);

      // Insert fresh OTP
      const { error } = await admin.from('otp_codes').insert({
        email: normalizedEmail,
        code_hash,
        created_at,
        expires_at,
        attempts: 0,
        is_used: false,
      });

      if (!error) {
        return { success: true };
      }
      console.warn('[Supabase saveOtpRecord Error]', error.message);
    } catch (e: unknown) {
      console.warn('[Supabase saveOtpRecord Exception]', e);
    }
  }

  // Dev In-Memory Fallback
  const existing = devOtpStore.get(normalizedEmail) || [];
  // Mark previous as used
  existing.forEach((r) => {
    r.is_used = true;
  });

  const newRecord: OtpRecord = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    code_hash,
    created_at,
    expires_at,
    attempts: 0,
    is_used: false,
  };

  existing.push(newRecord);
  devOtpStore.set(normalizedEmail, existing);

  return { success: true };
}

/**
 * Verifies a user-submitted OTP:
 * - Checks code existence and expiry
 * - Enforces max 5 attempts lockout
 * - Verifies using constant-time HMAC comparison
 * - Marks code as used upon success
 */
export async function verifyOtpRecord(
  email: string,
  userOtp: string
): Promise<{
  success: boolean;
  error?: string;
  attemptsRemaining?: number;
}> {
  const normalizedEmail = email.toLowerCase().trim();

  if (isSupabaseConfigured()) {
    try {
      const admin = createAdminClient() as unknown as OtpQueryHelper;

      // Retrieve latest active OTP record
      const { data, error } = await admin
        .from('otp_codes')
        .select('*')
        .eq('email', normalizedEmail)
        .eq('is_used', false)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) {
        return {
          success: false,
          error: 'No active verification code found for this email. Please request a new code.',
        };
      }

      const record = data[0];

      // Check Expiry
      if (isOtpExpired(record.expires_at)) {
        return {
          success: false,
          error: 'Verification code has expired. Please request a new one.',
        };
      }

      // Check Lockout
      if (record.attempts >= OTP_CONFIG.MAX_ATTEMPTS) {
        return {
          success: false,
          error: 'Too many failed attempts. This code is locked. Please request a new code.',
          attemptsRemaining: 0,
        };
      }

      // Timing-safe verification
      const isValid = verifyOtpHash(userOtp, record.code_hash);

      if (!isValid) {
        const nextAttempts = record.attempts + 1;
        const attemptsRemaining = Math.max(0, OTP_CONFIG.MAX_ATTEMPTS - nextAttempts);

        await admin
          .from('otp_codes')
          .update({ attempts: nextAttempts })
          .eq('id', record.id);

        if (attemptsRemaining === 0) {
          return {
            success: false,
            error: 'Invalid verification code. Code is now locked after 5 failed attempts.',
            attemptsRemaining: 0,
          };
        }

        return {
          success: false,
          error: `Invalid verification code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`,
          attemptsRemaining,
        };
      }

      // Valid: mark code as used
      await admin
        .from('otp_codes')
        .update({ is_used: true })
        .eq('id', record.id);

      return { success: true };
    } catch {
      // Fall through to dev in-memory
    }
  }

  // Dev In-Memory Fallback
  const existing = devOtpStore.get(normalizedEmail) || [];
  const activeRecord = [...existing].reverse().find((r) => !r.is_used);

  if (!activeRecord) {
    return {
      success: false,
      error: 'No active verification code found for this email. Please request a new code.',
    };
  }

  if (isOtpExpired(activeRecord.expires_at)) {
    return {
      success: false,
      error: 'Verification code has expired. Please request a new one.',
    };
  }

  if (activeRecord.attempts >= OTP_CONFIG.MAX_ATTEMPTS) {
    return {
      success: false,
      error: 'Too many failed attempts. This code is locked. Please request a new code.',
      attemptsRemaining: 0,
    };
  }

  const isValid = verifyOtpHash(userOtp, activeRecord.code_hash);

  if (!isValid) {
    activeRecord.attempts += 1;
    const attemptsRemaining = Math.max(0, OTP_CONFIG.MAX_ATTEMPTS - activeRecord.attempts);

    if (attemptsRemaining === 0) {
      return {
        success: false,
        error: 'Invalid verification code. Code is now locked after 5 failed attempts.',
        attemptsRemaining: 0,
      };
    }

    return {
      success: false,
      error: `Invalid verification code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`,
      attemptsRemaining,
    };
  }

  activeRecord.is_used = true;
  return { success: true };
}
