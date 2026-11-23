import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { subjectName = '', topicTitle = '' } = await request.json();
    const cleanSub = String(subjectName || '')
      .replace(/^no[çc][õo]es\s+de\s+/i, '')
      .replace(/\s*\([^)]*\)/g, '')
      .trim();
    const cleanTop = String(topicTitle || '')
      .replace(/^(da|do|das|dos|de)\s+/i, '')
      .replace(/[.;:]+$/g, '')
      .trim()
      .slice(0, 95);
    const query = `aula ${cleanSub} ${cleanTop}`.replace(/\s+/g, ' ').trim();
    if (!query) {
      return NextResponse.json({ ok: false, error: 'Tópico vazio.' }, { status: 400 });
    }

    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`YouTube retornou HTTP ${res.status}`);
    }

    const html = await res.text();
    const matches = Array.from(html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g));
    const uniqueIds: string[] = [];
    for (const m of matches) {
      const id = m[1];
      if (!uniqueIds.includes(id)) {
        uniqueIds.push(id);
      }
      if (uniqueIds.length >= 5) break;
    }

    if (uniqueIds.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'Nenhum vídeo encontrado automaticamente.',
        searchUrl,
      });
    }

    const videos = uniqueIds.map((id) => ({
      videoId: id,
      url: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube.com/embed/${id}`,
    }));

    return NextResponse.json({ ok: true, videos, searchUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar vídeo no YouTube.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
