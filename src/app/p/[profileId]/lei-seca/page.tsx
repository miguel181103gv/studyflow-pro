'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useProfile } from '@/components/ProfileProvider';
import { CLOUD_SYNC_EVENT, pushLeiSecaToCloud } from '@/lib/cloudSync';
import { extractDocxLawText, extractHtmlLawText } from '@/lib/docExtract';
import { DictionaryText } from '@/components/DictionaryText';
import { useGlobal } from '@/components/GlobalProvider';
import { useAiProviderName } from '@/lib/useAiProvider';
import {
  normalizeLegalOrdinalsAndSpaces,
  parseLeiSecaBlocks,
  validateParsedLaw,
  type BlockKind,
  type HighlightTone,
  type LegalBlock,
} from '@/lib/leiSecaParser';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Edit3,
  Eye,
  Filter,
  Highlighter,
  Minus,
  Plus,
  RotateCcw,
  Scale,
  Search,
  Star,
  StickyNote,
  FileUp,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';


interface LeiSecaArticle {
  id: string;
  subjectId: string; // '' = Geral / Sem matéria
  lawName: string; // ex: CF/88, CLT, Lei 8.112/90
  title: string; // ex: Art. 7º - Direitos dos Trabalhadores
  rawText: string;
  note: string;
  studied: boolean;
  favorite?: boolean;
  readCount?: number;
  lastReadAt?: string;
  highlights: Record<string, HighlightTone>; // keyed by block index/id
  createdAt: string;
  updatedAt: string;
}

const LAW_PRESETS = [
  'CF/88',
  'CLT',
  'CPC',
  'CDC',
  'Código Civil',
  'Código Penal',
  'LC 101/2000 (LRF)',
  'Lei 8.429/1992',
  'Lei 8.112/90',
  'Lei 14.133/21',
  'LGPD',
];

const NORM_CATEGORIES = [
  { key: '__CAT:EC__', label: 'Emendas Constitucionais (EC)' },
  { key: '__CAT:LC__', label: 'Leis Complementares (LC)' },
  { key: '__CAT:LO__', label: 'Leis Ordinárias' },
  { key: '__CAT:MP__', label: 'Medidas Provisórias (MP)' },
  { key: '__CAT:LD__', label: 'Leis Delegadas' },
  { key: '__CAT:DLG__', label: 'Decretos Legislativos' },
  { key: '__CAT:RES__', label: 'Resoluções' },
  { key: '__CAT:DL__', label: 'Decretos-Leis' },
  { key: '__CAT:SUM__', label: 'Súmulas & OJs' },
] as const;

function classifyNormCategory(lawName: string, title = '', rawText = ''): string {
  const txt = `${lawName} ${title} ${rawText.slice(0, 300)}`.trim();
  if (/decreto\s+legislativo|decretos\s+legislativos|\bdlg\b/i.test(txt)) return '__CAT:DLG__';
  if (/\b(?:ec|ecr|emenda\s+constitucional|emendas\s+constitucionais)\b/i.test(txt)) return '__CAT:EC__';
  if (/\b(?:lc|lei\s+complementar)\b|101\/2000|responsabilidade\s+fiscal/i.test(txt)) return '__CAT:LC__';
  if (/\b(?:mp|medida\s+provis[óo]ria)\b/i.test(txt)) return '__CAT:MP__';
  if (/\bleis?\s+delegadas?\b|\bld\s*n[º°]?\s*\d/i.test(txt)) return '__CAT:LD__';
  if (/\bdecretos?\s+legislativos?\b|\bdlg\b/i.test(txt)) return '__CAT:DLG__';
  if (/\bresolu[çc][ãaõo]e?s?\b/i.test(txt)) return '__CAT:RES__';
  if (/decreto[-\s]?lei|\b(?:clt|c[óo]digo\s+penal|c[óo]digo\s+de\s+processo\s+penal|2\.?848|5\.?452|3\.?689)\b/i.test(txt)) return '__CAT:DL__';
  if (/\bs[úu]mula|\boj\s*\d+|orienta[çc][ãa]o\s+jurisprudencial/i.test(txt)) return '__CAT:SUM__';
  if (/\blei\b|8\.?429|8\.?112|14\.?133|9\.?784|8\.?078|10\.?406|13\.?105|13\.?709|8\.?069/i.test(txt)) return '__CAT:LO__';
  return '';
}

function normalizeLawBucket(lawName: string, title = '', rawText = ''): string {
  const combined = `${lawName} ${title} ${rawText.slice(0, 350)}`.trim();
  const primary = lawName.trim();
  const target = primary || combined;

  if (/s[úu]mula\s+vinculante/i.test(target)) return 'Súmulas Vinculantes STF';
  if (/\bs[úu]mulas?\b|\boj\b/i.test(target)) {
    if (/\btst\b/i.test(target)) return /\boj\b/i.test(target) ? 'OJs TST' : 'Súmulas TST';
    if (/\bstf\b/i.test(target)) return 'Súmulas STF';
    if (/\bstj\b/i.test(target)) return 'Súmulas STJ';
    return 'Súmulas';
  }
  if (/^emendas\s+constitucionais\s+de\s+revis/i.test(primary)) return 'Emendas Constitucionais de Revisão';
  if (/^emendas\s+constitucionais/i.test(primary)) return 'Emendas Constitucionais';
  if (/^decretos\s+legislativos/i.test(primary)) return 'Decretos Legislativos (Equiv. EC)';
  if (/^adct/i.test(primary)) return 'ADCT (CF/88)';
  if (/\blei\s+delegada\b/i.test(primary)) return primary;
  if (/\bdecreto\s+legislativo\b/i.test(primary)) return primary;
  if (/\bresolu[çc][ãa]o\b/i.test(primary)) return primary;
  if (/\bcf(?:\/88)?\b|constitui[çc][ãa]o\s+federal|\bcrfb\b/i.test(target)) return 'CF/88';
  if (/\bclt\b|5\.?452|consolida[çc][ãa]o\s+das\s+leis\s+do\s+trabalho/i.test(target)) return 'CLT';
  if (/\bcpc\b|13\.?105|processo\s+civil/i.test(target)) return 'CPC';
  if (/\bcpp\b|3\.?689|processo\s+penal/i.test(target)) return 'CPP';
  if (/\bcdc\b|8\.?078|defesa\s+do\s+consumidor/i.test(target)) return 'CDC';
  if (/\bctn\b|5\.?172|tribut[áa]rio\s+nacional/i.test(target)) return 'CTN';
  if (/\beca\b|8\.?069|estatuto\s+da\s+crian[çc]a/i.test(target)) return 'ECA';
  if (/\blgpd\b|13\.?709/i.test(target)) return 'LGPD';
  if (/101\/?2000|responsabilidade\s+fiscal|\blrf\b/i.test(target)) return 'LC 101/2000 (LRF)';
  if (/8\.?429|improbidade/i.test(target)) return 'Lei 8.429/1992';
  if (/8\.?112/i.test(target)) return 'Lei 8.112/90';
  if (/14\.?133/i.test(target)) return 'Lei 14.133/21';
  if (/9\.?784/i.test(target)) return 'Lei 9.784/99';
  if (/\bcc\b|10\.?406|c[óo]digo\s+civil/i.test(target)) return 'Código Civil';
  if (/\bcp\b|2\.?848|c[óo]digo\s+penal/i.test(target)) return 'Código Penal';

  const ecM = target.match(/\b(?:EC|Emenda\s+Constitucional)\s*(?:n[º°]?\s*)?(\d+(?:\/\d{2,4})?)/i);
  if (ecM) return `EC ${ecM[1]}`;
  const mpM = target.match(/\b(?:MP|Medida\s+Provis[óo]ria)\s*(?:n[º°]?\s*)?(\d[\d.]*(?:\/\d{2,4})?)/i);
  if (mpM) return `MP ${mpM[1]}`;
  const lcM = target.match(/\b(?:LC|Lei\s+Complementar)\s*(?:n[º°]?\s*)?(\d[\d.]*(?:\/\d{2,4})?)/i);
  if (lcM) return `LC ${lcM[1]}`;
  const dlM = target.match(/\bDecreto[-\s]?Lei\s*(?:n[º°]?\s*)?(\d[\d.]*(?:\/\d{2,4})?)/i);
  if (dlM) return `Decreto-Lei ${dlM[1]}`;
  const leiM = target.match(/\bLei(?:\s+Ordin[áa]ria)?\s*(?:n[º°]?\s*)?(\d[\d.]*(?:\/\d{2,4})?)/i);
  if (leiM) return `Lei ${leiM[1]}`;

  if (primary) return primary;

  if (/\bcf(?:\/88)?\b|constitui[çc][ãa]o/i.test(combined)) return 'CF/88';
  if (/\bclt\b|5\.?452/i.test(combined)) return 'CLT';
  if (/\bcpc\b|13\.?105/i.test(combined)) return 'CPC';
  if (/\bcdc\b|8\.?078/i.test(combined)) return 'CDC';
  return 'Outras leis';
}

