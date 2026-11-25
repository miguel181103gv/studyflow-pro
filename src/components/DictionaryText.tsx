'use client';

import React, { useEffect, useMemo, useState } from 'react';
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

export function DictionaryText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { regex, map } = useDictionaryIndex();
  const [hovered, setHovered] = useState<{
    entry: DictEntryLite;
    x: number;
    y: number;
    below: boolean;
  } | null>(null);

  const segments = useMemo(() => {
    if (!text || !regex) return null;
    const parts: Array<{ type: 'text'; value: string } | { type: 'term'; value: string; entry: DictEntryLite }> = [];
    regex.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const prefix = match[1] || '';
      const matchedWord = match[2] || '';
      const matchStart = match.index + prefix.length;

      if (matchStart > lastIndex) {
        parts.push({ type: 'text', value: text.slice(lastIndex, matchStart) });
      }

      const norm = stripAccentsLower(matchedWord).replace(/\s+/g, ' ');
      const entry = map.get(norm);
      if (entry) {
        parts.push({ type: 'term', value: matchedWord, entry });
      } else {
        parts.push({ type: 'text', value: matchedWord });
      }

      lastIndex = matchStart + matchedWord.length;
      if (match[0].length === 0) regex.lastIndex++;
    }

    if (lastIndex < text.length) {
      parts.push({ type: 'text', value: text.slice(lastIndex) });
    }
    return parts.length > 0 ? parts : null;
  }, [text, regex, map]);

  if (!text) return null;
  if (!segments) {
    return className ? <span className={className}>{text}</span> : <>{text}</>;
  }

  const showTooltip = (el: HTMLElement, entry: DictEntryLite) => {
    const rect = el.getBoundingClientRect();
    const below = rect.top < 140;
    const x = Math.max(150, Math.min(window.innerWidth - 150, rect.left + rect.width / 2));
    const y = below ? rect.bottom + 8 : rect.top - 8;
    setHovered({ entry, x, y, below });
  };

  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <React.Fragment key={i}>{seg.value}</React.Fragment>
        ) : (
          <span
            key={i}
            onMouseEnter={(e) => showTooltip(e.currentTarget, seg.entry)}
            onMouseLeave={() => setHovered(null)}
            onClick={(e) => {
              // No celular (toque), alterna tooltip sem impedir seleção no desktop
              if (window.matchMedia('(pointer: coarse)').matches) {
                if (hovered?.entry.id === seg.entry.id) setHovered(null);
                else showTooltip(e.currentTarget, seg.entry);
              }
            }}
            className="border-b border-dotted border-teal-500/80 dark:border-teal-400/80 text-teal-700 dark:text-teal-300 font-medium cursor-help rounded-sm hover:bg-teal-500/10 transition-colors"
          >
            {seg.value}
          </span>
        )
      )}

      {hovered && (
        <span
          role="tooltip"
          style={{
            left: hovered.x,
            top: hovered.y,
            transform: hovered.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
          className="fixed z-[9999] pointer-events-none w-max max-w-[280px] rounded-xl border border-teal-500/40 bg-slate-900 text-white dark:bg-slate-800 px-3 py-2 shadow-xl text-left"
        >
          <span className="block text-[11px] font-bold text-teal-300 mb-0.5">
            {hovered.entry.word}
          </span>
          <span className="block text-[11px] leading-snug text-slate-100 line-clamp-4">
            {hovered.entry.meaning}
          </span>
          {hovered.entry.example && (
            <span className="block text-[10px] italic text-slate-300 mt-1 line-clamp-2">
              Ex: {hovered.entry.example}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
