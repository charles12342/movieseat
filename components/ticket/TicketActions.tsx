'use client';

import Link from 'next/link';
import { Download, Search, Film } from 'lucide-react';

interface TicketActionsProps {
  reservationId: string;
  referenceCode: string;
}

export default function TicketActions({ reservationId, referenceCode }: TicketActionsProps) {
  const pdfDownloadUrl = `/api/reservations/${reservationId}/pdf`;

  return (
    <div
      id="ticket-actions-bar"
      className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2"
    >
      {/* Primary Action: Download PDF */}
      <a
        id="download-ticket-pdf"
        href={pdfDownloadUrl}
        download={`MovieSeat-Ticket-${referenceCode}.pdf`}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black font-bold text-sm shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-all cursor-pointer"
      >
        <Download className="w-4 h-4" aria-hidden="true" />
        <span>Print / Save Ticket (PDF)</span>
      </a>

      {/* Secondary Actions */}
      <div className="w-full sm:w-auto flex items-center gap-3">
        <Link
          id="lookup-anytime-button"
          href="/find-reservation"
          className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#15161B] hover:bg-[#1C1E26] border border-[#23252E] hover:border-zinc-700 text-zinc-300 hover:text-white text-sm font-semibold transition-colors"
        >
          <Search className="w-4 h-4 text-amber-500" aria-hidden="true" />
          <span>Lookup Anytime</span>
        </Link>

        <Link
          id="book-another-movie-button"
          href="/"
          className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#15161B] hover:bg-[#1C1E26] border border-[#23252E] hover:border-zinc-700 text-zinc-300 hover:text-white text-sm font-semibold transition-colors"
        >
          <Film className="w-4 h-4 text-sky-400" aria-hidden="true" />
          <span>Book Another Movie</span>
        </Link>
      </div>
    </div>
  );
}
