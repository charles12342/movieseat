'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Ticket, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export default function UserMenu() {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    // 1.2s safety fallback timer to eliminate hanging skeleton loaders for guest users
    const fallbackTimer = setTimeout(() => {
      if (isMounted) setLoading(false);
    }, 1200);

    // Fast-path instant local check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMounted) {
        setUser(session?.user ?? null);
        setLoading(false);
        clearTimeout(fallbackTimer);
      }
    }).catch(() => {
      if (isMounted) {
        setLoading(false);
        clearTimeout(fallbackTimer);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      setUser(null);
      setMenuOpen(false);
      router.refresh();
    } catch {
      // Ignore signOut errors
    }
  };

  // Skeleton during initial fast-path hydration
  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-16 h-8 bg-zinc-800/60 rounded-md animate-pulse" />
        <div className="w-24 h-8 bg-amber-500/20 rounded-md animate-pulse" />
      </div>
    );
  }

  // Authenticated State
  if (user) {
    const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Patron';
    const initials = displayName.substring(0, 2).toUpperCase();

    return (
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 p-1.5 rounded-full hover:bg-zinc-800/80 transition-colors border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
          aria-expanded={menuOpen}
          aria-haspopup="true"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-xs font-bold text-black ring-1 ring-amber-400/50">
            {initials}
          </div>
          <span className="text-xs text-zinc-300 font-medium hidden md:inline max-w-[100px] truncate">
            {displayName}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-52 bg-[#15161B] border border-[#23252E] rounded-xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-4 py-2 border-b border-zinc-800/80">
                <p className="text-xs font-semibold text-white truncate">{displayName}</p>
                <p className="text-[11px] text-zinc-400 truncate">{user.email}</p>
              </div>

              <Link
                href="/find-reservation"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors"
              >
                <Ticket className="w-3.5 h-3.5 text-amber-500" />
                My Reservations
              </Link>

              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-red-400 hover:text-red-300 hover:bg-zinc-800/60 transition-colors text-left"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Guest State
  return (
    <div className="flex items-center gap-3">
      <Link
        href="/signin"
        className="text-xs font-medium text-zinc-300 hover:text-white transition-colors py-1.5 px-2"
      >
        Sign In
      </Link>
      <Link
        href="/signup"
        className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs px-3.5 py-1.5 rounded-lg transition-colors shadow-sm shadow-amber-500/20 active:scale-95"
      >
        Create Account
      </Link>
    </div>
  );
}
