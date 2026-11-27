'use client';

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function PwaSupport() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // ignore registration errors in unsupported contexts
      });
    }

    const updateStatus = () => {
      const offline = !navigator.onLine;
      setIsOffline(offline);
      if (!offline) {
        window.dispatchEvent(new Event('studyflow:profile-refresh'));
      }
    };

    setIsOffline(!navigator.onLine);
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[9999] px-3.5 py-2 rounded-full bg-amber-500 text-slate-950 text-xs font-bold shadow-xl flex items-center gap-2 border border-amber-300 pointer-events-none">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Modo offline — lendo dados salvos neste aparelho</span>
    </div>
  );
}
