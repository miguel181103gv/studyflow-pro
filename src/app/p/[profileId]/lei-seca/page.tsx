'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useProfile } from '@/components/ProfileProvider';
import { DictionaryText } from '@/components/DictionaryText';
import { useGlobal } from '@/components/GlobalProvider';
import { useAiProviderName } from '@/lib/useAiProvider';
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
  StickyNote,
  FileUp,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

type BlockKind = 'artigo' | 'inciso' | 'paragrafo' | 'alinea' | 'item' | 'texto';
type HighlightTone = 'none' | 'yellow' | 'green' | 'red';

interface LegalBlock {
  id: string;
  kind: BlockKind;
  marker: string;
  body: string;
  annotations: string[];
}

interface LeiSecaArticle {
  id: string;
  subjectId: string; // '' = Geral / Sem matéria
  lawName: string; // ex: CF/88, CLT, Lei 8.112/90
  title: string; // ex: Art. 7º - Direitos dos Trabalhadores
  rawText: string;
  note: string;
  studied: boolean;
  readCount?: number;
  lastReadAt?: string;
  highlights: Record<string, HighlightTone>; // keyed by block index/id
  createdAt: string;
  updatedAt: string;
}

const LAW_PRESETS = ['CF/88', 'CLT', 'CPC', 'CDC', 'Código Civil', 'Código Penal', 'Lei 8.112/90', 'Lei 14.133/21', 'LGPD'];

function normalizeLawBucket(lawName: string, title = '', rawText = ''): string {
  const combined = `${lawName} ${title} ${rawText.slice(0, 350)}`.trim();
  const primary = lawName.trim();
  const target = primary || combined;

  if (/\bcf(?:\/88)?\b|constitui[çc][ãa]o\s+federal|\bcrfb\b/i.test(target)) return 'CF/88';
  if (/\bclt\b|5\.?452|consolida[çc][ãa]o\s+das\s+leis\s+do\s+trabalho/i.test(target)) return 'CLT';
  if (/\bcpc\b|13\.?105|processo\s+civil/i.test(target)) return 'CPC';
  if (/\bcpp\b|3\.?689|processo\s+penal/i.test(target)) return 'CPP';
  if (/\bcdc\b|8\.?078|defesa\s+do\s+consumidor/i.test(target)) return 'CDC';
  if (/\bctn\b|5\.?172|tribut[áa]rio\s+nacional/i.test(target)) return 'CTN';
  if (/\beca\b|8\.?069|estatuto\s+da\s+crian[çc]a/i.test(target)) return 'ECA';
  if (/\blgpd\b|13\.?709/i.test(target)) return 'LGPD';
  if (/8\.?112/i.test(target)) return 'Lei 8.112/90';
  if (/14\.?133/i.test(target)) return 'Lei 14.133/21';
  if (/9\.?784/i.test(target)) return 'Lei 9.784/99';
  if (/\bcc\b|10\.?406|c[óo]digo\s+civil/i.test(target)) return 'Código Civil';
  if (/\bcp\b|2\.?848|c[óo]digo\s+penal/i.test(target)) return 'Código Penal';

  if (primary) return primary;

  // Se lawName estiver vazio, tenta inferir pelo texto completo
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

function extractAnnotations(text: string): { clean: string; annotations: string[] } {
  const annotations: string[] = [];
  const regex =
    /\((?:Redação dada|Incluíd[oa]|Revogad[oa]|Vide|Acrescid[oa]|Alterad[oa]|Vigência|Vetad[oa]|Regulamento|Produção de efeito)[^)]*\)/gi;
  const clean = text
    .replace(regex, (match) => {
      annotations.push(match.slice(1, -1).trim());
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { clean, annotations };
}

function detectArticleTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^(Art\.?\s*\d+[º°oª]?(?:-[A-Z])?)/i);
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  const firstLine = trimmed.split(/\r?\n/)[0] || '';
  return firstLine.slice(0, 60).trim();
}

/**
 * Parser instantâneo (0ms) para textos de Lei Seca brasileira:
 * separa Caput (Art.), Incisos (I, II, III...), Parágrafos (§ 1º / Parágrafo único),
 * Alíneas (a), b), c)) e Itens (1., 2.), mesmo quando colados com quebras de PDF.
 */
