export function normalizeForCompare(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/<!--SF_Q_JSON:[\s\S]*?-->/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PT_STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos',
  'a', 'o', 'as', 'os', 'um', 'uma', 'para', 'por', 'com', 'sem', 'ao', 'aos',
]);

function meaningfulTokens(normText: string): string[] {
  const raw = normText.split(' ').filter((w) => w.length >= 2);
  const filtered = raw.filter((w) => !PT_STOPWORDS.has(w));
  return filtered.length > 0 ? filtered : raw;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = Math.min(prev, dp[j], dp[j - 1]) + 1;
      }
      prev = temp;
    }
  }
  return dp[n];
}

function tokenMetrics(a: string, b: string): { jaccard: number; overlap: number; minSize: number } {
  const setA = new Set(meaningfulTokens(a));
  const setB = new Set(meaningfulTokens(b));
  if (setA.size === 0 || setB.size === 0) return { jaccard: 0, overlap: 0, minSize: 0 };
  let inter = 0;
  setA.forEach((w) => {
    if (setB.has(w)) inter++;
  });
  const union = setA.size + setB.size - inter;
  const minSize = Math.min(setA.size, setB.size);
  return {
    jaccard: union === 0 ? 0 : inter / union,
    overlap: minSize === 0 ? 0 : inter / minSize,
    minSize,
  };
}

export type MatchKind = 'exact' | 'similar';

export interface SimilarityMatch<T> {
  item: T;
  kind: MatchKind;
  score: number;
}

/**
 * Compara duas palavras/termos curtos (ex: Dicionário) com detecção rígida de repetições.
 */
export function compareShortTerms(aRaw: string, bRaw: string): { kind: MatchKind; score: number } | null {
  const a = normalizeForCompare(aRaw);
  const b = normalizeForCompare(bRaw);
  if (!a || !b) return null;
  if (a === b) return { kind: 'exact', score: 1 };

  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);

  // Contenção direta (ex: "convencao coletiva" dentro de "convencao coletiva de trabalho")
  if (minLen >= 5 && (a.includes(b) || b.includes(a)) && minLen / maxLen >= 0.42) {
    return { kind: 'similar', score: Math.max(0.75, minLen / maxLen) };
  }

  // Sobreposição de palavras relevantes (ignora "de", "da", "do", etc.)
  const { jaccard, overlap, minSize } = tokenMetrics(a, b);
  if (minSize >= 2 && overlap >= 0.85) {
    return { kind: 'similar', score: Math.max(jaccard, overlap * 0.9) };
  }
  if (jaccard >= 0.5) {
    return { kind: 'similar', score: jaccard };
  }

  if (maxLen <= 45) {
    const dist = levenshtein(a, b);
    const sim = 1 - dist / maxLen;
    if ((maxLen >= 5 && dist <= 2) || sim >= 0.74) {
      return { kind: 'similar', score: sim };
    }
  }

  return null;
}

/**
 * Compara textos médios/longos (ex: Enunciado de Questão, Frente de Flashcard).
 */
export function compareLongTexts(
  aRaw: string,
  bRaw: string,
  threshold = 0.52
): { kind: MatchKind; score: number } | null {
  const a = normalizeForCompare(aRaw);
  const b = normalizeForCompare(bRaw);
  if (!a || !b || a.length < 4 || b.length < 4) return null;
  if (a === b) return { kind: 'exact', score: 1 };

  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);

  if (minLen >= 14 && (a.includes(b) || b.includes(a))) {
    return { kind: 'similar', score: Math.max(0.8, minLen / maxLen) };
  }

  const { jaccard, overlap, minSize } = tokenMetrics(a, b);
  if (minSize >= 4 && overlap >= 0.85) {
    return { kind: 'similar', score: Math.max(jaccard, overlap * 0.85) };
  }
  if (jaccard >= threshold) {
    return { kind: 'similar', score: jaccard };
  }

  if (maxLen <= 140) {
    const dist = levenshtein(a, b);
    const sim = 1 - dist / maxLen;
    if (sim >= 0.76) {
      return { kind: 'similar', score: sim };
    }
  }

  return null;
}

export function findSimilarItems<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
  mode: 'short' | 'long' = 'long',
  limit = 3
): SimilarityMatch<T>[] {
  const qNorm = normalizeForCompare(query);
  if (!qNorm || qNorm.length < 2) return [];

  const matches: SimilarityMatch<T>[] = [];
  for (const item of items) {
    const text = getText(item);
    const res =
      mode === 'short' ? compareShortTerms(query, text) : compareLongTexts(query, text);
    if (res) {
      matches.push({ item, kind: res.kind, score: res.score });
    }
  }

  matches.sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === 'exact' ? -1 : 1;
    return y.score - x.score;
  });

  return matches.slice(0, limit);
}
