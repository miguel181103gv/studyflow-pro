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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, termo = '', uf = '', regiao = '' } = body;

    if (action === 'pesquisar') {
      const args: Record<string, unknown> = { termo: String(termo).trim() };
      if (uf && /^[a-zA-Z]{2}$/.test(String(uf).trim())) {
        args.uf = String(uf).trim().toLowerCase();
      }
      const data = await callPciMcp('pesquisar_concursos', args);
      if (action === 'provas') {
      const args: Record<string, unknown> = { termo: String(termo).trim() };
      const data = await callPciMcp('pesquisar_provas', args);
      return NextResponse.json({ ok: true, data });
    }

    return NextResponse.json({ ok: true, data });
    }

    if (action === 'listar') {
      const args: Record<string, unknown> = {};
      if (regiao) args.regiao = regiao;
      const data = await callPciMcp('listar_concursos', args);
      return NextResponse.json({ ok: true, data });
    }

    return NextResponse.json({ ok: false, error: 'Ação inválida.' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar PCI Concursos.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
