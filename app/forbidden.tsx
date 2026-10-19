import Link from 'next/link';
import { ShieldAlert, ArrowLeft } from 'lucide-react';

export default function Forbidden() {
  return (
    <div className="max-w-md w-full mx-auto px-4 py-20 text-center flex flex-col items-center gap-4">
      <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
        <ShieldAlert className="w-8 h-8" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-white">403 Forbidden</h1>
      <p className="text-sm text-zinc-400">
        You do not have permission to view or manage this reservation ticket.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#15161B] hover:bg-[#1C1E26] border border-[#23252E] text-sm font-semibold text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Back to Now Showing
      </Link>
    </div>
  );
}
