'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { useGlobal } from '@/components/GlobalProvider';
import { DictionaryText } from '@/components/DictionaryText';
import { ExplainForChildButton } from '@/components/ExplainForChildButton';
import { useAiProviderName } from '@/lib/useAiProvider';
import { extractPdfTextInBrowser } from '@/lib/pdfBrowser';
import { getStudyMode } from '@/lib/studyModes';
import { calcAccuracy, formatDateBR, formatDurationHMS, todayISO } from '@/lib/utils';
import type { SimuladoSubjectScore } from '@/lib/types';
import {
  Plus,
  Trash2,
  ClipboardCheck,
  X,
  Sparkles,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  Flag,
  Clock,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  FileUp,
  RotateCw,
  Search,
} from 'lucide-react';

interface SimOption {
  letter: string;
  text: string;
}

interface SimQuestion {
  id: string;
  subject_id: string;
  subject_name: string;
  topic_id: string | null;
  topic_title?: string;
  header?: string;
  statement: string;
  options: SimOption[];
  correct_answer: string;
  explanation?: string;
}

interface GeneratedSimulado {
  id: string;
  title: string;
  board: string;
  style: 'multipla' | 'certo_errado';
  kind?: 'simulado' | 'prova_real' | 'prova_anterior';
  created_at: string;
  weights?: Record<string, number>;
  questions: SimQuestion[];
  saved_progress?: {
    answers: Record<string, string>;
    flagged: Record<string, boolean>;
    elapsed_sec: number;
    idx: number;
    saved_at: string;
  };
  last_score?: {
    correct: number;
    total: number;
    duration_sec: number;
    finished_at: string;
  };
}

const PRESET_BOARDS = [
  'FCC',
  'FGV',
  'Cebraspe (Cespe)',
  'Cesgranrio',
  'Vunesp',
];

function splitStatementForDisplay(raw: string): {
  intro?: string;
  passage?: string;
  question: string;
} {
  let txt = (raw || '').trim();
  if (!txt) return { question: '' };

  // Quebra itens romanos (I., II., III.) em novas linhas para leitura agradável
  txt = txt.replace(/\s+(?=(?:I|II|III|IV|V)[.)\-]\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/g, '\n');

  // Detecta padrão de texto-base ("Atenção: Considere o texto..." / "Texto para as questões...")
  const introRe = /^((?:Aten[çc][ãa]o:\s*)?(?:Considere|Leia|Texto\s+base|Com\s+base\s+no\s+texto)[\s\S]{10,130}?(?:quest[õo]es\s+de\s+n[úu]meros?\s+\d+\s+a\s+\d+\.?|a\s+seguir\.?:|abaixo\.?:))\s*([\s\S]+)$/i;
  const introMatch = txt.match(introRe);
  if (introMatch) {
    const intro = introMatch[1].trim();
    const rest = introMatch[2].trim();
    // Tenta separar o texto-base (geralmente termina com referência bibliográfica "(AUTOR...)" ou antes da pergunta final)
    const citMatch = rest.match(/^([\s\S]+?\([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^)]{8,120}\))\s+([\s\S]+)$/);
    if (citMatch) {
      return {
        intro,
        passage: citMatch[1].trim(),
        question: citMatch[2].trim(),
      };
    }
    const qStartMatch = rest.match(/^([\s\S]{120,}?)\s+((?:O\s+texto|No\s+texto|De\s+acordo|Segundo|Assinale|Considerando|A\s+respeito|Em\s+rela[çc][ãa]o|Infere-se|Depreende-se)[\s\S]+)$/i);
    if (qStartMatch) {
      return {
        intro,
        passage: qStartMatch[1].trim(),
        question: qStartMatch[2].trim(),
      };
    }
    return { intro, question: rest };
  }

  return { question: txt };
}

