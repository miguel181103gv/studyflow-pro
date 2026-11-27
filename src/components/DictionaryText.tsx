'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from './ProfileProvider';
import { pushLeiSecaToCloud } from '@/lib/cloudSync';
import { BookOpen, ExternalLink, Loader2, Scale, X } from 'lucide-react';
import { parseLeiSecaBlocks } from '@/lib/leiSecaParser';
import { LegalBlocksView } from './LegalBlocksView';

export interface DictEntryLite {
  id: string;
  word: string;
  meaning: string;
  example?: string;
  subject_id?: string;
}

interface LeiSecaStored {
  id: string;
  subjectId?: string;
  lawName?: string;
  title?: string;
  rawText?: string;
  note?: string;
  studied?: boolean;
  readCount?: number;
  highlights?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

const DICT_EVENT = 'sf-dictionary-updated';

export function dispatchDictionaryUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DICT_EVENT));
  }
}

function stripAccentsLower(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function accentPattern(base: string): string {
  let out = '';
  for (const ch of base) {
    if (ch === 'a') out += '[aáàâãä]';
    else if (ch === 'e') out += '[eéèêë]';
    else if (ch === 'i') out += '[iíìîï]';
    else if (ch === 'o') out += '[oóòôõö]';
    else if (ch === 'u') out += '[uúùûü]';
    else if (ch === 'c') out += '[cç]';
    else if (ch === 'n') out += '[nñ]';
    else if (/\s/.test(ch)) out += '\\s+';
    else out += escapeRegExp(ch);
  }
  return out;
}

const VERB_SUFFIX_RE =
  '(?:[aá]r|[eé]r|[ií]r|ou|ei|am|em|[aã]o|ava[ms]?|ia[ms]?|[aá]mos|[eé]mos|[ií]mos|ado[s]?|ada[s]?|ido[s]?|ida[s]?|ando|endo|indo|ar[aá]o?|er[aá]o?|ir[aá]o?|aram|eram|iram|asse[ms]?|esse[ms]?|isse[ms]?|aria[ms]?|eria[ms]?|iria[ms]?|a|e|i|o)';

function getVerbStem(normWord: string): string | null {
  if (/\s/.test(normWord) || normWord.length < 5) return null;
  if (/(?:ar|er|ir)$/.test(normWord)) {
    const stem = normWord.slice(0, -2);
    return stem.length >= 3 ? stem : null;
  }
  return null;
}

function toAccentInsensitivePattern(word: string): string {
  const base = stripAccentsLower(word);
  const verbStem = getVerbStem(base);
  if (verbStem) {
    let stemPat = accentPattern(verbStem);
    if (verbStem.endsWith('c')) {
      stemPat = `${accentPattern(verbStem.slice(0, -1))}(?:c|qu)`;
    } else if (verbStem.endsWith('g')) {
      stemPat = `${accentPattern(verbStem.slice(0, -1))}(?:g|gu)`;
    } else if (base.endsWith('car') || base.endsWith('gar')) {
      // handled above
    }
    return `${stemPat}${VERB_SUFFIX_RE}`;
  }
  const pat = accentPattern(base);
  if (!/\s/.test(base) && base.length >= 4 && !base.endsWith('s')) {
    return `${pat}(?:e?s)?`;
  }
  return pat;
}

const LAW_ARTICLE_PATTERN =
  '(?:\\b(?:(?:(?:(?:[ao]s?)\\s+)?(?:al[íi]neas?\\s+["“”\\x27]?[a-z]["“”\\x27]?|incisos?\\s+(?!(?:d[aeo]|no|na)\\b)[IVXLCDM]+\\b|§§?\\s*\\d+[º°oª]?|par[áa]grafos?\\s+[úu]nicos?)(?:\\s*(?:,|e|d[aeo]s?|n[ao]s?)\\s+)+)*art(?:igo)?s?\\.?\\s*\\d+(?:\\.\\d{3})*(?:[º°oª])?(?:-[A-Za-z]+)?(?:\\s*,\\s*(?:caput|§\\s*\\d+[º°oª]?|par[áa]grafo\\s+[úu]nico|inc(?:iso)?\\.?\\s*(?!(?:d[aeo]|no|na)\\b)[IVXLCDM]+\\b|(?!(?:d[aeo]|no|na)\\b)[IVXLCDM]+\\b|al[íi]nea\\s+["“”\\x27]?[a-z]["“”\\x27]?|[a-z]\\)))*(?:,?\\s*(?:d[aeo]|no|na)\\s+(?:(?:CRFB(?:\\/\\d{2,4})?|CF(?:\\/\\d{2,4})?|Constitui[çc][ãa]o(?:\\s+Federal)?(?:\\s+de\\s+\\d{4})?|CLT|Consolida[çc][ãa]o\\s+das\\s+Leis\\s+do\\s+Trabalho|CPC(?:\\/\\d{2,4})?|C[óo]digo\\s+de\\s+Processo\\s+Civil|CPP(?:\\/\\d{2,4})?|C[óo]digo\\s+de\\s+Processo\\s+Penal|C[óo]digo\\s+Penal|CP|C[óo]digo\\s+Civil|CC(?:\\/\\d{2,4})?|CDC|CTN|ECA|LGPD|LINDB|EC(?:\\s*n\\.?[º°]?\\s*)?\\d+(?:\\/\\d{2,4})?|Emenda\\s+Constitucional(?:\\s*n\\.?[º°]?\\s*)?\\d+(?:\\/\\d{2,4})?|MP(?:\\s*n\\.?[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?|Medida\\s+Provis[óo]ria(?:\\s*n\\.?[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?|Decreto-Lei(?:\\s*n\\.?[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?|Decreto(?:\\s*n\\.?[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?|DL(?:\\s*n\\.?[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?|Resolu[çc][ãa]o(?:\\s*n\\.?[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?|Portaria(?:\\s*n\\.?[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?|Lei\\s+(?:Complementar\\s+|Ordin[áa]ria\\s+|n\\.?[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?|LC\\s*(?:n\\.?[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?)\\b))?)|\\b(?:S[úu]mula(?:\\s+Vinculante)?|OJ|Orienta[çc][ãa]o\\s+Jurisprudencial)\\s*(?:n[º°]?\\s*)?\\d+(?:\\s*,\\s*(?:item\\s+)?(?!(?:d[aeo]|no|na)\\b)[IVXLCDM]+\\b)*(?:\\s*,?\\s*(?:d[aeo]|na|no)\\s+(?:SDI-?[12]|SBDI-?[12]|TST|STF|STJ|TSE|TNU))*(?:\\s*,?\\s*(?:d[aeo])\\s+(?:TST|STF|STJ|TSE|TNU))?\\b)';

function parseLawCitation(raw: string): { article: string; lawHint: string } {
  const sumMatch = raw.match(/\b(S[úu]mula(?:\s+Vinculante)?|OJ|Orienta[çc][ãa]o\s+Jurisprudencial)\s*(?:n[º°]?\s*)?(\d+)/i);
  if (sumMatch) {
    const kindRaw = sumMatch[1];
    const num = sumMatch[2];
    const isVinc = /vinculante/i.test(kindRaw);
    const isOj = /^oj|orienta/i.test(kindRaw);
    const article = isVinc ? `Súmula Vinculante ${num}` : isOj ? `OJ ${num}` : `Súmula ${num}`;
    let court = '';
    if (/\bTST\b/i.test(raw)) court = 'TST';
    else if (/\bSTF\b/i.test(raw)) court = 'STF';
    else if (/\bSTJ\b/i.test(raw)) court = 'STJ';
    else if (/\bTSE\b/i.test(raw)) court = 'TSE';
    else if (/\bTNU\b/i.test(raw)) court = 'TNU';
    else if (isVinc) court = 'STF';
    else if (isOj) court = 'TST';
    const lawHint = isVinc
      ? 'Súmulas Vinculantes STF'
      : isOj
      ? `OJs ${court || 'TST'}`
      : court
      ? `Súmulas ${court}`
      : 'Súmulas';
    return { article, lawHint };
  }

  const numMatch = raw.match(/art(?:igo)?s?\.?\s*(\d+(?:[º°oª])?(?:-[A-Za-z]+)?)/i);
  const article = numMatch ? `Art. ${numMatch[1]}` : raw.trim();

  let lawHint = '';
  if (/\b(?:CRFB|CF)(?:\/\d{2,4})?\b|\bConstitui[çc][ãa]o/i.test(raw)) lawHint = 'CF/88';
  else if (/\bCLT\b|Consolida[çc][ãa]o\s+das\s+Leis\s+do\s+Trabalho/i.test(raw)) lawHint = 'CLT';
  else if (/\bCPC\b|C[óo]digo\s+de\s+Processo\s+Civil/i.test(raw)) lawHint = 'CPC';
  else if (/\bCPP\b|C[óo]digo\s+de\s+Processo\s+Penal/i.test(raw)) lawHint = 'CPP';
  else if (/\bCC\b|C[óo]digo\s+Civil/i.test(raw)) lawHint = 'Código Civil';
  else if (/\bCP\b|C[óo]digo\s+Penal/i.test(raw)) lawHint = 'Código Penal';
  else if (/\bCDC\b/i.test(raw)) lawHint = 'CDC';
  else if (/\bCTN\b/i.test(raw)) lawHint = 'CTN';
  else if (/\bECA\b/i.test(raw)) lawHint = 'ECA';
  else if (/\bLGPD\b/i.test(raw)) lawHint = 'LGPD';
  else if (/\bLINDB\b/i.test(raw)) lawHint = 'LINDB';
  else {
    const normM = raw.match(/\b((?:Lei(?:\s+Complementar|\s+Ordin[áa]ria)?|LC|MP|Medida\s+Provis[óo]ria|EC|Emenda\s+Constitucional|Decreto-Lei|Decreto|DL|Resolu[çc][ãa]o|Portaria)\s*(?:n\.?[º°]?\s*)?\d[\d.]*(?:\/\d{2,4})?)/i);
    if (normM) lawHint = normM[1].replace(/\s+/g, ' ').trim();
  }

  return { article, lawHint };
}

/**
 * Verifica se um match de "Art. X" é realmente a definição do artigo (caput) e não uma citação (ex: "art. 37, § 4º").
 */
function isArticleDefinitionTail(tail: string): boolean {
  const t = (tail || '').trimStart();
  if (!t) return false;
  if (/^[,)]/.test(t)) return false;
  if (/^(?:d[aeo]s?|dest[ae]|dess[ae]|n[ao]s?|al[íi]nea|inciso|§|par[áa]grafo|caput)\b/i.test(t)) {
    return false;
  }
  return true;
}

