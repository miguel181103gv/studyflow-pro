'use client';

import React, { createContext, useContext, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Youtube, CheckCircle2, AlertTriangle } from 'lucide-react';

interface VideoJobState {
  running: boolean;
  finished: boolean;
  errorMsg: string | null;
  profileName: string;
  done: number;
  total: number;
  savedCount: number;
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
  dismissVideoJob: () => void;
}

const GlobalContext = createContext<GlobalContextValue | null>(null);

export function GlobalProvider({ children }: { children: React.ReactNode }) {
  const [videoJob, setVideoJob] = useState<VideoJobState>({
    running: false,
    finished: false,
    errorMsg: null,
    profileName: '',
    done: 0,
    total: 0,
    savedCount: 0,
    currentLabel: '',
  });

  const dismissVideoJob = () => {
    setVideoJob((prev) => ({ ...prev, finished: false, errorMsg: null }));
  };

  const startBatchVideoJob = (
    profileName: string,
    items: BatchVideoItem[],
    onEachDone?: (topicId: string, url: string) => void
  ) => {
    if (items.length === 0 || videoJob.running) return;

    setVideoJob({
      running: true,
      finished: false,
      errorMsg: null,
      profileName,
      done: 0,
      total: items.length,
      savedCount: 0,
      currentLabel: items[0].topicTitle,
    });

    (async () => {
      const supabase = createClient();
      let saved = 0;
      let dbError: string | null = null;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setVideoJob((prev) => ({
          ...prev,
          done: i,
          savedCount: saved,
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
            const { error } = await supabase
              .from('topics')
              .update({ video_url: url })
              .eq('id', item.topicId);

            if (error) {
              dbError = error.message;
              break;
            }
            saved++;
            onEachDone?.(item.topicId, url);
          }
        } catch {
          // Continua para o próximo tópico se um falhar na busca
        }
      }

      setVideoJob((prev) => ({
        ...prev,
        running: false,
        finished: !dbError,
        errorMsg: dbError
          ? dbError.includes('video_url')
            ? 'Falta criar a coluna video_url no Supabase (SQL Editor).'
            : `Erro ao salvar no banco: ${dbError}`
          : null,
        done: items.length,
        savedCount: saved,
        currentLabel: dbError ? '' : `${saved} de ${items.length} vídeos salvos na nuvem!`,
      }));

      if (!dbError) {
        setTimeout(() => {
          setVideoJob((prev) => (prev.running ? prev : { ...prev, finished: false }));
        }, 7000);
      }
    })();
  };

  return (
    <GlobalContext.Provider value={{ videoJob, startBatchVideoJob, dismissVideoJob }}>
      {children}

      {(videoJob.running || videoJob.finished || videoJob.errorMsg) && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl bg-slate-900 text-white border border-white/15 shadow-2xl px-4 py-3 flex items-start gap-3 text-xs">
          {videoJob.running ? (
            <Loader2 className="w-4 h-4 animate-spin text-red-400 shrink-0 mt-0.5" />
          ) : videoJob.errorMsg ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-bold flex items-center gap-1.5">
              <Youtube className="w-3.5 h-3.5 text-red-400 shrink-0" />
              {videoJob.running
                ? `Vídeos (${videoJob.done}/${videoJob.total}) · ${videoJob.profileName}`
                : videoJob.errorMsg
                ? 'Não foi possível salvar os vídeos'
                : `Vídeos salvos (${videoJob.savedCount}/${videoJob.total})`}
            </p>
            <p className="text-[11px] text-slate-300 mt-0.5 break-words">
              {videoJob.errorMsg || videoJob.currentLabel}
            </p>
          </div>
          {!videoJob.running && (
            <button
              onClick={dismissVideoJob}
              className="text-slate-400 hover:text-white text-[11px] font-bold px-1"
            >
              ✕
            </button>
          )}
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