export default function SimuladosPage() {
  const {
    profile,
    subjects,
    topics,
    errors,
    simulados,
    addSimulado,
    deleteSimulado,
    addErrorEntry,
    addStudyLog,
  } = useProfile();
  const { notify, aiJobs, runAiJob, updateAiJobProgress } = useGlobal();
  const aiName = useAiProviderName();
  const studyMode = getStudyMode(profile);

  // Registro manual
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [board, setBoard] = useState('FCC / FGV');
  const [examDate, setExamDate] = useState(todayISO());
  const [totalQ, setTotalQ] = useState('60');
  const [correctQ, setCorrectQ] = useState('42');
  const [durationMin, setDurationMin] = useState('240');
  const [notes, setNotes] = useState('');
  const [subjectScores, setSubjectScores] = useState<
    Record<string, { total: string; correct: string; weight: string }>
  >({});

  // Simulados Gerados por IA
  const genStorageKey = `sf_generated_simulados_${profile?.id || 'default'}`;
  const [generatedList, setGeneratedList] = useState<GeneratedSimulado[]>([]);
  const [showGenModal, setShowGenModal] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [examPdfFile, setExamPdfFile] = useState<File | null>(null);
  const [gabaritoPdfFile, setGabaritoPdfFile] = useState<File | null>(null);
  const [examDraftChoice, setExamDraftChoice] = useState<string>('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchingExams, setSearchingExams] = useState(false);
  const [searchedExams, setSearchedExams] = useState<
    Array<{ title: string; board?: string; organ?: string; year?: string; url?: string; pdf_url?: string; snippet?: string }>
  >([]);
  const [genTitle, setGenTitle] = useState('');
  const [genBoard, setGenBoard] = useState('FCC');
  const [genStyle, setGenStyle] = useState<'multipla' | 'certo_errado'>('multipla');
  const [genMode, setGenMode] = useState<'rapido' | 'prova_real'>('rapido');
  const [genTotalCount, setGenTotalCount] = useState<number>(15);
  const [genSubjectCounts, setGenSubjectCounts] = useState<Record<string, number>>({});
  const [genSubjectWeights, setGenSubjectWeights] = useState<Record<string, number>>({});
  const [genSubjectIds, setGenSubjectIds] = useState<string[]>([]);
  const simJobId = `simulados:${profile?.id || 'default'}`;
  const simJob = aiJobs[simJobId];
  const generating = simJob?.status === 'running';
  const [genProgressText, setGenProgressText] = useState('');
  const [genProgressPct, setGenProgressPct] = useState(0);
  const cancelGenRef = useRef(false);

  // Runner de Prova Interativa
  const [activeSim, setActiveSim] = useState<GeneratedSimulado | null>(null);
  const [examIdx, setExamIdx] = useState(0);
  const [examAnswers, setExamAnswers] = useState<Record<string, string>>({});
  const [examFlagged, setExamFlagged] = useState<Record<string, boolean>>({});
  const [examFinished, setExamFinished] = useState(false);
  const [examElapsedSec, setExamElapsedSec] = useState(0);
  const [savingResult, setSavingResult] = useState(false);
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [showTopicSpoiler, setShowTopicSpoiler] = useState(false);
  const [showExamGrid, setShowExamGrid] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(genStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setGeneratedList(parsed);
      } else {
        setGeneratedList([]);
      }
    } catch {
      setGeneratedList([]);
    }
    const reload = () => {
      try {
        const raw = localStorage.getItem(genStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setGeneratedList(parsed);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('sf-simulados-updated', reload);
    return () => window.removeEventListener('sf-simulados-updated', reload);
  }, [genStorageKey]);

  useEffect(() => {
    if (subjects.length > 0 && genSubjectIds.length === 0) {
      setGenSubjectIds(subjects.map((s) => s.id));
    }
  }, [subjects, genSubjectIds.length]);

  useEffect(() => {
    if (!activeSim || examFinished) return;
    const t = window.setInterval(() => {
      setExamElapsedSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, [activeSim, examFinished]);

  function saveGeneratedList(next: GeneratedSimulado[]) {
    setGeneratedList(next);
    try {
      localStorage.setItem(genStorageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const breakdown: SimuladoSubjectScore[] = subjects
      .map((s) => {
        const entry = subjectScores[s.id];
        const t = Number(entry?.total || 0);
        const c = Math.min(t, Number(entry?.correct || 0));
        const w = Math.max(0.1, Number(entry?.weight || 1));
        return { subject_id: s.id, subject_name: s.name, total: t, correct: c, weight: w };
      })
      .filter((x) => x.total > 0);

    const computedTotal =
      breakdown.length > 0
        ? breakdown.reduce((a, b) => a + b.total, 0)
        : Number(totalQ) || 60;
    const computedCorrect =
      breakdown.length > 0
        ? breakdown.reduce((a, b) => a + b.correct, 0)
        : Math.min(computedTotal, Number(correctQ) || 0);

    await addSimulado({
      title: title.trim(),
      board,
      exam_date: examDate,
      total_questions: computedTotal,
      correct_answers: computedCorrect,
      duration_minutes: Number(durationMin) || 240,
      notes,
      subject_scores: breakdown,
    });
    setTitle('');
    setNotes('');
    setSubjectScores({});
    setShowAdd(false);
  }

  function computeDefaultWeights(activeSubs: typeof subjects): Record<string, number> {
    const wMap: Record<string, number> = {};
    activeSubs.forEach((s) => {
      const isSpec = (s.category || '').toLowerCase().includes('espec');
      wMap[s.id] = isSpec ? 2 : 1;
    });
    return wMap;
  }

  function distributeBucket(subs: typeof subjects, bucketTotal: number): Record<string, number> {
    const map: Record<string, number> = {};
    if (subs.length === 0 || bucketTotal <= 0) return map;
    const base = Math.floor(bucketTotal / subs.length);
    const rem = bucketTotal % subs.length;
    subs.forEach((s, i) => {
      map[s.id] = base + (i < rem ? 1 : 0);
    });
    return map;
  }

  function computeRealisticExamCounts(targetTotal: number, activeSubs: typeof subjects): Record<string, number> {
    if (activeSubs.length === 0) return {};
    const gerais = activeSubs.filter((s) => !(s.category || '').toLowerCase().includes('espec'));
    const espec = activeSubs.filter((s) => (s.category || '').toLowerCase().includes('espec'));
    if (gerais.length > 0 && espec.length > 0) {
      const gTotal = Math.round(targetTotal / 2);
      const eTotal = targetTotal - gTotal;
      return {
        ...distributeBucket(gerais, gTotal),
        ...distributeBucket(espec, eTotal),
      };
    }
    return distributeBucket(activeSubs, targetTotal);
  }

  function applyProvaRealPreset(boardName: string) {
    const isCebraspe = boardName.toLowerCase().includes('cebraspe') || boardName.toLowerCase().includes('cespe');
    let target = isCebraspe ? 120 : 60;
    const allIds = subjects.map((s) => s.id);

    let editalMeta: Record<string, { weight?: number; exam_questions?: number | null }> = {};
    try {
      const rawMeta = localStorage.getItem(`sf_subject_exam_meta_${profile?.id || 'default'}`);
      if (rawMeta) editalMeta = JSON.parse(rawMeta) || {};
    } catch {
      editalMeta = {};
    }

    const weights = computeDefaultWeights(subjects);
    let hasEditalCounts = true;
    const editalCounts: Record<string, number> = {};
    let editalSum = 0;

    subjects.forEach((s) => {
      const meta = editalMeta[s.id];
      if (meta?.weight && meta.weight > 0) weights[s.id] = meta.weight;
      if (meta?.exam_questions && meta.exam_questions > 0) {
        editalCounts[s.id] = meta.exam_questions;
        editalSum += meta.exam_questions;
      } else {
        hasEditalCounts = false;
      }
    });

    const finalCounts =
      hasEditalCounts && editalSum > 0
        ? editalCounts
        : computeRealisticExamCounts(target, subjects);
    if (hasEditalCounts && editalSum > 0) target = editalSum;

    setGenMode('prova_real');
    setGenStyle(isCebraspe ? 'certo_errado' : 'multipla');
    setGenTotalCount(target);
    setGenSubjectIds(allIds);
    setGenSubjectCounts(finalCounts);
    setGenSubjectWeights(weights);
  }

  function handleGenerateSimulado(e: React.FormEvent) {
    e.preventDefault();
    if (!profile?.id) return;
    const chosenSubs = subjects.filter((s) => genSubjectIds.includes(s.id));
    if (chosenSubs.length === 0) {
      notify('Selecione pelo menos uma matéria para o simulado.', 'error');
      return;
    }

    const boardSnap = genBoard.trim() || 'Padrão Concurso';
    const styleSnap = genStyle;
    const storageKeySnap = genStorageKey;
    const topicsSnap = topics;
    const weightsSnap = genMode === 'prova_real' ? { ...genSubjectWeights } : computeDefaultWeights(chosenSubs);

    const orderedChosenSubs = [...chosenSubs].sort((a, b) => {
      const aSpec = (a.category || '').toLowerCase().includes('espec') ? 1 : 0;
      const bSpec = (b.category || '').toLowerCase().includes('espec') ? 1 : 0;
      if (aSpec !== bSpec) return aSpec - bSpec;
      return (a.cycle_order ?? 0) - (b.cycle_order ?? 0);
    });

    const plan =
      genMode === 'prova_real'
        ? orderedChosenSubs
            .map((sub) => ({
              subject: sub,
              count: Math.max(0, Number(genSubjectCounts[sub.id] ?? 0)),
            }))
            .filter((p) => p.count > 0)
        : (() => {
            const basePerSub = Math.floor(genTotalCount / orderedChosenSubs.length);
            const remainder = genTotalCount % orderedChosenSubs.length;
            return orderedChosenSubs
              .map((sub, idx) => ({
                subject: sub,
                count: basePerSub + (idx < remainder ? 1 : 0),
              }))
              .filter((p) => p.count > 0);
          })();

    const totalSnap = plan.reduce((acc, p) => acc + p.count, 0);
    if (totalSnap === 0) {
      notify('Defina pelo menos 1 questão para gerar o simulado.', 'error');
      return;
    }

    const kindSnap: 'simulado' | 'prova_real' = genMode === 'prova_real' ? 'prova_real' : 'simulado';
    const titleSnap =
      genTitle.trim() ||
      `${genMode === 'prova_real' ? 'Prova Real' : 'Simulado'} ${boardSnap} · ${
        profile.name || 'Concurso'
      }`;

    setShowGenModal(false);
    setGenTitle('');

    const fetchSimBatch = async (
      sub: typeof chosenSubs[number],
      topicTitle: string,
      topicId: string | null,
      qty: number,
      boardExamples = ''
    ): Promise<SimQuestion[]> => {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_topic_questions',
          subjectName: sub.name,
          topicTitle,
          count: qty,
          style: styleSnap,
          board: boardSnap,
          profileName: profile?.name || '',
          boardExamples,
        }),
      });
      const rawResp = await res.text();
      let json: { ok?: boolean; error?: string; data?: { questions?: unknown[] } } = {};
      try {
        json = JSON.parse(rawResp);
      } catch {
        throw new Error(`Tempo esgotado no lote de ${sub.name}.`);
      }
      if (!res.ok || !json.ok || !Array.isArray(json.data?.questions)) {
        throw new Error(json.error || `Falha ao gerar questões de ${sub.name}.`);
      }
      const nowTs = Date.now();
      return json.data.questions
        .map((rawQ, idx) => {
          const q = rawQ as {
            header?: string;
            statement?: string;
            options?: SimOption[];
            correct_answer?: string;
            explanation?: string;
          };
          if (!q?.statement) return null;
          return {
            id: `simq-${nowTs}-${Math.random().toString(36).slice(2, 6)}-${idx}`,
            subject_id: sub.id,
            subject_name: sub.name,
            topic_id: topicId,
            topic_title: topicTitle || undefined,
            header: q.header || `${boardSnap} · ${sub.name}`,
            statement: q.statement,
            options: Array.isArray(q.options) ? q.options : [],
            correct_answer: String(q.correct_answer || '').trim().toUpperCase(),
            explanation: q.explanation || '',
          } as SimQuestion;
        })
        .filter((x): x is SimQuestion => Boolean(x));
    };

    runAiJob({
      id: simJobId,
      kind: 'quiz',
      label: `Gerando Simulado ${boardSnap} (${totalSnap}q)`,
      route: `/p/${profile.id}/simulados`,
      successMsg: `Simulado "${titleSnap}" pronto!`,
      task: async () => {
        let boardExamples = '';
        try {
          updateAiJobProgress(simJobId, 3, `Pesquisando estilo real da banca ${boardSnap}...`);
          const stRes = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'fetch_board_style',
              board: boardSnap,
              profileName: profile?.name || '',
              subjectName: plan[0]?.subject.name || '',
            }),
          });
          const stJson = await stRes.json();
          if (stRes.ok && stJson.ok && stJson.data?.examples) {
            boardExamples = String(stJson.data.examples);
          }
        } catch {
          // ignore
        }

        const collected: SimQuestion[] = [];
        try {
          interface SimTask {
            subject: typeof chosenSubs[number];
            topicTitle: string;
            topicId: string | null;
            qty: number;
          }
          const tasks: SimTask[] = [];
          for (const item of plan) {
            // Embaralha todos os tópicos da matéria sem repetição até esgotar
            const shuffled = [...topicsSnap.filter((t) => t.subject_id === item.subject.id)];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            let rem = item.count;
            let topicCursor = 0;
            while (rem > 0) {
              const batchCount = Math.min(2, rem);
              const t1 = shuffled.length > 0 ? shuffled[topicCursor % shuffled.length] : null;
              const t2 =
                batchCount === 2 && shuffled.length > 1
                  ? shuffled[(topicCursor + 1) % shuffled.length]
                  : null;
              const combinedTopicTitle =
                t1 && t2 && t1.id !== t2.id
                  ? `${t1.title} (questão 1) e ${t2.title} (questão 2)`
                  : t1?.title || '';
              tasks.push({
                subject: item.subject,
                topicTitle: combinedTopicTitle,
                topicId: t1?.id || null,
                qty: batchCount,
              });
              topicCursor += batchCount;
              rem -= batchCount;
            }
          }

          let cursor = 0;
          const workerCount = Math.min(4, tasks.length);
          const workers = Array.from({ length: workerCount }, async () => {
            while (cursor < tasks.length) {
              const t = tasks[cursor++];
              try {
                const batchItems = await fetchSimBatch(
                  t.subject,
                  t.topicTitle,
                  t.topicId,
                  t.qty,
                  boardExamples
                );
                collected.push(...batchItems);
              } catch {
                if (t.qty > 1) {
                  for (let k = 0; k < t.qty; k++) {
                    const single = await fetchSimBatch(
                      t.subject,
                      t.topicTitle,
                      t.topicId,
                      1,
                      boardExamples
                    );
                    collected.push(...single);
                  }
                } else {
                  throw new Error(`Tempo esgotado no lote de ${t.subject.name}.`);
                }
              }
              const nextPct = Math.min(100, Math.round((collected.length / totalSnap) * 100));
              updateAiJobProgress(
                simJobId,
                nextPct,
                `${t.subject.name}: ${collected.length}/${totalSnap} questões (${nextPct}%)`
              );
            }
          });
          await Promise.all(workers);
        } finally {
          if (collected.length > 0) {
            const orderMap = new Map<string, number>();
            plan.forEach((p, idx) => orderMap.set(p.subject.id, idx));
            collected.sort((a, b) => (orderMap.get(a.subject_id) ?? 999) - (orderMap.get(b.subject_id) ?? 999));
            const isPartial = collected.length < totalSnap;
            const newSim: GeneratedSimulado = {
              id: `gensim-${Date.now()}`,
              title: isPartial ? `${titleSnap} (${collected.length}q)` : titleSnap,
              board: boardSnap,
              style: styleSnap,
              kind: kindSnap,
              created_at: new Date().toISOString(),
              weights: weightsSnap,
              questions: collected,
            };

            try {
              const rawExisting = localStorage.getItem(storageKeySnap);
              const prevArr = rawExisting ? JSON.parse(rawExisting) : [];
              const nextArr = [newSim, ...(Array.isArray(prevArr) ? prevArr : [])];
              localStorage.setItem(storageKeySnap, JSON.stringify(nextArr));
              window.dispatchEvent(new CustomEvent('sf-simulados-updated'));
            } catch {
              // ignore
            }
          }
        }

        if (collected.length === 0) throw new Error('Nenhuma questão foi gerada.');
      },
    });
  }

  function matchSubjectId(rawSubjectName: string): { id: string; name: string } {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    const target = norm(rawSubjectName || '');
    if (target && subjects.length > 0) {
      const exact = subjects.find((s) => norm(s.name) === target);
      if (exact) return { id: exact.id, name: exact.name };
      const partial = subjects.find(
        (s) => norm(s.name).includes(target) || target.includes(norm(s.name))
      );
      if (partial) return { id: partial.id, name: partial.name };
      // Match por palavras-chave relevantes
      const words = target.split(/\s+/).filter((w) => w.length >= 4);
      let bestSub = subjects[0];
      let bestHits = 0;
      for (const s of subjects) {
        const sn = norm(s.name);
        const hits = words.filter((w) => sn.includes(w)).length;
        if (hits > bestHits) {
          bestHits = hits;
          bestSub = s;
        }
      }
      if (bestHits > 0) return { id: bestSub.id, name: bestSub.name };
    }
    return subjects[0]
      ? { id: subjects[0].id, name: subjects[0].name }
      : { id: 'geral', name: rawSubjectName || 'Geral' };
  }

  function splitExamTextChunks(text: string, maxChars = 5500): string[] {
    const blocks = text.split(/(?=\n\s*(?:Quest[ãa]o\s+)?\d{1,3}[.)\-\s])/i);
    const chunks: string[] = [];
    let cur = '';
    for (const blk of blocks) {
      if ((cur + '\n' + blk).length > maxChars && cur.trim()) {
        chunks.push(cur.trim());
        cur = blk;
      } else {
        cur = cur ? `${cur}\n${blk}` : blk;
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
  }

  function base64ToPdfFile(b64: string, filename: string): File {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], filename, { type: 'application/pdf' });
  }

  async function handleAutoImportSearchedExam(ex: {
    title: string;
    url?: string;
    pdf_url?: string;
  }) {
    if (!ex.url && !ex.pdf_url) return;
    setSearchingExams(true);
    try {
      notify(`Procurando PDF oficial de "${ex.title}"...`, 'info');
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fetch_exam_pdfs_from_url',
          url: ex.url || '',
          pdfUrl: ex.pdf_url || '',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data?.examBase64) {
        throw new Error(json.error || 'O site bloqueou o download automático.');
      }
      const safeName = `${ex.title.replace(/[^a-zA-Z0-9\s-]/g, '').slice(0, 40) || 'prova'}.pdf`;
      const examFile = base64ToPdfFile(String(json.data.examBase64), safeName);
      const gabFile = json.data.gabBase64
        ? base64ToPdfFile(String(json.data.gabBase64), `gabarito-${safeName}`)
        : null;
      setShowSearchModal(false);
      processExamPdfFiles(examFile, gabFile);
    } catch (err) {
      notify(
        `${err instanceof Error ? err.message : 'Download bloqueado.'} Abrindo o link para você baixar o PDF.`,
        'info'
      );
      if (ex.pdf_url || ex.url) {
        window.open(ex.pdf_url || ex.url, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setSearchingExams(false);
    }
  }

  function handleImportExamPdf(e: React.FormEvent) {
    e.preventDefault();
    if (!examPdfFile) return;
    const examFileSnap = examPdfFile;
    const gabFileSnap = gabaritoPdfFile;
    setShowPdfModal(false);
    setExamPdfFile(null);
    setGabaritoPdfFile(null);
    processExamPdfFiles(examFileSnap, gabFileSnap);
  }

  function processExamPdfFiles(examFileSnap: File, gabFileSnap: File | null) {
    if (!profile?.id) return;
    const storageKeySnap = genStorageKey;
    const subjectNamesSnap = subjects.map((s) => s.name);

    runAiJob({
      id: simJobId,
      kind: 'quiz',
      label: `Importando prova: ${examFileSnap.name}`,
      route: `/p/${profile.id}/simulados`,
      successMsg: `Prova "${examFileSnap.name}" importada e pronta para resolver!`,
      task: async () => {
        updateAiJobProgress(simJobId, 5, 'Lendo páginas do PDF da prova...');
        const examText = await extractPdfTextInBrowser(
          examFileSnap,
          (p, total) => {
            const pct = Math.min(25, Math.round((p / Math.max(1, total)) * 25));
            updateAiJobProgress(simJobId, pct, `Lendo PDF (${p}/${total} páginas)...`);
          },
          false
        );

        if (!examText.trim()) {
          throw new Error('Não foi possível extrair texto desse PDF (pode ser imagem escaneada).');
        }

        let gabaritoText = '';
        if (gabFileSnap) {
          updateAiJobProgress(simJobId, 28, 'Lendo PDF do gabarito...');
          gabaritoText = await extractPdfTextInBrowser(gabFileSnap, undefined, false);
        }

        updateAiJobProgress(
          simJobId,
          32,
          gabFileSnap
            ? 'Identificando banca e lendo gabarito...'
            : 'Identificando banca e buscando gabarito oficial online...'
        );

        const idRes = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'identify_exam_pdf',
            sampleText: examText.slice(0, 4500),
            gabaritoText,
          }),
        });
        const idJson = await idRes.json();
        if (!idRes.ok || !idJson.ok) {
          throw new Error(idJson.error || 'Erro ao identificar a prova.');
        }
        const meta = idJson.data as {
          exam_title?: string;
          board?: string;
          style?: string;
          gabarito_map?: Record<string, string>;
          gabarito_found?: boolean;
          gabarito_source_url?: string;
        };

        const boardSnap = meta.board || 'Concurso';
        const styleSnap: 'multipla' | 'certo_errado' =
          String(meta.style || '').toLowerCase().includes('certo') ? 'certo_errado' : 'multipla';
        const gabMap = meta.gabarito_map || {};

        const chunks = splitExamTextChunks(examText, 5500);
        const rawQuestions: Array<{
          number?: string;
          subject_name?: string;
          statement?: string;
          options?: SimOption[];
          correct_answer?: string;
          explanation?: string;
        }> = [];

        let doneChunks = 0;
        let cursor = 0;
        const workers = Array.from({ length: Math.min(3, chunks.length) }, async () => {
          while (cursor < chunks.length) {
            const idx = cursor++;
            const chunkText = chunks[idx];
            const res = await fetch('/api/gemini', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'parse_exam_questions_chunk',
                chunkText,
                board: boardSnap,
                style: styleSnap,
                subjectNames: subjectNamesSnap,
              }),
            });
            const rawResp = await res.text();
            let json: { ok?: boolean; data?: { questions?: typeof rawQuestions } } = {};
            try {
              json = JSON.parse(rawResp);
            } catch {
              // skip malformed chunk response
            }
            if (res.ok && json.ok && Array.isArray(json.data?.questions)) {
              rawQuestions.push(...json.data.questions);
            }
            doneChunks++;
            const pct = 35 + Math.round((doneChunks / chunks.length) * 60);
            updateAiJobProgress(
              simJobId,
              pct,
              `${boardSnap}: extraindo questões (${rawQuestions.length} encontradas)...`
            );
          }
        });
        await Promise.all(workers);

        if (rawQuestions.length === 0) {
          throw new Error('Nenhuma questão estruturada foi identificada no PDF.');
        }

        // Ordena pelo número da questão e aplica gabarito oficial (online/PDF) quando encontrado
        rawQuestions.sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));

        const nowTs = Date.now();
        const finalQuestions: SimQuestion[] = rawQuestions
          .filter((q) => q?.statement && Array.isArray(q.options) && q.options.length > 0)
          .map((q, idx) => {
            const qNum = String(q.number || idx + 1).replace(/\D/g, '') || String(idx + 1);
            const matchedSub = matchSubjectId(q.subject_name || '');
            const officialGab = (gabMap[qNum] || '').trim().toUpperCase();
            const finalAns =
              officialGab && officialGab !== 'ANULADA'
                ? officialGab
                : String(q.correct_answer || '').trim().toUpperCase();
            return {
              id: `simpdf-${nowTs}-${idx}`,
              subject_id: matchedSub.id,
              subject_name: matchedSub.name,
              topic_id: null,
              header: `${boardSnap}${meta.exam_title ? ` · ${meta.exam_title}` : ''} · Q${qNum}`,
              statement: String(q.statement || '').trim(),
              options: q.options || [],
              correct_answer: finalAns,
              explanation: [
                officialGab ? `Gabarito oficial: ${officialGab}` : '',
                q.explanation || '',
              ]
                .filter(Boolean)
                .join(' — '),
            };
          });

        const newSim: GeneratedSimulado = {
          id: `gensim-pdf-${Date.now()}`,
          title: meta.exam_title || examFileSnap.name.replace(/\.pdf$/i, ''),
          board: boardSnap,
          style: styleSnap,
          kind: 'prova_anterior',
          created_at: new Date().toISOString(),
          weights: computeDefaultWeights(subjects),
          questions: finalQuestions,
        };

        try {
          const rawExisting = localStorage.getItem(storageKeySnap);
          const prevArr = rawExisting ? JSON.parse(rawExisting) : [];
          const nextArr = [newSim, ...(Array.isArray(prevArr) ? prevArr : [])];
          localStorage.setItem(storageKeySnap, JSON.stringify(nextArr));
          window.dispatchEvent(new CustomEvent('sf-simulados-updated'));
        } catch {
          // ignore
        }

        if (meta.gabarito_found) {
          notify(
            `Prova importada (${finalQuestions.length}q) com gabarito oficial localizado${
              meta.gabarito_source_url ? ' online' : ' no PDF'
            }!`,
            'success'
          );
        } else {
          notify(
            `Prova importada (${finalQuestions.length}q)! Gabarito oficial não encontrado online — ${aiName} preencheu as respostas comentadas.`,
            'info'
          );
        }
      },
    });
  }

  async function handleSearchPastExams(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchingExams(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search_past_exams', query: searchQuery.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao buscar provas.');
      const list = Array.isArray(json.data?.exams) ? json.data.exams : [];
      setSearchedExams(list);
      if (list.length === 0) notify('Nenhuma prova encontrada para essa busca.', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro na busca de provas.', 'error');
    } finally {
      setSearchingExams(false);
    }
  }

  function startExamRunner(sim: GeneratedSimulado, restartFresh = false) {
    setActiveSim(sim);
    setShowClosePrompt(false);
    setShowTopicSpoiler(false);
    setShowExamGrid(false);
    setExamFinished(false);
    if (!restartFresh && sim.saved_progress) {
      setExamAnswers(sim.saved_progress.answers || {});
      setExamFlagged(sim.saved_progress.flagged || {});
      setExamElapsedSec(sim.saved_progress.elapsed_sec || 0);
      setExamIdx(
        Math.min(
          Math.max(0, sim.saved_progress.idx || 0),
          Math.max(0, sim.questions.length - 1)
        )
      );
    } else {
      setExamIdx(0);
      setExamAnswers({});
      setExamFlagged({});
      setExamElapsedSec(0);
    }
  }

  function handlePauseAndSaveExam() {
    if (!activeSim) return;
    const updated = generatedList.map((g) =>
      g.id === activeSim.id
        ? {
            ...g,
            saved_progress: {
              answers: examAnswers,
              flagged: examFlagged,
              elapsed_sec: examElapsedSec,
              idx: examIdx,
              saved_at: new Date().toISOString(),
            },
          }
        : g
    );
    saveGeneratedList(updated);
    setShowClosePrompt(false);
    setActiveSim(null);
    notify('Cronômetro pausado e progresso do simulado salvo!', 'info');
  }

  function handleDiscardExamProgress() {
    if (!activeSim) return;
    const updated = generatedList.map((g) =>
      g.id === activeSim.id ? { ...g, saved_progress: undefined } : g
    );
    saveGeneratedList(updated);
    setShowClosePrompt(false);
    setActiveSim(null);
    notify('Simulado encerrado sem salvar andamento.', 'info');
  }

  async function handleFinishExam() {
    if (!activeSim || savingResult) return;
    setSavingResult(true);

    try {
      const bySub = new Map<string, { subject_name: string; total: number; correct: number }>();
      let totalCorrect = 0;

      for (const q of activeSim.questions) {
        const picked = (examAnswers[q.id] || '').trim().toUpperCase();
        const right = (q.correct_answer || '').trim().toUpperCase();
        const isHit = Boolean(picked && right && picked === right);
        if (isHit) totalCorrect++;

        const cur = bySub.get(q.subject_id) || {
          subject_name: q.subject_name,
          total: 0,
          correct: 0,
        };
        cur.total += 1;
        if (isHit) cur.correct += 1;
        bySub.set(q.subject_id, cur);

        // Envia erradas (com resposta marcada errada) para o Caderno de Erros
        if (picked && right && !isHit) {
          const normStmt = q.statement.trim().slice(0, 80).toLowerCase();
          const alreadyInErrors = errors.some((er) =>
            er.question_text.toLowerCase().includes(normStmt)
          );
          if (!alreadyInErrors) {
            const payload = JSON.stringify({
              header: q.header || activeSim.title,
              statement: q.statement,
              options: q.options,
            });
            await addErrorEntry({
              subject_id: q.subject_id,
              topic_id: q.topic_id || null,
              question_text: `<!--SF_Q_JSON:${payload}-->\n${q.statement}`,
              image_path: null,
              user_answer: picked,
              correct_answer: right,
              error_cause: 'Erro em Simulado',
              explanation: q.explanation || '',
              golden_rule: '',
              review_count: 0,
              last_reviewed_at: null,
              next_review_date: todayISO(),
            });
          }
        }
      }

      const breakdown: SimuladoSubjectScore[] = Array.from(bySub.entries()).map(
        ([subject_id, v]) => ({
          subject_id,
          subject_name: v.subject_name,
          total: v.total,
          correct: v.correct,
          weight: Number(activeSim.weights?.[subject_id] ?? 1) || 1,
        })
      );

      const durationMinutes = Math.max(1, Math.round(examElapsedSec / 60));

      // 1. Registra resultado oficial na aba Simulados
      await addSimulado({
        title: activeSim.title,
        board: activeSim.board,
        exam_date: todayISO(),
        total_questions: activeSim.questions.length,
        correct_answers: totalCorrect,
        duration_minutes: durationMinutes,
        notes: `Simulado interativo (${aiName}) · ${formatDurationHMS(examElapsedSec)}`,
        subject_scores: breakdown,
      });

      // 2. Registra no histórico (Evolução & Mapa de Acertos)
      for (const sc of breakdown) {
        await addStudyLog({
          subject_id: sc.subject_id,
          topic_id: null,
          duration_seconds: Math.max(60, Math.round(examElapsedSec / Math.max(1, breakdown.length))),
          study_date: todayISO(),
          period: 'Simulado',
          questions_total: sc.total,
          questions_correct: sc.correct,
          method: `Simulado (${activeSim.board})`,
          stop_point: activeSim.title,
          notes: activeSim.title,
        });
      }

      // 3. Salva questões no Banco de Questões sem duplicar
      try {
        const bankKey = `sf_question_bank_${profile?.id || 'default'}`;
        const rawBank = localStorage.getItem(bankKey);
        const arr = rawBank ? JSON.parse(rawBank) : [];
        const list = Array.isArray(arr) ? arr : [];
        const existingStmts = new Set(
          list.map((it: { statement?: string }) =>
            String(it.statement || '').trim().slice(0, 80).toLowerCase()
          )
        );
        const toAdd = activeSim.questions
          .filter((q) => !existingStmts.has(q.statement.trim().slice(0, 80).toLowerCase()))
          .map((q) => ({
            id: q.id,
            subject_id: q.subject_id,
            topic_id: q.topic_id || null,
            header: q.header || activeSim.title,
            statement: q.statement,
            options: q.options,
            correct_answer: q.correct_answer,
            explanation: q.explanation || '',
            created_at: new Date().toISOString(),
          }));
        if (toAdd.length > 0) {
          localStorage.setItem(bankKey, JSON.stringify([...toAdd, ...list]));
        }
      } catch {
        // ignore
      }

      // 4. Atualiza último placar no card do simulado gerado
      const updated = generatedList.map((g) =>
        g.id === activeSim.id
          ? {
              ...g,
              saved_progress: undefined,
              last_score: {
                correct: totalCorrect,
                total: activeSim.questions.length,
                duration_sec: examElapsedSec,
                finished_at: new Date().toISOString(),
              },
            }
          : g
      );
      saveGeneratedList(updated);

      setExamFinished(true);
      notify(
        `Simulado corrigido: ${totalCorrect}/${activeSim.questions.length} acertos! Salvo em Simulados, Evolução e Banco de Questões.`,
        'success'
      );
    } finally {
      setSavingResult(false);
    }
  }

  const currentExamQ = activeSim ? activeSim.questions[examIdx] : undefined;

  useEffect(() => {
    if (currentExamQ) {
      setExamDraftChoice(examAnswers[currentExamQ.id] || '');
    } else {
      setExamDraftChoice('');
    }
  }, [currentExamQ, examAnswers]);
  const examAnsweredCount = useMemo(() => {
    if (!activeSim) return 0;
    return activeSim.questions.filter((q) => Boolean(examAnswers[q.id])).length;
  }, [activeSim, examAnswers]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            {studyMode.simuladosPageTitle}
          </h1>
          <p className="text-sm text-muted-theme mt-1">
            Gere provas completas no padrão da sua banca com {aiName} ou registre simulados externos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (!searchQuery && profile?.name) setSearchQuery(`${profile.name} ${profile.role_title || ''}`.trim());
              setShowSearchModal(true);
            }}
            className="px-4 py-3 rounded-2xl subtle-surface border border-theme hover:border-teal-500 text-sm font-bold inline-flex items-center gap-2 shadow-sm"
          >
            <Search className="w-4 h-4 text-teal-600" />
            Buscar Provas
          </button>
          <button
            type="button"
            onClick={() => setShowPdfModal(true)}
            className="px-4 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm"
          >
            <FileUp className="w-4 h-4" />
            Importar Prova (PDF)
          </button>
          <button
            type="button"
            onClick={() => setShowGenModal(true)}
            className="px-4 py-3 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm"
          >
            <Sparkles className="w-4 h-4" />
            Gerar Simulado com {aiName}
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="px-4 py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Registrar Manual
          </button>
        </div>
      </div>

      {simJob?.status === 'running' && (
        <div className="rounded-2xl bg-violet-500/10 border border-violet-500/30 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-violet-700 dark:text-violet-300">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {simJob.progressText || simJob.label}
            </span>
            <span>{simJob.progressPct ?? 5}%</span>
          </div>
          <div className="h-2 rounded-full bg-violet-500/20 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-600 to-teal-500 transition-all duration-300"
              style={{ width: `${Math.max(5, simJob.progressPct ?? 5)}%` }}
            />
          </div>
        </div>
      )}

      {/* Seção 1: Provas Reais & Provas Anteriores (PDF) */}
      {(() => {
        const realExams = generatedList.filter(
          (g) =>
            g.kind === 'prova_real' ||
            g.kind === 'prova_anterior' ||
            g.id.startsWith('gensim-pdf-') ||
            g.questions.length >= 40
        );
        const quickSims = generatedList.filter((g) => !realExams.includes(g));

        const renderExamCard = (gs: GeneratedSimulado, isReal: boolean) => {
          const isPdf = gs.kind === 'prova_anterior' || gs.id.startsWith('gensim-pdf-');
          return (
            <div
              key={gs.id}
              className={`card-surface rounded-3xl p-5 border space-y-3 ${
                isPdf
                  ? 'border-indigo-500/35'
                  : isReal
                  ? 'border-emerald-500/35'
                  : 'border-violet-500/25'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                        isPdf
                          ? 'bg-indigo-600 text-white'
                          : isReal
                          ? 'bg-emerald-600 text-white'
                          : 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                      }`}
                    >
                      {isPdf ? 'Prova Anterior (PDF)' : isReal ? 'Prova Real' : 'Simulado'}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full subtle-surface border border-theme">
                      {gs.board}
                    </span>
                    <span className="text-[10px] font-semibold text-muted-theme">
                      {gs.questions.length} questões ·{' '}
                      {gs.style === 'certo_errado' ? 'Certo/Errado' : 'Múltipla escolha'}
                    </span>
                  </div>
                  <h3 className="font-bold text-base mt-1.5 truncate">{gs.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    saveGeneratedList(generatedList.filter((x) => x.id !== gs.id))
                  }
                  className="p-2 rounded-xl hover:bg-rose-500/15 text-muted-theme hover:text-rose-500 shrink-0"
                  title="Excluir"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {gs.last_score && (
                <p className="text-xs text-muted-theme">
                  Último resultado:{' '}
                  <strong className="text-teal-600">
                    {gs.last_score.correct}/{gs.last_score.total} (
                    {calcAccuracy(gs.last_score.correct, gs.last_score.total)}%)
                  </strong>{' '}
                  · {formatDurationHMS(gs.last_score.duration_sec)}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startExamRunner(gs)}
                  className={`flex-1 py-2.5 rounded-xl text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 ${
                    isPdf
                      ? 'bg-indigo-600 hover:bg-indigo-500'
                      : isReal
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : 'bg-violet-600 hover:bg-violet-500'
                  }`}
                >
                  {gs.saved_progress ? (
                    <Play className="w-3.5 h-3.5" />
                  ) : gs.last_score ? (
                    <RotateCw className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {gs.saved_progress
                    ? `Continuar (${Object.keys(gs.saved_progress.answers || {}).length}/${gs.questions.length})`
                    : gs.last_score
                    ? isReal
                      ? 'Refazer Prova'
                      : 'Refazer Simulado'
                    : isReal
                    ? 'Iniciar Prova Agora'
                    : 'Iniciar Simulado Agora'}
                </button>
                {gs.saved_progress && (
                  <button
                    type="button"
                    onClick={() => startExamRunner(gs, true)}
                    className="px-3 py-2.5 rounded-xl subtle-surface border border-theme text-xs font-semibold"
                    title="Recomeçar do zero"
                  >
                    Zerar
                  </button>
                )}
              </div>
            </div>
          );
        };

        return (
          <>
            {realExams.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Provas Reais & Provas Anteriores ({realExams.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {realExams.map((gs) => renderExamCard(gs, true))}
                </div>
              </div>
            )}

            {quickSims.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-violet-500" />
                  Simulados Rápidos ({quickSims.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {quickSims.map((gs) => renderExamCard(gs, false))}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Histórico de Resultados Oficiais */}
      {simulados.length === 0 && generatedList.length === 0 ? (
        <div className="card-surface rounded-3xl p-12 text-center space-y-2">
          <ClipboardCheck className="w-12 h-12 mx-auto text-teal-500 opacity-75" />
          <p className="font-bold text-base">Nenhum simulado registrado</p>
          <p className="text-sm text-muted-theme">
            Clique em <strong>Gerar Simulado com {aiName}</strong> para montar uma prova no padrão da banca ou registre um simulado manual!
          </p>
        </div>
      ) : simulados.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-muted-theme">
            Resultados Registrados ({simulados.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {simulados.map((sim) => {
              const scores = Array.isArray(sim.subject_scores) ? sim.subject_scores : [];
              const hasWeighted = scores.some((sc) => (sc.weight ?? 1) !== 1);
              const weightedEarned = scores.reduce(
                (a, b) => a + b.correct * (b.weight ?? 1),
                0
              );
              const weightedMax = scores.reduce(
                (a, b) => a + b.total * (b.weight ?? 1),
                0
              );
              const displayPct =
                hasWeighted && weightedMax > 0
                  ? Math.round((weightedEarned / weightedMax) * 100)
                  : calcAccuracy(sim.correct_answers, sim.total_questions);

              return (
                <div key={sim.id} className="card-surface rounded-3xl p-6 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-bold text-base">{sim.title}</h2>
                      <p className="text-xs text-muted-theme mt-0.5">
                        {formatDateBR(sim.exam_date)} • {sim.board} • {sim.duration_minutes} min
                      </p>
                    </div>
                    <button
                      onClick={() => deleteSimulado(sim.id)}
                      className="p-2 rounded-xl hover:bg-rose-500/15 text-muted-theme hover:text-rose-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-3xl font-extrabold text-teal-600">{displayPct}%</span>
                    <span className="text-xs text-muted-theme">
                      {sim.correct_answers}/{sim.total_questions} questões
                      {hasWeighted && (
                        <strong className="ml-2 text-indigo-600">
                          · {weightedEarned.toFixed(1)}/{weightedMax.toFixed(1)} pts (ponderado)
                        </strong>
                      )}
                    </span>
                  </div>

                  {scores.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {scores.map((sc, i) => (
                        <span
                          key={i}
                          className="text-xs px-2.5 py-1 rounded-xl subtle-surface font-medium"
                        >
                          {sc.subject_name}: <strong>{sc.correct}/{sc.total}</strong>
                          {(sc.weight ?? 1) !== 1 && (
                            <span className="text-indigo-600 font-bold"> (p.{sc.weight})</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {sim.notes && <p className="text-xs text-muted-theme">{sim.notes}</p>}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* MODAL MOTOR DE BUSCA DE PROVAS ANTERIORES */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-2xl rounded-3xl p-6 space-y-4 my-8 max-h-[90vh] overflow-y-auto animate-pop-in">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Search className="w-5 h-5 text-teal-600" />
                Buscar Provas Anteriores na Web
              </h2>
              <button
                type="button"
                onClick={() => setShowSearchModal(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSearchPastExams} className="flex gap-2">
              <input
                required
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ex: TRT-MG Técnico Judiciário FCC 2022 ou Banco do Brasil Cesgranrio"
                className="flex-1 rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-xs"
              />
              <button
                type="submit"
                disabled={searchingExams}
                className="px-4 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                {searchingExams ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                {searchingExams ? 'Buscando...' : 'Buscar'}
              </button>
            </form>

            {searchedExams.length > 0 && (
              <div className="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
                {searchedExams.map((ex, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl subtle-surface border border-theme p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-sm">{ex.title}</p>
                        <p className="text-[11px] text-muted-theme">
                          {[ex.board, ex.organ, ex.year].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {ex.url && (
                        <a
                          href={ex.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                        >
                          Abrir Prova/PDF
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    {ex.snippet && (
                      <p className="text-xs text-muted-theme line-clamp-2">{ex.snippet}</p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {(ex.pdf_url || ex.url) && (
                        <button
                          type="button"
                          disabled={searchingExams || generating}
                          onClick={() => void handleAutoImportSearchedExam(ex)}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          <FileUp className="w-3 h-3" />
                          Importar PDF & Resolver
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setShowSearchModal(false);
                          setGenTitle(`Simulado estilo ${ex.title}`);
                          if (ex.board && PRESET_BOARDS.some((b) => b.toLowerCase().includes(ex.board!.toLowerCase()))) {
                            const matchedB = PRESET_BOARDS.find((b) =>
                              b.toLowerCase().includes(ex.board!.toLowerCase())
                            );
                            if (matchedB) setGenBoard(matchedB);
                          }
                          setShowGenModal(true);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold inline-flex items-center gap-1"
                      >
                        <Sparkles className="w-3 h-3" />
                        Gerar Simulado no Estilo desta Prova
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSearchModal(false);
                          setShowPdfModal(true);
                        }}
                        className="px-3 py-1.5 rounded-xl card-surface border border-theme text-[11px] font-semibold inline-flex items-center gap-1"
                      >
                        <FileUp className="w-3 h-3" />
                        Já baixei o PDF → Importar aqui
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL IMPORTAR PROVA EM PDF */}
      {showPdfModal && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-lg rounded-3xl p-6 space-y-4 my-8 animate-pop-in">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <FileUp className="w-5 h-5 text-indigo-600" />
                Importar Prova Anterior (PDF)
              </h2>
              <button
                type="button"
                onClick={() => setShowPdfModal(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleImportExamPdf} className="space-y-4">
              <div className="rounded-2xl bg-indigo-500/10 border border-indigo-500/25 p-3.5 text-xs text-muted-theme leading-relaxed">
                Envie o PDF de uma prova anterior. O StudyFlow lê as páginas no navegador, identifica automaticamente a <strong>banca</strong>, extrai as <strong>questões</strong> e procura o <strong>gabarito oficial online</strong> (ou usa o PDF de gabarito se você já tiver).
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  1. Arquivo PDF da Prova *
                </label>
                <input
                  type="file"
                  required
                  accept="application/pdf"
                  onChange={(e) => setExamPdfFile(e.target.files?.[0] || null)}
                  className="w-full text-xs file:mr-3 file:py-2 file:px-3.5 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  2. PDF do Gabarito Oficial (opcional — se deixar vazio, busca online)
                </label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setGabaritoPdfFile(e.target.files?.[0] || null)}
                  className="w-full text-xs file:mr-3 file:py-2 file:px-3.5 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-teal-600 file:text-white hover:file:bg-teal-500 cursor-pointer"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPdfModal(false)}
                  className="px-4 py-2.5 rounded-xl subtle-surface text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!examPdfFile || generating}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  Processar Prova e Buscar Gabarito
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL GERAR SIMULADO COM IA */}
      {showGenModal && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-xl rounded-3xl p-6 space-y-4 my-8 max-h-[92vh] overflow-y-auto animate-pop-in">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-600" />
                Gerar Simulado Padrão Banca ({aiName})
              </h2>
              <button
                type="button"
                disabled={generating}
                onClick={() => setShowGenModal(false)}
                className="p-2 rounded-xl subtle-surface disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleGenerateSimulado} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-theme mb-1">
                  Nome do Simulado (opcional)
                </label>
                <input
                  value={genTitle}
                  onChange={(e) => setGenTitle(e.target.value)}
                  placeholder={`Ex: Simulado ${genBoard} · ${profile?.name || 'Prova Completa'}`}
                  className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                />
              </div>

              {/* Seletor de Modo: Simulado Rápido vs Prova Real */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl subtle-surface border border-theme">
                <button
                  type="button"
                  onClick={() => {
                    setGenMode('rapido');
                    setGenTotalCount(15);
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition ${
                    genMode === 'rapido'
                      ? 'bg-violet-600 text-white shadow-xs'
                      : 'text-muted-theme hover:text-[var(--text-main)]'
                  }`}
                >
                  Simulado Rápido
                </button>
                <button
                  type="button"
                  onClick={() => applyProvaRealPreset(genBoard)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition ${
                    genMode === 'prova_real'
                      ? 'bg-teal-600 text-white shadow-xs'
                      : 'text-muted-theme hover:text-[var(--text-main)]'
                  }`}
                >
                  Prova Real (Edital Completo)
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-theme mb-1">
                    Banca
                  </label>
                  <select
                    value={genBoard}
                    onChange={(e) => {
                      const nextBoard = e.target.value;
                      setGenBoard(nextBoard);
                      if (genMode === 'prova_real') {
                        applyProvaRealPreset(nextBoard);
                      } else if (nextBoard.toLowerCase().includes('cebraspe')) {
                        setGenStyle('certo_errado');
                      } else {
                        setGenStyle('multipla');
                      }
                    }}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold"
                  >
                    {PRESET_BOARDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-theme mb-1">
                    Estilo da Prova
                  </label>
                  <select
                    value={genStyle}
                    onChange={(e) =>
                      setGenStyle(e.target.value as 'multipla' | 'certo_errado')
                    }
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold"
                  >
                    <option value="multipla">Múltipla escolha (A-E)</option>
                    <option value="certo_errado">Certo / Errado</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-theme mb-1">
                    Total de Questões
                  </label>
                  <select
                    value={genTotalCount}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setGenTotalCount(val);
                      if (genMode === 'prova_real') {
                        const activeSubs = subjects.filter((s) => genSubjectIds.includes(s.id));
                        setGenSubjectCounts(computeRealisticExamCounts(val, activeSubs));
                      }
                    }}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold"
                  >
                    {(genMode === 'prova_real' ? [40, 50, 60, 70, 80, 100, 120] : [10, 15, 20, 30]).map((n) => (
                      <option key={n} value={n}>
                        {n} questões
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-theme">
                    {genMode === 'prova_real'
                      ? `Divisão real por matéria (Total: ${subjects
                          .filter((s) => genSubjectIds.includes(s.id))
                          .reduce((acc, s) => acc + (genSubjectCounts[s.id] ?? 0), 0)} questões)`
                      : `Matérias do Simulado (${genSubjectIds.length}/${subjects.length})`}
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const all = subjects.map((s) => s.id);
                        setGenSubjectIds(all);
                        if (genMode === 'prova_real') {
                          setGenSubjectCounts(computeRealisticExamCounts(genTotalCount, subjects));
                        }
                      }}
                      className="text-[11px] font-bold text-teal-600 hover:underline"
                    >
                      Todas
                    </button>
                    <button
                      type="button"
                      onClick={() => setGenSubjectIds([])}
                      className="text-[11px] font-bold text-muted-theme hover:underline"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-2xl subtle-surface border border-theme p-2.5 space-y-1.5">
                  {subjects.map((s) => {
                    const checked = genSubjectIds.includes(s.id);
                    const subQty = genSubjectCounts[s.id] ?? 0;
                    return (
                      <div
                        key={s.id}
                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-[var(--bg-card)] text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setGenSubjectIds((prev) =>
                              checked ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                            )
                          }
                          className="accent-violet-600 cursor-pointer"
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="font-medium truncate flex-1">{s.name}</span>
                        {genMode === 'prova_real' && checked && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="number"
                              min={0}
                              max={60}
                              value={subQty}
                              onChange={(e) =>
                                setGenSubjectCounts((prev) => ({
                                  ...prev,
                                  [s.id]: Math.max(0, Number(e.target.value) || 0),
                                }))
                              }
                              className="w-14 rounded-lg bg-[var(--bg-card)] border border-theme px-1.5 py-1 text-center font-bold text-xs"
                              title="Quantidade de questões"
                            />
                            <span className="text-[10px] text-muted-theme">q · p.</span>
                            <input
                              type="number"
                              step="0.5"
                              min={0.5}
                              max={10}
                              value={genSubjectWeights[s.id] ?? ((s.category || '').toLowerCase().includes('espec') ? 2 : 1)}
                              onChange={(e) =>
                                setGenSubjectWeights((prev) => ({
                                  ...prev,
                                  [s.id]: Math.max(0.5, Number(e.target.value) || 1),
                                }))
                              }
                              className="w-12 rounded-lg bg-[var(--bg-card)] border border-indigo-500/40 px-1.5 py-1 text-center font-bold text-xs text-indigo-600 dark:text-indigo-300"
                              title="Peso da matéria na nota"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-theme">
                  {genMode === 'prova_real'
                    ? 'Divisão automática dando maior peso às matérias específicas (você pode ajustar o número de cada matéria acima). Cada questão sorteia um tópico diferente sem repetir.'
                    : 'As questões são geradas em paralelo usando tópicos diferentes do seu edital sem repetir assunto.'}
                </p>
              </div>

              {generating && (
                <div className="rounded-2xl bg-violet-500/10 border border-violet-500/30 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-violet-700 dark:text-violet-300">
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {genProgressText || 'Preparando simulado...'}
                    </span>
                    <span>{genProgressPct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-violet-500/20 overflow-hidden">
                    <div
                      className="h-full bg-violet-600 transition-all duration-300"
                      style={{ width: `${Math.max(4, genProgressPct)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                {generating ? (
                  <button
                    type="button"
                    onClick={() => {
                      cancelGenRef.current = true;
                    }}
                    className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                  >
                    Parar e salvar o que já gerou
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowGenModal(false)}
                      className="px-4 py-2.5 rounded-xl subtle-surface text-xs font-semibold"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={genSubjectIds.length === 0}
                      className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Sparkles className="w-4 h-4" />
                      Gerar {genMode === 'prova_real'
                        ? subjects
                            .filter((s) => genSubjectIds.includes(s.id))
                            .reduce((acc, s) => acc + (genSubjectCounts[s.id] ?? 0), 0)
                        : genTotalCount}{' '}
                      Questões
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL PROVA INTERATIVA DO SIMULADO */}
      {activeSim && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="card-surface w-full max-w-3xl max-h-[94vh] flex flex-col rounded-3xl p-4 sm:p-6 shadow-2xl animate-pop-in">
            <div className="flex items-center justify-between gap-3 border-b border-theme pb-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase ${
                      activeSim.kind === 'prova_anterior' || activeSim.id.startsWith('gensim-pdf-')
                        ? 'bg-indigo-600 text-white'
                        : activeSim.kind === 'prova_real' || activeSim.questions.length >= 40
                        ? 'bg-emerald-600 text-white'
                        : 'bg-violet-600 text-white'
                    }`}
                  >
                    {activeSim.kind === 'prova_anterior' || activeSim.id.startsWith('gensim-pdf-')
                      ? 'Prova Anterior'
                      : activeSim.kind === 'prova_real' || activeSim.questions.length >= 40
                      ? 'Prova Real'
                      : 'Simulado'}
                  </span>
                  <p className="text-xs font-bold text-violet-600 truncate">
                    {activeSim.title} · {activeSim.board}
                  </p>
                </div>
                <p className="text-xs text-muted-theme mt-0.5 inline-flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 font-mono font-bold text-[var(--text-main)]">
                    <Clock className="w-3.5 h-3.5 text-teal-600" />
                    {formatDurationHMS(examElapsedSec)}
                  </span>
                  <span>
                    · {examAnsweredCount}/{activeSim.questions.length} respondida(s)
                  </span>
                </p>
              </div>
              <button
                type="button"
                aria-label="Fechar simulado"
                onClick={() => {
                  if (examFinished) setActiveSim(null);
                  else setShowClosePrompt(true);
                }}
                className="p-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 shrink-0 transition"
                title="Fechar ou pausar simulado"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {showClosePrompt && !examFinished && (
              <div className="my-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3 shrink-0 animate-fade-in-up">
                <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                  O que deseja fazer com este simulado em andamento?
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handlePauseAndSaveExam}
                    className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
                  >
                    Pausar cronômetro e salvar progresso
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardExamProgress}
                    className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                  >
                    Parar e descartar simulado
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowClosePrompt(false)}
                    className="px-3.5 py-2 rounded-xl subtle-surface border border-theme text-xs font-semibold"
                  >
                    Voltar para a prova
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto pt-4 pr-1">

            {!examFinished && currentExamQ ? (
              <div className="space-y-4">
                {/* Barra limpa de progresso + mapa recolhível das questões */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-muted-theme">
                      Questão <strong className="text-[var(--text-main)]">{examIdx + 1}</strong> de{' '}
                      {activeSim.questions.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowExamGrid((v) => !v)}
                      className="px-2.5 py-1 rounded-xl subtle-surface border border-theme text-[11px] font-bold hover:border-violet-500/50 transition"
                    >
                      {showExamGrid ? 'Ocultar mapa' : `Mapa (${examIdx + 1}/${activeSim.questions.length})`}
                    </button>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                    <div
                      className="h-full bg-violet-600 transition-all duration-300"
                      style={{
                        width: `${Math.round(((examIdx + 1) / Math.max(1, activeSim.questions.length)) * 100)}%`,
                      }}
                    />
                  </div>
                  {showExamGrid && (
                    <div className="flex flex-wrap gap-1 pt-1 max-h-32 overflow-y-auto animate-fade-in-up">
                      {activeSim.questions.map((q, idx) => {
                        const isCur = idx === examIdx;
                        const isAns = Boolean(examAnswers[q.id]);
                        const isFlag = Boolean(examFlagged[q.id]);
                        return (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => {
                              setExamIdx(idx);
                              setShowExamGrid(false);
                            }}
                            className={`w-7 h-7 rounded-lg text-[11px] font-bold transition relative ${
                              isCur
                                ? 'bg-violet-600 text-white'
                                : isAns
                                ? 'bg-teal-600/20 text-teal-700 dark:text-teal-300 border border-teal-500/40'
                                : 'subtle-surface border border-theme text-muted-theme'
                            }`}
                          >
                            {idx + 1}
                            {isFlag && (
                              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-teal-600 text-white">
                      {currentExamQ.subject_name}
                    </span>
                    {currentExamQ.topic_title && (
                      showTopicSpoiler ? (
                        <button
                          type="button"
                          onClick={() => setShowTopicSpoiler(false)}
                          className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full subtle-surface border border-theme"
                          title="Clique para recolher o tópico"
                        >
                          {currentExamQ.topic_title} · Ocultar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowTopicSpoiler(true)}
                          className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full subtle-surface border border-theme text-muted-theme hover:text-[var(--text-main)]"
                        >
                          Ver tópico (oculto)
                        </button>
                      )
                    )}
                    {currentExamQ.header && (
                      <span className="text-xs text-muted-theme">{currentExamQ.header}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setExamFlagged((prev) => ({
                        ...prev,
                        [currentExamQ.id]: !prev[currentExamQ.id],
                      }))
                    }
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-bold inline-flex items-center gap-1 border ${
                      examFlagged[currentExamQ.id]
                        ? 'bg-amber-500/20 border-amber-500 text-amber-700 dark:text-amber-300'
                        : 'subtle-surface border-theme text-muted-theme'
                    }`}
                  >
                    <Flag className="w-3 h-3" />
                    {examFlagged[currentExamQ.id] ? 'Marcada' : 'Marcar p/ revisar'}
                  </button>
                </div>

                {(() => {
                  const formatted = splitStatementForDisplay(currentExamQ.statement);
                  return (
                    <div className="space-y-3">
                      {formatted.intro && (
                        <p className="text-xs font-bold text-teal-700 dark:text-teal-300">
                          {formatted.intro}
                        </p>
                      )}
                      {formatted.passage && (
                        <div className="rounded-2xl subtle-surface border-l-4 border-l-teal-500 p-4 text-[13.5px] leading-relaxed whitespace-pre-wrap">
                          <DictionaryText text={formatted.passage} />
                        </div>
                      )}
                      <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                        <span className="font-extrabold mr-1.5">{examIdx + 1}.</span>
                        <DictionaryText text={formatted.question} />
                      </p>
                    </div>
                  );
                })()}

                <div className="space-y-2">
                  {currentExamQ.options.map((opt) => {
                    const letter = opt.letter.trim().toUpperCase();
                    const isPicked = examDraftChoice === letter;
                    return (
                      <button
                        key={letter}
                        type="button"
                        onClick={() => setExamDraftChoice(letter)}
                        className={`w-full text-left rounded-2xl border p-3.5 flex items-start gap-3 transition ${
                          isPicked
                            ? 'border-2 border-violet-600 bg-violet-600/10'
                            : 'border-theme bg-[var(--bg-card)] hover:border-violet-500/50'
                        }`}
                      >
                        <span
                          className={`w-7 h-7 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${
                            isPicked
                              ? 'bg-violet-600 text-white'
                              : 'subtle-surface border border-theme'
                          }`}
                        >
                          {letter}
                        </span>
                        <span className="text-sm leading-relaxed flex-1">
                          <DictionaryText text={opt.text} />
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-theme flex-wrap">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={examIdx === 0}
                      onClick={() => setExamIdx((i) => Math.max(0, i - 1))}
                      className="px-3.5 py-2 rounded-xl subtle-surface text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Anterior
                    </button>
                    <button
                      type="button"
                      disabled={examIdx >= activeSim.questions.length - 1}
                      onClick={() =>
                        setExamIdx((i) => Math.min(activeSim.questions.length - 1, i + 1))
                      }
                      className="px-3.5 py-2 rounded-xl subtle-surface text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40"
                    >
                      Próxima
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={!examDraftChoice}
                      onClick={() => {
                        if (!examDraftChoice || !currentExamQ) return;
                        setExamAnswers((prev) => ({ ...prev, [currentExamQ.id]: examDraftChoice }));
                        if (examIdx < activeSim.questions.length - 1) {
                          setExamIdx((i) => i + 1);
                        } else {
                          notify('Resposta confirmada! Quando terminar, clique em Finalizar.', 'info');
                        }
                      }}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-45 shadow-xs"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {examIdx < activeSim.questions.length - 1
                        ? 'Confirmar & Próxima'
                        : 'Confirmar Resposta'}
                    </button>

                    <button
                      type="button"
                      disabled={savingResult}
                      onClick={() => void handleFinishExam()}
                      className="px-4 py-2.5 rounded-xl subtle-surface border border-theme hover:border-emerald-500 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {savingResult && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {savingResult ? 'Corrigindo...' : 'Finalizar & Ver Gabarito'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* GABARITO COMENTADO FINAL */
              <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                {(() => {
                  const hits = activeSim.questions.filter(
                    (q) =>
                      examAnswers[q.id] &&
                      examAnswers[q.id] === q.correct_answer.trim().toUpperCase()
                  ).length;
                  const wEarned = activeSim.questions.reduce((acc, q) => {
                    const w = Number(activeSim.weights?.[q.subject_id] ?? 1) || 1;
                    const ok = examAnswers[q.id] && examAnswers[q.id] === q.correct_answer.trim().toUpperCase();
                    return acc + (ok ? w : 0);
                  }, 0);
                  const wMax = activeSim.questions.reduce((acc, q) => {
                    return acc + (Number(activeSim.weights?.[q.subject_id] ?? 1) || 1);
                  }, 0);
                  const pct = wMax > 0 ? Math.round((wEarned / wMax) * 100) : calcAccuracy(hits, activeSim.questions.length);
                  return (
                    <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                          Resultado Final (Ponderado)
                        </p>
                        <p className="text-2xl font-extrabold">
                          {hits}/{activeSim.questions.length} acertos · {wEarned.toFixed(1)}/{wMax.toFixed(1)} pts ({pct}%)
                        </p>
                      </div>
                      <p className="text-xs text-muted-theme">
                        Tempo: <strong>{formatDurationHMS(examElapsedSec)}</strong> · Erradas enviadas ao Caderno de Erros
                      </p>
                    </div>
                  );
                })()}

                <div className="space-y-3">
                  {activeSim.questions.map((q, idx) => {
                    const picked = (examAnswers[q.id] || '').trim().toUpperCase();
                    const right = (q.correct_answer || '').trim().toUpperCase();
                    const isHit = Boolean(picked && right && picked === right);
                    return (
                      <div
                        key={q.id}
                        className={`rounded-2xl border p-4 space-y-2 text-xs ${
                          isHit
                            ? 'border-emerald-500/40 bg-emerald-500/5'
                            : 'border-rose-500/40 bg-rose-500/5'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-extrabold">
                            Questão {idx + 1} · {q.subject_name}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 font-bold ${
                              isHit ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {isHit ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5" />
                            )}
                            Sua resp.: {picked || 'Em branco'} · Gabarito: {right}
                          </span>
                        </div>
                        <p className="font-medium leading-relaxed">
                          <DictionaryText text={q.statement} />
                        </p>
                        <div className="space-y-2 border-t border-theme pt-2">
                          {q.explanation && (
                            <p className="text-muted-theme leading-relaxed">
                              <DictionaryText text={q.explanation} />
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <ExplainForChildButton
                              mode="statement"
                              content={q.statement}
                              context={q.subject_name || ''}
                              compact
                            />
                            {q.explanation && (
                              <ExplainForChildButton
                                title={q.topic_title || q.subject_name || 'Questão do Simulado'}
                                content={`Enunciado: ${q.statement}\n\nExplicação: ${q.explanation}`}
                                context={q.subject_name || ''}
                                compact
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveSim(null)}
                    className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
                  >
                    Fechar Gabarito
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL REGISTRAR SIMULADO MANUAL */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-xl rounded-3xl p-6 space-y-4 my-8 max-h-[90vh] overflow-y-auto animate-pop-in">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">Registrar Simulado</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-xl subtle-surface">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nome (ex: Prova TRT-4 2022 ou Simulado 01)"
                className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={board}
                  onChange={(e) => setBoard(e.target.value)}
                  placeholder="Banca"
                  className="rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                />
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="text-xs text-muted-theme font-medium">Total Questões</label>
                  <input
                    type="number"
                    value={totalQ}
                    onChange={(e) => setTotalQ(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-theme font-medium">Total Acertos</label>
                  <input
                    type="number"
                    value={correctQ}
                    onChange={(e) => setCorrectQ(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-theme font-medium">Tempo (min)</label>
                  <input
                    type="number"
                    value={durationMin}
                    onChange={(e) => setDurationMin(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2 text-sm mt-1"
                  />
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-theme">
                <div className="flex items-center justify-between text-xs font-bold text-muted-theme">
                  <span>Acertos & Peso por Matéria (padrão = 1)</span>
                  <div className="flex items-center gap-3 pr-1">
                    <span className="w-14 text-center">Acert.</span>
                    <span className="w-14 text-center">Total</span>
                    <span className="w-14 text-center">Peso</span>
                  </div>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {subjects.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate flex-1 font-medium">{s.name}</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={subjectScores[s.id]?.correct || ''}
                        onChange={(e) =>
                          setSubjectScores((prev) => ({
                            ...prev,
                            [s.id]: {
                              total: prev[s.id]?.total || '',
                              correct: e.target.value,
                              weight: prev[s.id]?.weight || '1',
                            },
                          }))
                        }
                        className="w-14 rounded-xl subtle-surface border border-theme px-2 py-1.5 text-center"
                      />
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={subjectScores[s.id]?.total || ''}
                        onChange={(e) =>
                          setSubjectScores((prev) => ({
                            ...prev,
                            [s.id]: {
                              total: e.target.value,
                              correct: prev[s.id]?.correct || '',
                              weight: prev[s.id]?.weight || '1',
                            },
                          }))
                        }
                        className="w-14 rounded-xl subtle-surface border border-theme px-2 py-1.5 text-center"
                      />
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={subjectScores[s.id]?.weight ?? '1'}
                        onChange={(e) =>
                          setSubjectScores((prev) => ({
                            ...prev,
                            [s.id]: {
                              total: prev[s.id]?.total || '',
                              correct: prev[s.id]?.correct || '',
                              weight: e.target.value,
                            },
                          }))
                        }
                        className="w-14 rounded-xl subtle-surface border border-theme px-2 py-1.5 text-center font-bold text-indigo-600"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observações (tempo, nota da redação/discursiva, cansaço...)"
                className="w-full rounded-2xl subtle-surface border border-theme p-3 text-xs"
              />
              <button
                type="submit"
                className="w-full py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold"
              >
                Salvar Simulado
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
