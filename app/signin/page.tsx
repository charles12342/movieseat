'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle, CheckCircle2, ShieldAlert, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { safeRedirectPath } from '@/lib/redirect';

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = safeRedirectPath(searchParams.get('redirect'));
  const isVerifiedParam = searchParams.get('verified') === 'true';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Mount-delay readOnly toggle to prevent browser aggressive autofill on page load
  const [isMountDelayedReadOnly, setIsMountDelayedReadOnly] = useState(true);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  useEffect(() => {
    // Release readOnly after a 200ms delay
    const timer = setTimeout(() => {
      setIsMountDelayedReadOnly(false);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setUnverifiedEmail(null);

    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        // Detect Unverified User Error from Supabase Auth
        const errorLower = error.message.toLowerCase();
        if (
          errorLower.includes('email not confirmed') ||
          errorLower.includes('unverified') ||
          errorLower.includes('not verified')
        ) {
          setUnverifiedEmail(email.trim().toLowerCase());
          setErrorMessage('Account not verified. Your email address has not been confirmed yet.');
        } else {
          setErrorMessage(error.message || 'Invalid email or password.');
        }
        setLoading(false);
        return;
      }

      if (data.session) {
        router.push(redirectParam);
        router.refresh();
      }
    } catch {
      setErrorMessage('An unexpected error occurred during sign in. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      {/* Ambient Cinema Lighting Glow */}
      <div
        className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-[550px] h-[350px] bg-radial from-amber-500/10 via-amber-500/2 to-transparent blur-3xl"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-[440px]">
        {/* Card Container */}
        <div className="bg-[#15161B] border border-[#23252E] rounded-2xl shadow-2xl p-6 sm:p-8 backdrop-blur-xl">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Sign In to MovieSeat
            </h1>
            <p className="mt-2 text-xs text-zinc-400 max-w-sm mx-auto leading-relaxed">
              Enter your registered credentials to access your booked seats and profile.
            </p>
          </div>

          {/* Verified Account Success Toast */}
          {isVerifiedParam && !errorMessage && (
            <div className="mb-6 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2.5 animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Email verified successfully! You can now sign in below.</span>
            </div>
          )}

          {/* Unverified Account Alert with Shortcut */}
          {unverifiedEmail && (
            <div className="mb-6 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex flex-col gap-2.5 animate-in fade-in duration-200">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  Your account is not verified yet. Please enter the 6-digit code sent to your inbox.
                </span>
              </div>
              <Link
                href={`/verify?email=${encodeURIComponent(unverifiedEmail)}`}
                className="self-start text-[11px] font-bold text-black bg-amber-500 hover:bg-amber-400 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ml-6"
              >
                <span>Verify Now</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && !unverifiedEmail && (
            <div className="mb-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* Sign In Form */}
          <form onSubmit={handleSignIn} className="space-y-4" autoComplete="off">
            {/* Autofill Prevention: Dummy Hidden Honeypot Fields */}
            <input type="text" name="fakeusernameremembered" className="hidden" tabIndex={-1} aria-hidden="true" />
            <input type="password" name="fakepasswordremembered" className="hidden" tabIndex={-1} aria-hidden="true" />

            {/* Email Address */}
            <div>
              <label
                htmlFor="signin-email"
                className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
              >
                Email Address
              </label>
              <div className="relative flex items-center rounded-xl bg-[#0E0F12] border border-[#23252E] focus-within:border-amber-500/80 focus-within:ring-1 focus-within:ring-amber-500/40 transition-all">
                <div className="pl-3.5 pr-2 text-zinc-500 pointer-events-none">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="signin-email"
                  type="email"
                  required
                  autoComplete="none"
                  readOnly={isMountDelayedReadOnly}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex.rivera@example.com"
                  className="w-full bg-transparent py-3 pr-3.5 text-xs text-white placeholder-zinc-600 outline-none"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="signin-password"
                  className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => alert('Password reset is managed via Cinema City Hall support desk or automated re-registration.')}
                  className="text-[11px] text-zinc-500 hover:text-amber-400 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative flex items-center rounded-xl bg-[#0E0F12] border border-[#23252E] focus-within:border-amber-500/80 focus-within:ring-1 focus-within:ring-amber-500/40 transition-all">
                <div className="pl-3.5 pr-2 text-zinc-500 pointer-events-none">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  readOnly={isMountDelayedReadOnly}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-transparent py-3 pr-2 text-xs text-white placeholder-zinc-600 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-2 mr-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Action Button */}
            <div className="pt-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-xs py-3.5 px-4 rounded-xl shadow-lg shadow-amber-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In to MovieSeat</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Bottom Link */}
          <div className="mt-8 text-center text-xs text-zinc-400">
            Don&apos;t have an account?{' '}
            <Link
              href="/signup"
              className="font-semibold text-amber-500 hover:text-amber-400 transition-colors ml-1"
            >
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
