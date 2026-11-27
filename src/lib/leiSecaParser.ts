export type BlockKind = 'artigo' | 'inciso' | 'paragrafo' | 'alinea' | 'item' | 'texto';
export type HighlightTone = 'none' | 'yellow' | 'green' | 'red';

export interface LegalBlock {
  id: string;
  stableId?: string;
  kind: BlockKind;
  marker: string;
  body: string;
  annotations: string[];
  contextPath?: string;
  refs?: string[];
}

export interface LawValidationReport {
  articleCount: number;
  missingGaps: string[];
  duplicates: string[];
  outOfOrder: string[];
  emptyArticles: string[];
  giantArticles: string[];
  isClean: boolean;
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

function romanToInt(roman: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const s = roman.toUpperCase().trim();
  if (!/^[IVXLCDM]+$/.test(s)) return 0;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]] || 0;
    const next = map[s[i + 1]] || 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

function extractAnnotations(text: string): { clean: string; annotations: string[] } {
  const annotations: string[] = [];
  const parenRe =
    /\((?:Redação dada|Incluíd[oa]|Revogad[oa]|Vide|Acrescid[oa]|Alterad[oa]|Vigência|Vetad[oa]|Regulamento|Produção de efeito|Execução suspensa|Declarad[oa])[^)]*\)/gi;
  let clean = text.replace(parenRe, (match) => {
    annotations.push(match.slice(1, -1).trim());
    return '';
  });
  // Notas explicativas "NE: ..." no fim da linha ou bloco
  clean = clean.replace(/\bNE\s*:\s*([^\n]+)/gi, (_, noteBody) => {
    annotations.push(`NE: ${String(noteBody).trim()}`);
    return '';
  });
  clean = clean.replace(/\s{2,}/g, ' ').trim();
  return { clean, annotations };
}