/**
 * Extrai apenas o trecho do artigo específico quando o registro salvo contém um bloco de 20 artigos.
 */
function extractSingleArticleSnippet(rawText: string, artNum: string): string | null {
  const clean = (rawText || '').trim();
  if (!clean || !artNum) return clean || null;
  const escaped = escapeRegExp(artNum);
  const lineRe = new RegExp(
    `(?:^|\\n)\\s*(Art\\.?\\s*${escaped}[º°oª]?\\.?\\s*([^\\n]*))`,
    'gi'
  );
  let startIdx = -1;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(clean)) !== null) {
    if (isArticleDefinitionTail(match[2] || '')) {
      startIdx = match.index + (clean[match.index] === '\n' ? 1 : 0);
      break;
    }
  }
  if (startIdx < 0) return null;

  const rest = clean.slice(startIdx).trimStart();
  // Procura o início real do próximo artigo (ignorando citações)
  const nextRe = /\n\s*Art\.?\s*\d+(?:\.\d{3})*[º°oª]?(?:-[A-Za-z0-9]+)?\.?\s*([^\n]*)/gi;
  nextRe.lastIndex = 8;
  let nextArtIdx = -1;
  let nm: RegExpExecArray | null;
  while ((nm = nextRe.exec(rest)) !== null) {
    if (isArticleDefinitionTail(nm[1] || '')) {
      nextArtIdx = nm.index;
      break;
    }
  }
  const sliced = (nextArtIdx > 0 ? rest.slice(0, nextArtIdx) : rest).trim();
  // Evita retornar apenas um título solto ou citação curta
  if (sliced.length < 25) return null;
  return sliced;
}

