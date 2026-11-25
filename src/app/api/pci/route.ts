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

  const prompt = `Com base nos resultados da web abaixo sobre "${qBase}", liste até 6 concursos DISTINTOS (sem repetir o mesmo concurso/edital!). Inclua editais abertos OU anteriores/antigos, do mais recente ao mais antigo.
REGRAS IMPORTANTES:
- NUNCA repita o mesmo concurso duas vezes na lista.
- SEMPRE preencha "cargos" com os principais cargos do edital (ex: ["Técnico Bancário Novo", "Técnico Bancário - TI"]).
- SEMPRE coloque o ano e a banca no "titulo" (ex: "CAIXA Econômica Federal 2024 · Cesgranrio").

RESULTADOS DA WEB:
${combined.slice(0, 10000)}

Retorne SOMENTE JSON válido neste formato exato:
{
  "concursos": [
    {
      "titulo": "Nome do Concurso, Ano e Banca (ex: CAIXA Econômica Federal 2024 · Cesgranrio)",
      "orgao": "Órgão (ex: CAIXA Econômica Federal)",
      "banca": "Banca (ex: Cesgranrio)",
      "ano": "2024",
      "vagas": "4.050",
      "salario": "Faixa salarial (ex: R$ 3.762,00 a R$ 14.915,00 ou vazio)",
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

      // Mescla e remove duplicatas reais (inclusive edições repetidas do PCI sem ano/cargo)
      const normKey = (v: unknown) =>
        String(v || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

      const seen = new Map<string, Record<string, unknown>>();
      for (const item of [...webList, ...pciList]) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const orgaoK = normKey(rec.orgao || rec.titulo);
        const salK = normKey(rec.salario || rec.vagas_salario);
        const cargosArr = Array.isArray(rec.cargos) ? rec.cargos.map(String).filter(Boolean) : [];
        const cargosK = normKey(cargosArr.slice(0, 3).join(' '));
        const yearM = String(rec.ano || rec.titulo || '').match(/20\d{2}/)?.[0] || '';
        const dedupKey = `${orgaoK}__${yearM || salK}__${cargosK ? cargosK.slice(0, 30) : salK}`;
        if (!orgaoK) continue;

        const prev = seen.get(dedupKey);
        if (!prev) {
          seen.set(dedupKey, rec);
        } else {
          // Enriquece o registro existente com cargos/banca/link que estiverem faltando
          const prevCargos = Array.isArray(prev.cargos) ? prev.cargos : [];
          if (prevCargos.length === 0 && cargosArr.length > 0) prev.cargos = cargosArr;
          if (!prev.banca && rec.banca) prev.banca = rec.banca;
          if (!prev.ano && rec.ano) prev.ano = rec.ano;
          if (!prev.url && rec.url) prev.url = rec.url;
        }
      }
      const merged = Array.from(seen.values());

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