function extractRefs(text: string): string[] {
  const refs = new Set<string>();
  const re = /\bart(?:igo)?s?\.?\s*(\d+(?:\.\d{3})*(?:-[A-Z0-9]+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    refs.add(`art${m[1].replace(/\./g, '')}`);
  }
  return Array.from(refs);
}

/**
 * Passo 1: Limpeza e normalização do texto bruto de PDF antes de separar:
 * - remove caracteres invisíveis (\x00-\x08, \x0b, \x0c, \x0e-\x1f)
 * - remove cabeçalhos/rodapés repetidos e números de página isolados
 * - junta palavras hifenizadas no fim da linha (com-\ntinua -> continua)
 * - normaliza ordinais (1o -> 1º, 1a -> 1ª, Art. 5 o -> Art. 5º)
 */
/**
 * Remove cabeçalhos/rodapés correntes: linhas "146   Título do livro" ou "Seção   141"
 * que se repetem várias vezes, com ou sem número de página colado.
 */
export function stripRunningHeaders(raw: string): string {
  const lines = (raw || '').split('\n');
  const key = (l: string) =>
    l.trim().replace(/^\d{1,4}\s{2,}/, '').replace(/\s{2,}\d{1,4}$/, '').replace(/\s+/g, ' ').toLowerCase();
  const hasPageNum = (l: string) => /^\s*\d{1,4}\s{2,}\S/.test(l) || /\S\s{2,}\d{1,4}\s*$/.test(l);
  const freq = new Map<string, number>();
  for (const l of lines) {
    if (!hasPageNum(l)) continue;
    const k = key(l);
    if (k.length > 0 && k.length < 100 && !MARKER_START_RE.test(k)) freq.set(k, (freq.get(k) || 0) + 1);
  }
  return lines
    .filter((l) => {
      if (!hasPageNum(l)) return true;
      const k = key(l);
      return !((freq.get(k) || 0) >= 3);
    })
    .join('\n');
}

export function normalizeLegalOrdinalsAndSpaces(raw: string): string {
  return stripRunningHeaders(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    // Remove marcas de nota de rodapé: linha só com * ou * colado no fim da frase
    .replace(/^\s*\*+\s*$/gm, '')
    // Ordinal solto em linha própria (superscript deslocado pelo PDF)
    .replace(/^\s*[oaºª]\s*$/gm, '')
    .replace(/([.;:!?)”])\s*\*+[ \t]*$/gm, '$1')
    // Remove caracteres de controle invisíveis (ex: \x08) mantendo \n e \t
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    // Remove cabeçalhos/rodapés isolados comuns de PDFs do Planalto/Senado
    .replace(/^\s*Consolidação das Leis do Trabalho\s*$/gim, '')
    .replace(/^\s*Presidência da República\s*$/gim, '')
    .replace(/^\s*Casa Civil\s*$/gim, '')
    .replace(
      /^\s*(?:Senado Federal|Secretaria Especial de Editoração e Publicações|Subchefia para Assuntos Jurídicos|Constituição da República Federativa do Brasil)\s*$/gim,
      ''
    )
    // Remove números de página isolados em linha própria
    .replace(/^\s*\d{1,4}\s*$/gm, '')
    // Junta palavras partidas por hífen no fim da linha (com-\ntinua -> continua)
    .replace(/([a-záàâãéêíóôõúç])-\s*\n\s*([a-záàâãéêíóôõúç])/g, '$1$2')
    // Junta "Art." separado do número por quebra de linha de PDF (ex: "Art.\n22.")
    .replace(/\b(Art(?:igo)?\.?)\s*\n+\s*(\d)/gi, '$1 $2')
    // Junta ordinal quebrado em nova linha ou com espaço
    .replace(
      /(\d{1,2})\s*\n?\s*a\s*\n?\s*(?=Regi[ãa]o|Vara|Turma|Inst[âa]ncia|C[âa]mara|Se[çc][ãa]o|Subse[çc][ãa]o|Parte|S[ée]rie|Categoria|Classe|Etapa|Fase|Ordem|Zona|hip[óo]tese|vez)/gi,
      '$1ª '
    )
    .replace(
      /(\d{1,2})\s*\n?\s*o\s*\n?\s*(?=Grau|Par[áa]grafo|Inciso|Artigo|Livro|T[íi]tulo|Cap[íi]tulo|Grupo|N[íi]vel|dia|m[êe]s|ano)/gi,
      '$1º '
    )
    .replace(/\bn\s+o\s+(?=\d)/gi, 'nº ')
    .replace(/\bn\s+a\s+(?=\d)/gi, 'nª ')
    .replace(/\b(Art\.?\s*\d+(?:\.\d{3})*)\s+[oº°]\b/gi, '$1º')
    .replace(/\b(Art\.?\s*\d+(?:\.\d{3})*)\s+[aª]\b/gi, '$1ª')
    .replace(/(§\s*\d+)\s+[oº°]\b/gi, '$1º')
    .replace(/(§\s*\d+)\s+[aª]\b/gi, '$1ª')
    .replace(/(\b\d{1,3})o\b(?=\s+(?:grau|par[áa]grafo|inciso|artigo|dia|m[êe]s|ano))/gi, '$1º')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const STRUCTURAL_HEADING_RE =
  /^(?:(?:T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O|LIVRO|PARTE)\s+(?:[IVXLCDM]{1,8}|[ÚU]NIC[OA]|GERAL|ESPECIAL|\d{1,3})(?:-[A-Z])?\s*(?:[–—-].*)?$|PRE[ÂA]MBULO\s*$)/i;

const ATO_HEADING_RE = /^ATO\s+DAS\s+DISPOSI[ÇC][ÕO]ES\b/;
function isStructuralHeading(line: string): boolean {
  return STRUCTURAL_HEADING_RE.test(line) || ATO_HEADING_RE.test(line);
}

const MARKER_START_RE =
  /^(?:Art\.\s*\d|Par[áa]grafo\s+[úu]nico|§\s*\d|[IVXLCDM]{1,10}\s*[–—-]\s|[a-z]\)\s|\d{1,3}[.)]\s|Emenda\s+Constitucional)/;

