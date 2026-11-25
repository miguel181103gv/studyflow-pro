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

function tokenJaccard(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter((w) => w.length >= 2));
  const setB = new Set(b.split(' ').filter((w) => w.length >= 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  setA.forEach((w) => {
    if (setB.has(w)) inter++;
  });
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type MatchKind = 'exact' | 'similar';

export interface SimilarityMatch<T> {
  item: T;
  kind: MatchKind;
  score: number;
}

/**
 * Compara duas palavras/termos curtos (ex: Dicionário).
 */
export function compareShortTerms(aRaw: string, bRaw: string): { kind: MatchKind; score: number } | null {
  const a = normalizeForCompare(aRaw);
  const b = normalizeForCompare(bRaw);
  if (!a || !b) return null;
  if (a === b) return { kind: 'exact', score: 1 };

  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);

  if (minLen >= 4 && (a.includes(b) || b.includes(a)) && minLen / maxLen >= 0.65) {
    return { kind: 'similar', score: minLen / maxLen };
  }

  if (maxLen <= 40) {
    const dist = levenshtein(a, b);
    const sim = 1 - dist / maxLen;
    if ((maxLen >= 5 && dist <= 2) || sim >= 0.78) {
      return { kind: 'similar', score: sim };
    }
  }

  const jac = tokenJaccard(a, b);
  if (jac >= 0.65) {
    return { kind: 'similar', score: jac };
  }

  return null;
}

/**
 * Compara textos médios/longos (ex: Enunciado de Questão, Frente de Flashcard).
 */
export function compareLongTexts(
  aRaw: string,
  bRaw: string,
  threshold = 0.62
): { kind: MatchKind; score: number } | null {
  const a = normalizeForCompare(aRaw);
  const b = normalizeForCompare(bRaw);
  if (!a || !b || a.length < 4 || b.length < 4) return null;
  if (a === b) return { kind: 'exact', score: 1 };

  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);

  if (minLen >= 20 && (a.includes(b) || b.includes(a))) {
    return { kind: 'similar', score: Math.max(0.8, minLen / maxLen) };
  }

  const jac = tokenJaccard(a, b);
  if (jac >= threshold) {
    return { kind: 'similar', score: jac };
  }

  if (maxLen <= 120) {
    const dist = levenshtein(a, b);
    const sim = 1 - dist / maxLen;
    if (sim >= 0.8) {
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