function parseLeiSecaBlocks(rawText: string): LegalBlock[] {
  if (!rawText.trim()) return [];

  // Normaliza espaços e insere quebras antes de marcadores legais colados no meio da linha
  let normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  // Quebra antes de Art. / Parágrafo único / § Xº se vierem após pontuação na mesma linha
  normalized = normalized
    .replace(/([.;:])\s+(Art\.?\s*\d+[º°oª]?(?:-[A-Z])?)/gi, '$1\n$2')
    .replace(/([.;:])\s+(Parágrafo\s+único\.?)/gi, '$1\n$2')
    .replace(/([.;:])\s+(§§?\s*\d+[º°oª]?(?:-[A-Z])?)/gi, '$1\n$2')
    .replace(
      /([.;:])\s+((?:X{0,3}(?:IX|IV|V?I{0,3})|L(?:X{0,3}(?:IX|IV|V?I{0,3}))?|C)\s*[-–—])/g,
      '$1\n$2'
    );

  const rawLines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Regex para detectar início de bloco legal
  const artRe = /^(Art(?:igo)?\.?\s*\d+[º°oª]?(?:-[A-Z])?\.?)\s*(.*)$/i;
  const parUnicoRe = /^(Parágrafo\s+único\.?)\s*[-–—]?\s*(.*)$/i;
  const parNumRe = /^(§\s*\d+[º°oª]?(?:-[A-Z])?\.?)\s*[-–—]?\s*(.*)$/i;
  const incisoRe = /^([IVXLCDM]{1,7})\s*[-–—.)]\s+(.*)$/;
  const alineaRe = /^([a-z])\)\s+(.*)$/;
  const itemRe = /^(\d{1,2})\.\s+(.*)$/;

  const blocks: LegalBlock[] = [];

  for (const line of rawLines) {
    let matched: { kind: BlockKind; marker: string; body: string } | null = null;

    const mArt = line.match(artRe);
    const mParU = !mArt ? line.match(parUnicoRe) : null;
    const mParN = !mArt && !mParU ? line.match(parNumRe) : null;
    const mInc = !mArt && !mParU && !mParN ? line.match(incisoRe) : null;
    const mAli = !mArt && !mParU && !mParN && !mInc ? line.match(alineaRe) : null;
    const mItem = !mArt && !mParU && !mParN && !mInc && !mAli ? line.match(itemRe) : null;

    if (mArt) {
      matched = { kind: 'artigo', marker: mArt[1].trim(), body: mArt[2].trim() };
    } else if (mParU) {
      matched = { kind: 'paragrafo', marker: 'Parágrafo único', body: mParU[2].trim() };
    } else if (mParN) {
      matched = { kind: 'paragrafo', marker: mParN[1].replace(/\s+/g, ' ').trim(), body: mParN[2].trim() };
    } else if (mInc) {
      matched = { kind: 'inciso', marker: mInc[1].trim(), body: mInc[2].trim() };
    } else if (mAli) {
      matched = { kind: 'alinea', marker: `${mAli[1]})`, body: mAli[2].trim() };
    } else if (mItem) {
      matched = { kind: 'item', marker: `${mItem[1]}.`, body: mItem[2].trim() };
    }

    if (matched) {
      const { clean, annotations } = extractAnnotations(matched.body);
      blocks.push({
        id: `b_${blocks.length}`,
        kind: matched.kind,
        marker: matched.marker,
        body: clean,
        annotations,
      });
    } else if (blocks.length > 0) {
      // Continuação de linha quebrada de PDF -> junta no bloco anterior
      const prev = blocks[blocks.length - 1];
      const { clean, annotations } = extractAnnotations(line);
      prev.body = [prev.body, clean].filter(Boolean).join(' ');
      if (annotations.length > 0) prev.annotations.push(...annotations);
    } else {
      const { clean, annotations } = extractAnnotations(line);
      blocks.push({
        id: `b_${blocks.length}`,
        kind: 'texto',
        marker: '',
        body: clean,
        annotations,
      });
    }
  }

  return blocks;
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
      if (currentY !== null && y !== null && Math.abs(y - currentY) > 4) {
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
      if (/^(?:Presidência da República|Casa Civil|Subchefia para Assuntos Jurídicos)$/i.test(ln)) {
        return false;
      }
      return true;
    });
    pagesText.push(cleaned.join('\n'));
  }

  return pagesText.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function splitLawIntoSections(
  rawText: string,
  lawName: string
): { title: string; text: string }[] {
  const clean = rawText
    .replace(/-\n([a-záàâãéêíóôõúç])/g, '$1')
    .replace(/\n(?=Art\.\s*\d)/g, '\n\n')
    .trim();

  // Divide por início de cada Artigo
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
    return [{ title: '', text: clean }];
  }

  const GROUP_SIZE = 20;
  const sections: { title: string; text: string }[] = [];
  for (let i = 0; i < artBlocks.length; i += GROUP_SIZE) {
    const slice = artBlocks.slice(i, i + GROUP_SIZE);
    const firstArt = slice[0].match(/Art\.\s*\d+[º°o]?/i)?.[0] || `Parte ${sections.length + 1}`;
    const lastArt = slice[slice.length - 1].match(/Art\.\s*\d+[º°o]?/i)?.[0] || '';
    const rangeLabel = lastArt && lastArt !== firstArt ? `${firstArt} a ${lastArt}` : firstArt;
    sections.push({
      title: lawName ? `${lawName} · ${rangeLabel}` : rangeLabel,
      text: slice.join('\n\n'),
    });
  }
  return sections;
}

