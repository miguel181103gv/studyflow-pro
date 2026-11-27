'use client';

import React, { useEffect, useRef } from 'react';
import { Highlighter } from 'lucide-react';
import { HIGHLIGHT_STYLES, HighlightTone, LegalBlock } from '@/lib/leiSecaParser';
import { DictionaryText } from './DictionaryText';

export function LegalBlocksView({
  blocks,
  highlights,
  onToggleHighlight,
  interactive = true,
  articleId,
  targetArtNum,
  targetSub,
}: {
  blocks: LegalBlock[];
  highlights?: Record<string, HighlightTone>;
  onToggleHighlight?: (blockId: string) => void;
  interactive?: boolean;
  articleId?: string;
  targetArtNum?: string;
  targetSub?: { inciso?: string; paragrafo?: string; alinea?: string };
}) {
  const targetRef = useRef<HTMLDivElement | null>(null);

  // Determina qual bloco específico deve receber foco e scroll
  const targetBlockId = React.useMemo(() => {
    if (!targetSub && !targetArtNum) return '';
    let inTargetArt = !targetArtNum;
    let inTargetPar = !targetSub?.paragrafo;
    let inTargetInc = !targetSub?.inciso;
    let bestId = '';

    for (const b of blocks) {
      if (b.kind === 'artigo') {
        const bNum = b.marker.match(/\d+(?:-[A-Za-z]+)?/)?.[0]?.toLowerCase() || '';
        inTargetArt = !targetArtNum || bNum === targetArtNum.toLowerCase();
        inTargetPar = !targetSub?.paragrafo;
        inTargetInc = !targetSub?.inciso;
        if (inTargetArt && !targetSub?.paragrafo && !targetSub?.inciso && !targetSub?.alinea) {
          return b.id;
        }
        if (inTargetArt && !bestId) bestId = b.id;
      } else if (!inTargetArt) {
        continue;
      } else if (b.kind === 'paragrafo' && targetSub?.paragrafo) {
        const want = targetSub.paragrafo.toLowerCase();
        const isUnico = want === 'unico' && /único/i.test(b.marker);
        const pNum = b.marker.match(/\d+(?:-[A-Za-z]+)?/)?.[0]?.toLowerCase() || '';
        inTargetPar = isUnico || pNum === want;
        inTargetInc = !targetSub?.inciso;
        if (inTargetPar && !targetSub?.inciso && !targetSub?.alinea) return b.id;
        if (inTargetPar) bestId = b.id;
      } else if (b.kind === 'inciso' && inTargetPar && targetSub?.inciso) {
        if (b.marker.trim().toUpperCase() === targetSub.inciso.trim().toUpperCase()) {
          inTargetInc = true;
          if (!targetSub?.alinea) return b.id;
          bestId = b.id;
        } else {
          inTargetInc = false;
        }
      } else if (b.kind === 'alinea' && inTargetPar && inTargetInc && targetSub?.alinea) {
        const alLetter = b.marker.replace(/[^a-z]/gi, '').toLowerCase();
        if (alLetter === targetSub.alinea.toLowerCase()) {
          return b.id;
        }
      }
    }
    return bestId;
  }, [blocks, targetArtNum, targetSub]);

  useEffect(() => {
    if (!targetBlockId) return;
    const t = setTimeout(() => {
      targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => clearTimeout(t);
  }, [targetBlockId]);
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-2">
      {blocks.map((b) => {
        const tone: HighlightTone = highlights?.[b.id] || 'none';
        const style = HIGHLIGHT_STYLES[tone];

        if (b.kind === 'artigo') {
          const blockArtNum = b.marker.match(/\d+(?:-[A-Za-z]+)?/)?.[0]?.toLowerCase() || '';
          const isTargetBlock = b.id === targetBlockId || Boolean(!targetBlockId && targetArtNum && blockArtNum && blockArtNum === targetArtNum);
          return (
            <div
              key={b.id}
              ref={isTargetBlock ? targetRef : undefined}
              id={articleId && blockArtNum ? `${articleId}-art-${blockArtNum}` : undefined}
              className={`group scroll-mt-24 rounded-2xl p-3.5 border ${
                isTargetBlock
                  ? 'border-indigo-500 ring-2 ring-indigo-500/60 bg-indigo-500/12'
                  : `border-teal-500/25 ${tone !== 'none' ? `${style.bg} ${style.border}` : 'bg-teal-500/5'}`
              } transition`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm leading-relaxed">
                  <span className="inline-flex items-center px-2 py-0.5 mr-2 rounded-lg bg-teal-600 text-white text-xs font-extrabold tracking-wide">
                    {b.marker}
                  </span>
                  <span className="font-medium">
                    <DictionaryText text={b.body} />
                  </span>
                </p>
                {interactive && onToggleHighlight && (
                  <button
                    type="button"
                    onClick={() => onToggleHighlight(b.id)}
                    title={`Destacar (${style.label})`}
                    className={`p-1.5 rounded-lg shrink-0 transition ${
                      tone !== 'none'
                        ? 'opacity-100 text-amber-600 dark:text-amber-300'
                        : 'opacity-40 group-hover:opacity-100 text-muted-theme'
                    }`}
                  >
                    <Highlighter className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {b.annotations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {b.annotations.map((ann, i) => (
                    <span
                      key={i}
                      className="text-[10px] italic px-2 py-0.5 rounded-full subtle-surface border border-theme text-muted-theme"
                    >
                      <DictionaryText text={ann} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        }

        if (b.kind === 'inciso') {
          const isTargetInc = b.id === targetBlockId;
          return (
            <div
              key={b.id}
              ref={isTargetInc ? targetRef : undefined}
              className={`group ml-2 sm:ml-4 rounded-2xl px-3.5 py-2.5 border flex items-start justify-between gap-2.5 transition ${
                isTargetInc
                  ? 'border-indigo-500 ring-2 ring-indigo-500/60 bg-indigo-500/12'
                  : `border-theme ${tone !== 'none' ? `${style.bg} ${style.border}` : 'subtle-surface border-l-4 border-l-teal-500/50'}`
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="min-w-[2rem] text-center px-2 py-0.5 rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-300 text-xs font-extrabold shrink-0 mt-0.5">
                  {b.marker}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-[13.5px] leading-relaxed">
                    <DictionaryText text={b.body} />
                  </p>
                  {b.annotations.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {b.annotations.map((ann, i) => (
                        <span
                          key={i}
                          className="text-[10px] italic px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/5 text-muted-theme"
                        >
                          <DictionaryText text={ann} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {interactive && onToggleHighlight && (
                <button
                  type="button"
                  onClick={() => onToggleHighlight(b.id)}
                  title={`Destacar inciso (${style.label})`}
                  className={`p-1.5 rounded-lg shrink-0 transition ${
                    tone !== 'none'
                      ? 'opacity-100 text-amber-600 dark:text-amber-300'
                      : 'opacity-35 group-hover:opacity-100 text-muted-theme'
                  }`}
                >
                  <Highlighter className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        }

        if (b.kind === 'paragrafo') {
          return (
            <div
              key={b.id}
              className={`group ml-1 sm:ml-2 rounded-2xl px-3.5 py-2.5 border border-indigo-500/25 flex items-start justify-between gap-2.5 transition ${
                tone !== 'none' ? `${style.bg} ${style.border}` : 'bg-indigo-500/5'
              }`}
            >
              <div className="min-w-0 space-y-1">
                <p className="text-[13.5px] leading-relaxed">
                  <span className="inline-flex items-center px-2 py-0.5 mr-2 rounded-lg bg-indigo-600/15 text-indigo-700 dark:text-indigo-300 text-xs font-extrabold">
                    {b.marker}
                  </span>
                  <span>
                    <DictionaryText text={b.body} />
                  </span>
                </p>
                {b.annotations.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {b.annotations.map((ann, i) => (
                      <span
                        key={i}
                        className="text-[10px] italic px-2 py-0.5 rounded-full subtle-surface border border-theme text-muted-theme"
                      >
                        <DictionaryText text={ann} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {interactive && onToggleHighlight && (
                <button
                  type="button"
                  onClick={() => onToggleHighlight(b.id)}
                  title={`Destacar parágrafo (${style.label})`}
                  className={`p-1.5 rounded-lg shrink-0 transition ${
                    tone !== 'none'
                      ? 'opacity-100 text-amber-600 dark:text-amber-300'
                      : 'opacity-35 group-hover:opacity-100 text-muted-theme'
                  }`}
                >
                  <Highlighter className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        }

        if (b.kind === 'alinea' || b.kind === 'item') {
          return (
            <div
              key={b.id}
              className={`group ${
                b.kind === 'alinea' ? 'ml-4 sm:ml-8' : 'ml-8 sm:ml-12'
              } rounded-xl px-3 py-2 border border-theme flex items-start justify-between gap-2 transition ${
                tone !== 'none' ? `${style.bg} ${style.border}` : 'subtle-surface'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                <span className="px-1.5 py-0.5 rounded-md bg-slate-500/15 text-xs font-bold shrink-0">
                  {b.marker}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-[13px] leading-relaxed">
                    <DictionaryText text={b.body} />
                  </p>
                  {b.annotations.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {b.annotations.map((ann, i) => (
                        <span
                          key={i}
                          className="text-[10px] italic px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/5 text-muted-theme"
                        >
                          <DictionaryText text={ann} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {interactive && onToggleHighlight && (
                <button
                  type="button"
                  onClick={() => onToggleHighlight(b.id)}
                  title={`Destacar (${style.label})`}
                  className={`p-1 rounded-lg shrink-0 transition ${
                    tone !== 'none'
                      ? 'opacity-100 text-amber-600 dark:text-amber-300'
                      : 'opacity-35 group-hover:opacity-100 text-muted-theme'
                  }`}
                >
                  <Highlighter className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        }

        return (
          <div
            key={b.id}
            className={`group rounded-2xl px-3.5 py-2.5 border border-theme flex items-start justify-between gap-2 ${
              tone !== 'none' ? `${style.bg} ${style.border}` : 'subtle-surface'
            }`}
          >
            <p className="text-[13.5px] leading-relaxed">
              <DictionaryText text={b.body} />
            </p>
            {interactive && onToggleHighlight && (
              <button
                type="button"
                onClick={() => onToggleHighlight(b.id)}
                className={`p-1.5 rounded-lg shrink-0 transition ${
                  tone !== 'none'
                    ? 'opacity-100 text-amber-600 dark:text-amber-300'
                    : 'opacity-35 group-hover:opacity-100 text-muted-theme'
                }`}
              >
                <Highlighter className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