interface DictIndex {
  regex: RegExp | null;
  map: Map<string, DictEntryLite>;
  stemMatchers: Array<{ re: RegExp; entry: DictEntryLite }>;
}

function buildDictIndex(entries: DictEntryLite[]): DictIndex {
  const map = new Map<string, DictEntryLite>();
  const valid: DictEntryLite[] = [];
  const stemMatchers: Array<{ re: RegExp; entry: DictEntryLite }> = [];
  for (const e of entries) {
    const key = stripAccentsLower(e.word || '').replace(/\s+/g, ' ');
    if (key.length >= 2 && e.meaning?.trim() && !map.has(key)) {
      map.set(key, e);
      valid.push(e);
      try {
        stemMatchers.push({
          re: new RegExp(`^${toAccentInsensitivePattern(e.word)}$`, 'i'),
          entry: e,
        });
      } catch {
        // ignore
      }
    }
  }
  if (valid.length === 0) return { regex: null, map, stemMatchers };

  valid.sort((a, b) => b.word.length - a.word.length);

  const patterns = valid.slice(0, 400).map((e) => toAccentInsensitivePattern(e.word));
  try {
    const wordChar = 'a-zA-Z0-9_áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
    const regex = new RegExp(`(^|[^${wordChar}])(${patterns.join('|')})(?=[^${wordChar}]|$)`, 'gi');
    return { regex, map, stemMatchers };
  } catch {
    return { regex: null, map, stemMatchers };
  }
}