/**
 * Une linhas quebradas de PDF pertencentes ao mesmo parágrafo antes da máquina de estados.
 */
function joinWrappedParagraphLines(lines: string[]): string[] {
  const joined: string[] = [];
  for (const line of lines) {
    if (joined.length === 0) {
      joined.push(line);
      continue;
    }
    const prev = joined[joined.length - 1];
    const prevTerminated = /[.;:!?…”")]$/.test(prev.trim());
    const curIsMarker = MARKER_START_RE.test(line) || isStructuralHeading(line);
    const prevIsHeading = isStructuralHeading(prev);
    if (!prevTerminated && !curIsMarker && !prevIsHeading) {
      joined[joined.length - 1] = `${prev} ${line}`;
    } else {
      joined.push(line);
    }
  }
  return joined;
}

const ABBREV_BEFORE_NUM_RE =
  /(?:^|\b)(?:art|arts|artigo|artigos|n|ns|inc|par|al|p|fl|fls|v|ed|vol|cap|sec|t[íi]t|item|itens)\./i;

function parseArtNumber(marker: string): { base: number; suffix: string } {
  const m = marker.match(/(\d+(?:\.\d{3})*)(?:-([A-Z0-9]+))?/i);
  if (!m) return { base: 0, suffix: '' };
  return {
    base: parseInt(m[1].replace(/\./g, ''), 10) || 0,
    suffix: (m[2] || '').toUpperCase(),
  };
}

/**
 * Parser por Máquina de Estados para textos de Lei Seca brasileira:
 * 1. Limpa texto, cabeçalhos, hifenizações e une linhas quebradas.
 * 2. Distingue início real de artigo (Art. maiúsculo + sequência + controle de aspas “ ”).
 * 3. Máquina de estados: Artigo -> Parágrafo -> Inciso (sequencial) -> Alínea -> Item.
 * 4. Separa estrutura (Títulos/Capítulos/Seções em contextPath), anotações e refs.
 */
export function parseLeiSecaBlocks(rawText: string, lawPrefix = 'LEI'): LegalBlock[] {
  if (!rawText.trim()) return [];

  let normalized = normalizeLegalOrdinalsAndSpaces(rawText);

  // Quebra antes de marcadores legais caso venham colados após ':', ';' ou '.'
  normalized = normalized
    .replace(/([.;:])\s+(Art\.\s*\d+(?:\.\d{3})*[º°oª]?(?:-[A-Z0-9]+)?)/g, '$1\n$2')
    .replace(/([.;:])\s+(Parágrafo\s+único\.?)/gi, '$1\n$2')
    .replace(/([.;:])\s+(§§?\s*\d+[º°oª]?(?:-[A-Z0-9]+)?)/gi, '$1\n$2')
    .replace(
      /([.;:])\s+((?:X{0,3}(?:IX|IV|V?I{0,3})|L(?:X{0,3}(?:IX|IV|V?I{0,3}))?|C)\s*[-–—])/g,
      '$1\n$2'
    )
    .replace(/([.;:])\s+([a-z]\))/g, (match, punct, alinea, offset, str) => {
      if (punct === '.') {
        const before = str.slice(Math.max(0, offset - 12), offset + 1);
        if (ABBREV_BEFORE_NUM_RE.test(before)) return match;
      }
      return `${punct}\n${alinea}`;
    })
    .replace(/([.;:])\s+(\d{1,2}[.)])/g, (match, punct, num, offset, str) => {
      if (punct === '.') {
        const before = str.slice(Math.max(0, offset - 12), offset + 1);
        if (ABBREV_BEFORE_NUM_RE.test(before)) return match;
      }
      return `${punct}\n${num}`;
    });

  const rawLines = joinWrappedParagraphLines(
    normalized
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );

  // Regex estritas de início de linha
  const artRe = /^(Art\.\s*\d+(?:\.\d{3})*[º°oª]?(?:-[A-Z0-9]+)?\.?)\s*(.*)$/;
  const ecHeaderRe =
    /^(Emenda\s+Constitucional(?:\s+de\s+Revisão)?\s*(?:n[º°]?\s*)?\d+(?:[\/,][^\n]*)?)\s*(.*)$/i;
  const parUnicoRe = /^(Parágrafo\s+único\.?)\s*[-–—]?\s*(.*)$/i;
  const parNumRe = /^(§\s*\d+[º°oª]?(?:-[A-Z0-9]+)?\.?)\s*[-–—]?\s*(.*)$/i;
  const incisoRe = /^([IVXLCDM]{1,10}(?:-[A-Z]{1,2})?)\s*[-–—]\s+(.*)$/;
  const alineaRe = /^([a-z])\)\s+(.*)$/;
  const itemRe = /^(\d{1,3})[.)]\s+(.*)$/;

  const blocks: LegalBlock[] = [];

  // Estado da máquina
  let openQuotes = 0;
  let lastArtNum = 0;
  let lastIncisoNum = 0;
  let lastAlineaCode = 0;
  let lastItemNum = 0;

  let curTitulo = '';
  let curCapitulo = '';
  let curSecao = '';
  let curSubsecao = '';
  let curArtTag = '';
  let curIncTag = '';
  let signed = false;
  let headingTarget: 'titulo' | 'capitulo' | 'secao' | 'subsecao' | null = null;

  const getContextPath = () =>
    [curTitulo, curCapitulo, curSecao, curSubsecao].filter(Boolean).join(' · ');

  const prefixSlug = (lawPrefix || 'LEI').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'LEI';

  const updateQuotes = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '“') openQuotes++;
      else if (ch === '”') openQuotes = Math.max(0, openQuotes - 1);
    }
  };

  for (const line of rawLines) {
    // Após a data/assinatura o texto normativo acabou, a menos que comece uma nova Emenda Constitucional no mesmo bloco
    if (signed) {
      if (/^Emenda\s+Constitucional(?:\s+de\s+Revis[ãa]o)?\s*(?:n[º°]?\s*)?\d+/i.test(line)) {
        signed = false;
      } else {
        const last = blocks[blocks.length - 1];
        if (last) last.body = [last.body, line].filter(Boolean).join(' ');
        continue;
      }
    }
    // 1. Cabeçalhos estruturais -> atualizam contextPath sem virar corpo do artigo anterior
    if (openQuotes === 0 && isStructuralHeading(line) && !/^Art\./i.test(line)) {
      if (/^PRE[ÂA]MBULO/i.test(line)) {
        blocks.push({
          id: `b_${blocks.length}`,
          stableId: `${prefixSlug}-preambulo`,
          kind: 'texto',
          marker: 'Preâmbulo',
          body: '',
          annotations: [],
        });
        continue;
      } else if (/^SUBSE[ÇC][ÃA]O\b/i.test(line)) {
        curSubsecao = line;
        headingTarget = 'subsecao';
      } else if (/^SE[ÇC][ÃA]O\b/i.test(line)) {
        curSecao = line;
        curSubsecao = '';
        headingTarget = 'secao';
      } else if (/^CAP[ÍI]TULO\b/i.test(line)) {
        curCapitulo = line;
        curSecao = '';
        curSubsecao = '';
        headingTarget = 'capitulo';
      } else {
        // TÍTULO, LIVRO, PARTE, PREÂMBULO, ATO DAS DISPOSIÇÕES...
        curTitulo = line;
        curCapitulo = '';
        curSecao = '';
        curSubsecao = '';
        headingTarget = 'titulo';
      }
      continue;
    }
    // 1b. Linha seguinte ao cabeçalho = nome (ex.: "Dos Princípios Fundamentais")
    if (headingTarget && openQuotes === 0 && !MARKER_START_RE.test(line)) {
      const add = (v: string) => `${v} – ${line}`;
      if (headingTarget === 'titulo') curTitulo = add(curTitulo);
      else if (headingTarget === 'capitulo') curCapitulo = add(curCapitulo);
      else if (headingTarget === 'secao') curSecao = add(curSecao);
      else curSubsecao = add(curSubsecao);
      headingTarget = null;
      continue;
    }
    headingTarget = null;

    if (openQuotes === 0 && /^Bras[íi]lia,\s*(?:em\s+)?\d{1,2}(?:º|o)?\s+de\s+\w+\s+de\s+\d{4}/.test(line)) {
      curArtTag = 'assinaturas';
      blocks.push({
        id: `b_${blocks.length}`,
        stableId: `${prefixSlug}-assinaturas`,
        kind: 'texto',
        marker: 'Promulgação',
        body: line,
        annotations: [],
        contextPath: getContextPath() || undefined,
      });
      signed = true;
      updateQuotes(line);
      continue;
    }

    let matched: { kind: BlockKind; marker: string; body: string; stableId?: string } | null = null;

    const prevBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
    const prevEndedMidPhrase = Boolean(
      prevBlock && prevBlock.kind !== 'texto' && prevBlock.body && !/[.;:!?…”")]$/.test(prevBlock.body.trim())
    );

    const rawArtMatch = openQuotes === 0 ? line.match(artRe) : null;
    const isCitationFollowing = Boolean(
      rawArtMatch &&
        /^[,)]|^\s*(?:d[aeo]s?|dest[ae]|dess[ae]|al[íi]nea|inciso|§|par[áa]grafo|caput)\b/i.test(
          rawArtMatch[2] || ''
        )
    );

    // Regra de sequência de Artigo: aceita primeiro artigo OU (base === lastArtNum + 1) OU (base === lastArtNum com letra)
    let isSequentialArt = true;
    if (rawArtMatch && lastArtNum > 0) {
      const parsedNum = parseArtNumber(rawArtMatch[1]);
      const nextBase = lastArtNum + 1;
      isSequentialArt =
        parsedNum.base === nextBase ||
        (parsedNum.base === lastArtNum && Boolean(parsedNum.suffix)) ||
        // Permite salto pequeno quando há texto/artigos revogados ou blocos filtrados (mas impede citação distante tipo Art. 150 dentro do Art. 7º)
        (parsedNum.base > lastArtNum && parsedNum.base <= lastArtNum + 5);
    }

    const mArt =
      rawArtMatch && !prevEndedMidPhrase && !isCitationFollowing && isSequentialArt
        ? rawArtMatch
        : null;
    const rawEc = !mArt && openQuotes === 0 && !prevEndedMidPhrase ? line.match(ecHeaderRe) : null;
    const mEc = rawEc && (!rawEc[2] || /^\(/.test(rawEc[2])) && line.length < 120 ? rawEc : null;
    const mParU = !mArt && !mEc && openQuotes === 0 ? line.match(parUnicoRe) : null;
    const mParN = !mArt && !mEc && !mParU && openQuotes === 0 ? line.match(parNumRe) : null;

    // Inciso só entra se romano válido e sequencial (1 ou lastIncisoNum + 1, com pequena folga p/ revogados)
    const rawInc = !mArt && !mEc && !mParU && !mParN && openQuotes === 0 ? line.match(incisoRe) : null;
    let mInc: RegExpMatchArray | null = null;
    if (rawInc) {
      const rVal = romanToInt(rawInc[1].split('-')[0]);
      if (rVal > 0 && (rVal === lastIncisoNum && rawInc[1].includes('-')) || rVal > 0 && (rVal === lastIncisoNum + 1 || rVal === 1 || (rVal > lastIncisoNum && rVal <= lastIncisoNum + 3))) {
        mInc = rawInc;
      }
    }

    // Alínea: 'a)' ou próxima letra da sequência
    const rawAli =
      !mArt && !mEc && !mParU && !mParN && !mInc && openQuotes === 0 ? line.match(alineaRe) : null;
    let mAli: RegExpMatchArray | null = null;
    if (rawAli) {
      const code = rawAli[1].charCodeAt(0);
      if (code === 97 || code === lastAlineaCode + 1 || (code > lastAlineaCode && code <= lastAlineaCode + 2)) {
        mAli = rawAli;
      }
    }

    const rawItem =
      !mArt && !mEc && !mParU && !mParN && !mInc && !mAli && openQuotes === 0
        ? line.match(itemRe)
        : null;
    let mItem: RegExpMatchArray | null = null;
    if (rawItem) {
      const itNum = parseInt(rawItem[1], 10);
      if (itNum === 1 || itNum === lastItemNum + 1) {
        mItem = rawItem;
      }
    }

    if (mArt) {
      const parsedNum = parseArtNumber(mArt[1]);
      if (parsedNum.base > 0) lastArtNum = parsedNum.base;
      lastIncisoNum = 0;
      lastAlineaCode = 0;
      lastItemNum = 0;
      curArtTag = `art${parsedNum.base}${parsedNum.suffix}`;
      curIncTag = '';
      matched = {
        kind: 'artigo',
        marker: mArt[1].trim().replace(/(\d)o\b/, '$1º'),
        body: mArt[2].trim(),
        stableId: `${prefixSlug}-${curArtTag}`,
      };
    } else if (mEc) {
      lastArtNum = 0;
      lastIncisoNum = 0;
      lastAlineaCode = 0;
      lastItemNum = 0;
      curArtTag = `ec${blocks.length}`;
      curIncTag = '';
      matched = {
        kind: 'artigo',
        marker: mEc[1].trim(),
        body: mEc[2].trim(),
        stableId: `${prefixSlug}-${curArtTag}`,
      };
    } else if (mParU) {
      lastIncisoNum = 0;
      lastAlineaCode = 0;
      lastItemNum = 0;
      curIncTag = '';
      matched = {
        kind: 'paragrafo',
        marker: 'Parágrafo único',
        body: mParU[2].trim(),
        stableId: `${prefixSlug}-${curArtTag || 'top'}-parUnico`,
      };
    } else if (mParN) {
      lastIncisoNum = 0;
      lastAlineaCode = 0;
      lastItemNum = 0;
      curIncTag = '';
      const pMarker = mParN[1].replace(/\s+/g, ' ').trim().replace(/(\d)o\b/, '$1º');
      const pNum = pMarker.match(/\d+(?:-[A-Z0-9]+)?/i)?.[0] || String(blocks.length);
      matched = {
        kind: 'paragrafo',
        marker: pMarker,
        body: mParN[2].trim(),
        stableId: `${prefixSlug}-${curArtTag || 'top'}-par${pNum}`,
      };
    } else if (mInc) {
      const rVal = romanToInt(mInc[1].split('-')[0]);
      lastIncisoNum = rVal;
      lastAlineaCode = 0;
      lastItemNum = 0;
      curIncTag = `inc${mInc[1].trim().toUpperCase()}`;
      matched = {
        kind: 'inciso',
        marker: mInc[1].trim(),
        body: mInc[2].trim(),
        stableId: `${prefixSlug}-${curArtTag || 'top'}-${curIncTag}`,
      };
    } else if (mAli) {
      lastAlineaCode = mAli[1].charCodeAt(0);
      lastItemNum = 0;
      matched = {
        kind: 'alinea',
        marker: `${mAli[1]})`,
        body: mAli[2].trim(),
        stableId: `${prefixSlug}-${curArtTag || 'top'}-${curIncTag || 'caput'}-al${mAli[1].toUpperCase()}`,
      };
    } else if (mItem) {
      lastItemNum = parseInt(mItem[1], 10);
      const punct = line.match(/^(\d{1,3}[.)])/)?.[1] || `${mItem[1]})`;
      matched = {
        kind: 'item',
        marker: punct,
        body: mItem[2].trim(),
        stableId: `${prefixSlug}-${curArtTag || 'top'}-item${mItem[1]}`,
      };
    }

    if (matched) {
      const { clean, annotations } = extractAnnotations(matched.body);
      const refs = extractRefs(clean);
      blocks.push({
        id: `b_${blocks.length}`,
        stableId: matched.stableId,
        kind: matched.kind,
        marker: matched.marker,
        body: clean,
        annotations,
        contextPath: getContextPath() || undefined,
        refs: refs.length > 0 ? refs : undefined,
      });
    } else if (blocks.length > 0) {
      const prev = blocks[blocks.length - 1];
      const { clean, annotations } = extractAnnotations(line);
      prev.body = [prev.body, clean].filter(Boolean).join(' ');
      if (annotations.length > 0) prev.annotations.push(...annotations);
      const newRefs = extractRefs(clean);
      if (newRefs.length > 0) {
        prev.refs = Array.from(new Set([...(prev.refs || []), ...newRefs]));
      }
    } else {
      const { clean, annotations } = extractAnnotations(line);
      const refs = extractRefs(clean);
      blocks.push({
        id: `b_${blocks.length}`,
        kind: 'texto',
        marker: '',
        body: clean,
        annotations,
        contextPath: getContextPath() || undefined,
        refs: refs.length > 0 ? refs : undefined,
      });
    }

    updateQuotes(line);
  }

  return blocks;
}

