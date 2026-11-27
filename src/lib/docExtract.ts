'use client';

function decodeHtmlBytes(bytes: Uint8Array): string {
  const asciiHead = new TextDecoder('ascii', { fatal: false }).decode(bytes.slice(0, 2048));
  const isLatin1 = /charset\s*=\s*["']?\s*(?:iso-8859-1|windows-1252|latin1)/i.test(asciiHead);
  if (isLatin1) {
    return new TextDecoder('windows-1252').decode(bytes);
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Se houver muitos replacement chars (), tenta windows-1252 (comum no Planalto)
  if ((utf8.match(/\uFFFD/g) || []).length > 3) {
    return new TextDecoder('windows-1252').decode(bytes);
  }
  return utf8;
}

export async function extractHtmlLawText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const html = decodeHtmlBytes(new Uint8Array(buf));
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Remove scripts, estilos e dispositivos revogados riscados (<strike>, <s>, <del>)
  doc
    .querySelectorAll('script, style, noscript, svg, nav, strike, s, del')
    .forEach((el) => el.remove());

  const blockTags = new Set([
    'P',
    'DIV',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'LI',
    'TR',
    'BLOCKQUOTE',
    'SECTION',
    'ARTICLE',
  ]);

  const lines: string[] = [];
  let cur = '';

  const flush = () => {
    const clean = cur.replace(/\s+/g, ' ').trim();
    if (clean) lines.push(clean);
    cur = '';
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      cur += (node.textContent || '').replace(/\u00a0/g, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === 'BR') {
      flush();
      return;
    }
    const isBlock = blockTags.has(tag);
    if (isBlock) flush();
    for (let i = 0; i < el.childNodes.length; i++) {
      walk(el.childNodes[i]);
    }
    if (isBlock) flush();
  };

  if (doc.body) walk(doc.body);
  flush();
  return lines.join('\n');
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Seu navegador não suporta descompressão nativa de DOCX.');
  }
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([copy]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

export async function extractDocxLawText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  // Localiza End of Central Directory (PK\x05\x06) para ler tamanhos exatos mesmo com data descriptor
  let eocdOffset = -1;
  for (let i = Math.max(0, bytes.length - 65557); i <= bytes.length - 22; i++) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      eocdOffset = i;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Arquivo DOCX inválido (cabeçalho ZIP não encontrado).');
  }

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let ptr = cdOffset;
  let docXmlBytes: Uint8Array | null = null;

  for (let i = 0; i < totalEntries && ptr + 46 <= bytes.length; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const fileName = new TextDecoder('utf-8').decode(
      bytes.slice(ptr + 46, ptr + 46 + nameLen)
    );
    ptr += 46 + nameLen + extraLen + commentLen;

    if (fileName === 'word/document.xml') {
      const lhNameLen = view.getUint16(localHeaderOffset + 26, true);
      const lhExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
      const compData = bytes.slice(dataStart, dataStart + compSize);
      if (method === 0) {
        docXmlBytes = compData;
      } else if (method === 8) {
        docXmlBytes = await inflateRawBytes(compData);
      } else {
        throw new Error(`Método de compressão DOCX não suportado (${method}).`);
      }
      break;
    }
  }

  if (!docXmlBytes) {
    throw new Error('Conteúdo word/document.xml não encontrado dentro do DOCX.');
  }

  const xmlText = new TextDecoder('utf-8').decode(docXmlBytes);
  const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const paragraphs = Array.from(xmlDoc.getElementsByTagName('w:p'));
  const lines: string[] = [];

  for (const p of paragraphs) {
    // Ignora texto riscado (<w:strike/>) dentro do run
    let pText = '';
    const runs = Array.from(p.getElementsByTagName('w:r'));
    for (const r of runs) {
      const rPr = r.getElementsByTagName('w:rPr')[0];
      if (rPr && rPr.getElementsByTagName('w:strike').length > 0) continue;
      for (let j = 0; j < r.childNodes.length; j++) {
        const child = r.childNodes[j] as Element;
        const name = child.nodeName;
        if (name === 'w:t') {
          pText += child.textContent || '';
        } else if (name === 'w:tab') {
          pText += ' ';
        } else if (name === 'w:br' || name === 'w:cr') {
          pText += '\n';
        }
      }
    }
    const clean = pText.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
    if (clean) lines.push(clean);
  }

  return lines.join('\n');
}
