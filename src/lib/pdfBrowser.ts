'use client';

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

export async function loadPdfJsLib(): Promise<PdfJsLib> {
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

export async function extractPdfTextInBrowser(
  file: File,
  onProgress?: (page: number, total: number) => void,
  stripLegalHeaders = true
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

    const cleaned = lines.filter((ln) => {
      if (/^\d{1,4}$/.test(ln)) return false;
      if (
        stripLegalHeaders &&
        /^(?:Presidência da República|Casa Civil|Subchefia para Assuntos Jurídicos)$/i.test(ln)
      ) {
        return false;
      }
      return true;
    });
    pagesText.push(cleaned.join('\n'));
  }

  return pagesText.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