/**
 * Passo 6: Validação automática dos blocos separados.
 * Checa buracos na numeração, duplicados, incisos fora de ordem, artigos vazios ou gigantes.
 */
export function validateParsedLaw(blocks: LegalBlock[]): LawValidationReport {
  const missingGaps: string[] = [];
  const duplicates: string[] = [];
  const outOfOrder: string[] = [];
  const emptyArticles: string[] = [];
  const giantArticles: string[] = [];

  const seenArts = new Set<string>();
  let prevArtBase = 0;
  let prevInc = 0;
  let articleCount = 0;

  for (const b of blocks) {
    if (b.kind === 'artigo' && /^Art\./i.test(b.marker)) {
      articleCount++;
      prevInc = 0;
      const { base, suffix } = parseArtNumber(b.marker);
      const key = `${base}${suffix}`;
      if (seenArts.has(key)) {
        duplicates.push(b.marker);
      } else {
        seenArts.add(key);
      }
      if (prevArtBase > 0 && base > prevArtBase + 1) {
        missingGaps.push(`Pulou de Art. ${prevArtBase} para Art. ${base}`);
      }
      if (base > 0) prevArtBase = base;
      if (!b.body.trim() && blocks.indexOf(b) === blocks.length - 1) {
        emptyArticles.push(b.marker);
      }
      if (b.body.length > 12000) {
        giantArticles.push(`${b.marker} (${b.body.length} caracteres)`);
      }
    } else if (b.kind === 'paragrafo') {
      prevInc = 0;
    } else if (b.kind === 'inciso') {
      const r = romanToInt(b.marker.split('-')[0]);
      if (prevInc > 0 && r > 0 && r <= prevInc) {
        outOfOrder.push(`Inciso ${b.marker} fora de ordem`);
      }
      if (r > 0) prevInc = r;
    }
  }

  const isClean =
    missingGaps.length === 0 &&
    duplicates.length === 0 &&
    outOfOrder.length === 0 &&
    emptyArticles.length === 0 &&
    giantArticles.length === 0;

  return {
    articleCount,
    missingGaps,
    duplicates,
    outOfOrder,
    emptyArticles,
    giantArticles,
    isClean,
  };
}
