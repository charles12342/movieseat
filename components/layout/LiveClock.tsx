'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { formatManilaClock } from '@/lib/time';

export default function LiveClock() {
  const [timeString, setTimeString] = useState<string>('');

  useEffect(() => {
    let driftOffset = 0;

    // Initial server-sync offset to eliminate device clock drift
    fetch('/api/time')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.serverTimeMs) {
          driftOffset = data.serverTimeMs - Date.now();
        }
        setTimeString(formatManilaClock(new Date(Date.now() + driftOffset)));
      })
      .catch(() => {
        // Fallback to client clock in Manila timezone
        setTimeString(formatManilaClock(new Date()));
      });

    // 1-second interval update without repeated network requests
    const interval = setInterval(() => {
      setTimeString(formatManilaClock(new Date(Date.now() + driftOffset)));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!timeString) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
        <Clock className="w-3.5 h-3.5 text-amber-500" />
        <span className="tabular-nums">--:-- --</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-medium tracking-wide">
      <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
      <span className="tabular-nums">{timeString}</span>
    </div>
  );
}
