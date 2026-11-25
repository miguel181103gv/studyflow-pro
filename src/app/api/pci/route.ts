import { NextResponse } from 'next/server';

const PCI_MCP_URL = 'https://mcp.pciconcursos.com.br/mcp';

async function callPciMcp(toolName: string, args: Record<string, unknown>) {
  const res = await fetch(PCI_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    }),
    signal: AbortSignal.timeout(4500),
  });

  if (!res.ok) {
    throw new Error(`PCI Concursos respondeu HTTP ${res.status}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || 'Erro no servidor MCP da PCI Concursos.');
  }

  const text = json?.result?.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function searchDeepSeekWeb(query: string, count = 8): Promise<string> {
  const dsKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!dsKey) return '';
  try {
    const res = await fetch('https://api.deepseek.com/v1/tools/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dsKey}`,
      },
      body: JSON.stringify({
        query: query.slice(0, 128),
        count,
        need_content: false,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return '';
    const json = await res.json();
    const results = json?.results || json?.data || [];
    if (!Array.isArray(results) || results.length === 0) return '';
    return results
      .map(
        (r: { title?: string; url?: string; snippet?: string }, idx: number) =>
          `[${idx + 1}] ${r.title || ''}\nURL: ${r.url || ''}\nResumo: ${r.snippet || ''}`
      )
      .join('\n\n');
  } catch {
    return '';
  }
}

async function searchConcursosOnWeb(termo: string, uf: string) {
  const dsKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!dsKey) return [];

  const qBase = `${termo}${uf ? ` ${uf.toUpperCase()}` : ''}`.trim();
  const [web1, web2] = await Promise.all([
    searchDeepSeekWeb(`${qBase} concurso edital cargos banca salario`, 8),
    searchDeepSeekWeb(`${qBase} edital concurso pdf`, 6),
  ]);

  const combined = [web1, web2].filter(Boolean).join('\n\n');
  if (!combined) return [];

  const prompt = `Com base nos resultados da web abaixo sobre "${qBase}", liste até 8 concursos (incluindo editais abertos OU editais anteriores/antigos já encerrados, do mais recente/relevante ao mais antigo).

RESULTADOS DA WEB:
${combined.slice(0, 10000)}

Retorne SOMENTE JSON válido neste formato exato:
{
  "concursos": [
    {
      "titulo": "Nome do Concurso e Ano (ex: TRT-MG 2022 - 3ª Região)",
      "orgao": "Órgão (ex: TRT-MG)",
      "banca": "Banca (ex: Fumarc / FCC / FGV / Cebraspe ou vazio)",
      "salario": "Faixa salarial se houver (ex: R$ 8.529,65 a R$ 13.994,78 ou vazio)",
      "cargos": ["Cargo 1", "Cargo 2"],
      "datas": {
        "aberto": false,
        "em_breve": false,
        "inicio": "",
        "fim": ""
      },
      "url": "URL principal encontrada"
    }
  ]
}`;

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dsKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.concursos) ? parsed.concursos : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, termo = '', uf = '', regiao = '' } = body;

    if (action === 'pesquisar') {
      const qTermo = String(termo).trim();
      const qUf = String(uf).trim();

      // Busca na internet inteira (acha editais abertos E antigos) + tenta PCI em paralelo
      const args: Record<string, unknown> = { termo: qTermo };
      if (qUf && /^[a-zA-Z]{2}$/.test(qUf)) {
        args.uf = qUf.toLowerCase();
      }

      const [webList, pciData] = await Promise.all([
        searchConcursosOnWeb(qTermo, qUf),
        callPciMcp('pesquisar_concursos', args).catch(() => null),
      ]);

      const pciList = Array.isArray(pciData?.data)
        ? pciData.data
        : Array.isArray(pciData?.concursos)
        ? pciData.concursos
        : Array.isArray(pciData?.resultados)
        ? pciData.resultados
        : [];

      // Mescla priorizando abertos do PCI + editais (incluindo antigos) achados na web
      const seen = new Set<string>();
      const merged = [...pciList, ...webList].filter((item) => {
        const key = String(item?.titulo || item?.orgao || '').toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return NextResponse.json({
        ok: true,
        data: {
          concursos: merged,
          message: merged.length === 0 ? 'Nenhum concurso ou edital encontrado na web para esse termo.' : undefined,
        },
      });
    }

    if (action === 'listar') {
      const args: Record<string, unknown> = {};
      if (regiao) args.regiao = regiao;
      const data = await callPciMcp('listar_concursos', args);
      return NextResponse.json({ ok: true, data });
    }

    return NextResponse.json({ ok: false, error: 'Ação inválida.' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar concursos.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
