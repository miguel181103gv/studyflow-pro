'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from './ProfileProvider';

export interface DictEntryLite {
  id: string;
  word: string;
  meaning: string;
  example?: string;
  subject_id?: string;
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

function toAccentInsensitivePattern(word: string): string {
  const base = stripAccentsLower(word);
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

const LAW_ARTICLE_PATTERN =
  '\\b(?:art(?:igo)?s?\\.?\\s*\\d+(?:[º°oª])?(?:-[A-Za-z]+)?(?:\\s*,\\s*(?:caput|§\\s*\\d+[º°oª]?|par[áa]grafo\\s+[úu]nico|inc(?:iso)?\\.?\\s*[IVXLCDM]+|[IVXLCDM]+|al[íi]nea\\s+[a-z]|[a-z]\\)))*(?:\\s*(?:d[aeo]|no|na)\\s+(?:CF(?:\\/\\d{2,4})?|Constitui[çc][ãa]o(?:\\s+Federal)?(?:\\s+de\\s+\\d{4})?|CLT|Consolida[çc][ãa]o\\s+das\\s+Leis\\s+do\\s+Trabalho|CP|C[óo]digo\\s+Penal|CC|C[óo]digo\\s+Civil|CPC|C[óo]digo\\s+de\\s+Processo\\s+Civil|CPP|C[óo]digo\\s+de\\s+Processo\\s+Penal|CDC|CTN|ECA|LGPD|LINDB|Lei\\s+(?:Complementar\\s+|n[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?|LC\\s*(?:n[º°]?\\s*)?\\d[\\d.]*(?:\\/\\d{2,4})?))?)';

function parseLawCitation(raw: string): { article: string; lawHint: string } {
  const numMatch = raw.match(/art(?:igo)?s?\.?\s*(\d+(?:[º°oª])?(?:-[A-Za-z]+)?)/i);
  const article = numMatch ? `Art. ${numMatch[1]}` : raw.trim();

  let lawHint = '';
  if (/\bCF(?:\/\d{2,4})?\b|\bConstitui[çc][ãa]o/i.test(raw)) lawHint = 'CF/88';
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
    const leiM = raw.match(/\b((?:Lei(?:\s+Complementar)?|LC)\s*(?:n[º°]?\s*)?\d[\d.]*(?:\/\d{2,4})?)/i);
    if (leiM) lawHint = leiM[1].replace(/\s+/g, ' ').trim();
  }

  return { article, lawHint };
}

interface DictIndex {
  regex: RegExp | null;
  map: Map<string, DictEntryLite>;
}

function buildDictIndex(entries: DictEntryLite[]): DictIndex {
  const map = new Map<string, DictEntryLite>();
  const valid: DictEntryLite[] = [];
  for (const e of entries) {
    const key = stripAccentsLower(e.word || '').replace(/\s+/g, ' ');
    if (key.length >= 2 && e.meaning?.trim() && !map.has(key)) {
      map.set(key, e);
      valid.push(e);
    }
  }
  if (valid.length === 0) return { regex: null, map };

  // Ordena do termo mais longo para o mais curto para priorizar expressões compostas
  valid.sort((a, b) => b.word.length - a.word.length);

  // Limita a 400 termos mais relevantes para manter regex ultrarrápida
  const patterns = valid.slice(0, 400).map((e) => toAccentInsensitivePattern(e.word));
  try {
    const wordChar = 'a-zA-Z0-9_áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
    const regex = new RegExp(`(^|[^${wordChar}])(${patterns.join('|')})(?=[^${wordChar}]|$)`, 'gi');
    return { regex, map };
  } catch {
    return { regex: null, map };
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
  | { type: 'law'; value: string; article: string; lawHint: string };

export function DictionaryText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const router = useRouter();
  const { profile } = useProfile();
  const { regex, map } = useDictionaryIndex();
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

  const segments = useMemo(() => {
    if (!text) return null;

    // 1. Primeiro detecta citações de artigos de lei (CF/88, CLT, CP, etc.)
    const lawRegex = new RegExp(LAW_ARTICLE_PATTERN, 'gi');
    const firstPass: Array<{ type: 'text'; value: string } | { type: 'law'; value: string; article: string; lawHint: string }> = [];
    let lastIdx = 0;
    let lawMatch: RegExpExecArray | null;
    while ((lawMatch = lawRegex.exec(text)) !== null) {
      if (lawMatch.index > lastIdx) {
        firstPass.push({ type: 'text', value: text.slice(lastIdx, lawMatch.index) });
      }
      const rawMatched = lawMatch[0];
      const { article, lawHint } = parseLawCitation(rawMatched);
      firstPass.push({ type: 'law', value: rawMatched, article, lawHint });
      lastIdx = lawMatch.index + rawMatched.length;
      if (rawMatched.length === 0) lawRegex.lastIndex++;
    }
    if (lastIdx < text.length) {
      firstPass.push({ type: 'text', value: text.slice(lastIdx) });
    }

    const hasLaw = firstPass.some((p) => p.type === 'law');
    if (!regex && !hasLaw) return null;

    // 2. Nos trechos de texto livre, aplica o destaque do dicionário
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
        const entry = map.get(norm);
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
  }, [text, regex, map]);

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
              role="link"
              tabIndex={0}
              onMouseEnter={(e) =>
                showTooltip(e.currentTarget, {
                  kind: 'law',
                  keyId: `law_${i}_${seg.article}`,
                  title: `📜 ${lawLabel}`,
                  body: 'Clique para abrir na Lei Seca (ou baixar automaticamente da internet se ainda não estiver salvo).',
                })
              }
              onMouseLeave={() => setHovered(null)}
              onClick={(e) => {
                e.stopPropagation();
                setHovered(null);
                if (profile?.id) {
                  const params = new URLSearchParams();
                  params.set('art', seg.article);
                  if (seg.lawHint) params.set('law', seg.lawHint);
                  router.push(`/p/${profile.id}/lei-seca?${params.toString()}`);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (profile?.id) {
                    const params = new URLSearchParams();
                    params.set('art', seg.article);
                    if (seg.lawHint) params.set('law', seg.lawHint);
                    router.push(`/p/${profile.id}/lei-seca?${params.toString()}`);
                  }
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
              // No celular (toque), alterna tooltip sem impedir seleção no desktop
              if (window.matchMedia('(pointer: coarse)').matches) {
                if (hovered?.keyId === seg.entry.id) setHovered(null);
                else {
                  showTooltip(e.currentTarget, {
                    kind: 'dict',
                    keyId: seg.entry.id,
                    title: seg.entry.word,
                    body: seg.entry.meaning,
                    example: seg.entry.example,
                  });
                }
              }
            }}
            className="border-b border-dotted border-teal-500/80 dark:border-teal-400/80 text-teal-700 dark:text-teal-300 font-medium cursor-help rounded-sm hover:bg-teal-500/10 transition-colors"
          >
            {seg.value}
          </span>
        );
      })}

      {hovered && (
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
    </span>
  );
}
