'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Ticket, Menu, X, Clapperboard, Search } from 'lucide-react';
import LiveClock from './LiveClock';
import UserMenu from './UserMenu';

export default function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isNowShowing = pathname === '/' || pathname.startsWith('/screenings');
  const isFindReservation = pathname.startsWith('/find-reservation');

  // Close mobile navigation menu on route change
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMobileMenuOpen(false);
  }

  return (
    <header className="sticky top-0 z-50 w-full bg-[#0B0B0D]/95 backdrop-blur-md border-b border-[#23252E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* Left: Brand Logo & Desktop Navigation Pills */}
        <div className="flex items-center gap-6 sm:gap-8">
          <Link href="/" className="flex items-center gap-2 transition-transform hover:opacity-95 shrink-0">
            <Image
              src="/logo.svg"
              alt="MovieSeat"
              width={141}
              height={32}
              priority
              className="h-7 sm:h-8 w-auto"
            />
          </Link>

          {/* Desktop Navigation Pills (hidden on mobile) */}
          <nav className="hidden sm:flex items-center gap-1.5 sm:gap-2" aria-label="Main Navigation">
            <Link
              href="/"
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isNowShowing
                  ? 'bg-amber-500 text-black shadow-sm shadow-amber-500/20'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              Now Showing
            </Link>
            <Link
              href="/find-reservation"
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isFindReservation
                  ? 'bg-amber-500 text-black shadow-sm shadow-amber-500/20'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              Find Reservation
            </Link>
          </nav>
        </div>

        {/* Right: Location Tag, LiveClock, User Menu & Mobile Hamburger */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          {/* Cinema Location Badge (hidden on mobile) */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-300 font-medium">
            <Ticket className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>Cinema City Hall</span>
          </div>

          <div className="hidden sm:block h-3.5 w-px bg-zinc-800" aria-hidden="true" />

          {/* Live Manila Clock */}
          <div className="flex items-center">
            <LiveClock />
          </div>

          <div className="h-3.5 w-px bg-zinc-800" aria-hidden="true" />

          {/* User Menu / Auth Action */}
          <UserMenu />

          {/* Mobile Navigation Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            className="sm:hidden flex items-center justify-center p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5 text-amber-400" aria-hidden="true" />
            ) : (
              <Menu className="w-5 h-5 text-zinc-300" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          id="mobile-navigation-menu"
          className="sm:hidden border-t border-[#23252E] bg-[#0E0F12]/98 backdrop-blur-xl px-4 py-4 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {/* Mobile Navigation Links */}
          <nav className="flex flex-col gap-1.5" aria-label="Mobile Navigation">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                isNowShowing
                  ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                  : 'text-zinc-300 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              <Clapperboard className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Now Showing</span>
            </Link>

            <Link
              href="/find-reservation"
              onClick={() => setMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                isFindReservation
                  ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                  : 'text-zinc-300 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Find Reservation</span>
            </Link>
          </nav>

          {/* Cinema Location Tag in Mobile Menu */}
          <div className="pt-2 border-t border-[#23252E] flex items-center justify-between text-xs text-zinc-400 px-2">
            <div className="flex items-center gap-2">
              <Ticket className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>Cinema City Hall</span>
            </div>
            <span className="text-[11px] text-zinc-500 font-mono">Asia/Manila</span>
          </div>
        </div>
      )}
    </header>
  );
}
