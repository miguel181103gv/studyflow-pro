'use client';

import { useAiProviderName } from '@/lib/useAiProvider';

import React, { createContext, useCallback, useContext, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Loader2,
  Youtube,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ArrowUpRight,
  X,
} from 'lucide-react';

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

export interface AiJob {
  id: string;
  kind: 'explain_error' | 'flashcards' | 'report' | 'quiz';
  label: string;
  status: 'running' | 'done' | 'error';
  route?: string;
  result?: unknown;
  error?: string;
  updatedAt: number;
}

interface RunAiJobConfig<T> {
  id: string;
  kind: AiJob['kind'];
  label: string;
  route?: string;
  successMsg?: string;
  keepResult?: boolean;
  task: () => Promise<T>;
  onDone?: (result: T) => void | Promise<void>;
}

interface ToastState {
  msg: string;
  tone: 'success' | 'info' | 'error';
  onUndo?: () => void;
}

interface GlobalContextValue {
  videoJob: VideoJobState;
  startBatchVideoJob: (
    profileName: string,
    items: BatchVideoItem[],
    onEachDone?: (topicId: string, url: string) => void
  ) => void;
  dismissVideoJob: () => void;
  aiJobs: Record<string, AiJob>;
  runAiJob: <T>(config: RunAiJobConfig<T>) => void;
  dismissAiJob: (id: string) => void;
  notify: (msg: string, tone?: 'success' | 'info' | 'error', onUndo?: () => void) => void;
}

const GlobalContext = createContext<GlobalContextValue | null>(null);

export function GlobalProvider({ children }: { children: React.ReactNode }) {
  const aiName = useAiProviderName();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [aiJobs, setAiJobs] = useState<Record<string, AiJob>>({});

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

  const notify = useCallback(
    (msg: string, tone: 'success' | 'info' | 'error' = 'success', onUndo?: () => void) => {
      setToast({ msg, tone, onUndo });
      setTimeout(() => {
        setToast((prev) => (prev?.msg === msg ? null : prev));
      }, onUndo ? 6000 : 3800);
    },
    []
  );

  const dismissVideoJob = useCallback(() => {
    setVideoJob((prev) => ({ ...prev, finished: false, errorMsg: null }));
  }, []);

  const dismissAiJob = useCallback((id: string) => {
    setAiJobs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const runAiJob = useCallback(
    <T,>({ id, kind, label, route, successMsg, keepResult, task, onDone }: RunAiJobConfig<T>) => {
      let alreadyRunning = false;
      setAiJobs((prev) => {
        if (prev[id]?.status === 'running') {
          alreadyRunning = true;
          return prev;
        }
        return {
          ...prev,
          [id]: {
            id,
            kind,
            label,
            status: 'running',
            route,
            updatedAt: Date.now(),
          },
        };
      });

      if (alreadyRunning) return;

      (async () => {
        try {
          const result = await task();
          if (onDone) {
            await onDone(result);
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('studyflow:profile-refresh'));
          }

          setAiJobs((prev) => ({
            ...prev,
            [id]: {
              id,
              kind,
              label,
              status: 'done',
              route,
              result: keepResult ? result : undefined,
              updatedAt: Date.now(),
            },
          }));

          notify(successMsg || `${label} concluído!`, 'success');

          if (!keepResult) {
            setTimeout(() => {
              setAiJobs((prev) => {
                if (prev[id]?.status !== 'done') return prev;
                const next = { ...prev };
                delete next[id];
                return next;
              });
            }, 6500);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Erro ao consultar o Gemini.';
          setAiJobs((prev) => ({
            ...prev,
            [id]: {
              id,
              kind,
              label,
              status: 'error',
              route,
              error: errMsg,
              updatedAt: Date.now(),
            },
          }));
          notify(errMsg, 'error');
        }
      })();
    },
    [notify]
  );

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
          // Continua para o próximo tópico
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

  const activeAiJobs = Object.values(aiJobs).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <GlobalContext.Provider
      value={{
        videoJob,
        startBatchVideoJob,
        dismissVideoJob,
        aiJobs,
        runAiJob,
        dismissAiJob,
        notify,
      }}
    >
      {children}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold flex items-center gap-3 animate-pop-in max-w-[92vw] ${
            toast.tone === 'error'
              ? 'bg-rose-600 text-white'
              : toast.tone === 'info'
              ? 'bg-slate-900 text-white'
              : 'bg-teal-700 text-white'
          }`}
        >
          {toast.tone === 'error' ? (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          )}
          <span>{toast.msg}</span>
          {toast.onUndo && (
            <button
              onClick={() => {
                const fn = toast.onUndo;
                setToast(null);
                fn?.();
              }}
              className="px-2.5 py-1 rounded-xl bg-white/20 hover:bg-white/30 text-white inline-flex items-center gap-1 shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              Desfazer
            </button>
          )}
        </div>
      )}

      {/* Dock flutuante unificado para tarefas em segundo plano (Gemini AI + Vídeos) */}
      {(activeAiJobs.length > 0 || videoJob.running || videoJob.finished || videoJob.errorMsg) && (
        <div className="fixed bottom-20 lg:bottom-5 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)] sm:w-80 pointer-events-none">
          {activeAiJobs.map((job) => (
            <div
              key={job.id}
              className="pointer-events-auto rounded-2xl bg-slate-900/95 backdrop-blur-md text-white border border-white/15 shadow-xl px-4 py-3 flex items-start gap-3 text-xs animate-pop-in"
            >
              {job.status === 'running' ? (
                <Loader2 className="w-4 h-4 animate-spin text-violet-400 shrink-0 mt-0.5" />
              ) : job.status === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              )}

              <div className="min-w-0 flex-1">
                <p className="font-bold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <span className="truncate">
                    {job.status === 'running'
                      ? `${aiName} trabalhando em segundo plano`
                      : job.status === 'error'
                      ? `Falha na tarefa do ${aiName}`
                      : `Tarefa do ${aiName} concluída`}
                  </span>
                </p>
                <p className="text-[11px] text-slate-300 mt-0.5 break-words">
                  {job.status === 'error' ? job.error : job.label}
                </p>
                {job.route && (
                  <Link
                    href={job.route}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-teal-300 hover:text-teal-200"
                  >
                    {job.status === 'done' && job.kind === 'quiz'
                      ? 'Abrir quiz pronto'
                      : 'Ir para a tela'}
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
                )}
              </div>

              {job.status !== 'running' && (
                <button
                  onClick={() => dismissAiJob(job.id)}
                  aria-label="Fechar aviso"
                  className="text-slate-400 hover:text-white p-0.5 rounded-lg"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}

          {(videoJob.running || videoJob.finished || videoJob.errorMsg) && (
            <div className="pointer-events-auto rounded-2xl bg-slate-900/95 backdrop-blur-md text-white border border-white/15 shadow-xl px-4 py-3 flex items-start gap-3 text-xs animate-pop-in">
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
                  aria-label="Fechar aviso"
                  className="text-slate-400 hover:text-white p-0.5 rounded-lg"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
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