export default function LeiSecaPage() {
  const { profile, subjects } = useProfile();
  const { notify } = useGlobal();
  const aiName = useAiProviderName();
  const [pdfProgress, setPdfProgress] = useState<string>('');
  const [aiFormatting, setAiFormatting] = useState(false);
  const [formattingCardId, setFormattingCardId] = useState<string | null>(null);
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'highlighted'>('all');

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
  }, [storageKey]);

  function persist(next: LeiSecaArticle[]) {
    setArticles(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
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

  const previewBlocks = useMemo(() => parseLeiSecaBlocks(formRawText), [formRawText]);

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return articles.filter((a) => {
      if (selectedLaw !== 'ALL') {
        const bucket = normalizeLawBucket(a.lawName, a.title, a.rawText);
        if (bucket !== selectedLaw) return false;
      }
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
  }, [articles, selectedLaw, searchQuery, statusFilter, subjectMap]);

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
      setPdfProgress('Abrindo PDF...');
      const extracted = await extractPdfTextInBrowser(file, (p, total) => {
        setPdfProgress(`Lendo página ${p} de ${total}...`);
      });
      if (!extracted.trim()) {
        notify('Não foi possível extrair texto desse PDF (pode ser imagem escaneada).', 'error');
        return;
      }

      const inferredLaw =
        formLawName.trim() ||
        (/clt|5\.452/i.test(file.name + ' ' + extracted.slice(0, 600))
          ? 'CLT'
          : file.name.replace(/\.pdf$/i, '').slice(0, 32));

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
          lawName: inferredLaw,
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
          <label className="cursor-pointer px-4 py-3 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm">
            {pdfProgress ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileUp className="w-4 h-4" />
            )}
            {pdfProgress || 'Importar PDF (CLT/Lei)'}
            <input
              type="file"
              accept="application/pdf"
              disabled={Boolean(pdfProgress)}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportLawPdf(file);
                e.currentTarget.value = '';
              }}
            />
          </label>
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
            <div className="relative">
              <Filter className="w-3.5 h-3.5 text-muted-theme absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={selectedLaw}
                onChange={(e) => setSelectedLaw(e.target.value)}
                className="rounded-2xl subtle-surface border border-theme pl-8 pr-4 py-2.5 text-xs font-bold"
              >
                <option value="ALL">Todas as leis ({articles.length})</option>
                {lawBuckets.map((law) => (
                  <option key={law.name} value={law.name}>
                    {law.name} ({law.count})
                  </option>
                ))}
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

          <div className="ml-auto flex items-center gap-1">
            {(
              [
                { id: 'all', label: 'Todos' },
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
        <div className="space-y-4">
          {filteredArticles.map((art) => {
            const sub = subjectMap.get(art.subjectId);
            const blocks = parseLeiSecaBlocks(art.rawText);
            const isCollapsed = Boolean(collapsedIds[art.id]);
            const incisoCount = blocks.filter((b) => b.kind === 'inciso').length;
            const parCount = blocks.filter((b) => b.kind === 'paragrafo').length;
            const readCount = getReadCount(art);

            return (
              <div
                key={art.id}
                id={`ls-art-${art.id}`}
                className={`card-surface rounded-3xl border transition ${
                  highlightedArticleId === art.id
                    ? 'border-indigo-500 ring-2 ring-indigo-500/40'
                    : art.studied
                      ? 'border-emerald-500/35'
                      : 'border-theme'
                }`}
              >
                {/* Cabeçalho do Artigo */}
                <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
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

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h2 className="font-extrabold text-base truncate">{art.title}</h2>
                        {art.lawName && (
                          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-300">
                            {art.lawName}
                          </span>
                        )}
                        {sub && (
                          <span
                            className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: sub.color }}
                          >
                            {sub.name}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-theme mt-0.5">
                        {incisoCount > 0 ? `${incisoCount} ${incisoCount === 1 ? 'inciso' : 'incisos'}` : 'Texto corrido'}
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
                  <p className="text-xs font-extrabold text-teal-700 dark:text-teal-300">
                    Prévia formatada ({previewBlocks.length}{' '}
                    {previewBlocks.length === 1 ? 'bloco' : 'blocos'})
                  </p>
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
    </div>
  );
}