const HIGHLIGHT_STYLES: Record<HighlightTone, { bg: string; border: string; label: string }> = {
  none: { bg: '', border: '', label: 'Sem destaque' },
  yellow: {
    bg: 'bg-amber-400/15 dark:bg-amber-400/15',
    border: 'border-l-4 border-l-amber-400',
    label: 'Importante',
  },
  green: {
    bg: 'bg-emerald-500/15 dark:bg-emerald-500/15',
    border: 'border-l-4 border-l-emerald-500',
    label: 'Dominado',
  },
  red: {
    bg: 'bg-rose-500/15 dark:bg-rose-500/15',
    border: 'border-l-4 border-l-rose-500',
    label: 'Pegadinha / Atenção',
  },
};

function nextTone(current: HighlightTone | undefined): HighlightTone {
  if (!current || current === 'none') return 'yellow';
  if (current === 'yellow') return 'red';
  if (current === 'red') return 'green';
  return 'none';
}

function detectArticleTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^(Art\.?\s*\d+[º°oª]?(?:-[A-Z])?)/i);
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  const firstLine = trimmed.split(/\r?\n/)[0] || '';
  return firstLine.slice(0, 60).trim();
}

function LegalBlocksView({
  blocks,
  highlights,
  onToggleHighlight,
  interactive = true,
  articleId,
  targetArtNum,
}: {
  blocks: LegalBlock[];
  highlights?: Record<string, HighlightTone>;
  onToggleHighlight?: (blockId: string) => void;
  interactive?: boolean;
  articleId?: string;
  targetArtNum?: string;
}) {
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-2">
      {blocks.map((b) => {
        const tone: HighlightTone = highlights?.[b.id] || 'none';
        const style = HIGHLIGHT_STYLES[tone];

        if (b.kind === 'artigo') {
          const blockArtNum = b.marker.match(/\d+(?:-[A-Za-z]+)?/)?.[0]?.toLowerCase() || '';
          const isTargetBlock = Boolean(targetArtNum && blockArtNum && blockArtNum === targetArtNum);
          return (
            <div
              key={b.id}
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
                  <span className="font-medium"><DictionaryText text={b.body} /></span>
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
                      {ann}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        }

        if (b.kind === 'inciso') {
          return (
            <div
              key={b.id}
              className={`group ml-2 sm:ml-4 rounded-2xl px-3.5 py-2.5 border border-theme flex items-start justify-between gap-2.5 transition ${
                tone !== 'none' ? `${style.bg} ${style.border}` : 'subtle-surface border-l-4 border-l-teal-500/50'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="min-w-[2rem] text-center px-2 py-0.5 rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-300 text-xs font-extrabold shrink-0 mt-0.5">
                  {b.marker}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-[13.5px] leading-relaxed"><DictionaryText text={b.body} /></p>
                  {b.annotations.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {b.annotations.map((ann, i) => (
                        <span
                          key={i}
                          className="text-[10px] italic px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/5 text-muted-theme"
                        >
                          {ann}
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
                  <span><DictionaryText text={b.body} /></span>
                </p>
                {b.annotations.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {b.annotations.map((ann, i) => (
                      <span
                        key={i}
                        className="text-[10px] italic px-2 py-0.5 rounded-full subtle-surface border border-theme text-muted-theme"
                      >
                        {ann}
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
                b.kind === 'alinea' ? 'ml-6 sm:ml-10' : 'ml-10 sm:ml-14'
              } rounded-xl px-3 py-2 border border-theme flex items-start justify-between gap-2 transition ${
                tone !== 'none' ? `${style.bg} ${style.border}` : 'subtle-surface'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                <span className="px-1.5 py-0.5 rounded-md bg-slate-500/15 text-xs font-bold shrink-0">
                  {b.marker}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-[13px] leading-relaxed"><DictionaryText text={b.body} /></p>
                  {b.annotations.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {b.annotations.map((ann, i) => (
                        <span
                          key={i}
                          className="text-[10px] italic px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/5 text-muted-theme"
                        >
                          {ann}
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
            <p className="text-[13.5px] leading-relaxed"><DictionaryText text={b.body} /></p>
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

interface PdfJsTextItem {
  str?: string;
  transform?: number[];
}

interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (opts: { data: ArrayBuffer }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: PdfJsTextItem[] }>;
      }>;
    }>;
  };
}

async function loadPdfJsLib(): Promise<PdfJsLib> {
  const win = window as unknown as { pdfjsLib?: PdfJsLib };
  if (win.pdfjsLib) return win.pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-sf-pdfjs="1"]') as HTMLScriptElement | null;
    if (existing) {
      if (win.pdfjsLib) resolve();
      else existing.addEventListener('load', () => resolve(), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    script.setAttribute('data-sf-pdfjs', '1');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Não foi possível carregar o leitor de PDF.'));
    document.head.appendChild(script);
  });
  const lib = (window as unknown as { pdfjsLib?: PdfJsLib }).pdfjsLib;
  if (!lib) throw new Error('Leitor de PDF indisponível.');
  lib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return lib;
}

async function extractPdfTextInBrowser(
  file: File,
  onProgress?: (page: number, total: number) => void
): Promise<string> {
  const lib = await loadPdfJsLib();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf }).promise;
  const pagesText: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let currentY: number | null = null;
    let currentLine = '';

    for (const item of content.items) {
      const str = (item.str || '').replace(/\s+/g, ' ');
      if (!str.trim()) continue;
      const y = Array.isArray(item.transform) ? Math.round(item.transform[5] / 3) * 3 : null;
      if (currentY !== null && y !== null && Math.abs(y - currentY) > 6) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = str;
        currentY = y;
      } else {
        currentLine = currentLine ? `${currentLine} ${str}` : str;
        if (currentY === null) currentY = y;
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    // Remove números de página isolados e cabeçalhos repetitivos comuns
    const cleaned = lines.filter((ln) => {
      if (/^\d{1,4}$/.test(ln)) return false;
      if (/^(?:Consolidação das Leis do Trabalho|Presidência da República|Casa Civil|Subchefia para Assuntos Jurídicos|Senado Federal)$/i.test(ln)) {
        return false;
      }
      return true;
    });
    pagesText.push(normalizeLegalOrdinalsAndSpaces(cleaned.join('\n')));
  }

  return pagesText.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripEditorialAndBackIndex(rawText: string, isConstitution: boolean): string {
  let clean = (rawText || '').trim();
  if (!clean) return clean;

  // 7. Remove "Índice de Assuntos" / "Índice de Entidades" no final do PDF
  const backIdxMatch = clean.match(
    /(?:^|\n)\s*(?:ÍNDICE\s+DE\s+ASSUNTOS|Índice\s+de\s+Assuntos(?:\s+e\s+Entidades)?|ÍNDICE\s+TEMÁTICO|Índice\s+Alfabético)\b/i
  );
  if (backIdxMatch && backIdxMatch.index !== undefined && backIdxMatch.index > clean.length * 0.45) {
    clean = clean.slice(0, backIdxMatch.index).trim();
  }

  // 1. Para CF/88, mantém o Preâmbulo (pula capa, ficha catalográfica e sumário)
  if (isConstitution) {
    const preMatches = Array.from(clean.matchAll(/(?:^|\n)\s*PRE[ÂA]MBULO\b/gi));
    for (const pm of preMatches) {
      if (pm.index !== undefined) {
        const after = clean.slice(pm.index, pm.index + 2500);
        if (/representantes\s+do\s+povo\s+brasileiro|\bArt\.?\s*1[º°o]?\b/i.test(after) && !/\.{3,}/.test(after.slice(0, 120))) {
          return clean.slice(pm.index).trim();
        }
      }
    }
  }

  // Para outras leis, pula sumário e vai para o 1º artigo real
  const art1Re = /^\s*Art(?:igo)?\.?\s*1[º°oª]?\b[^\n]*/gim;
  let m: RegExpExecArray | null;
  const candidates: number[] = [];
  while ((m = art1Re.exec(clean)) !== null) {
    const line = m[0];
    if (/\.{3,}|\s+\d{1,3}\s*$/.test(line)) continue;
    candidates.push(m.index);
  }
  for (const idx of candidates) {
    const windowAfter = clean.slice(idx, idx + 5000);
    if (/\bArt(?:igo)?\.?\s*2[º°oª]?\b/i.test(windowAfter)) {
      return clean.slice(idx).trim();
    }
  }
  if (candidates.length > 0) {
    return clean.slice(candidates[candidates.length - 1]).trim();
  }

  const anyArtRe = /^\s*Art(?:igo)?\.?\s*\d+[º°oª]?\b[^\n]*/gim;
  while ((m = anyArtRe.exec(clean)) !== null) {
    const line = m[0];
    if (/\.{3,}/.test(line)) continue;
    return clean.slice(m.index).trim();
  }
  return clean;
}

function splitArtBlocks(
  clean: string,
  lawName: string
): { title: string; text: string; lawNameOverride?: string }[] {
  const parts = clean.split(/(?=^|\n\s*Art\.\s*\d+)/m).filter((p) => p.trim());
  const artBlocks: string[] = [];
  let buffer = '';
  for (const part of parts) {
    if (/^\s*Art\.\s*\d+/i.test(part)) {
      if (buffer.trim()) artBlocks.push(buffer.trim());
      buffer = part;
    } else {
      buffer = buffer ? `${buffer}\n${part}` : part;
    }
  }
  if (buffer.trim()) artBlocks.push(buffer.trim());

  if (artBlocks.length <= 15) {
    return [{ title: '', text: clean, lawNameOverride: lawName }];
  }

  const GROUP_SIZE = 20;
  const sections: { title: string; text: string; lawNameOverride?: string }[] = [];
  for (let i = 0; i < artBlocks.length; i += GROUP_SIZE) {
    const slice = artBlocks.slice(i, i + GROUP_SIZE);
    const firstArt = slice[0].match(/Art\.\s*\d+[º°o]?/i)?.[0] || `Parte ${sections.length + 1}`;
    const lastArt = slice[slice.length - 1].match(/Art\.\s*\d+[º°o]?/i)?.[0] || '';
    const rangeLabel = lastArt && lastArt !== firstArt ? `${firstArt} a ${lastArt}` : firstArt;
    sections.push({
      title: lawName ? `${lawName} · ${rangeLabel}` : rangeLabel,
      text: slice.join('\n\n'),
      lawNameOverride: lawName,
    });
  }
  return sections;
}

function extractHeadingTitle(block: string, kindRe: RegExp): string {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const first = lines[0];
  const m = first.match(kindRe);
  if (!m) return first.slice(0, 80);
  const head = m[1].replace(/\s+/g, ' ').trim();
  const restSameLine = first.slice(m[0].length).replace(/^[\s\-–—:]+/, '').trim();
  if (restSameLine) return `${head} — ${restSameLine}`.slice(0, 95);
  const nextLine = lines[1] || '';
  if (
    nextLine &&
    !/^(?:Art\.|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O|T[ÍI]TULO|§|Par[áa]grafo|[IVX]+\s*[-–—])/i.test(
      nextLine
    ) &&
    nextLine.length <= 95
  ) {
    return `${head} — ${nextLine}`.slice(0, 95);
  }
  return head;
}

function getArtRangeLabel(text: string): string {
  const matches = Array.from(text.matchAll(/(?:^|\n)\s*Art\.\s*(\d+[º°o]?)/gi));
  if (matches.length === 0) return '';
  const first = `Art. ${matches[0][1]}`;
  const last = `Art. ${matches[matches.length - 1][1]}`;
  return first === last ? first : `${first} a ${last}`;
}

function splitByHeadingRegex(
  chunk: string,
  headingLineRe: RegExp
): { preamble: string; items: { heading: string; body: string }[] } {
  const matches = Array.from(chunk.matchAll(headingLineRe));
  if (matches.length === 0) return { preamble: chunk.trim(), items: [] };
  const preamble = chunk.slice(0, matches[0].index).trim();
  const items: { heading: string; body: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : chunk.length;
    const slice = chunk.slice(start, end).trim();
    const heading = extractHeadingTitle(
      slice,
      /^((?:T[ÍI]TULO|CAP[ÍI]TULO|SUBSE[ÇC][ÃA]O|SE[ÇC][ÃA]O)\s+[IVXLCDM]+)/i
    );
    items.push({ heading, body: slice });
  }
  return { preamble, items };
}

function splitCfByTitlesAndSections(
  chunk: string
): { title: string; text: string; lawNameOverride?: string }[] {
  const titleSplit = splitByHeadingRegex(
    chunk,
    /(?:^|\n)\s*T[ÍI]TULO\s+[IVXLCDM]+\b[^\n]*/gi
  );
  if (titleSplit.items.length < 2) {
    return splitArtBlocks(chunk, 'CF/88');
  }

  const out: { title: string; text: string; lawNameOverride?: string }[] = [];

  const pushCard = (label: string, text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    const range = getArtRangeLabel(cleanText);
    const fullTitle = range ? `CF/88 · ${label} (${range})` : `CF/88 · ${label}`;
    out.push({ title: fullTitle, text: cleanText, lawNameOverride: 'CF/88' });
  };

  // 1. Preâmbulo em bloco próprio (se existir antes do Título I)
  if (titleSplit.preamble && titleSplit.preamble.length > 20) {
    pushCard('Preâmbulo', titleSplit.preamble);
  }

  // 2. Hierarquia Interna: Títulos -> Capítulos -> Seções -> Subseções -> Artigos
  for (const t of titleSplit.items) {
    const chSplit = splitByHeadingRegex(
      t.body,
      /(?:^|\n)\s*CAP[ÍI]TULO\s+[IVXLCDM]+\b[^\n]*/gi
    );
    if (chSplit.items.length === 0) {
      pushCard(t.heading, t.body);
      continue;
    }
    if (chSplit.preamble && /\bArt\.\s*\d+/i.test(chSplit.preamble)) {
      pushCard(t.heading, chSplit.preamble);
    }

    for (const ch of chSplit.items) {
      const chLabel = `${t.heading} · ${ch.heading}`;
      const secSplit = splitByHeadingRegex(
        ch.body,
        /(?:^|\n)\s*SE[ÇC][ÃA]O\s+[IVXLCDM]+\b[^\n]*/gi
      );
      if (secSplit.items.length === 0) {
        pushCard(chLabel, ch.body);
        continue;
      }
      if (secSplit.preamble && /\bArt\.\s*\d+/i.test(secSplit.preamble)) {
        pushCard(chLabel, secSplit.preamble);
      }

      for (const sc of secSplit.items) {
        const scLabel = `${chLabel} · ${sc.heading}`;
        const subSplit = splitByHeadingRegex(
          sc.body,
          /(?:^|\n)\s*SUBSE[ÇC][ÃA]O\s+[IVXLCDM]+\b[^\n]*/gi
        );
        if (subSplit.items.length === 0) {
          pushCard(scLabel, sc.body);
          continue;
        }
        if (subSplit.preamble && /\bArt\.\s*\d+/i.test(subSplit.preamble)) {
          pushCard(scLabel, subSplit.preamble);
        }
        for (const sub of subSplit.items) {
          pushCard(`${scLabel} · ${sub.heading}`, sub.body);
        }
      }
    }
  }

  return out.length > 0 ? out : splitArtBlocks(chunk, 'CF/88');
}

function splitLawIntoSections(
  rawText: string,
  lawName: string
): { title: string; text: string; lawNameOverride?: string }[] {
  const cleanAll = rawText
    .replace(/-\n([a-záàâãéêíóôõúç])/g, '$1')
    .replace(/\n(?=Art\.\s*\d)/g, '\n\n')
    .trim();

  // Detecta se é o PDF completo da Constituição Federal com suas seções estruturais
  const isCf =
    lawName === 'CF/88' ||
    /Ato\s+das\s+Disposi[çc][õo]es\s+Constitucionais\s+Transit[óo]rias/i.test(cleanAll);

  if (!isCf) {
    return splitArtBlocks(cleanAll, lawName);
  }

  // Localiza marcos reais da Constituição (após o Preâmbulo)
  const findFirstReal = (re: RegExp, minIdx = 200): number => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleanAll)) !== null) {
      if (m.index >= minIdx && !/\.{3,}/.test(m[0])) return m.index;
    }
    return -1;
  };

  const adctIdx = findFirstReal(/(?:^|\n)\s*ATO\s+DAS\s+DISPOSI[ÇC][ÕO]ES\s+CONSTITUCIONAIS\s+TRANSIT[ÓO]RIAS[^\n]*/gi, 500);
  const ecrIdx = findFirstReal(/(?:^|\n)\s*(?:EMENDAS\s+CONSTITUCIONAIS\s+DE\s+REVIS[ÃA]O|Emenda\s+Constitucional\s+de\s+Revis[ãa]o\s+n[º°o]?\s*1\b)[^\n]*/gi, 500);
  const ecIdx = findFirstReal(/(?:^|\n)\s*(?:EMENDAS\s+CONSTITUCIONAIS\s*$|Emenda\s+Constitucional\s+n[º°o]?\s*1\b)[^\n]*/gim, Math.max(500, ecrIdx + 10));
  const dlIdx = findFirstReal(/(?:^|\n)\s*(?:DECRETOS\s+LEGISLATIVOS|Decreto\s+Legislativo\s+n[º°o]?\s*186\b)[^\n]*/gi, Math.max(500, ecIdx + 10));

  const cuts: { idx: number; kind: 'CF' | 'ADCT' | 'ECR' | 'EC' | 'DLG' }[] = [{ idx: 0, kind: 'CF' }];
  if (adctIdx > 0) cuts.push({ idx: adctIdx, kind: 'ADCT' });
  if (ecrIdx > 0) cuts.push({ idx: ecrIdx, kind: 'ECR' });
  if (ecIdx > 0) cuts.push({ idx: ecIdx, kind: 'EC' });
  if (dlIdx > 0) cuts.push({ idx: dlIdx, kind: 'DLG' });
  cuts.sort((a, b) => a.idx - b.idx);

  const out: { title: string; text: string; lawNameOverride?: string }[] = [];

  for (let c = 0; c < cuts.length; c++) {
    const cur = cuts[c];
    const nextIdx = c + 1 < cuts.length ? cuts[c + 1].idx : cleanAll.length;
    const chunk = cleanAll.slice(cur.idx, nextIdx).trim();
    if (!chunk) continue;

    if (cur.kind === 'CF') {
      out.push(...splitCfByTitlesAndSections(chunk));
    } else if (cur.kind === 'ADCT') {
      out.push(...splitArtBlocks(chunk, 'ADCT (CF/88)'));
    } else if (cur.kind === 'ECR') {
      const ecrParts = chunk
        .split(/(?=(?:^|\n)\s*Emenda\s+Constitucional\s+de\s+Revis[ãa]o\s*(?:n[º°o]?\s*)?\d+)/im)
        .map((p) => p.trim())
        .filter((p) => /Emenda\s+Constitucional\s+de\s+Revis[ãa]o/i.test(p));
      if (ecrParts.length > 0) {
        out.push({
          title: `Emendas Constitucionais de Revisão (ECR nº 1 a ${ecrParts.length})`,
          text: ecrParts.join('\n\n'),
          lawNameOverride: 'Emendas Constitucionais de Revisão',
        });
      }
    } else if (cur.kind === 'EC') {
      const ecParts = chunk
        .split(/(?=(?:^|\n)\s*Emenda\s+Constitucional\s*(?:n[º°o]?\s*)?\d+)/im)
        .map((p) => p.trim())
        .filter((p) => /^Emenda\s+Constitucional\s*(?:n[º°o]?\s*)?\d+/i.test(p));
      const EC_GROUP = 5;
      for (let i = 0; i < ecParts.length; i += EC_GROUP) {
        const slice = ecParts.slice(i, i + EC_GROUP);
        const fM = slice[0].match(/Emenda\s+Constitucional\s*(?:n[º°o]?\s*)?(\d+)/i)?.[1] || '';
        const lM = slice[slice.length - 1].match(/Emenda\s+Constitucional\s*(?:n[º°o]?\s*)?(\d+)/i)?.[1] || '';
        out.push({
          title: fM && lM && fM !== lM ? `EC nº ${fM} a EC nº ${lM}` : fM ? `EC nº ${fM}` : `Emendas (${i + 1})`,
          text: slice.join('\n\n'),
          lawNameOverride: 'Emendas Constitucionais',
        });
      }
    } else if (cur.kind === 'DLG') {
      const dlParts = chunk
        .split(/(?=(?:^|\n)\s*Decreto\s+Legislativo\s*(?:n[º°o]?\s*)?\d+)/im)
        .map((p) => p.trim())
        .filter((p) => /^Decreto\s+Legislativo\s*(?:n[º°o]?\s*)?\d+/i.test(p));
      for (const dlp of dlParts) {
        const dlTitle =
          dlp.match(/Decreto\s+Legislativo\s*(?:n[º°o]?\s*)?\d+(?:\s*(?:,\s*de\s*\d{4}|\/\d{4}))?/i)?.[0] ||
          'Decreto Legislativo';
        out.push({
          title: dlTitle.trim(),
          text: dlp,
          lawNameOverride: 'Decretos Legislativos (Equiv. EC)',
        });
      }
    }
  }

  return out.length > 0 ? out : splitArtBlocks(cleanAll, lawName);
}

export default function LeiSecaPage() {
  const { profile, subjects } = useProfile();
  const { notify } = useGlobal();
  const aiName = useAiProviderName();
  const [pdfProgress, setPdfProgress] = useState<string>('');
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [pdfTargetLaw, setPdfTargetLaw] = useState<string>('AUTO');
  const [pdfCustomLaw, setPdfCustomLaw] = useState<string>('');
  const [pdfSkipIndex, setPdfSkipIndex] = useState(true);
  const [aiFormatting, setAiFormatting] = useState(false);
  const [formattingCardId, setFormattingCardId] = useState<string | null>(null);
  const [formattingAllProgress, setFormattingAllProgress] = useState<string>('');
  const storageKey = `sf_lei_seca_${profile?.id || 'default'}`;

  const [articles, setArticles] = useState<LeiSecaArticle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const searchParams = useSearchParams();
  const [fetchingLawBanner, setFetchingLawBanner] = useState<string>('');
  const [highlightedArticleId, setHighlightedArticleId] = useState<string | null>(null);
  const [highlightedArtNum, setHighlightedArtNum] = useState<string>('');
  const handledDeepLinkRef = useRef<string>('');

  // Filtros
  const [selectedLaw, setSelectedLaw] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'favorites' | 'unread' | 'highlighted'>('all');
  const [themeQuery, setThemeQuery] = useState('');
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeMatchedIds, setThemeMatchedIds] = useState<string[] | null>(null);
  const [activeThemeLabel, setActiveThemeLabel] = useState('');

  // Recolher/Expandir
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});

  // Modal Adicionar / Editar
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formSubjectId, setFormSubjectId] = useState<string>('');
  const [formLawName, setFormLawName] = useState<string>('');
  const [formTitle, setFormTitle] = useState<string>('');
  const [formRawText, setFormRawText] = useState<string>('');
  const [formNote, setFormNote] = useState<string>('');
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    const loadLs = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setArticles(parsed);
        } else {
          setArticles([]);
        }
      } catch {
        setArticles([]);
      } finally {
        setLoaded(true);
      }
    };
    loadLs();
    const onSync = (e: Event) => {
      const scope = (e as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === 'lei-seca') loadLs();
    };
    window.addEventListener(CLOUD_SYNC_EVENT, onSync);
    return () => window.removeEventListener(CLOUD_SYNC_EVENT, onSync);
  }, [storageKey]);

  function persist(next: LeiSecaArticle[]) {
    const nextIds = new Set(next.map((a) => a.id));
    const removedIds = articles.filter((a) => !nextIds.has(a.id)).map((a) => a.id);
    setArticles(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
    if (profile?.user_id && profile?.id) {
      pushLeiSecaToCloud(profile.user_id, profile.id, removedIds);
    }
  }

  // Abre automaticamente artigo clicado via DictionaryText (?art=...&law=...) ou baixa da internet se não existir
  useEffect(() => {
    if (!loaded) return;
    const idParam = (searchParams.get('id') || '').trim();
    const artParam = (searchParams.get('art') || '').trim();
    const lawParam = (searchParams.get('law') || '').trim();
    if (!idParam && !artParam) return;

    const key = `${idParam}|${artParam}|${lawParam}`;
    if (handledDeepLinkRef.current === key) return;
    handledDeepLinkRef.current = key;

    const numMatch = artParam.match(/\d+(?:-[A-Za-z]+)?/);
    const artNum = numMatch ? numMatch[0].toLowerCase() : '';
    const artRegex = artNum
      ? new RegExp(`\\bArt\\.?\\s*${artNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[º°oª]?\\b`, 'i')
      : null;

    const lawNorm = lawParam.toLowerCase().replace(/[^a-z0-9]/g, '');

    const focusArticle = (targetId: string, targetArt?: string) => {
      setSelectedLaw('ALL');
      setStatusFilter('all');
      setSearchQuery('');
      setCollapsedIds((prev) => ({ ...prev, [targetId]: false }));
      setHighlightedArticleId(targetId);
      setHighlightedArtNum(targetArt || '');
      const tryScroll = () => {
        const exactEl = targetArt ? document.getElementById(`${targetId}-art-${targetArt}`) : null;
        const cardEl = document.getElementById(`ls-art-${targetId}`);
        const el = exactEl || cardEl;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
      setTimeout(() => {
        requestAnimationFrame(tryScroll);
      }, 200);
      setTimeout(() => {
        requestAnimationFrame(tryScroll);
      }, 450);
    };

    const existing =
      (idParam ? articles.find((a) => a.id === idParam) : undefined) ||
      articles.find((a) => {
        const lawOk =
          !lawNorm ||
          a.lawName.toLowerCase().replace(/[^a-z0-9]/g, '').includes(lawNorm) ||
          lawNorm.includes(a.lawName.toLowerCase().replace(/[^a-z0-9]/g, ''));
        if (!lawOk && a.lawName.trim()) return false;
        if (artRegex) {
          return artRegex.test(a.title) || artRegex.test(a.rawText);
        }
        return a.title.toLowerCase().includes(artParam.toLowerCase());
      });

    if (existing) {
      focusArticle(existing.id, artNum);
      notify(`Abrindo ${existing.title}${existing.lawName ? ` (${existing.lawName})` : ''}`, 'info');
      return;
    }

    // Não encontrado localmente: baixa da internet com IA (Planalto / fontes oficiais)
    let cancelled = false;
    (async () => {
      const label = lawParam ? `${artParam} (${lawParam})` : artParam;
      setFetchingLawBanner(`Buscando ${label} na internet...`);
      try {
        const res = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'fetch_law_article',
            article: artParam,
            lawHint: lawParam,
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.ok || !json.data?.rawText) {
          throw new Error(json.error || 'Não foi possível localizar o artigo na internet.');
        }
        const now = new Date().toISOString();
        const created: LeiSecaArticle = {
          id: `ls_web_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          subjectId: '',
          lawName: String(json.data.lawName || lawParam || '').trim(),
          title: String(json.data.title || artParam).trim(),
          rawText: String(json.data.rawText).trim(),
          note: 'Baixado automaticamente da internet via StudyFlow.',
          studied: false,
          readCount: 0,
          highlights: {},
          createdAt: now,
          updatedAt: now,
        };
        persist([created, ...articles]);
        focusArticle(created.id, artNum);
        notify(`${created.title} baixado e salvo na Lei Seca!`, 'success');
      } catch (err) {
        if (!cancelled) {
          notify(err instanceof Error ? err.message : 'Erro ao baixar artigo.', 'error');
        }
      } finally {
        if (!cancelled) setFetchingLawBanner('');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loaded, searchParams, articles]);

  const subjectMap = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    subjects.forEach((s) => m.set(s.id, { name: s.name, color: s.color || '#0d9488' }));
    return m;
  }, [subjects]);

  const previewBlocks = useMemo(
    () => parseLeiSecaBlocks(formRawText, formLawName || 'LEI'),
    [formRawText, formLawName]
  );
  const previewValidation = useMemo(() => validateParsedLaw(previewBlocks), [previewBlocks]);

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const themeSet = themeMatchedIds ? new Set(themeMatchedIds) : null;
    return articles.filter((a) => {
      if (themeSet && !themeSet.has(a.id)) return false;
      if (selectedLaw !== 'ALL') {
        if (selectedLaw.startsWith('__CAT:')) {
          const cat = classifyNormCategory(a.lawName, a.title, a.rawText);
          if (cat !== selectedLaw) return false;
        } else {
          const bucket = normalizeLawBucket(a.lawName, a.title, a.rawText);
          if (bucket !== selectedLaw) return false;
        }
      }
      if (statusFilter === 'favorites' && !a.favorite) return false;
      if (statusFilter === 'unread' && a.studied) return false;
      if (statusFilter === 'highlighted') {
        const hasHl = Object.values(a.highlights || {}).some((v) => v && v !== 'none');
        if (!hasHl) return false;
      }
      if (q) {
        const norm = (s: string) =>
          (s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\bartigo\b/g, 'art')
            .replace(/[.,;:º°ª()\[\]\-\/]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const tokens = norm(q).split(' ').filter(Boolean);
        const subName = subjectMap.get(a.subjectId)?.name || '';
        const bucket = normalizeLawBucket(a.lawName, a.title, a.rawText);
        const hay = norm(`${a.title} ${a.lawName} ${bucket} ${subName} ${a.rawText} ${a.note}`);
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [articles, selectedLaw, searchQuery, statusFilter, subjectMap, themeMatchedIds]);

  const lawBuckets = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of articles) {
      const bucket = normalizeLawBucket(a.lawName, a.title, a.rawText);
      map.set(bucket, (map.get(bucket) || 0) + 1);
    }
    const entries = Array.from(map.entries()).map(([name, count]) => ({ name, count }));
    entries.sort((a, b) => {
      if (a.name === 'Outras leis') return 1;
      if (b.name === 'Outras leis') return -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    return entries;
  }, [articles]);

  function getReadCount(art: LeiSecaArticle): number {
    if (typeof art.readCount === 'number' && art.readCount >= 0) return art.readCount;
    return art.studied ? 1 : 0;
  }

  const studiedCount = useMemo(() => articles.filter((a) => getReadCount(a) > 0).length, [articles]);
  const totalReadsCount = useMemo(
    () => articles.reduce((acc, a) => acc + getReadCount(a), 0),
    [articles]
  );

  function openNewForm() {
    setEditingId(null);
    setFormSubjectId(subjects[0]?.id || '');
    if (selectedLaw !== 'ALL' && selectedLaw !== 'Outras leis') setFormLawName(selectedLaw);
    setFormLawName('');
    setFormTitle('');
    setFormRawText('');
    setFormNote('');
    setShowPreview(true);
    setShowForm(true);
  }

  function openEditForm(art: LeiSecaArticle) {
    setEditingId(art.id);
    setFormSubjectId(art.subjectId);
    setFormLawName(art.lawName);
    setFormTitle(art.title);
    setFormRawText(art.rawText);
    setFormNote(art.note);
    setShowPreview(true);
    setShowForm(true);
  }

  function handleSaveArticle(e: React.FormEvent) {
    e.preventDefault();
    if (!formRawText.trim()) return;
    const autoTitle = formTitle.trim() || detectArticleTitle(formRawText) || 'Artigo sem título';
    const now = new Date().toISOString();

    if (editingId) {
      const next = articles.map((a) =>
        a.id === editingId
          ? {
              ...a,
              subjectId: formSubjectId,
              lawName: formLawName.trim(),
              title: autoTitle,
              rawText: formRawText.trim(),
              note: formNote.trim(),
              updatedAt: now,
            }
          : a
      );
      persist(next);
    } else {
      const created: LeiSecaArticle = {
        id: `ls_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        subjectId: formSubjectId,
        lawName: formLawName.trim(),
        title: autoTitle,
        rawText: formRawText.trim(),
        note: formNote.trim(),
        studied: false,
        highlights: {},
        createdAt: now,
        updatedAt: now,
      };
      persist([created, ...articles]);
    }
    setShowForm(false);
    setEditingId(null);
  }

  async function runAiFormatText(rawText: string, lawName: string): Promise<string> {
    const clean = rawText.trim();
    if (!clean) return clean;
    // Divide textos longos em blocos de ~3500 chars em paralelo para responder rápido na Vercel
    const chunks: string[] = [];
    const paras = clean.split(/\n\n+/);
    let cur = '';
    for (const p of paras) {
      if ((cur + '\n\n' + p).length > 3500 && cur) {
        chunks.push(cur);
        cur = p;
      } else {
        cur = cur ? `${cur}\n\n${p}` : p;
      }
    }
    if (cur) chunks.push(cur);

    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const res = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'format_lei_seca',
            rawText: chunk,
            lawName,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok || !json.data?.formattedText) {
          throw new Error(json.error || 'Erro ao formatar texto legal com IA.');
        }
        return String(json.data.formattedText).trim();
      })
    );
    return results.join('\n\n');
  }

  async function handleFormatModalWithAi() {
    if (!formRawText.trim()) return;
    setAiFormatting(true);
    try {
      const formatted = await runAiFormatText(formRawText, formLawName);
      setFormRawText(formatted);
      setShowPreview(true);
      notify(`Texto formatado com ${aiName}!`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao formatar.', 'error');
    } finally {
      setAiFormatting(false);
    }
  }

  async function handleFormatCardWithAi(art: LeiSecaArticle) {
    setFormattingCardId(art.id);
    try {
      const formatted = await runAiFormatText(art.rawText, art.lawName);
      persist(
        articles.map((a) =>
          a.id === art.id
            ? { ...a, rawText: formatted, updatedAt: new Date().toISOString() }
            : a
        )
      );
      notify(`Artigo formatado com ${aiName}!`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao formatar artigo.', 'error');
    } finally {
      setFormattingCardId(null);
    }
  }

  async function handleImportLawPdf(file: File) {
    try {
      const lowerName = (file.name || '').toLowerCase();
      let rawExtracted = '';
      if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
        setPdfProgress('Lendo arquivo HTML...');
        rawExtracted = await extractHtmlLawText(file);
      } else if (lowerName.endsWith('.docx')) {
        setPdfProgress('Lendo arquivo DOCX...');
        rawExtracted = await extractDocxLawText(file);
      } else if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
        setPdfProgress('Lendo arquivo de texto...');
        rawExtracted = await file.text();
      } else {
        setPdfProgress('Abrindo PDF...');
        rawExtracted = await extractPdfTextInBrowser(file, (p, total) => {
          setPdfProgress(`Lendo página ${p} de ${total}...`);
        });
      }
      if (!rawExtracted.trim()) {
        notify('Não foi possível extrair texto desse arquivo.', 'error');
        return;
      }

      const chosenLaw =
        pdfTargetLaw === 'CUSTOM'
          ? pdfCustomLaw.trim()
          : pdfTargetLaw !== 'AUTO'
          ? pdfTargetLaw
          : '';

      const inferredLaw =
        chosenLaw ||
        formLawName.trim() ||
        normalizeLawBucket('', file.name, rawExtracted.slice(0, 800)) ||
        file.name.replace(/\.pdf$/i, '').slice(0, 32);

      const isConstitution =
        inferredLaw === 'CF/88' ||
        /Constitui[çc][ãa]o\s+da\s+Rep[úu]blica\s+Federativa\s+do\s+Brasil/i.test(rawExtracted.slice(0, 2000));

      const extracted = pdfSkipIndex
        ? stripEditorialAndBackIndex(rawExtracted, isConstitution)
        : rawExtracted;

      const sections = splitLawIntoSections(extracted, inferredLaw);

      if (sections.length === 1) {
        setFormLawName(inferredLaw);
        setFormRawText(sections[0].text);
        setShowPreview(true);
        if (!showForm) {
          setEditingId(null);
          setFormTitle('');
          setFormNote('');
          setFormSubjectId('');
          setShowForm(true);
        }
        notify('Texto do PDF extraído! Clique em "Formatar com IA" ou salve direto.', 'success');
      } else {
        const now = Date.now();
        const created: LeiSecaArticle[] = sections.map((sec, idx) => ({
          id: `ls-pdf-${now}-${idx}`,
          subjectId: formSubjectId || '',
          lawName: sec.lawNameOverride || inferredLaw,
          title: sec.title,
          rawText: sec.text,
          note: '',
          studied: false,
          readCount: 0,
          highlights: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        const nextCollapsed: Record<string, boolean> = { ...collapsedIds };
        created.forEach((c) => {
          nextCollapsed[c.id] = true;
        });
        setCollapsedIds(nextCollapsed);
        persist([...created, ...articles]);
        setShowForm(false);
        setShowPdfModal(false);
        notify(
          `${inferredLaw} importada em ${created.length} blocos organizados de ~20 artigos!`,
          'success'
        );
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao ler o PDF.', 'error');
    } finally {
      setPdfProgress('');
    }
  }

  function handleDeleteArticle(id: string) {
    if (!window.confirm('Apagar este artigo da Lei Seca?')) return;
    persist(articles.filter((a) => a.id !== id));
  }

  function handleToggleFavorite(id: string) {
    const now = new Date().toISOString();
    persist(
      articles.map((a) => (a.id === id ? { ...a, favorite: !a.favorite, updatedAt: now } : a))
    );
  }

  async function handleFormatAllWithAi() {
    if (articles.length === 0 || formattingAllProgress) return;
    const targetList = filteredArticles.length > 0 ? filteredArticles : articles;
    const total = targetList.length;
    setFormattingAllProgress(`0/${total}`);
    let current = [...articles];
    let done = 0;
    let updatedCount = 0;

    try {
      // Processa em lotes de 3 em paralelo com DeepSeek para ser rápido e confiável
      const BATCH = 3;
      for (let i = 0; i < targetList.length; i += BATCH) {
        const slice = targetList.slice(i, i + BATCH);
        await Promise.all(
          slice.map(async (art) => {
            try {
              const preClean = normalizeLegalOrdinalsAndSpaces(art.rawText);
              const formatted = await runAiFormatText(preClean, art.lawName);
              if (formatted && formatted.trim()) {
                const now = new Date().toISOString();
                current = current.map((x) =>
                  x.id === art.id ? { ...x, rawText: formatted.trim(), updatedAt: now } : x
                );
                updatedCount += 1;
              }
            } catch {
              // Se um bloco falhar, aplica ao menos a limpeza local
              const blocks = parseLeiSecaBlocks(art.rawText);
              const rebuilt = blocks
                .map((b) => {
                  const ann = b.annotations.length > 0 ? ` (${b.annotations.join(') (')})` : '';
                  if (b.kind === 'inciso') return `${b.marker} - ${b.body}${ann}`.trim();
                  if (b.kind) return `${b.marker ? b.marker + ' ' : ''}${b.body}${ann}`.trim();
                  return `${b.body}${ann}`.trim();
                })
                .filter(Boolean)
                .join('\n');
              if (rebuilt) {
                current = current.map((x) =>
                  x.id === art.id ? { ...x, rawText: rebuilt, updatedAt: new Date().toISOString() } : x
                );
              }
            } finally {
              done += 1;
              setFormattingAllProgress(`${done}/${total}`);
            }
          })
        );
        persist(current);
      }
      notify(`${updatedCount} de ${total} blocos formatados com ${aiName}!`, 'success');
    } finally {
      setFormattingAllProgress('');
    }
  }

  async function handleFilterByTheme(e: React.FormEvent) {
    e.preventDefault();
    const t = themeQuery.trim();
    if (!t) {
      setThemeMatchedIds(null);
      setActiveThemeLabel('');
      return;
    }
    if (articles.length === 0) return;
    setThemeBusy(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'filter_lei_seca_theme',
          theme: t,
          items: articles.map((a) => ({
            id: a.id,
            lawName: a.lawName,
            title: a.title,
            preview: a.rawText.slice(0, 220),
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao filtrar por tema.');
      const ids = Array.isArray(json.data?.matched_ids) ? json.data.matched_ids : [];
      setThemeMatchedIds(ids);
      setActiveThemeLabel(t);
      if (ids.length === 0) {
        notify(`Nenhum artigo salvo encontrado sobre "${t}".`, 'info');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao filtrar com IA.', 'error');
    } finally {
      setThemeBusy(false);
    }
  }

  function handleToggleStudied(id: string) {
    const now = new Date().toISOString();
    persist(
      articles.map((a) => {
        if (a.id !== id) return a;
        const curr = getReadCount(a);
        const nextCount = curr > 0 ? 0 : 1;
        return {
          ...a,
          studied: nextCount > 0,
          readCount: nextCount,
          lastReadAt: nextCount > 0 ? now : a.lastReadAt,
          updatedAt: now,
        };
      })
    );
  }

  function handleChangeReadCount(id: string, delta: 1 | -1) {
    const now = new Date().toISOString();
    persist(
      articles.map((a) => {
        if (a.id !== id) return a;
        const curr = getReadCount(a);
        const nextCount = Math.max(0, curr + delta);
        return {
          ...a,
          studied: nextCount > 0,
          readCount: nextCount,
          lastReadAt: delta > 0 ? now : a.lastReadAt,
          updatedAt: now,
        };
      })
    );
  }

  function handleToggleHighlight(articleId: string, blockId: string) {
    persist(
      articles.map((a) => {
        if (a.id !== articleId) return a;
        const curr = a.highlights?.[blockId] || 'none';
        const nextHl = { ...(a.highlights || {}), [blockId]: nextTone(curr) };
        if (nextHl[blockId] === 'none') delete nextHl[blockId];
        return { ...a, highlights: nextHl, updatedAt: new Date().toISOString() };
      })
    );
  }

  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const allCollapsed =
    filteredArticles.length > 0 && filteredArticles.every((a) => Boolean(collapsedIds[a.id]));

  function toggleCollapseAll() {
    if (allCollapsed) {
      setCollapsedIds({});
    } else {
      const next: Record<string, boolean> = {};
      filteredArticles.forEach((a) => {
        next[a.id] = true;
      });
      setCollapsedIds(next);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Lei Seca</h1>
              <p className="text-xs sm:text-sm text-muted-theme">
                Cole o artigo e o StudyFlow organiza automaticamente caput, incisos, parágrafos e alíneas.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={Boolean(pdfProgress)}
            onClick={() => {
              setPdfTargetLaw(selectedLaw !== 'ALL' && !selectedLaw.startsWith('__CAT:') ? selectedLaw : 'AUTO');
              setShowPdfModal(true);
            }}
            className="px-4 py-3 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm disabled:opacity-60"
          >
            {pdfProgress ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileUp className="w-4 h-4" />
            )}
            {pdfProgress || 'Importar Lei (PDF/HTML/DOCX)'}
          </button>
          {articles.length > 0 && (
            <button
              type="button"
              disabled={Boolean(formattingAllProgress)}
              onClick={() => void handleFormatAllWithAi()}
              title={`Formata todos os ${filteredArticles.length > 0 ? filteredArticles.length : articles.length} blocos visíveis com ${aiName} (junta palavras quebradas, corrige ordinais e remove rodapés)`}
              className="px-4 py-3 rounded-2xl bg-violet-600/12 hover:bg-violet-600/20 border border-violet-500/35 text-violet-700 dark:text-violet-300 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60"
            >
              {formattingAllProgress ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {formattingAllProgress
                ? `Formatando (${formattingAllProgress})...`
                : `Formatar Tudo c/ ${aiName}`}
            </button>
          )}
          <button
            type="button"
            onClick={openNewForm}
            className="px-5 py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Adicionar Artigo
          </button>
        </div>
      </div>

      {/* Resumo rápido */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card-surface rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-muted-theme">Artigos salvos</p>
          <p className="text-2xl font-extrabold mt-0.5">{articles.length}</p>
        </div>
        <div className="card-surface rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-muted-theme">Lidos · Total de releituras</p>
          <p className="text-2xl font-extrabold text-emerald-600 mt-0.5">
            {studiedCount}
            <span className="text-xs font-semibold text-muted-theme ml-1.5">
              ({totalReadsCount}x releituras)
            </span>
          </p>
        </div>
        <div className="card-surface rounded-2xl p-4 col-span-2 sm:col-span-1">
          <p className="text-[11px] font-semibold text-muted-theme">Dica de leitura</p>
          <p className="text-xs text-muted-theme mt-1">
            Clique no ícone <Highlighter className="w-3 h-3 inline text-amber-500" /> em qualquer inciso para grifar (amarelo, vermelho ou verde).
          </p>
        </div>
      </div>

      {/* Filtros por Lei + Busca */}
      <div className="card-surface rounded-3xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-muted-theme absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por artigo, lei (ex: CF/88, CLT, CPC) ou palavra dentro dos incisos..."
              className="w-full rounded-2xl subtle-surface border border-theme pl-10 pr-4 py-2.5 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            {selectedLaw !== 'ALL' && !selectedLaw.startsWith('__CAT:') && (
              <button
                type="button"
                onClick={() => {
                  const nextName = window.prompt(
                    `Renomear o filtro "${selectedLaw}" para:`,
                    selectedLaw === 'Outras leis' ? '' : selectedLaw
                  );
                  const clean = (nextName || '').trim();
                  if (!clean || clean === selectedLaw) return;
                  const now = new Date().toISOString();
                  const next = articles.map((a) =>
                    normalizeLawBucket(a.lawName, a.title, a.rawText) === selectedLaw
                      ? { ...a, lawName: clean, updatedAt: now }
                      : a
                  );
                  persist(next);
                  setSelectedLaw(normalizeLawBucket(clean));
                  notify(`Filtro renomeado para "${clean}"!`, 'success');
                }}
                title="Renomear este filtro de lei"
                className="px-2.5 py-2.5 rounded-2xl subtle-surface border border-theme hover:border-teal-500/50 text-xs font-bold inline-flex items-center gap-1"
              >
                <Edit3 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                <span className="hidden sm:inline">Renomear</span>
              </button>
            )}
            {selectedLaw !== 'ALL' && (
              <button
                type="button"
                onClick={() => {
                  const isCat = selectedLaw.startsWith('__CAT:');
                  const targetIds = new Set(
                    articles
                      .filter((a) =>
                        isCat
                          ? classifyNormCategory(a.lawName, a.title, a.rawText) === selectedLaw
                          : normalizeLawBucket(a.lawName, a.title, a.rawText) === selectedLaw
                      )
                      .map((a) => a.id)
                  );
                  if (targetIds.size === 0) return;
                  const label = isCat
                    ? NORM_CATEGORIES.find((c) => c.key === selectedLaw)?.label || selectedLaw
                    : selectedLaw;
                  if (
                    !window.confirm(
                      `Excluir todos os ${targetIds.size} bloco(s) de "${label}"? Essa ação não pode ser desfeita.`
                    )
                  ) {
                    return;
                  }
                  persist(articles.filter((a) => !targetIds.has(a.id)));
                  setSelectedLaw('ALL');
                  notify(`${targetIds.size} bloco(s) de "${label}" excluídos.`, 'success');
                }}
                title="Excluir todos os blocos deste filtro"
                className="px-2.5 py-2.5 rounded-2xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-xs font-bold inline-flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Excluir</span>
              </button>
            )}
            <div className="relative">
              <Filter className="w-3.5 h-3.5 text-muted-theme absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={selectedLaw}
                onChange={(e) => setSelectedLaw(e.target.value)}
                className="rounded-2xl subtle-surface border border-theme pl-8 pr-4 py-2.5 text-xs font-bold"
              >
                <option value="ALL">Todas as leis ({articles.length})</option>
                <optgroup label="Por tipo de norma">
                  {NORM_CATEGORIES.map((cat) => {
                    const cnt = articles.filter(
                      (a) => classifyNormCategory(a.lawName, a.title, a.rawText) === cat.key
                    ).length;
                    return (
                      <option key={cat.key} value={cat.key}>
                        {cat.label} ({cnt})
                      </option>
                    );
                  })}
                </optgroup>
                {lawBuckets.length > 0 && (
                  <optgroup label="Normas salvas">
                    {lawBuckets.map((law) => (
                      <option key={law.name} value={law.name}>
                        {law.name} ({law.count})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {filteredArticles.length > 0 && (
              <button
                type="button"
                onClick={toggleCollapseAll}
                className="px-3 py-2.5 rounded-2xl subtle-surface border border-theme text-xs font-bold whitespace-nowrap hover:opacity-85"
              >
                {allCollapsed ? 'Expandir todos' : 'Recolher todos'}
              </button>
            )}
          </div>
        </div>

        {/* Pills rápidas por Lei + status */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedLaw('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
              selectedLaw === 'ALL'
                ? 'bg-teal-600 text-white border-teal-600'
                : 'subtle-surface border-theme hover:opacity-85'
            }`}
          >
            Todas ({articles.length})
          </button>
          {lawBuckets.map((law) => {
            const active = selectedLaw === law.name;
            return (
              <button
                key={law.name}
                type="button"
                onClick={() => setSelectedLaw(law.name)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition inline-flex items-center gap-1.5 ${
                  active
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'subtle-surface border-theme hover:opacity-85'
                }`}
              >
                <Scale className="w-3 h-3 shrink-0 opacity-80" />
                <span className="truncate max-w-[160px]">{law.name}</span>
                <span className="opacity-75">({law.count})</span>
              </button>
            );
          })}

          <form onSubmit={(e) => void handleFilterByTheme(e)} className="flex items-center gap-1.5">
            <div className="relative">
              <Sparkles className="w-3 h-3 text-violet-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={themeQuery}
                onChange={(e) => setThemeQuery(e.target.value)}
                placeholder="Tema c/ IA (ex: férias, jornada)..."
                className="rounded-xl subtle-surface border border-theme pl-7 pr-2.5 py-1 text-[11px] w-48 sm:w-56"
              />
            </div>
            <button
              type="submit"
              disabled={themeBusy}
              className="px-2.5 py-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-50"
            >
              {themeBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Filtrar'}
            </button>
            {activeThemeLabel && (
              <button
                type="button"
                onClick={() => {
                  setThemeQuery('');
                  setThemeMatchedIds(null);
                  setActiveThemeLabel('');
                }}
                title="Limpar filtro por tema"
                className="px-2 py-1 rounded-xl bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[10px] font-bold inline-flex items-center gap-1"
              >
                {activeThemeLabel}
                <X className="w-3 h-3" />
              </button>
            )}
          </form>

          <div className="ml-auto flex items-center gap-1 flex-wrap">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'favorites', label: `★ Favoritos (${articles.filter((a) => a.favorite).length})` },
                { id: 'unread', label: 'Não lidos' },
                { id: 'highlighted', label: 'Com grifo' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                  statusFilter === f.id
                    ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                    : 'text-muted-theme hover:opacity-80'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {fetchingLawBanner && (
        <div className="rounded-2xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 flex items-center gap-3 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>{fetchingLawBanner}</span>
        </div>
      )}

      {/* Lista de Artigos */}
      {!loaded ? null : filteredArticles.length === 0 ? (
        <div className="card-surface rounded-3xl p-10 text-center space-y-3 border border-dashed border-theme">
          <div className="w-12 h-12 rounded-2xl bg-teal-500/15 text-teal-600 mx-auto flex items-center justify-center">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <p className="font-bold text-base">
              {articles.length === 0
                ? 'Nenhum artigo salvo na Lei Seca ainda'
                : 'Nenhum artigo encontrado com esse filtro'}
            </p>
            <p className="text-xs text-muted-theme mt-1 max-w-md mx-auto">
              {articles.length === 0
                ? 'Clique em "Adicionar Artigo", cole o texto da lei (ex: Art. 7º da CF/88) e veja cada inciso organizado automaticamente.'
                : 'Tente trocar a matéria selecionada ou limpar a busca.'}
            </p>
          </div>
          {articles.length === 0 && (
            <button
              type="button"
              onClick={openNewForm}
              className="px-5 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Adicionar primeiro artigo
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredArticles.map((art) => {
            const sub = subjectMap.get(art.subjectId);
            const blocks = parseLeiSecaBlocks(art.rawText, art.lawName || 'LEI');
            const isCollapsed = Boolean(collapsedIds[art.id]);
            const artBlocks = blocks.filter((b) => b.kind === 'artigo' && /^Art\./i.test(b.marker));
            const incisoCount = blocks.filter((b) => b.kind === 'inciso').length;
            const parCount = blocks.filter((b) => b.kind === 'paragrafo').length;
            const readCount = getReadCount(art);

            // Extrai faixa de artigos (ex: "Art. 5º" ou "Art. 6º a 11") para ficar sempre visível
            let rawTitleClean = (art.title || '').trim();
            if (art.lawName && rawTitleClean.toLowerCase().startsWith(art.lawName.toLowerCase())) {
              rawTitleClean = rawTitleClean.slice(art.lawName.length).replace(/^[\s·\-–—:]+/, '').trim();
            }
            rawTitleClean = rawTitleClean.replace(/^CF\/88\s*[·\-–—:]\s*/i, '').trim();

            let rangeBadge = '';
            const rangeInTitle = rawTitleClean.match(/\((Art\.[^)]+)\)\s*$/i);
            if (rangeInTitle) {
              rangeBadge = rangeInTitle[1]
                .replace(/\ba\s+Art\./i, 'a')
                .replace(/\.$/, '')
                .trim();
              rawTitleClean = rawTitleClean.slice(0, rangeInTitle.index).trim();
            } else if (artBlocks.length > 0) {
              const firstM = artBlocks[0].marker.replace(/\.$/, '').trim();
              const lastM = artBlocks[artBlocks.length - 1].marker.replace(/\.$/, '').trim();
              rangeBadge =
                firstM === lastM ? firstM : `${firstM} a ${lastM.replace(/^Art\.?\s*/i, '')}`;
            }

            const titleSegments = rawTitleClean.split(/\s*·\s*/).filter(Boolean);
            const mainHeading =
              titleSegments.length > 1
                ? titleSegments[titleSegments.length - 1]
                : rawTitleClean || art.title;
            const parentBreadcrumb =
              titleSegments.length > 1 ? titleSegments.slice(0, -1).join(' › ') : '';

            return (
              <div
                key={art.id}
                id={`ls-art-${art.id}`}
                className={`card-surface rounded-2xl border transition ${
                  highlightedArticleId === art.id
                    ? 'border-indigo-500 ring-2 ring-indigo-500/40'
                    : art.studied
                      ? 'border-emerald-500/35'
                      : 'border-theme'
                }`}
              >
                {/* Cabeçalho do Artigo */}
                <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => handleToggleStudied(art.id)}
                      title={art.studied ? 'Marcar como não lido' : 'Marcar como lido'}
                      className="shrink-0"
                    >
                      {art.studied ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      ) : (
                        <Circle className="w-5 h-5 text-muted-theme hover:text-teal-500" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleFavorite(art.id)}
                      title={art.favorite ? 'Remover dos Favoritos' : 'Salvar nos Favoritos'}
                      className="shrink-0"
                    >
                      <Star
                        className={`w-4 h-4 transition ${
                          art.favorite
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-muted-theme hover:text-amber-400'
                        }`}
                      />
                    </button>

                    <div className="min-w-0 flex-1">
                      {parentBreadcrumb && (
                        <p className="text-[11px] text-muted-theme truncate mb-0.5">
                          {parentBreadcrumb}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {rangeBadge && (
                          <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-lg bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 shrink-0">
                            {rangeBadge}
                          </span>
                        )}
                        <h2 className="font-extrabold text-sm leading-snug">{mainHeading}</h2>
                        {art.lawName && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-300 shrink-0">
                            {art.lawName}
                          </span>
                        )}
                        {sub && (
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0"
                            style={{ backgroundColor: sub.color }}
                          >
                            {sub.name}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-theme mt-0.5">
                        {artBlocks.length > 0
                          ? `${artBlocks.length} ${artBlocks.length === 1 ? 'artigo' : 'artigos'}`
                          : 'Texto corrido'}
                        {incisoCount > 0 ? ` · ${incisoCount} ${incisoCount === 1 ? 'inciso' : 'incisos'}` : ''}
                        {parCount > 0 ? ` · ${parCount} ${parCount === 1 ? 'parágrafo' : 'parágrafos'}` : ''}
                        {readCount > 0 ? ` · Relido ${readCount}x` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <div className="inline-flex items-center rounded-xl border border-emerald-500/35 bg-emerald-500/10 overflow-hidden">
                      {readCount > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleChangeReadCount(art.id, -1)}
                            title="Diminuir 1 releitura"
                            className="px-1.5 py-1.5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="px-1.5 text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
                            {readCount}x
                          </span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleChangeReadCount(art.id, 1)}
                        title="Registrar mais uma releitura deste artigo"
                        className="px-2.5 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 inline-flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {readCount === 0 ? 'Relido (1x)' : '+1 Relido'}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleCollapse(art.id)}
                      className="px-2.5 py-1.5 rounded-xl subtle-surface border border-theme text-xs font-bold inline-flex items-center gap-1 hover:opacity-85"
                    >
                      {isCollapsed ? (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" /> Expandir
                        </>
                      ) : (
                        <>
                          <ChevronUp className="w-3.5 h-3.5" /> Recolher
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={formattingCardId === art.id}
                      onClick={() => void handleFormatCardWithAi(art)}
                      title={`Formatar e limpar texto com ${aiName}`}
                      className="px-2.5 py-1.5 rounded-xl bg-violet-500/12 hover:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {formattingCardId === art.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      Formatar IA
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditForm(art)}
                      title="Editar artigo"
                      className="p-2 rounded-xl subtle-surface border border-theme text-muted-theme hover:text-teal-600"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteArticle(art.id)}
                      title="Apagar artigo"
                      className="p-2 rounded-xl subtle-surface border border-theme text-muted-theme hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Corpo formatado */}
                {!isCollapsed && (
                  <div className="px-4 sm:px-5 pb-5 space-y-3 border-t border-theme pt-4">
                    <LegalBlocksView
                      blocks={blocks}
                      highlights={art.highlights}
                      onToggleHighlight={(blockId) => handleToggleHighlight(art.id, blockId)}
                      interactive
                      articleId={art.id}
                      targetArtNum={highlightedArticleId === art.id ? highlightedArtNum : undefined}
                    />

                    {art.note && (
                      <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 text-xs flex items-start gap-2">
                        <StickyNote className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-amber-800 dark:text-amber-200 mb-0.5">
                            Anotação pessoal
                          </p>
                          <p className="whitespace-pre-wrap leading-relaxed">{art.note}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Adicionar / Editar Artigo */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-theme overflow-hidden">
            <div className="px-6 py-4 border-b border-theme flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-teal-500/15 text-teal-600 flex items-center justify-center">
                  <Scale className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-base">
                    {editingId ? 'Editar Artigo da Lei Seca' : 'Adicionar Artigo na Lei Seca'}
                  </h2>
                  <p className="text-xs text-muted-theme">
                    Cole o texto da lei — caput, incisos, parágrafos e alíneas são formatados na hora.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="p-2 rounded-xl hover:opacity-75 text-muted-theme"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveArticle} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-muted-theme mb-1">
                    Matéria
                  </label>
                  <select
                    value={formSubjectId}
                    onChange={(e) => setFormSubjectId(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                  >
                    <option value="">Geral / Sem matéria</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-theme mb-1">
                    Lei / Norma (opcional)
                  </label>
                  <input
                    value={formLawName}
                    onChange={(e) => setFormLawName(e.target.value)}
                    placeholder="Ex: CF/88, CLT, Lei 8.112/90"
                    className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {LAW_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setFormLawName(preset)}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full subtle-surface border border-theme hover:border-teal-500"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-theme mb-1">
                  Título / Número do Artigo (opcional — detectado automaticamente se deixar em branco)
                </label>
                <input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Ex: Art. 7º - Direitos dos Trabalhadores"
                  className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-muted-theme">
                    Texto do Artigo *
                  </label>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      disabled={aiFormatting || !formRawText.trim()}
                      onClick={() => void handleFormatModalWithAi()}
                      className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-45"
                    >
                      {aiFormatting ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      {aiFormatting ? 'Formatando...' : `Formatar com ${aiName}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPreview((v) => !v)}
                      className="text-[11px] font-bold text-teal-600 dark:text-teal-400 inline-flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {showPreview ? 'Ocultar prévia' : 'Ver prévia formatada'}
                    </button>
                  </div>
                </div>
                <textarea
                  required
                  rows={7}
                  value={formRawText}
                  onChange={(e) => setFormRawText(e.target.value)}
                  placeholder={'Cole aqui o artigo completo, por exemplo:\nArt. 7º São direitos dos trabalhadores urbanos e rurais...\nI - relação de emprego protegida...\nII - seguro-desemprego...\n§ 1º ...'}
                  className="w-full rounded-2xl subtle-surface border border-theme px-4 py-3 text-sm font-mono leading-relaxed"
                />
              </div>

              {showPreview && previewBlocks.length > 0 && (
                <div className="rounded-2xl border border-teal-500/30 p-4 space-y-2.5 bg-teal-500/[0.03]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-extrabold text-teal-700 dark:text-teal-300">
                      Prévia formatada ({previewBlocks.length}{' '}
                      {previewBlocks.length === 1 ? 'bloco' : 'blocos'} · {previewValidation.articleCount} art.)
                    </p>
                    {previewValidation.isClean ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        ✓ Sequência validada
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
                        ⚠ {[
                          ...previewValidation.missingGaps,
                          ...previewValidation.duplicates.map((d) => `Duplicado: ${d}`),
                          ...previewValidation.outOfOrder,
                          ...previewValidation.emptyArticles.map((e) => `Vazio: ${e}`),
                          ...previewValidation.giantArticles.map((g) => `Muito longo: ${g}`),
                        ].slice(0, 2).join(' · ')}
                      </span>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto pr-1">
                    <LegalBlocksView blocks={previewBlocks} interactive={false} />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-theme mb-1">
                  Anotação / Mnemonico / Pegadinha de Banca (opcional)
                </label>
                <textarea
                  rows={2}
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="Ex: FCC adora trocar 'prazo de 30 dias' por '15 dias' neste inciso..."
                  className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 rounded-2xl subtle-surface border border-theme text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shadow-sm"
                >
                  {editingId ? 'Salvar Alterações' : 'Salvar Artigo Formatado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showPdfModal && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl border border-theme animate-pop-in">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-base flex items-center gap-2">
                <FileUp className="w-5 h-5 text-violet-500" />
                Importar Lei (PDF / HTML / DOCX)
              </h2>
              <button
                type="button"
                onClick={() => setShowPdfModal(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-muted-theme mb-1">
                  Colocar em qual filtro / norma?
                </label>
                <select
                  value={pdfTargetLaw}
                  onChange={(e) => setPdfTargetLaw(e.target.value)}
                  className="w-full rounded-xl subtle-surface border border-theme px-3 py-2.5 text-xs font-bold"
                >
                  <option value="AUTO">Detectar automaticamente pelo PDF</option>
                  {Array.from(
                    new Set([
                      ...lawBuckets.map((l) => l.name),
                      ...LAW_PRESETS,
                    ])
                  )
                    .filter((n) => n !== 'Outras leis')
                    .map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  <option value="CUSTOM">Outra norma (digitar)...</option>
                </select>
                {pdfTargetLaw === 'CUSTOM' && (
                  <input
                    value={pdfCustomLaw}
                    onChange={(e) => setPdfCustomLaw(e.target.value)}
                    placeholder="Ex: Lei 13.869/2019, Regimento Interno..."
                    className="w-full mt-2 rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  />
                )}
              </div>

              <label className="flex items-center gap-2.5 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pdfSkipIndex}
                  onChange={(e) => setPdfSkipIndex(e.target.checked)}
                  className="rounded accent-teal-600"
                />
                <span>
                  Pular índice / sumário inicial e começar direto no 1º artigo
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPdfModal(false)}
                className="px-4 py-2.5 rounded-xl subtle-surface text-xs font-semibold"
              >
                Cancelar
              </button>
              <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold inline-flex items-center gap-1.5">
                {pdfProgress ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileUp className="w-3.5 h-3.5" />
                )}
                {pdfProgress || 'Escolher arquivo'}
                <input
                  type="file"
                  accept=".pdf,.html,.htm,.docx,.txt,application/pdf,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  disabled={Boolean(pdfProgress)}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImportLawPdf(file);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
