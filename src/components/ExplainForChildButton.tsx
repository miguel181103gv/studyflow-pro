'use client';

import React, { useState } from 'react';
import { Baby, ChevronUp, Languages, Loader2 } from 'lucide-react';
import { DictionaryText } from './DictionaryText';

function quickHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return String(h);
}

export function ExplainForChildButton({
  title = '',
  content,
  context = '',
  mode = 'explanation',
  compact = false,
}: {
  title?: string;
  content: string;
  context?: string;
  mode?: 'explanation' | 'statement';
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  if (!content.trim() && !title.trim()) return null;

  const isStatement = mode === 'statement';
  const cacheKey = `sf_kid_${mode}_${quickHash(`${title}|${context}|${content.slice(0, 300)}`)}`;

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();

    if (result) {
      setOpen((v) => !v);
      return;
    }

    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        setResult(cached);
        setOpen(true);
        return;
      }
    } catch {
      // ignore
    }

    setLoading(true);
    setError('');
    setOpen(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'explain_for_child',
          mode,
          title: title.slice(0, 300),
          content: content.slice(0, 6000),
          context: context.slice(0, 200),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data?.explanation) {
        throw new Error(json.error || 'Não foi possível gerar a explicação simples.');
      }
      const txt = String(json.data.explanation).trim();
      setResult(txt);
      try {
        sessionStorage.setItem(cacheKey, txt);
      } catch {
        // ignore
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao consultar a IA.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => void handleClick(e)}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 rounded-xl font-bold transition border ${
          compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
        } ${
          isStatement
            ? 'bg-sky-500/12 hover:bg-sky-500/20 border-sky-500/35 text-sky-700 dark:text-sky-300'
            : 'bg-amber-500/12 hover:bg-amber-500/20 border-amber-500/35 text-amber-700 dark:text-amber-300'
        } disabled:opacity-60`}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : open && result ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : isStatement ? (
          <Languages className="w-3.5 h-3.5" />
        ) : (
          <Baby className="w-3.5 h-3.5" />
        )}
        {loading
          ? isStatement
            ? 'Traduzindo enunciado...'
            : 'Mastigando explicação...'
          : open && result
          ? isStatement
            ? 'Ocultar tradução'
            : 'Ocultar explicação simples'
          : isStatement
          ? 'Traduzir enunciado'
          : 'Explicar para criança'}
      </button>

      {open && (result || error) && (
        <div
          className={`rounded-2xl border p-4 text-xs sm:text-[13px] leading-relaxed space-y-1.5 animate-fade-in-up ${
            isStatement
              ? 'border-sky-500/35 bg-sky-500/8'
              : 'border-amber-500/35 bg-amber-500/8'
          }`}
        >
          <div
            className={`flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider ${
              isStatement
                ? 'text-sky-700 dark:text-sky-300'
                : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            {isStatement ? (
              <>
                <Languages className="w-3.5 h-3.5" />
                Tradutor do enunciado (passo a passo · sem spoiler)
              </>
            ) : (
              <>
                <Baby className="w-3.5 h-3.5" />
                Explicação bem simples (mastigada)
              </>
            )}
          </div>
          {error ? (
            <p className="text-rose-600 dark:text-rose-300">{error}</p>
          ) : (
            <p className="whitespace-pre-wrap text-[var(--text-main)]">
              <DictionaryText text={result} />
            </p>
          )}
        </div>
      )}
    </div>
  );
}
