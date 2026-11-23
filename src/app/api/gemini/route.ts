import { NextResponse } from 'next/server';

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash'];

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
          ? { responseMimeType: 'application/json', temperature: 0.15, maxOutputTokens: 8192 }
          : { temperature: 0.3, maxOutputTokens: 8192 },
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
      const { word, subjectName = '' } = body;
      if (!word || !String(word).trim()) {
        return NextResponse.json({ error: 'Informe uma palavra ou termo.' }, { status: 400 });
      }
      const raw = await callGemini(
        [
          {
            text: `Explique o significado de "${String(word).trim()}"${
              subjectName ? ` no contexto de ${subjectName}` : ''
            } de forma MUITO SIMPLES, curta e direta (no máximo 1 ou 2 frases curtas, nada longo, fácil de memorizar em flashcard).
Retorne SOMENTE um JSON válido neste formato exato:
{
  "meaning": "Significado curto, claro e direto em linguagem simples.",
  "example": "Uma frase curta de exemplo (ou vazio se não precisar)."
}`,
          },
        ],
        true
      );
      const parsed = extractJsonObject(raw);
      return NextResponse.json({ ok: true, data: parsed });
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
