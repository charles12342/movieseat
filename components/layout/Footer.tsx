export default function Footer() {
  return (
    <footer className="w-full bg-[#0B0B0D] border-t border-[#23252E] mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
        {/* Brand & Cinema City Hall */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-400">MovieSeat</span>
          <span>•</span>
          <span>Cinema City Hall</span>
        </div>

        {/* TMDB Notice */}
        <div className="text-center sm:text-left text-[11px] text-zinc-500 max-w-md">
          This product uses the TMDB API but is not endorsed or certified by TMDB. All movie media belongs to their respective owners.
        </div>

        {/* Live Status Badge */}
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>Asia/Manila (UTC+8)</span>
        </div>
      </div>
    </footer>
  );
}