export function useDictionaryIndex(): DictIndex {
  const { profile } = useProfile();
  const storageKey = `sf_dictionary_${profile?.id || 'default'}`;
  const [entries, setEntries] = useState<DictEntryLite[]>([]);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setEntries(parsed);
            return;
          }
        }
        setEntries([]);
      } catch {
        setEntries([]);
      }
    };
    load();
    window.addEventListener(DICT_EVENT, load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener(DICT_EVENT, load);
      window.removeEventListener('storage', load);
    };
  }, [storageKey]);

  return useMemo(() => buildDictIndex(entries), [entries]);
}

type Segment =
  | { type: 'text'; value: string }
  | { type: 'term'; value: string; entry: DictEntryLite }
  | { type: 'law'; value: string; article: string; lawHint: string; contextText: string };

type FloatingModalState =
  | { kind: 'dict'; entry: DictEntryLite }
  | {
      kind: 'law';
      article: string;
      lawHint: string;
      loading: boolean;
      error?: string;
      title?: string;
      lawName?: string;
      text?: string;
      savedId?: string;
      downloadedFromWeb?: boolean;
    };

export function DictionaryText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const router = useRouter();
  const { profile } = useProfile();
  const { regex, map, stemMatchers } = useDictionaryIndex();
  const [hovered, setHovered] = useState<{
    kind: 'dict' | 'law';
    title: string;
    body: string;
    example?: string;
    x: number;
    y: number;
    below: boolean;
    keyId: string;
  } | null>(null);

  const [modal, setModal] = useState<FloatingModalState | null>(null);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  const segments = useMemo(() => {
    if (!text) return null;

    const lawRegex = new RegExp(LAW_ARTICLE_PATTERN, 'gi');
    const firstPass: Array<
      | { type: 'text'; value: string }
      | { type: 'law'; value: string; article: string; lawHint: string; contextText: string }
    > = [];
    let lastIdx = 0;
    let lawMatch: RegExpExecArray | null;
    while ((lawMatch = lawRegex.exec(text)) !== null) {
      if (lawMatch.index > lastIdx) {
        firstPass.push({ type: 'text', value: text.slice(lastIdx, lawMatch.index) });
      }
      const rawMatched = lawMatch[0];
      const { article, lawHint } = parseLawCitation(rawMatched);
      const ctxStart = Math.max(0, lawMatch.index - 450);
      const ctxEnd = Math.min(text.length, lawMatch.index + rawMatched.length + 450);
      const contextText = text.slice(ctxStart, ctxEnd).trim();
      firstPass.push({ type: 'law', value: rawMatched, article, lawHint, contextText });
      lastIdx = lawMatch.index + rawMatched.length;
      if (rawMatched.length === 0) lawRegex.lastIndex++;
    }
    if (lastIdx < text.length) {
      firstPass.push({ type: 'text', value: text.slice(lastIdx) });
    }

    const hasLaw = firstPass.some((p) => p.type === 'law');
    if (!regex && !hasLaw) return null;

    const parts: Segment[] = [];
    for (const chunk of firstPass) {
      if (chunk.type === 'law') {
        parts.push(chunk);
        continue;
      }
      if (!regex) {
        parts.push(chunk);
        continue;
      }
      const subText = chunk.value;
      regex.lastIndex = 0;
      let subLast = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(subText)) !== null) {
        const prefix = match[1] || '';
        const matchedWord = match[2] || '';
        const matchStart = match.index + prefix.length;

        if (matchStart > subLast) {
          parts.push({ type: 'text', value: subText.slice(subLast, matchStart) });
        }

        const norm = stripAccentsLower(matchedWord).replace(/\s+/g, ' ');
        const entry =
          map.get(norm) ||
          stemMatchers.find((sm) => sm.re.test(matchedWord))?.entry;
        if (entry) {
          parts.push({ type: 'term', value: matchedWord, entry });
        } else {
          parts.push({ type: 'text', value: matchedWord });
        }

        subLast = matchStart + matchedWord.length;
        if (match[0].length === 0) regex.lastIndex++;
      }
      if (subLast < subText.length) {
        parts.push({ type: 'text', value: subText.slice(subLast) });
      }
    }

    const anySpecial = parts.some((p) => p.type !== 'text');
    return anySpecial ? parts : null;
  }, [text, regex, map, stemMatchers]);

  if (!text) return null;
  if (!segments) {
    return className ? <span className={className}>{text}</span> : <>{text}</>;
  }

  const showTooltip = (
    el: HTMLElement,
    payload: { kind: 'dict' | 'law'; title: string; body: string; example?: string; keyId: string }
  ) => {
    const rect = el.getBoundingClientRect();
    const below = rect.top < 140;
    const x = Math.max(150, Math.min(window.innerWidth - 150, rect.left + rect.width / 2));
    const y = below ? rect.bottom + 8 : rect.top - 8;
    setHovered({ ...payload, x, y, below });
  };

  async function openLawModal(article: string, lawHint: string, contextText = '') {
    setHovered(null);
    const lsKey = `sf_lei_seca_${profile?.id || 'default'}`;
    let stored: LeiSecaStored[] = [];
    try {
      const raw = localStorage.getItem(lsKey);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) stored = parsed;
    } catch {
      stored = [];
    }

    let effectiveLawHint = (lawHint || '').trim();
    let effectiveArticle = article;

    if (!effectiveLawHint && contextText) {
      setModal({
        kind: 'law',
        article,
        lawHint: 'Identificando norma...',
        loading: true,
      });
      try {
        const savedLaws = Array.from(
          new Set(stored.map((s) => (s.lawName || '').trim()).filter(Boolean))
        );
        const res = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'resolve_law_citation',
            article,
            contextText,
            savedLaws,
          }),
        });
        const json = await res.json();
        if (res.ok && json.ok && json.data?.lawName) {
          effectiveLawHint = String(json.data.lawName).trim();
          if (json.data.article) effectiveArticle = String(json.data.article).trim();
        }
      } catch {
        // segue se offline
      }
    }

    const numMatch = effectiveArticle.match(/\d+(?:\.\d{3})*(?:-[A-Za-z]+)?/);
    const artNum = numMatch ? numMatch[0].toLowerCase() : '';
    const isSumula = /^(?:s[úu]mula|oj)\b/i.test(effectiveArticle);
    const artRegex = artNum
      ? isSumula
        ? new RegExp(`\\b(?:S[úu]mula(?:\\s+Vinculante)?|OJ)\\s*(?:n[º°]?\\s*)?${escapeRegExp(artNum)}\\b`, 'i')
        : new RegExp(`\\bArt\\.?\\s*${escapeRegExp(artNum)}[º°oª]?\\b`, 'i')
      : null;
    const lawNorm = effectiveLawHint.toLowerCase().replace(/[^a-z0-9]/g, '');

    let existing: LeiSecaStored | undefined;
    let existingSnippet: string | null = null;

    for (const a of stored) {
      const lawNameStr = (a.lawName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const lawOk =
        !lawNorm ||
        (Boolean(lawNameStr) && (lawNameStr.includes(lawNorm) || lawNorm.includes(lawNameStr)));
      if (!lawOk || !a.rawText) continue;

      if (isSumula) {
        if (artRegex && (artRegex.test(a.title || '') || artRegex.test(a.rawText || ''))) {
          existing = a;
          existingSnippet = a.rawText.trim();
          break;
        }
      } else if (artNum) {
        const snippet = extractSingleArticleSnippet(a.rawText, artNum);
        if (snippet) {
          existing = a;
          existingSnippet = snippet;
          break;
        }
      } else if ((a.title || '').toLowerCase().includes(article.toLowerCase())) {
        existing = a;
        existingSnippet = a.rawText.trim();
        break;
      }
    }

    if (existing && existingSnippet) {
      setModal({
        kind: 'law',
        article: effectiveArticle,
        lawHint: effectiveLawHint,
        loading: false,
        title: effectiveArticle,
        lawName: existing.lawName || effectiveLawHint,
        text: existingSnippet,
        savedId: existing.id,
        downloadedFromWeb: false,
      });
      return;
    }

    // Não encontrou salvo: abre modal carregando e baixa da internet
    setModal({
      kind: 'law',
      article: effectiveArticle,
      lawHint: effectiveLawHint,
      loading: true,
    });

    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fetch_law_article',
          article: effectiveArticle,
          lawHint: effectiveLawHint,
          contextText,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data?.rawText) {
        throw new Error(json.error || 'Não foi possível localizar o artigo na internet.');
      }
      const now = new Date().toISOString();
      const created: LeiSecaStored = {
        id: `ls_web_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        subjectId: '',
        lawName: String(json.data.lawName || lawHint || '').trim(),
        title: String(json.data.title || article).trim(),
        rawText: String(json.data.rawText).trim(),
        note: 'Baixado automaticamente da internet via StudyFlow.',
        studied: false,
        readCount: 0,
        highlights: {},
        createdAt: now,
        updatedAt: now,
      };
      try {
        localStorage.setItem(lsKey, JSON.stringify([created, ...stored]));
        if (profile?.user_id && profile?.id) pushLeiSecaToCloud(profile.user_id, profile.id);
      } catch {
        // ignore quota errors
      }
      setModal({
        kind: 'law',
        article,
        lawHint,
        loading: false,
        title: created.title,
        lawName: created.lawName,
        text: created.rawText,
        savedId: created.id,
        downloadedFromWeb: true,
      });
    } catch (err) {
      setModal({
        kind: 'law',
        article,
        lawHint,
        loading: false,
        error: err instanceof Error ? err.message : 'Erro ao buscar artigo na internet.',
      });
    }
  }

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <React.Fragment key={i}>{seg.value}</React.Fragment>;
        }
        if (seg.type === 'law') {
          const lawLabel = seg.lawHint ? `${seg.article} (${seg.lawHint})` : seg.article;
          return (
            <span
              key={i}
              role="button"
              tabIndex={0}
              onMouseEnter={(e) =>
                showTooltip(e.currentTarget, {
                  kind: 'law',
                  keyId: `law_${i}_${seg.article}`,
                  title: `📜 ${lawLabel}`,
                  body: 'Clique para ler em janela flutuante sem sair daqui (baixa da internet se não tiver).',
                })
              }
              onMouseLeave={() => setHovered(null)}
              onClick={(e) => {
                e.stopPropagation();
                void openLawModal(seg.article, seg.lawHint, seg.contextText);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  void openLawModal(seg.article, seg.lawHint, seg.contextText);
                }
              }}
              className="border-b border-dotted border-indigo-500/80 dark:border-indigo-400/80 text-indigo-700 dark:text-indigo-300 font-semibold cursor-pointer rounded-sm px-0.5 hover:bg-indigo-500/15 hover:border-solid transition-colors"
            >
              {seg.value}
            </span>
          );
        }

        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            onMouseEnter={(e) =>
              showTooltip(e.currentTarget, {
                kind: 'dict',
                keyId: seg.entry.id,
                title: seg.entry.word,
                body: seg.entry.meaning,
                example: seg.entry.example,
              })
            }
            onMouseLeave={() => setHovered(null)}
            onClick={(e) => {
              e.stopPropagation();
              setHovered(null);
              setModal({ kind: 'dict', entry: seg.entry });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setHovered(null);
                setModal({ kind: 'dict', entry: seg.entry });
              }
            }}
            className="border-b border-dotted border-teal-500/80 dark:border-teal-400/80 text-teal-700 dark:text-teal-300 font-medium cursor-pointer rounded-sm hover:bg-teal-500/15 hover:border-solid transition-colors"
          >
            {seg.value}
          </span>
        );
      })}

      {hovered && !modal && (
        <span
          role="tooltip"
          style={{
            left: hovered.x,
            top: hovered.y,
            transform: hovered.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
          className={`fixed z-[9999] pointer-events-none w-max max-w-[290px] rounded-xl border ${
            hovered.kind === 'law' ? 'border-indigo-500/50' : 'border-teal-500/40'
          } bg-slate-900 text-white dark:bg-slate-800 px-3 py-2 shadow-xl text-left`}
        >
          <span
            className={`block text-[11px] font-bold mb-0.5 ${
              hovered.kind === 'law' ? 'text-indigo-300' : 'text-teal-300'
            }`}
          >
            {hovered.title}
          </span>
          <span className="block text-[11px] leading-snug text-slate-100 line-clamp-4">
            {hovered.body}
          </span>
          {hovered.example && (
            <span className="block text-[10px] italic text-slate-300 mt-1 line-clamp-2">
              Ex: {hovered.example}
            </span>
          )}
        </span>
      )}

      {modal && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setModal(null);
          }}
          className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[82vh] flex flex-col rounded-3xl card-surface border border-theme shadow-2xl overflow-hidden animate-fade-in-up"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-theme flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    modal.kind === 'law'
                      ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300'
                      : 'bg-teal-500/15 text-teal-600 dark:text-teal-300'
                  }`}
                >
                  {modal.kind === 'law' ? (
                    <Scale className="w-4 h-4" />
                  ) : (
                    <BookOpen className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-extrabold text-base truncate">
                      {modal.kind === 'law'
                        ? modal.title || modal.article
                        : modal.entry.word}
                    </h3>
                    {modal.kind === 'law' && (modal.lawName || modal.lawHint) && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                        {modal.lawName || modal.lawHint}
                      </span>
                    )}
                    {modal.kind === 'law' && modal.downloadedFromWeb && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        Salvo na Lei Seca
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-theme">
                    {modal.kind === 'law'
                      ? 'Leitura rápida · Feche para continuar de onde parou'
                      : 'Dicionário Pessoal · Feche para continuar'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                title="Fechar (Esc)"
                className="p-2 rounded-xl subtle-surface hover:opacity-80 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-3 text-sm leading-relaxed">
              {modal.kind === 'dict' ? (
                <>
                  <p className="whitespace-pre-wrap">{modal.entry.meaning}</p>
                  {modal.entry.example && (
                    <div className="rounded-2xl subtle-surface border border-theme px-4 py-3 text-xs italic text-muted-theme">
                      <span className="font-bold not-italic text-teal-600 dark:text-teal-300">
                        Exemplo:{' '}
                      </span>
                      {modal.entry.example}
                    </div>
                  )}
                </>
              ) : modal.loading ? (
                <div className="py-10 flex flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                  <p className="text-sm font-semibold">
                    Buscando {modal.article}
                    {modal.lawHint ? ` (${modal.lawHint})` : ''} na internet...
                  </p>
                  <p className="text-xs text-muted-theme">
                    O artigo será salvo automaticamente na sua aba Lei Seca.
                  </p>
                </div>
              ) : modal.error ? (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-600 dark:text-rose-300">
                  {modal.error}
                </div>
              ) : (
                <LegalBlocksView
                  blocks={parseLeiSecaBlocks(modal.text || '')}
                  interactive={false}
                />
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-theme flex items-center justify-between gap-2 bg-[var(--bg-subtle)]/40">
              {profile?.id ? (
                <button
                  type="button"
                  onClick={() => {
                    const m = modal;
                    setModal(null);
                    if (m.kind === 'dict') {
                      router.push(
                        `/p/${profile.id}/dicionario?q=${encodeURIComponent(m.entry.word)}`
                      );
                    } else {
                      const params = new URLSearchParams();
                      if (m.savedId) params.set('id', m.savedId);
                      params.set('art', m.article);
                      if (m.lawName || m.lawHint) params.set('law', m.lawName || m.lawHint);
                      router.push(`/p/${profile.id}/lei-seca?${params.toString()}`);
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl subtle-surface border border-theme text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-85"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {modal.kind === 'law' ? 'Abrir na aba Lei Seca' : 'Abrir no Dicionário'}
                </button>
              ) : (
                <span />
              )}

              <button
                type="button"
                onClick={() => setModal(null)}
                className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
              >
                Fechar e voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
