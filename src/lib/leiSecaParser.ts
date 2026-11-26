export type BlockKind = 'artigo' | 'inciso' | 'paragrafo' | 'alinea' | 'item' | 'texto';
export type HighlightTone = 'none' | 'yellow' | 'green' | 'red';

export interface LegalBlock {
  id: string;
  kind: BlockKind;
  marker: string;
  body: string;
  annotations: string[];
}

export const HIGHLIGHT_STYLES: Record<HighlightTone, { bg: string; border: string; label: string }> = {
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

export function nextTone(current: HighlightTone | undefined): HighlightTone {
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

/**
 * Parser instantâneo (0ms) para textos de Lei Seca brasileira:
 * 1. Caput (Art.)
 * 2. Parágrafos (§ 1º / Parágrafo único)
 * 3. Incisos (I, II, III...)
 * 4. Alíneas (a), b), c))
 * 5. Itens (1), 2), 3) ou 1., 2., 3.)
 */
export function parseLeiSecaBlocks(rawText: string): LegalBlock[] {
  if (!rawText.trim()) return [];

  let normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  // Remove cabeçalhos/rodapés isolados comuns de PDFs do Planalto/Senado
  normalized = normalized
    .replace(/^\s*Consolidação das Leis do Trabalho\s*$/gim, '')
    .replace(/^\s*Presidência da República\s*$/gim, '')
    .replace(/^\s*Casa Civil\s*$/gim, '');

  // Quebra antes de marcadores legais caso venham colados após ':', ';' ou '.'
  normalized = normalized
    .replace(/([.;:])\s+(Art\.?\s*\d+[º°oª]?(?:-[A-Z])?)/gi, '$1\n$2')
    .replace(/([.;:])\s+(Parágrafo\s+único\.?)/gi, '$1\n$2')
    .replace(/([.;:])\s+(§§?\s*\d+[º°oª]?(?:-[A-Z])?)/gi, '$1\n$2')
    .replace(
      /([.;:])\s+((?:X{0,3}(?:IX|IV|V?I{0,3})|L(?:X{0,3}(?:IX|IV|V?I{0,3}))?|C)\s*[-–—])/g,
      '$1\n$2'
    )
    .replace(/([.;:])\s+([a-z]\))/g, '$1\n$2')
    .replace(/([.;:])\s+(\d{1,2}[.)])/g, '$1\n$2');

  const rawLines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const artRe = /^(Art(?:igo)?\.?\s*\d+[º°oª]?(?:-[A-Z])?\.?)\s*(.*)$/i;
  const parUnicoRe = /^(Parágrafo\s+único\.?)\s*[-–—]?\s*(.*)$/i;
  const parNumRe = /^(§\s*\d+[º°oª]?(?:-[A-Z])?\.?)\s*[-–—]?\s*(.*)$/i;
  const incisoRe = /^([IVXLCDM]{1,7})\s*[-–—.)]\s+(.*)$/;
  const alineaRe = /^([a-z])\)\s+(.*)$/;
  const itemRe = /^(\d{1,2})[.)]\s+(.*)$/;

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
      const punct = line.match(/^(\d{1,2}[.)])/)?.[1] || `${mItem[1]})`;
      matched = { kind: 'item', marker: punct, body: mItem[2].trim() };
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
