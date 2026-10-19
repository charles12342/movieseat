'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Check, Clock, ArrowRight, RotateCw, Info, AlertCircle, Loader2 } from 'lucide-react';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get('email') || '';

  const [email] = useState(emailParam);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 5-minute code expiration timer (300 seconds)
  const [codeSecondsLeft, setCodeSecondsLeft] = useState(300);
  // 60-second resend cooldown timer
  const [resendCooldown, setResendCooldown] = useState(60);
  const [resending, setResending] = useState(false);

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // Expiration countdown
  useEffect(() => {
    if (codeSecondsLeft <= 0) return;
    const interval = setInterval(() => {
      setCodeSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [codeSecondsLeft]);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDigitChange = (index: number, value: string) => {
    const rawNumbers = value.replace(/\D/g, '');
    if (rawNumbers.length > 1) {
      // Support one-time-code mobile autofill or multi-digit paste into any input box
      const newDigits = [...otpDigits];
      for (let i = 0; i < 6; i++) {
        if (index + i < 6 && rawNumbers[i]) {
          newDigits[index + i] = rawNumbers[i];
        }
      }
      setOtpDigits(newDigits);
      setErrorMessage(null);
      const nextFocus = Math.min(index + rawNumbers.length, 5);
      inputRefs.current[nextFocus]?.focus();
      return;
    }

    const numericChar = rawNumbers.slice(-1);
    const newDigits = [...otpDigits];
    newDigits[index] = numericChar;
    setOtpDigits(newDigits);
    setErrorMessage(null);

    // Auto-advance to next input if filled
    if (numericChar && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      // Jump back to previous input on backspace
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pastedData) return;

    const newDigits = [...otpDigits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pastedData[i] || '';
    }
    setOtpDigits(newDigits);
    setErrorMessage(null);

    // Focus last filled or next empty input
    const nextIndex = Math.min(pastedData.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const fullOtp = otpDigits.join('');

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (fullOtp.length !== 6) {
      setErrorMessage('Please enter all 6 digits of your verification code.');
      return;
    }

    if (!email) {
      setErrorMessage('Missing email address. Please return to the sign-in page.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          otp: fullOtp,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || 'Verification failed. Please check your code.');
        setLoading(false);
        return;
      }

      setSuccessMessage('Email verified successfully! Redirecting to sign in...');
      setTimeout(() => {
        router.push(`/signin?verified=true&email=${encodeURIComponent(email)}`);
      }, 1500);
    } catch {
      setErrorMessage('Network error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || resending || !email) return;

    setResending(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || 'Failed to resend code.');
      } else {
        setResendCooldown(60);
        setCodeSecondsLeft(300);
        setOtpDigits(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch {
      setErrorMessage('Network error while resending code.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="relative min-h-[calc(100vh-8rem)] flex items-center justify-center px-3 sm:px-6 lg:px-8 py-10 overflow-x-hidden">
      {/* Ambient Cinema Lighting Glow */}
      <div
        className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-[550px] h-[350px] bg-radial from-amber-500/10 via-amber-500/2 to-transparent blur-3xl"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-[460px]">
        {/* Top Back Link */}
        <div className="mb-4">
          <Link
            href="/signin"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <span>← Back to Sign In</span>
          </Link>
        </div>

        {/* Card Container */}
        <div className="bg-[#15161B] border border-[#23252E] rounded-2xl shadow-2xl p-4 sm:p-8 backdrop-blur-xl">
          {/* Top Mail Icon Badge */}
          <div className="flex justify-center mb-6">
            <div className="relative w-14 h-14 rounded-2xl bg-[#1C1E26] border border-amber-500/40 flex items-center justify-center shadow-lg shadow-amber-500/10">
              <Mail className="w-6 h-6 text-amber-500" />
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-black flex items-center justify-center">
                <Check className="w-2.5 h-2.5 stroke-[3]" />
              </div>
            </div>
          </div>

          {/* Heading & Subtitle */}
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Verify Your Email
            </h1>
            <p className="mt-2 text-xs text-zinc-400 max-w-sm mx-auto leading-relaxed">
              We&apos;ve dispatched a 6-digit verification code to{' '}
              <span className="font-semibold text-amber-400 break-all">{email || 'your email'}</span> to activate your MovieSeat perks.
            </p>
          </div>

          {/* Success Banner */}
          {successMessage && (
            <div className="mb-6 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2.5 animate-in fade-in duration-200">
              <Check className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="mb-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* 6-Box OTP Input Form */}
          <form onSubmit={handleVerify} className="space-y-6">
            <div className="flex items-center justify-center gap-1.5 sm:gap-2.5">
              {[0, 1, 2].map((idx) => (
                <input
                  key={idx}
                  ref={(el) => { inputRefs.current[idx] = el; }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                  maxLength={idx === 0 ? 6 : 1}
                  value={otpDigits[idx]}
                  onChange={(e) => handleDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  onPaste={handlePaste}
                  aria-label={`Digit ${idx + 1} of verification code`}
                  className="w-10 h-12 sm:w-12 sm:h-14 text-center text-lg sm:text-xl font-bold bg-[#0E0F12] border border-[#23252E] rounded-xl text-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 transition-all select-none"
                />
              ))}

              {/* Separator Dash */}
              <span className="text-zinc-600 font-bold text-base sm:text-lg select-none px-0.5">-</span>

              {[3, 4, 5].map((idx) => (
                <input
                  key={idx}
                  ref={(el) => { inputRefs.current[idx] = el; }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  maxLength={1}
                  value={otpDigits[idx]}
                  onChange={(e) => handleDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  onPaste={handlePaste}
                  aria-label={`Digit ${idx + 1} of verification code`}
                  className="w-10 h-12 sm:w-12 sm:h-14 text-center text-lg sm:text-xl font-bold bg-[#0E0F12] border border-[#23252E] rounded-xl text-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 transition-all select-none"
                />
              ))}
            </div>

            {/* Countdown Expiry */}
            <div className="flex items-center justify-center gap-1.5 text-xs text-zinc-400">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              {codeSecondsLeft > 0 ? (
                <span>
                  Code expires in <strong className="text-zinc-200 font-mono">{formatTimer(codeSecondsLeft)}</strong>
                </span>
              ) : (
                <span className="text-red-400 font-medium">Code expired. Please request a new one.</span>
              )}
            </div>

            {/* Submit CTA */}
            <div>
              <button
                type="submit"
                disabled={loading || fullOtp.length !== 6 || codeSecondsLeft === 0}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:hover:bg-amber-500 text-black font-bold text-xs py-3.5 px-4 rounded-xl shadow-lg shadow-amber-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Verifying Code...</span>
                  </>
                ) : (
                  <>
                    <span>Verify Email &amp; Continue</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* Resend Action */}
            <div className="flex items-center justify-between text-xs pt-1 px-1">
              <span className="text-zinc-400">Didn&apos;t get the code?</span>
              {resendCooldown > 0 ? (
                <span className="text-zinc-500 flex items-center gap-1 font-mono">
                  <RotateCw className="w-3 h-3 text-zinc-600 animate-spin" style={{ animationDuration: '4s' }} />
                  Resend in 0:{resendCooldown.toString().padStart(2, '0')}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="font-semibold text-amber-500 hover:text-amber-400 transition-colors flex items-center gap-1"
                >
                  <RotateCw className={`w-3 h-3 ${resending ? 'animate-spin' : ''}`} />
                  {resending ? 'Sending...' : 'Resend Code'}
                </button>
              )}
            </div>

            {/* Spam Folder Advisory */}
            <div className="rounded-xl bg-[#0E0F12] border border-[#23252E] p-3 text-[11px] text-zinc-400 flex items-start gap-2.5 leading-relaxed">
              <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
              <span>
                Check your spam or promotions folder if the email doesn&apos;t appear within 2 minutes.
              </span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
