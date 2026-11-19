import { NextResponse } from 'next/server';

const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

async function callGemini(parts: unknown[], jsonMode = false, useSearch = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Chave GEMINI_API_KEY não configurada no servidor. Adicione nas variáveis de ambiente da Vercel.'
    );
  }

  let lastError = 'Erro desconhecido ao chamar o Gemini.';

  for (const model of MODELS) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      generationConfig:
        jsonMode && !useSearch
          ? { responseMimeType: 'application/json', temperature: 0.2 }
          : { temperature: 0.3 },
    };

    if (useSearch) {
      body.tools = [{ googleSearch: {} }];
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      const candidateParts = data?.candidates?.[0]?.content?.parts || [];
      const text = candidateParts.map((p: { text?: string }) => p.text || '').join('\n').trim();
      if (text) return text;
      lastError = 'Resposta vazia do modelo Gemini.';
    } else {
      const errData = await res.json().catch(() => ({}));
      lastError = errData?.error?.message || `HTTP ${res.status} (${model})`;
      if ((res.status === 400 || res.status === 403) && !lastError.toLowerCase().includes('model')) {
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
  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  return JSON.parse(cleaned);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'list_edital_roles') {
      const { pdfBase64, mimeType = 'application/pdf' } = body;
      const parts: unknown[] = [
        {
          text: `Analise este edital de concurso público brasileiro e identifique o órgão e TODOS os cargos disponíveis.
REGRAS RÍGIDAS:
- NUNCA agrupe ou escreva "Diversos Cargos", "Vários Cargos" ou "Todos os cargos".
- Liste CADA cargo individualmente pelo nome exato que aparece no edital (ex: "Agente Legislativo", "Analista Administrativo", "Técnico em Informática").
- Se o edital for de apenas 1 cargo, retorne um array com esse 1 cargo.

Retorne SOMENTE um JSON válido neste formato:
{
  "name": "Nome do concurso / órgão (ex: Câmara Municipal de Governador Valadares - MG)",
  "icon": "Um emoji adequado (ex: 🏛️, ⚖️, 🚔, 🏦)",
  "status_text": "Status resumido (ex: Edital publicado)",
  "exam_date": "YYYY-MM-DD se constar no edital, ou null",
  "roles": ["Cargo 1", "Cargo 2", "Cargo 3"]
}`,
        },
      ];

      if (pdfBase64) {
        parts.push({ inlineData: { mimeType, data: pdfBase64 } });
      }

      const raw = await callGemini(parts, true, false);
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'extract_role_details') {
      const { pdfBase64, mimeType = 'application/pdf', roleTitle, organName } = body;
      const parts: unknown[] = [
        {
          text: `Neste edital de "${organName}", foque EXCLUSIVAMENTE no cargo "${roleTitle}".
Extraia o salário base exato deste cargo, vale-alimentação/auxílios, carga horária semanal, data da prova e TODAS as matérias e tópicos do conteúdo programático que caem especificamente para "${roleTitle}" (Conhecimentos Gerais/Básicos + Conhecimentos Específicos deste cargo).
Não invente valores que não estejam no PDF — deixe "" se não encontrar.

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
      "topics": ["Tópico 1 limpo", "Tópico 2 limpo"]
    }
  ]
}`,
        },
      ];

      if (pdfBase64) {
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
      );
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
    }

    if (action === 'enrich_edital') {
      const { organName, roleTitle } = body;
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
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
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

      const raw = await callGemini(parts, true);
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
      );

      return NextResponse.json({ ok: true, data: { markdown: text } });
    }

    return NextResponse.json({ ok: false, error: 'Ação inválida.' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro interno no servidor Gemini.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
