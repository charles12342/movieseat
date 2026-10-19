'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User, Mail, Lock, RotateCcw, Eye, EyeOff, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';

export default function SignUpPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validation
    if (!fullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    if (!agreeTerms) {
      setErrorMessage('You must agree to the Terms of Service and Theater Rules to register.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || 'Failed to create account. Please try again.');
        setLoading(false);
        return;
      }

      // Successful signup: redirect to verification screen with email prefilled
      router.push(`/verify?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch {
      setErrorMessage('Network error occurred. Please check your connection and try again.');
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

      <div className="relative w-full max-w-[480px]">
        {/* Card Container */}
        <div className="bg-[#15161B] border border-[#23252E] rounded-2xl shadow-2xl p-6 sm:p-8 backdrop-blur-xl">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Create your MovieSeat Account
            </h1>
            <p className="mt-2 text-xs text-zinc-400 max-w-sm mx-auto leading-relaxed">
              Join MovieSeat to reserve seats faster, track digital tickets, and access your booking history.
            </p>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="mb-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <div>
              <label
                htmlFor="fullName"
                className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
              >
                Full Name *
              </label>
              <div className="relative flex items-center rounded-xl bg-[#0E0F12] border border-[#23252E] focus-within:border-amber-500/80 focus-within:ring-1 focus-within:ring-amber-500/40 transition-all">
                <div className="pl-3.5 pr-2 text-zinc-500 pointer-events-none">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full bg-transparent py-3 pr-3.5 text-xs text-white placeholder-zinc-600 outline-none"
                />
              </div>
            </div>

            {/* Email Address */}
            <div>
              <label
                htmlFor="email"
                className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
              >
                Email Address *
              </label>
              <div className="relative flex items-center rounded-xl bg-[#0E0F12] border border-[#23252E] focus-within:border-amber-500/80 focus-within:ring-1 focus-within:ring-amber-500/40 transition-all">
                <div className="pl-3.5 pr-2 text-zinc-500 pointer-events-none">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex.rivera@example.com"
                  className="w-full bg-transparent py-3 pr-3.5 text-xs text-white placeholder-zinc-600 outline-none"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
              >
                Password *
              </label>
              <div className="relative flex items-center rounded-xl bg-[#0E0F12] border border-[#23252E] focus-within:border-amber-500/80 focus-within:ring-1 focus-within:ring-amber-500/40 transition-all">
                <div className="pl-3.5 pr-2 text-zinc-500 pointer-events-none">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
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

            {/* Confirm Password */}
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
              >
                Confirm Password *
              </label>
              <div className="relative flex items-center rounded-xl bg-[#0E0F12] border border-[#23252E] focus-within:border-amber-500/80 focus-within:ring-1 focus-within:ring-amber-500/40 transition-all">
                <div className="pl-3.5 pr-2 text-zinc-500 pointer-events-none">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-transparent py-3 pr-2 text-xs text-white placeholder-zinc-600 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="p-2 mr-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Terms Agreement Checkbox */}
            <div className="pt-2">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-amber-500 focus:ring-amber-500/40"
                />
                <span className="text-[11px] text-zinc-400 leading-snug">
                  I agree to the{' '}
                  <span className="text-zinc-200 hover:underline">Terms of Service</span>,{' '}
                  <span className="text-zinc-200 hover:underline">Theater House Rules</span>, and consent to digital processing under the{' '}
                  <span className="text-zinc-200 hover:underline">Privacy Policy</span>.
                </span>
              </label>
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
                    <span>Creating Account...</span>
                  </>
                ) : (
                  <>
                    <span>Create Account</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Bottom Navigation */}
          <div className="mt-8 text-center text-xs text-zinc-400">
            Already have an account?{' '}
            <Link
              href="/signin"
              className="font-semibold text-amber-500 hover:text-amber-400 transition-colors ml-1"
            >
              Sign In →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
