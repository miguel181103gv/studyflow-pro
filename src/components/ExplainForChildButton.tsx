'use client';

import React, { useState } from 'react';
import { Baby, ChevronUp, Languages, Loader2 } from 'lucide-react';
import { DictionaryText } from './DictionaryText';

export interface FormattedChildExplanation {
  title: string;
  summary: string;
  sections: { heading: string; points: string[]; callout?: string }[];
}

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
  onSaveAsNewTab,
}: {
  title?: string;
  content: string;
  context?: string;
  mode?: 'explanation' | 'statement';
  compact?: boolean;
  onSaveAsNewTab?: (formatted: FormattedChildExplanation, tabTitle: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<FormattedChildExplanation | null>(null);
  const [error, setError] = useState<string>('');

  if (!content.trim() && !title.trim()) return null;

  const isStatement = mode === 'statement';
  const cacheKey = `sf_kid2_${mode}_${quickHash(`${title}|${context}|${content.slice(0, 300)}`)}`;

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();

    if (result && !onSaveAsNewTab) {
      setOpen((v) => !v);
      return;
    }

    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as FormattedChildExplanation;
        if (parsed && parsed.title) {
          if (onSaveAsNewTab) {
            onSaveAsNewTab(parsed, '🧸 Explicação p/ Criança');
            return;
          }
          setResult(parsed);
          setOpen(true);
          return;
        }
      }
    } catch {
      // ignore
    }

    setLoading(true);
    setError('');
    if (!onSaveAsNewTab) setOpen(true);
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
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error || 'Não foi possível gerar a explicação simples.');
      }
      const data = json.data as FormattedChildExplanation;
      const cleanData: FormattedChildExplanation = {
        title: String(data.title || title || 'Explicação Simples'),
        summary: String(data.summary || ''),
        sections: Array.isArray(data.sections) ? data.sections : [],
      };
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(cleanData));
      } catch {
        // ignore
      }
      if (onSaveAsNewTab) {
        onSaveAsNewTab(cleanData, '🧸 Explicação p/ Criança');
      } else {
        setResult(cleanData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao consultar a IA.');
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => void handleClick(e)}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 rounded-xl font-bold transition border ${
          compact ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs'
        } ${
          isStatement
            ? 'bg-sky-500/12 hover:bg-sky-500/20 border-sky-500/35 text-sky-700 dark:text-sky-300'
            : 'bg-amber-500/12 hover:bg-amber-500/20 border-amber-500/35 text-amber-700 dark:text-amber-300'
        } disabled:opacity-60`}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : open && result && !onSaveAsNewTab ? (
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
          : open && result && !onSaveAsNewTab
          ? isStatement
            ? 'Ocultar tradução'
            : 'Ocultar explicação simples'
          : isStatement
          ? 'Traduzir enunciado'
          : onSaveAsNewTab
          ? 'Explicar p/ criança (novo texto)'
          : 'Explicar para criança'}
      </button>

      {open && error && (
        <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-xs text-rose-600 dark:text-rose-300">
          {error}
        </div>
      )}

      {open && !error && result && !onSaveAsNewTab && (
        <div className="space-y-3 animate-fade-in-up">
          <div
            className={`card-surface rounded-2xl p-4 sm:p-5 space-y-1.5 border-l-4 ${
              isStatement ? 'border-l-sky-500' : 'border-l-amber-500'
            }`}
          >
            <h4 className="text-sm sm:text-base font-extrabold">{result.title}</h4>
            {result.summary && (
              <p className="text-xs sm:text-[13px] text-muted-theme leading-relaxed">
                <DictionaryText text={result.summary} />
              </p>
            )}
          </div>

          {result.sections.map((sec, sIdx) => (
            <div key={sIdx} className="card-surface rounded-2xl p-4 sm:p-5 space-y-2.5 border border-theme">
              <h5
                className={`text-xs sm:text-sm font-bold ${
                  isStatement
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {sec.heading}
              </h5>
              {sec.points && sec.points.length > 0 && (
                <ul className="space-y-1.5">
                  {sec.points.map((pt, pIdx) => (
                    <li
                      key={pIdx}
                      className="flex items-start gap-2 text-xs sm:text-[13px] leading-relaxed"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${
                          isStatement ? 'bg-sky-500' : 'bg-amber-500'
                        }`}
                      />
                      <span>
                        <DictionaryText text={pt} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {sec.callout && sec.callout.trim() && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 text-xs">
                  <strong className="text-amber-700 dark:text-amber-300">Dica de ouro: </strong>
                  <DictionaryText text={sec.callout} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
