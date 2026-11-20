'use client';

import React, { createContext, useContext, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Youtube, CheckCircle2 } from 'lucide-react';

interface VideoJobState {
  running: boolean;
  finished: boolean;
  profileName: string;
  done: number;
  total: number;
  currentLabel: string;
}

interface BatchVideoItem {
  topicId: string;
  subjectName: string;
  topicTitle: string;
}

interface GlobalContextValue {
  videoJob: VideoJobState;
  startBatchVideoJob: (
    profileName: string,
    items: BatchVideoItem[],
    onEachDone?: (topicId: string, url: string) => void
  ) => void;
}

const GlobalContext = createContext<GlobalContextValue | null>(null);

export function GlobalProvider({ children }: { children: React.ReactNode }) {
  const [videoJob, setVideoJob] = useState<VideoJobState>({
    running: false,
    finished: false,
    profileName: '',
    done: 0,
    total: 0,
    currentLabel: '',
  });

  const startBatchVideoJob = (
    profileName: string,
    items: BatchVideoItem[],
    onEachDone?: (topicId: string, url: string) => void
  ) => {
    if (items.length === 0 || videoJob.running) return;

    setVideoJob({
      running: true,
      finished: false,
      profileName,
      done: 0,
      total: items.length,
      currentLabel: items[0].topicTitle,
    });

    (async () => {
      const supabase = createClient();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setVideoJob((prev) => ({
          ...prev,
          done: i,
          currentLabel: item.topicTitle,
        }));
        try {
          const res = await fetch('/api/youtube', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subjectName: item.subjectName,
              topicTitle: item.topicTitle,
            }),
          });
          const json = await res.json();
          const url: string | undefined = json?.videos?.[0]?.url;
          if (res.ok && json.ok && url) {
            await supabase.from('topics').update({ video_url: url }).eq('id', item.topicId);
            onEachDone?.(item.topicId, url);
          }
        } catch {
          // Continua para o próximo tópico mesmo se um falhar
        }
      }

      setVideoJob((prev) => ({
        ...prev,
        running: false,
        finished: true,
        done: items.length,
        currentLabel: 'Concluído!',
      }));

      setTimeout(() => {
        setVideoJob((prev) => (prev.running ? prev : { ...prev, finished: false }));
      }, 6000);
    })();
  };

  return (
    <GlobalContext.Provider value={{ videoJob, startBatchVideoJob }}>
      {children}

      {/* Pill flutuante global de tarefas autônomas em segundo plano */}
      {(videoJob.running || videoJob.finished) && (
        <div className="fixed bottom-4 right-4 z-50 max-w-xs rounded-2xl bg-slate-900 text-white border border-white/15 shadow-2xl px-4 py-3 flex items-center gap-3 text-xs">
          {videoJob.running ? (
            <Loader2 className="w-4 h-4 animate-spin text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-bold flex items-center gap-1.5">
              <Youtube className="w-3.5 h-3.5 text-red-400 shrink-0" />
              {videoJob.running
                ? `Vídeos (${videoJob.done}/${videoJob.total}) · ${videoJob.profileName}`
                : `Vídeos prontos (${videoJob.total}/${videoJob.total})`}
            </p>
            <p className="text-[11px] text-slate-300 truncate">{videoJob.currentLabel}</p>
          </div>
        </div>
      )}
    </GlobalContext.Provider>
  );
}

export function useGlobal() {
  const ctx = useContext(GlobalContext);
  if (!ctx) throw new Error('useGlobal deve ser usado dentro de GlobalProvider');
  return ctx;
}
