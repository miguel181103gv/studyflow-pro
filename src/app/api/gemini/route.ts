import { NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    deepseekEnabled: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
    geminiEnabled: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
}

// Prioriza modelos mais recentes (Gemini 3.8 Flash) + descoberta automática de modelos ativos na chave
// Prioriza SEMPRE Flash Lite (500 req/dia e 15 req/min no plano gratuito!) antes dos Flash normais (20 req/dia)
const PREFERRED_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];

let cachedDiscoveredModels: { models: string[]; fetchedAt: number } | null = null;

async function discoverActiveFlashModels(apiKey: string): Promise<string[]> {
  if (cachedDiscoveredModels && Date.now() - cachedDiscoveredModels.fetchedAt < 30 * 60 * 1000) {
    return cachedDiscoveredModels.models;
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const list: { name?: string; supportedGenerationMethods?: string[] }[] = Array.isArray(data?.models)
      ? data.models
      : [];
    const candidates = list
      .filter(
        (m) =>
          typeof m.name === 'string' &&
          m.name.includes('gemini-') &&
          m.name.includes('flash') &&
          !m.name.includes('image') &&
          !m.name.includes('tts') &&
          !m.name.includes('audio') &&
          !m.name.includes('live') &&
          !m.name.includes('omni') &&
          !m.name.includes('2.0') &&
          !m.name.includes('2.5') &&
          Array.isArray(m.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes('generateContent')
      )
      .map((m) => String(m.name).replace(/^models\//, ''))
      .sort((a, b) => {
        const aLite = a.includes('lite') ? 1 : 0;
        const bLite = b.includes('lite') ? 1 : 0;
        if (aLite !== bLite) return bLite - aLite;
        return b.localeCompare(a, undefined, { numeric: true });
      });

    cachedDiscoveredModels = { models: candidates, fetchedAt: Date.now() };
    return candidates;
  } catch {
    return [];
  }
}

async function searchDeepSeekWeb(query: string, needContent = false, resultCount = 5): Promise<string | null> {
  const dsKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!dsKey || !query.trim()) return null;
  try {
    const res = await fetch('https://api.deepseek.com/v1/tools/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dsKey}`,
      },
      body: JSON.stringify({
        query: query.trim().slice(0, 128),
        count: resultCount,
        need_content: needContent,
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    if (results.length === 0) return null;
    return results
      .map(
        (r: { title?: string; url?: string; summary?: string; snippet?: string; content?: string }, i: number) =>
          `[${i + 1}] ${r.title || ''} (${r.url || ''})\n${(r.content || r.summary || r.snippet || '').slice(0, 2500)}`
      )
      .join('\n\n');
  } catch {
    return null;
  }
}

async function callDeepSeek(
  userContent: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>,
  jsonMode = false,
  preferPro = false,
  hasImage = false
): Promise<string | null> {
  const dsKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!dsKey) return null;

  // Somente deepseek-flash suporta Vision (imagens); deepseek-v4-pro é apenas para texto.
  const dsModels = hasImage
    ? ['deepseek-flash']
    : preferPro
    ? ['deepseek-flash', 'deepseek-v4-pro']
    : ['deepseek-flash', 'deepseek-chat'];

  for (const dsModel of dsModels) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${dsKey}`,
        },
        body: JSON.stringify({
          model: dsModel,
          messages: [
            {
              role: 'system',
              content: jsonMode
                ? 'Especialista em concursos BR. Responda em PT-BR e retorne apenas JSON válido.'
                : 'Especialista em concursos BR. Responda em PT-BR.',
            },
            { role: 'user', content: userContent },
          ],
          temperature: jsonMode ? 0.2 : 0.4,
          max_tokens: jsonMode ? 2500 : 4096,
          ...(dsModel === 'deepseek-flash' ? { thinking: { type: 'disabled' } } : {}),
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(hasImage ? 35000 : 24000),
      });

      if (!res.ok) {
        continue;
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return content.trim();
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function callGemini(parts: unknown[], jsonMode = false, useSearch = false, preferPro = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Chave GEMINI_API_KEY não configurada no servidor. Adicione nas variáveis de ambiente da Vercel.'
    );
  }

  const inlineItems = parts
    .filter((p) => typeof p === 'object' && p !== null && 'inlineData' in (p as Record<string, unknown>))
    .map((p) => (p as { inlineData: { mimeType?: string; data?: string } }).inlineData);

  const hasBinary = inlineItems.length > 0;
  const hasNonImageBinary = inlineItems.some((item) => !String(item?.mimeType || '').startsWith('image/'));
  const hasImage = inlineItems.some((item) => String(item?.mimeType || '').startsWith('image/'));

  // DeepSeek cuida de texto E imagens (via deepseek-flash Vision); apenas PDFs ou Google Search ficam no Gemini.
  if (!hasNonImageBinary && !useSearch && process.env.DEEPSEEK_API_KEY?.trim()) {
    if (hasImage) {
      const dsParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
      for (const p of parts) {
        if (typeof p === 'object' && p !== null && 'text' in (p as Record<string, unknown>)) {
          const txt = String((p as { text?: unknown }).text || '').trim();
          if (txt) dsParts.push({ type: 'text', text: txt });
        } else if (typeof p === 'object' && p !== null && 'inlineData' in (p as Record<string, unknown>)) {
          const inl = (p as { inlineData: { mimeType?: string; data?: string } }).inlineData;
          if (inl?.data && String(inl.mimeType || '').startsWith('image/')) {
            dsParts.push({
              type: 'image_url',
              image_url: { url: `data:${inl.mimeType};base64,${inl.data}` },
            });
          }
        }
      }
      if (dsParts.length > 0) {
        const dsResult = await callDeepSeek(dsParts, jsonMode, false, true);
        if (dsResult) return dsResult;
      }
    } else {
      const promptText = parts
        .map((p) => (typeof p === 'object' && p !== null && 'text' in (p as Record<string, unknown>) ? String((p as { text?: unknown }).text || '') : ''))
        .filter(Boolean)
        .join('\n\n');
      if (promptText.trim()) {
        const dsResult = await callDeepSeek(promptText, jsonMode, preferPro, false);
        if (dsResult) return dsResult;
      }
    }
  }

  const timeoutMs = hasBinary ? 45000 : 25000;

  // Usa SOMENTE modelos Flash confirmados como ativos na conta (evita 404 NotFound!)
  const discovered = await discoverActiveFlashModels(apiKey);
  const baseList = (discovered.length > 0 ? discovered : PREFERRED_MODELS).slice(0, 4);
  const firstLite = baseList.find((m) => m.includes('lite')) || baseList[0];
  // Tenta o primeiro Flash Lite até 2x em caso de 503, depois os demais Flash ativos
  const modelsQueue = [firstLite, firstLite, ...baseList.filter((m) => m !== firstLite)];

  let lastError = 'Os servidores do Gemini estão temporariamente ocupados. Tente novamente em alguns segundos.';
  const triedSummary: string[] = [];
  const skippedModels = new Set<string>();

  for (const model of modelsQueue) {
    if (skippedModels.has(model)) continue;
    const alreadyTried = triedSummary.some((s) => s.startsWith(`${model} (`));
    if (alreadyTried) {
      await new Promise((r) => setTimeout(r, 2000));
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const genConfig: Record<string, unknown> =
      jsonMode && !useSearch
        ? { responseMimeType: 'application/json', temperature: 0.15, maxOutputTokens: 8192 }
        : { temperature: 0.3, maxOutputTokens: 8192 };

    if (model.startsWith('gemini-2.5')) {
      genConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      generationConfig: genConfig,
    };

    if (useSearch) {
      body.tools = [{ googleSearch: {} }];
    }

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      lastError = `O Gemini (${model}) demorou mais que o esperado. Tente novamente.`;
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      const candidateParts = data?.candidates?.[0]?.content?.parts || [];
      const text = candidateParts.map((p: { text?: string }) => p.text || '').join('\n').trim();
      if (text) return text;
      lastError = `Resposta vazia do modelo ${model}. Tente novamente.`;
    } else {
      const errData = await res.json().catch(() => ({}));
      const rawMsg = String(errData?.error?.message || `HTTP ${res.status}`);
      const isModelUnavailable =
        res.status === 404 ||
        rawMsg.toLowerCase().includes('no longer available') ||
        rawMsg.toLowerCase().includes('not found');

      if (isModelUnavailable) {
        skippedModels.add(model);
        triedSummary.push(`${model} (indisponível)`);
        lastError = `${model}: ${rawMsg}`;
        continue;
      }

      if (res.status === 503 || res.status === 429) {
        const isZeroLimit = rawMsg.includes('limit: 0');
        if (isZeroLimit || res.status === 429) {
          skippedModels.add(model); // Não repete modelo sem cota ou com 429
        }
        triedSummary.push(`${model} (${res.status})`);
        if (!isZeroLimit) {
          lastError = `Servidores gratuitos do Google ocupados agora (${triedSummary.join(', ')}). Aguarde alguns segundos e tente novamente.`;
        }
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }

      lastError = `${model} (${res.status}): ${rawMsg}`;
      if ((res.status === 400 || res.status === 403) && !rawMsg.toLowerCase().includes('model')) {
        throw new Error(lastError);
      }
    }
  }

  throw new Error(lastError);
}

function extractJsonObject(raw: string) {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start !== -1 && end !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(candidate);
  } catch {
    // Fallback: remove trailing commas and raw control chars
    const repaired = candidate
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\u0000-\u0019]+/g, ' ');
    return JSON.parse(repaired);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'list_edital_roles') {
      const { pdfBase64, pdfText = '', mimeType = 'application/pdf' } = body;
      const parts: unknown[] = [
        {
          text: `Analise este edital de concurso público brasileiro e identifique o órgão, TODOS os cargos disponíveis e, JÁ NESTA MESMA LEITURA, extraia as informações, MATÉRIAS e TÓPICOS de cada cargo para que o usuário não precise esperar uma segunda leitura.
REGRAS RÍGIDAS:
- NUNCA agrupe ou escreva "Diversos Cargos", "Vários Cargos" ou "Todos os cargos".
- Liste CADA cargo individualmente pelo nome exato que aparece no edital (ex: "Agente Legislativo", "Analista Administrativo", "Técnico em Informática").
- Se o edital for de apenas 1 cargo, retorne um array com esse 1 cargo.
- REGRA CRÍTICA SOBRE MATÉRIAS vs CATEGORIAS: "Conhecimentos Básicos", "Conhecimentos Gerais" e "Conhecimentos Específicos" são APENAS o campo "category" — JAMAIS crie uma matéria com name = "Conhecimentos Específicos", "Conhecimentos Básicos" ou "Conhecimentos Gerais"! Dentro da seção de Conhecimentos Específicos, separe CADA disciplina real como uma matéria própria (ex: "Direito do Trabalho", "Direito Processual do Trabalho", "Conhecimentos Bancários") com category: "Conhecimentos Específicos", e coloque os itens numerados de cada disciplina em "topics".
- Em "roles_details", inclua para CADA cargo: salário base, vale-alimentação/auxílios, carga horária, data da prova e TODAS as matérias com TODOS os seus TÓPICOS do conteúdo programático (Conhecimentos Básicos/Gerais + Específicos). Nunca omita os tópicos de uma matéria! Se o edital informar o peso (ex: peso 1 para Gerais, peso 2 para Específicos) ou a quantidade de questões de cada disciplina/bloco, preencha "weight" (número) e "exam_questions" (número ou null).
- Não invente valores que não estejam no PDF — deixe "" se não encontrar.

Retorne SOMENTE um JSON válido neste formato:
{
  "name": "Nome do concurso / órgão (ex: Câmara Municipal de Governador Valadares - MG)",
  "icon": "Um emoji adequado (ex: 🏛️, ⚖️, 🚔, 🏦)",
  "status_text": "Status resumido (ex: Edital publicado)",
  "exam_date": "YYYY-MM-DD se constar no edital, ou null",
  "roles": ["Cargo 1", "Cargo 2"],
  "roles_details": [
    {
      "role_title": "Cargo 1",
      "salary_base": "R$ 3.500,00 ou vazio",
      "vale_alimentacao": "R$ 800,00 ou vazio",
      "workload": "40h ou vazio",
      "exam_date": "YYYY-MM-DD ou vazio",
      "extras": "Resumo curto de benefícios/etapas ou vazio",
      "subjects": [
        {
          "name": "Língua Portuguesa",
          "category": "Básica",
          "hours_target": 2,
          "weight": 1,
          "exam_questions": null,
          "topics": ["Compreensão e interpretação de textos", "Ortografia oficial", "Acentuação gráfica"]
        }
      ]
    }
  ]
}`,
        },
      ];

      if (pdfText && String(pdfText).trim()) {
        parts.push({ text: `TEXTO DO EDITAL:\n${String(pdfText).slice(0, 48000)}` });
      } else if (pdfBase64) {
        parts.push({ inlineData: { mimeType, data: pdfBase64 } });
      }

      const raw = await callGemini(parts, true, false);
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'extract_role_details') {
      const { pdfBase64, pdfText = '', mimeType = 'application/pdf', roleTitle, organName } = body;
      const parts: unknown[] = [
        {
          text: `Neste edital de "${organName}", foque EXCLUSIVAMENTE no cargo "${roleTitle}".
Extraia o salário base exato deste cargo, vale-alimentação/auxílios, carga horária semanal, data da prova e TODAS as matérias e tópicos do conteúdo programático que caem especificamente para "${roleTitle}" (Conhecimentos Gerais/Básicos + Conhecimentos Específicos deste cargo).
Não invente valores que não estejam no PDF — deixe "" se não encontrar.
- REGRA CRÍTICA SOBRE MATÉRIAS vs CATEGORIAS: "Conhecimentos Básicos", "Conhecimentos Gerais" e "Conhecimentos Específicos" são APENAS o campo "category" — JAMAIS crie uma matéria com name = "Conhecimentos Específicos", "Conhecimentos Básicos" ou "Conhecimentos Gerais"! Dentro da seção de Conhecimentos Específicos, separe CADA disciplina real como uma matéria própria (ex: "Direito do Trabalho", "Direito Processual do Trabalho", "Conhecimentos Bancários") com category: "Conhecimentos Específicos", e coloque os itens numerados de cada disciplina em "topics".

Retorne SOMENTE um JSON válido neste formato:
{
  "salary_base": "Ex: R$ 4.108,68 (ou '' se não constar)",
  "vale_alimentacao": "Ex: R$ 800,00 (ou '' se não constar)",
  "workload": "Ex: 30h/sem ou 40h/sem (ou '')",
  "extras": "Principais benefícios em 1 linha curta (ou '')",
  "exam_date": "YYYY-MM-DD se constar, ou null",
  "status_text": "Status resumido",
  "subjects": [
    {
      "name": "Nome da Matéria",
      "category": "Conhecimentos Gerais ou Conhecimentos Específicos",
      "weight": 1,
      "exam_questions": null,
      "topics": ["Tópico 1 limpo", "Tópico 2 limpo"]
    }
  ]
}`,
        },
      ];

      if (pdfText && String(pdfText).trim()) {
        parts.push({ text: `TEXTO DO EDITAL:\n${String(pdfText).slice(0, 48000)}` });
      } else if (pdfBase64) {
        parts.push({ inlineData: { mimeType, data: pdfBase64 } });
      }

      const raw = await callGemini(parts, true, false);
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    // Conciliar 2 ou mais editais: Núcleo Comum unificado + Módulos Exclusivos separados
    if (action === 'reconcile_editais') {
      const { editais } = body;
      const raw = await callGemini(
        [
          {
            text: `Você recebeu ${editais.length} editais de concursos públicos que o aluno quer conciliar juntos (exatamente como um plano unificado):
${JSON.stringify(editais, null, 2)}

Sua tarefa é cruzar todas as matérias e tópicos desses editais:
1. O que for comum entre 2 ou mais editais (ex: Língua Portuguesa, Raciocínio Lógico, Informática, Direito Constitucional/Administrativo) deve ser UNIFICADO sem duplicar tópicos, com category = "Núcleo Comum (Conciliável)" e nome terminado com " (Comum)".
2. O que for específico ou exclusivo de apenas um edital/cargo (ex: Legislação Municipal de GV, Regimento Interno da Câmara, etc.) deve ficar separado com category = "Exclusivo: <Nome curto do Órgão>" e nome claro indicando o edital.

Retorne SOMENTE um JSON válido neste formato:
{
  "combined_name": "Nome curto unificado (ex: TRT-MG + Câmara GV)",
  "combined_role": "Cargos conciliados separados por +",
  "subjects": [
    {
      "name": "Língua Portuguesa (Comum)",
      "category": "Núcleo Comum (Conciliável)",
      "topics": ["Tópico 1", "Tópico 2"]
    },
    {
      "name": "Legislação Municipal (Câmara GV)",
      "category": "Exclusivo: Câmara GV",
      "topics": ["Tópico específico 1"]
    }
  ]
}`,
          },
        ],
        true,
        false
      , true);
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'enrich_edital') {
      const { organName, roleTitle } = body;
      const webResults = await searchDeepSeekWeb(
        `${organName} ${roleTitle} concurso salario vale alimentacao edital`
      );
      if (webResults && process.env.DEEPSEEK_API_KEY?.trim()) {
        const dsPrompt = `Com base nos resultados de busca abaixo sobre o concurso "${organName}" para o cargo "${roleTitle}" no Brasil, extraia remuneração inicial / salário base, vale-alimentação, jornada semanal, principais benefícios, situação atual e data de prova se houver.

RESULTADOS DA WEB:
${webResults}

Responda SOMENTE com um JSON válido neste formato exato:
{
  "salary_base": "Ex: R$ 9.776,71 (ou '' se não encontrar)",
  "vale_alimentacao": "Ex: R$ 1.860,51 (ou '' se não encontrar)",
  "workload": "Ex: 40h/sem (ou '' se não encontrar)",
  "extras": "Principais benefícios em 1 linha curta",
  "status_text": "Situação atual resumida (ex: Edital previsto / Autorizado / Publicado)",
  "exam_date": "YYYY-MM-DD se já houver data marcada, ou null"
}`;
        const dsRaw = await callDeepSeek(dsPrompt, true, false, false);
        if (dsRaw) {
          const parsed = extractJsonObject(dsRaw);
          return NextResponse.json({ ok: true, data: parsed });
        }
      }

      const raw = await callGemini(
        [
          {
            text: `Pesquise informações atuais e oficiais sobre o concurso "${organName}" para o cargo "${roleTitle}" no Brasil (remuneração inicial / salário base, vale-alimentação, jornada semanal, principais benefícios, situação atual do concurso e possível data de prova se houver).
Responda SOMENTE com um JSON válido neste formato exato (sem markdown):
{
  "salary_base": "Ex: R$ 9.776,71 (ou '' se não encontrar)",
  "vale_alimentacao": "Ex: R$ 1.860,51 (ou '' se não encontrar)",
  "workload": "Ex: 40h/sem (ou '' se não encontrar)",
  "extras": "Principais benefícios em 1 linha curta",
  "status_text": "Situação atual resumida (ex: Edital previsto para 2027 / Autorizado / Publicado)",
  "exam_date": "YYYY-MM-DD se já houver data marcada, ou null"
}`,
          },
        ],
        false,
        true
      );
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'complete_flashcard') {
      const { front = '', back = '', subjectName = '', topicTitle = '', profileName = '' } = body;
      if (!front || !String(front).trim()) {
        return NextResponse.json({ error: 'Digite a pergunta/frente do flashcard.' }, { status: 400 });
      }
      const cleanF = String(front).trim();
      const cleanB = String(back || '').trim();
      const ctx = [profileName, subjectName, topicTitle].filter(Boolean).join(' · ');

      const prompt = cleanB
        ? `Corrija erros de digitação, acentuação e clareza deste flashcard (${ctx || 'concursos'}).
Frente: "${cleanF}"
Verso: "${cleanB}"
Retorne SOMENTE JSON válido:
{"corrected_front":"...","corrected_back":"..."}`
        : `Corrija erros de digitação, acentuação e pontuação da pergunta abaixo (${ctx || 'concursos'}) em "corrected_front", e escreva uma resposta curta, precisa e de alta retenção para prova (1 a 3 frases objetivas, citando artigo/regra se houver) em "corrected_back".
Pergunta digitada: "${cleanF}"
Retorne SOMENTE JSON válido:
{"corrected_front":"...","corrected_back":"..."}`;

      const raw = await callGemini([{ text: prompt }], true, false, false);
      const data = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data });
    }

    if (action === 'generate_study_curriculum') {
      const { goalText = '', studyModeLabel = 'Estudo Livre' } = body;
      if (!goalText || !String(goalText).trim()) {
        return NextResponse.json({ error: 'Descreva o que você quer estudar.' }, { status: 400 });
      }
      const prompt = `Você é um designer pedagógico especialista em criar currículos completos e progressivos (${studyModeLabel}).
O estudante pediu: "${String(goalText).trim()}".

Monte um currículo organizado por MATÉRIAS (ou blocos temáticos) e, dentro de cada matéria, liste os TÓPICOS em ordem lógica/cronológica do início (básico/origem) até o avançado/atual (ex: em História, começar na Pré-História até Mundo Contemporâneo; em Política/Economia, começar pelos fundamentos até temas atuais).
Se o usuário pediu apenas 1 tema (ex: só História), crie os grandes módulos como matérias ou 1-3 matérias bem divididas; se pediu vários temas (ex: História Geral, História do Brasil, Política, Economia), crie 1 matéria para cada tema com 6 a 12 tópicos progressivos cada.

Retorne SOMENTE JSON válido:
{
  "title": "Nome curto do plano (ex: Política, História & Economia)",
  "subtitle": "Descrição curta do objetivo em 1 linha",
  "subjects": [
    {
      "name": "História Geral",
      "category": "${studyModeLabel}",
      "topics": ["1. Pré-História e Primeiras Civilizações", "2. Antiguidade Clássica (Grécia e Roma)"]
    }
  ]
}`;
      const raw = await callGemini([{ text: prompt }], true, false, false);
      const data = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data });
    }

    if (action === 'generate_flashcards') {
      const { subjectName, topicTitle, profileName, count = 5 } = body;
      const raw = await callGemini(
        [
          {
            text: `Você é um professor especialista em concursos públicos (${profileName}). Crie ${count} flashcards de alta retenção (estilo Anki, diretos e cobrados em prova) sobre o tópico "${topicTitle}" da matéria "${subjectName}".
Retorne SOMENTE um JSON válido neste formato:
{
  "flashcards": [
    {
      "front": "Pergunta objetiva ou conceito-chave para lembrar",
      "back": "Resposta direta, clara e com a pegadinha/regra principal que cai em prova"
    }
  ]
}`,
          },
        ],
        true
      );
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'quiz') {
      const { subjectName, topicTitle, profileName } = body;
      const raw = await callGemini(
        [
          {
            text: `Você é um professor especialista em concursos públicos (${profileName}). Crie 5 questões inéditas de múltipla escolha (A, B, C, D) sobre o tópico "${topicTitle}" da matéria "${subjectName}", no estilo das principais bancas (FCC/FGV/Cesgranrio/Cebraspe).
Retorne exatamente um JSON neste formato:
{
  "questions": [
    {
      "statement": "Enunciado completo da questão",
      "options": ["A, false, true) ...", "B) ...", "C) ...", "D) ..."],
      "correctIndex": 0,
      "explanation": "Comentário objetivo explicando por que a alternativa está correta e as outras erradas."
    }
  ]
}`,
          },
        ],
        true
      );
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'digitize_error_question') {
      const { imageBase64, mimeType = 'image/png', subjectName = '' } = body;
      if (!imageBase64) {
        return NextResponse.json({ error: 'Envie uma imagem para digitalizar.' }, { status: 400 });
      }
      const raw = await callGemini(
        [
          {
            inlineData: {
              mimeType: mimeType,
              data: imageBase64,
            },
          },
          {
            text: `Você é um transcritor especialista em questões de concursos e vestibulares (${subjectName}).
Analise cuidadosamente esta imagem (print ou foto de uma questão) e DIGITALIZE-A completamente em texto estruturado.

Regras:
1. Extraia o cabeçalho se visível (ex: "FGV · 2026 · TRF 2"), ou "" se não houver.
2. Transcreva o enunciado completo de forma limpa e fiel.
3. Extraia TODAS as alternativas (A, B, C, D, E ou C/E para Certo/Errado) sem marcas de certo/errado no texto da opção.
4. Identifique se na imagem aparece qual alternativa o estudante marcou ERRADO (ex: marcada com X vermelho) -> coloque apenas a letra em "user_wrong_answer" (ou "" se não visível).
5. Identifique o GABARITO CORRETO se visível na imagem (ex: marcada em verde / "Opção correta") ou resolva com precisão -> coloque apenas a letra em "correct_answer".
6. Gere uma "golden_rule" (Regra de Ouro em 1 frase curta) e uma "explanation" (explicação didática do gabarito).

Retorne SOMENTE um JSON válido neste formato exato:
{
  "header": "Banca · Ano · Órgão (ou vazio)",
  "statement": "Enunciado completo da questão",
  "options": [
    { "letter": "A", "text": "Texto limpo da alternativa A" },
    { "letter": "B", "text": "Texto limpo da alternativa B" }
  ],
  "user_wrong_answer": "C",
  "correct_answer": "E",
  "golden_rule": "Frase curta para nunca mais errar",
  "explanation": "Explicação objetiva do gabarito e da pegadinha"
}`,
          },
        ],
        true
      );
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'digitize_text_questions') {
      const { rawText, subjectName = '', topicTitle = '' } = body;
      if (!rawText || !String(rawText).trim()) {
        return NextResponse.json({ error: 'Cole o texto com uma ou mais questões.' }, { status: 400 });
      }
      const raw = await callGemini(
        [
          {
            text: `Você é um professor especialista em concursos e provas (${subjectName} — ${topicTitle}).
Transforme o texto abaixo em um quiz estruturado, extraindo TODAS as questões encontradas (pode ser 1 ou várias).
Para cada questão:
- Limpe o enunciado e separe todas as alternativas (A, B, C, D, E ou Certo/Errado com letras C e E).
- Se o gabarito estiver no texto, use-o; se não estiver, resolva com precisão e indique a letra correta em "correct_answer".
- Escreva uma explicação objetiva em "explanation".

TEXTO ENVIADO:
${String(rawText).slice(0, 15000)}

Retorne SOMENTE um JSON válido neste formato exato:
{
  "questions": [
    {
      "header": "Banca · Ano (ou vazio)",
      "statement": "Enunciado limpo da questão",
      "options": [
        { "letter": "A", "text": "Texto da alternativa A" },
        { "letter": "B", "text": "Texto da alternativa B" }
      ],
      "correct_answer": "A",
      "explanation": "Comentário objetivo explicando o gabarito."
    }
  ]
}`,
          },
        ],
        true
      );
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'define_word') {
      const {
        word,
        subjectName = '',
        profileName = '',
        roleTitle = '',
        subjectsContext = '',
        onlySpellCheck = false,
      } = body;
      if (!word || !String(word).trim()) {
        return NextResponse.json({ error: 'Informe uma palavra ou termo.' }, { status: 400 });
      }
      const cleanW = String(word).trim();
      const areaCtx = subjectName
        ? `matéria "${subjectName}"${profileName ? ` (concurso/curso: ${profileName})` : ''}`
        : [
            profileName ? `concurso/curso "${profileName}"` : '',
            roleTitle ? `cargo "${roleTitle}"` : '',
            subjectsContext ? `matérias estudadas: ${subjectsContext}` : '',
          ]
            .filter(Boolean)
            .join(' · ');

      const prompt = onlySpellCheck
        ? `Verifique a grafia e acentuação de "${cleanW}"${
            areaCtx ? ` no contexto de ${areaCtx}` : ''
          }. Se houver erro de digitação ou falta de acento, corrija em "corrected_word"; se já estiver certa, repita igual. JSON: {"corrected_word":"..."}`
        : `Você está ajudando um estudante (${areaCtx || 'concursos públicos e direito/estudos'}).
Termo: "${cleanW}".
REGRAS:
1. Corrija eventuais erros de digitação/acentuação em "corrected_word" (se estiver certa, repita igual).
2. CONTEXTUALIZAÇÃO OBRIGATÓRIA: se o termo tiver outro sentido famoso fora da área do estudante (ex: 'princípio da inércia' na Física vs no Direito), IGNORE o sentido de fora e explique EXCLUSIVAMENTE o significado aplicado à área que o aluno estuda (${subjectName || subjectsContext || profileName || 'estudos'}).
3. Seja MUITO SIMPLES, curto e direto (1 a 2 frases curtas, fácil de memorizar).
JSON:
{"corrected_word":"${cleanW}","meaning":"Significado curto e direto no contexto certo.","example":"Frase curta de exemplo na área ou vazio."}`;

      const raw = await callGemini([{ text: prompt }], true);
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'fetch_law_article') {
      const { article = '', lawHint = '' } = body;
      if (!article || !String(article).trim()) {
        return NextResponse.json({ error: 'Informe o artigo para buscar.' }, { status: 400 });
      }
      const artClean = String(article).trim();
      const lawClean = String(lawHint || '').trim();
      const q = `${artClean} ${lawClean || 'Constituição Federal CLT'} site:planalto.gov.br OR texto oficial`.trim();
      const webHits = await searchDeepSeekWeb(q, true, 4);

      const prompt = `Você é um assistente jurídico brasileiro. Extraia/forneça o TEXTO OFICIAL LITERAL E COMPLETO do "${artClean}"${
        lawClean ? ` da norma "${lawClean}"` : ''
      } (incluindo caput, parágrafos, incisos e alíneas, formatando cada elemento em sua própria linha para leitura em Lei Seca).
${webHits ? `\nFONTES DA WEB (Planalto/Oficiais):\n${webHits.slice(0, 6000)}\n` : ''}
Retorne SOMENTE JSON válido neste formato:
{
  "lawName": "${lawClean || 'CF/88 ou Norma identificada'}",
  "title": "${artClean}${lawClean ? ` (${lawClean})` : ''}",
  "rawText": "Art. ...\nI - ...\n§ 1º ..."
}`;
      const raw = await callGemini([{ text: prompt }], true, false, false);
      const data = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data });
    }

    if (action === 'format_lei_seca') {
      const { rawText, lawName = '' } = body;
      if (!rawText || !String(rawText).trim()) {
        return NextResponse.json({ error: 'Envie o texto da lei para formatar.' }, { status: 400 });
      }
      const prompt = `Você é um formatador jurídico de Lei Seca brasileira${lawName ? ` (${lawName})` : ''}.
Limpe e organize o texto legal abaixo para ficar visualmente perfeito e agradável de estudar:
REGRAS RÍGIDAS:
1. NUNCA resuma, parafraseie ou apague artigos, parágrafos, incisos ou alíneas — mantenha 100% do texto legal fiel.
2. Remova apenas lixo de PDF (números de página isolados, cabeçalhos repetidos como 'Presidência da República / Casa Civil', hifens de quebra de linha no meio de palavras e quebras de linha no meio da frase).
3. Coloque cada elemento estrutural em sua própria linha:
   - Títulos/Capítulos/Seções em maiúsculas ou linha própria
   - Cada 'Art. Xº' em nova linha
   - Cada '§ Xº' ou 'Parágrafo único.' em nova linha
   - Cada inciso ('I -', 'II -', 'III -'...) em nova linha
   - Cada alínea ('a)', 'b)', 'c)'...) em nova linha
4. Retorne APENAS o texto legal formatado, sem comentários extras ou markdown.

TEXTO:
${String(rawText).slice(0, 12000)}`;

      const formattedText = await callGemini([{ text: prompt }], false, false, false);
      return NextResponse.json({ ok: true, data: { formattedText: formattedText.trim() } });
    }

    if (action === 'generate_study_summary') {
      const { subjectName = '', topicTitle = '', profileName = '' } = body;
      if (!topicTitle && !subjectName) {
        return NextResponse.json({ error: 'Informe a matéria ou tópico.' }, { status: 400 });
      }
      const prompt = `Crie um RESUMO DIDÁTICO COMPLETO E ESTRUTURADO para prova/concurso (${profileName || 'Estudos'}) sobre:
Matéria: "${subjectName}"
Tópico: "${topicTitle || subjectName}"

Regras:
- Cubra os conceitos essenciais, regras gerais, exceções, prazos e o que mais cai em prova.
- Seja claro, direto e didático (fácil de revisar antes da prova).
- Em cada seção, se houver pegadinha clássica de banca, coloque em "callout".

Retorne SOMENTE JSON válido neste formato exato:
{
  "title": "Resumo: ${topicTitle || subjectName}",
  "summary": "Visão geral do assunto em 2 frases diretas.",
  "sections": [
    {
      "heading": "1. Conceito e Fundamento",
      "points": ["Ponto objetivo 1", "Ponto objetivo 2"],
      "callout": "Pegadinha de prova ou exceção importante (ou vazio)"
    }
  ]
}`;
      const raw = await callGemini([{ text: prompt }], true, false, false);
      const data = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data });
    }

    if (action === 'format_study_notes') {
      const { rawText, subjectName = '', topicTitle = '' } = body;
      if (!rawText || !String(rawText).trim()) {
        return NextResponse.json({ error: 'Cole ou digite um texto para formatar.' }, { status: 400 });
      }
      const raw = await callGemini(
        [
          {
            text: `Você é um designer educacional e professor especialista (${subjectName} — ${topicTitle}).
Pegue o texto bruto do estudante abaixo e ORGANIZE-O em um material de estudo limpo, bonito, bem separado e fácil de revisar, sem perder nenhum conteúdo importante.

TEXTO ORIGINAL:
${String(rawText).slice(0, 18000)}

Retorne SOMENTE um JSON válido neste formato exato:
{
  "title": "Título limpo do resumo",
  "summary": "Síntese de 1 a 2 frases do assunto principal",
  "sections": [
    {
      "heading": "Nome claro da seção",
      "points": ["Ponto objetivo e bem escrito 1", "Ponto objetivo 2"],
      "callout": "Dica importante, exceção ou pegadinha desta seção (ou vazio)"
    }
  ]
}`,
          },
        ],
        true
      );
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'clean_topic_list') {
      const { rawText, subjectName = '' } = body;
      if (!rawText || !String(rawText).trim()) {
        return NextResponse.json({ error: 'Cole o texto com os tópicos.' }, { status: 400 });
      }
      const raw = await callGemini(
        [
          {
            text: `Você é um organizador especialista em editais e planos de estudo para a matéria "${subjectName}".
O estudante colou um texto bruto (muitas vezes copiado de um PDF de edital verticalizado, com cabeçalhos, números de página, colunas de tabela e linhas quebradas).

REGRAS OBRIGATÓRIAS:
1. REMOVA todo lixo de PDF/tabela: "Página X de Y", "Conteúdo", "Questões", "PDFs", "Lei Seca", "Videoaulas", "Revisão", "24 h 7 dias 30 dias 90 dias", "CLIQUE AQUI", "PROVA DISCURSIVA (MATERIAL...)", cabeçalhos repetidos, etc.
2. JUNTE linhas que foram quebradas no meio de uma frase.
3. IDENTIFIQUE HIERARQUIA DE TÓPICOS E SUBTÓPICOS: quando um tema principal tiver desdobramentos/subtópicos (ex: "Da rescisão do contrato de trabalho: das justas causas; da despedida indireta; da dispensa arbitrária"), coloque o tema principal como tópico pai e CADA subtópico logo abaixo começando EXATAMENTE com o prefixo "↳ " (ex: "Da rescisão do contrato de trabalho", "↳ Das justas causas", "↳ Da despedida indireta", "↳ Da dispensa arbitrária").
4. Mantenha 100% do conteúdo programático real — não invente nem apague assuntos reais do texto.

TEXTO COLADO:
${String(rawText).slice(0, 18000)}

Retorne SOMENTE um JSON válido neste formato exato:
{
  "topics": [
    "Princípios e fontes do Direito do Trabalho",
    "Da rescisão do contrato de trabalho",
    "↳ Das justas causas",
    "↳ Da despedida indireta"
  ]
}`,
          },
        ],
        true
      );
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'explain_error') {
      const {
        subjectName,
        topicTitle,
        questionText,
        userAnswer,
        correctAnswer,
        imageBase64,
        imageMime,
      } = body;
      const parts: unknown[] = [
        {
          text: `Você é um mentor especialista em concursos públicos. Analise esta questão errada pelo aluno:
Matéria: ${subjectName}
Tópico: ${topicTitle || 'Geral'}
Enunciado/Texto: ${questionText || '(ver imagem anexa)'}
Resposta do aluno: ${userAnswer || 'Não informada'}
Gabarito correto: ${correctAnswer || 'Identifique na questão'}

Retorne exatamente um JSON:
{
  "explanation": "Explicação clara, didática e direta do porquê o gabarito está correto e onde costuma estar a pegadinha da banca.",
  "golden_rule": "Uma frase curta e memorável ('Regra de Ouro') para nunca mais errar esse ponto."
}`,
        },
      ];

      if (imageBase64) {
        parts.push({
          inlineData: {
            mimeType: imageMime || 'image/png',
            data: imageBase64,
          },
        });
      }

      const raw = await callGemini(parts, true, false, true);
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'report') {
      const { profileName, periodType, metricsSummary } = body;
      const text = await callGemini(
        [
          {
            text: `Você é um Mentor Sênior de Concursos Públicos. Gere um relatório ${periodType} direto, prático e motivador para o aluno Miguel, que está estudando para "${profileName}".
Dados reais do aluno neste período:
${JSON.stringify(metricsSummary, null, 2)}

Estruture o relatório em Markdown limpo com:
1. **Diagnóstico Geral** (ritmo de horas vs meta, consistência e taxa de acertos).
2. **Pontos Fortes** (matérias acima da meta).
3. **Alertas Vermelhos** (matérias com baixo desempenho ou atraso nas revisões).
4. **Plano de Ação Prático** (3 passos concretos para a próxima semana).
Seja objetivo, use números reais dos dados enviados e evite floreios.`,
          },
        ],
        false
      , false, true);

      return NextResponse.json({ ok: true, data: { markdown: text } });
    }

    if (action === 'identify_exam_pdf') {
      const { sampleText = '', gabaritoText = '' } = body;
      if (!sampleText || !String(sampleText).trim()) {
        return NextResponse.json({ error: 'Texto da prova vazio.' }, { status: 400 });
      }

      const idPrompt = `Analise o início desta prova de concurso brasileiro e identifique os dados da prova.
TEXTO INICIAL DA PROVA:
${String(sampleText).slice(0, 4500)}

Retorne SOMENTE JSON válido:
{
  "exam_title": "Título curto (ex: TRT-MG · Técnico Judiciário · 2022)",
  "board": "Nome da banca (ex: FCC, FGV, Cebraspe, Cesgranrio, Vunesp ou outra)",
  "organ": "Órgão (ex: TRT-MG)",
  "role": "Cargo (ex: Técnico Judiciário - Área Administrativa)",
  "year": "Ano (ex: 2022 ou vazio)",
  "style": "multipla ou certo_errado"
}`;

      const idRaw = await callGemini([{ text: idPrompt }], true, false, false);
      const meta = extractJsonObject(idRaw) as {
        exam_title?: string;
        board?: string;
        organ?: string;
        role?: string;
        year?: string;
        style?: string;
      };

      let gabaritoMap: Record<string, string> = {};
      let gabaritoSourceUrl = '';
      let gabaritoFound = false;

      if (gabaritoText && String(gabaritoText).trim()) {
        const gabPrompt = `Extraia o gabarito oficial (número da questão -> letra correta A, B, C, D, E, C, E ou ANULADA) do texto abaixo.
TEXTO DO GABARITO:
${String(gabaritoText).slice(0, 12000)}

Retorne SOMENTE JSON:
{"gabarito":{"1":"A","2":"C"}}`;
        try {
          const gRaw = await callGemini([{ text: gabPrompt }], true, false, false);
          const gParsed = extractJsonObject(gRaw) as { gabarito?: Record<string, string> };
          if (gParsed?.gabarito && typeof gParsed.gabarito === 'object') {
            gabaritoMap = gParsed.gabarito;
            gabaritoFound = Object.keys(gabaritoMap).length > 0;
          }
        } catch {
          // ignore
        }
      } else {
        const qStr = [meta.board, meta.organ, meta.role, meta.year, 'gabarito oficial definitivo']
          .filter(Boolean)
          .join(' ');
        const webHits = await searchDeepSeekWeb(qStr, true, 4);
        if (webHits) {
          const webGabPrompt = `Procure nos resultados de busca abaixo o gabarito oficial desta prova (${meta.exam_title || qStr}).
Se encontrar o gabarito (mesmo parcial) com números de questões e letras, extraia em "gabarito" e coloque a URL da fonte em "source_url". Se NÃO encontrar a tabela de gabarito nos textos, retorne "gabarito": {} e "source_url" do melhor link oficial encontrado.

RESULTADOS:
${webHits}

JSON:
{"gabarito":{"1":"A"},"source_url":"https://..."}`;
          try {
            const wgRaw = await callGemini([{ text: webGabPrompt }], true, false, false);
            const wgParsed = extractJsonObject(wgRaw) as {
              gabarito?: Record<string, string>;
              source_url?: string;
            };
            if (wgParsed?.gabarito && typeof wgParsed.gabarito === 'object') {
              gabaritoMap = wgParsed.gabarito;
              gabaritoFound = Object.keys(gabaritoMap).length > 0;
            }
            if (wgParsed?.source_url) gabaritoSourceUrl = String(wgParsed.source_url);
          } catch {
            // ignore
          }
        }
      }

      return NextResponse.json({
        ok: true,
        data: {
          ...meta,
          gabarito_map: gabaritoMap,
          gabarito_found: gabaritoFound,
          gabarito_source_url: gabaritoSourceUrl,
        },
      });
    }

    if (action === 'parse_exam_questions_chunk') {
      const { chunkText = '', board = 'Concurso', style = 'multipla', subjectNames = [] } = body;
      if (!chunkText || !String(chunkText).trim()) {
        return NextResponse.json({ ok: true, data: { questions: [] } });
      }
      const isCE = String(style).toLowerCase().includes('certo');
      const subsList = Array.isArray(subjectNames) && subjectNames.length > 0
        ? `Matérias do aluno: ${subjectNames.join(', ')}.`
        : '';

      const prompt = `Extraia TODAS as questões completas encontradas neste trecho de prova (${board}). ${subsList}
Regras:
1. Preserve fielmente o número, o enunciado (incluindo texto-base curto se houver) e todas as alternativas (${isCE ? 'C e E' : 'A-E'}).
2. Em "subject_name", classifique na matéria mais próxima da lista do aluno (ou nome claro da disciplina).
3. Se o gabarito não estiver no trecho, resolva com precisão em "correct_answer" e dê um comentário curto (1-2 frases) em "explanation".
4. Não use aspas duplas sem escape dentro dos textos (use aspas simples '').

TRECHO DA PROVA:
${String(chunkText).slice(0, 7000)}

Retorne SOMENTE JSON válido:
{"questions":[{"number":"1","subject_name":"Língua Portuguesa","statement":"...","options":[{"letter":"A","text":"..."}],"correct_answer":"A","explanation":"..."}]}`;

      let data: unknown = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = await callGemini([{ text: prompt }], true, false, false);
          data = extractJsonObject(raw);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!data) {
        throw (lastErr instanceof Error ? lastErr : new Error('Erro ao extrair bloco da prova.'));
      }
      return NextResponse.json({ ok: true, data });
    }

    if (action === 'search_past_exams') {
      const { query = '' } = body;
      const qClean = String(query || '').trim();
      if (!qClean) {
        return NextResponse.json({ error: 'Digite o concurso, cargo ou banca para buscar.' }, { status: 400 });
      }
      const [pciHits, pdfHits] = await Promise.all([
        searchDeepSeekWeb(`site:pciconcursos.com.br/provas ${qClean}`, false, 8),
        searchDeepSeekWeb(`${qClean} prova anterior concurso filetype:pdf gabarito`, false, 6),
      ]);
      const combined = [pciHits ? `PCI CONCURSOS PROVAS:\n${pciHits}` : '', pdfHits ? `PDFs ENCONTRADOS:\n${pdfHits}` : '']
        .filter(Boolean)
        .join('\n\n');

      if (!combined) {
        return NextResponse.json({ ok: true, data: { exams: [] } });
      }
      const prompt = `Com base nos resultados abaixo, liste até 10 PROVAS ANTERIORES REAIS (evite notícias ou editais previstos; priorize páginas de prova/download de PDF, ordenadas das mais recentes para as mais antigas) para "${qClean}".
Se a URL já terminar em .pdf, coloque-a em "pdf_url" (senão deixe "").

RESULTADOS:
${combined.slice(0, 12000)}

Retorne SOMENTE JSON válido:
{"exams":[{"title":"Nome da Prova (ex: TRT-15 2025 - Técnico Judiciário)","board":"FCC","organ":"TRT-15","year":"2025","url":"https://...","pdf_url":"https://... ou vazio","snippet":"Resumo curto"}]}`;
      const raw = await callGemini([{ text: prompt }], true, false, false);
      const data = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data });
    }

    if (action === 'fetch_exam_pdfs_from_url') {
      const { url = '', pdfUrl = '' } = body;
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
      let targetExamPdf = String(pdfUrl || '').trim();
      let targetGabPdf = '';

      if (!targetExamPdf && url) {
        const cleanUrl = String(url).trim();
        if (cleanUrl.toLowerCase().endsWith('.pdf')) {
          targetExamPdf = cleanUrl;
        } else {
          try {
            const pageRes = await fetch(cleanUrl, {
              headers: { 'User-Agent': ua },
              signal: AbortSignal.timeout(8000),
            });
            if (pageRes.ok) {
              const html = await pageRes.text();
              const links = Array.from(html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)).map((m) => {
                try {
                  return new URL(m[1], cleanUrl).toString();
                } catch {
                  return m[1];
                }
              });
              const gabLink = links.find((l) => /gab|respost/i.test(l));
              const provaLink = links.find((l) => !/gab|respost|edital/i.test(l)) || links[0];
              if (provaLink) targetExamPdf = provaLink;
              if (gabLink) targetGabPdf = gabLink;
            }
          } catch {
            // ignore
          }
        }
      }

      if (!targetExamPdf) {
        return NextResponse.json(
          { ok: false, error: 'Não foi possível localizar o link direto do PDF nessa página.' },
          { status: 404 }
        );
      }

      const fetchPdfB64 = async (u: string): Promise<string> => {
        const r = await fetch(u, {
          headers: { 'User-Agent': ua },
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('pdf') && !u.toLowerCase().includes('.pdf')) {
          throw new Error('Link não retornou um PDF.');
        }
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 12 * 1024 * 1024) {
          throw new Error('PDF muito grande para download automático.');
        }
        return Buffer.from(buf).toString('base64');
      };

      const examBase64 = await fetchPdfB64(targetExamPdf);
      let gabBase64 = '';
      if (targetGabPdf) {
        try {
          gabBase64 = await fetchPdfB64(targetGabPdf);
        } catch {
          gabBase64 = '';
        }
      }

      return NextResponse.json({
        ok: true,
        data: {
          examBase64,
          gabBase64,
          examPdfUrl: targetExamPdf,
          gabPdfUrl: targetGabPdf,
        },
      });
    }

    if (action === 'fetch_board_style') {
      const { board = '', profileName = '', subjectName = '' } = body;
      const q = [board, profileName, subjectName, 'questão comentada concurso'].filter(Boolean).join(' ');
      const hits = await searchDeepSeekWeb(q, false, 4);
      return NextResponse.json({
        ok: true,
        data: { examples: hits ? hits.slice(0, 1400) : '' },
      });
    }

    if (action === 'generate_topic_questions') {
      const {
        subjectName = '',
        topicTitle = '',
        count = 5,
        style = 'Múltipla escolha (A-E)',
        board = '',
        profileName = '',
        boardExamples = '',
      } = body;
      const safeCount = Math.min(10, Math.max(1, Number(count) || 5));
      const isCE = String(style).toLowerCase().includes('certo');
      const boardLabel = board || 'Concurso';
      const organHint = profileName ? ` (${profileName})` : '';
      const topicContext = topicTitle
        ? `tópico(s): "${topicTitle}" | matéria: "${subjectName}"`
        : `matéria: "${subjectName}"`;

      const refBlock = boardExamples
        ? `\nREFERÊNCIA REAL DA WEB (use apenas como inspiração de estilo, tamanho e pegadinhas da banca ${boardLabel}):\n${String(boardExamples).slice(0, 1200)}\n`
        : '';
      const prompt = `Gere ${safeCount} questões inéditas nível REAL de prova da banca ${boardLabel}${organHint}, inspiradas no estilo de cobrança de provas anteriores dessa banca/órgão. ${topicContext}.${refBlock}
Regras:
1. PROIBIDO questão escolar/infantil, conta solta ou definição seca.
2. Use sempre SITUAÇÃO-PROBLEMA, CASO PRÁTICO ou análise aplicada, cobrando exceções legais, súmulas e distratores plausíveis da banca ${boardLabel}.
3. Se houver 2 tópicos citados, faça 1 questão de cada tópico (sem repetir).
4. Formato: ${isCE ? 'Certo/Errado (C e E)' : 'Múltipla escolha (A-E)'}.
5. Comentário direto (1-2 frases citando artigo/súmula/regra) sem repetir o enunciado. Não use aspas duplas nos textos (use aspas simples '').

JSON:
{"questions":[{"header":"${boardLabel} · ${subjectName}","statement":"...","options":${
        isCE
          ? '[{"letter":"C","text":"Certo"},{"letter":"E","text":"Errado"}]'
          : '[{"letter":"A","text":"..."},{"letter":"B","text":"..."},{"letter":"C","text":"..."},{"letter":"D","text":"..."},{"letter":"E","text":"..."}]'
      },"correct_answer":"${isCE ? 'C' : 'A'}","explanation":"..."}]}`;

      let data: unknown = null;
      let lastParseErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = await callGemini([{ text: prompt }], true, false, true);
          data = extractJsonObject(raw);
          break;
        } catch (err) {
          lastParseErr = err;
        }
      }
      if (!data) {
        throw (lastParseErr instanceof Error ? lastParseErr : new Error('Erro ao ler JSON da questão.'));
      }
      return NextResponse.json({ ok: true, data });
    }

    return NextResponse.json({ ok: false, error: 'Ação inválida.' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro interno no servidor Gemini.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
