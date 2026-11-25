'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { useGlobal } from '@/components/GlobalProvider';
import { DictionaryText } from '@/components/DictionaryText';
import { useAiProviderName } from '@/lib/useAiProvider';
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
  RotateCw,
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
  created_at: string;
  questions: SimQuestion[];
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
  const [genTitle, setGenTitle] = useState('');
  const [genBoard, setGenBoard] = useState('FCC');
  const [genStyle, setGenStyle] = useState<'multipla' | 'certo_errado'>('multipla');
  const [genMode, setGenMode] = useState<'rapido' | 'prova_real'>('rapido');
  const [genTotalCount, setGenTotalCount] = useState<number>(15);
  const [genSubjectCounts, setGenSubjectCounts] = useState<Record<string, number>>({});
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

  function computeRealisticExamCounts(targetTotal: number, activeSubs: typeof subjects): Record<string, number> {
    if (activeSubs.length === 0) return {};
    const weights = activeSubs.map((s) => {
      const cat = (s.category || '').toLowerCase();
      const isSpec = cat.includes('espec');
      const baseW = Math.max(1, Math.max(1, (Number(s.cycle_minutes) || Number(s.cycle_hours) * 60 || 60) / 60));
      return isSpec ? baseW * 1.8 : baseW;
    });
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;
    const raw = weights.map((w) => Math.max(1, Math.round((w / sumW) * targetTotal)));
    let diff = targetTotal - raw.reduce((a, b) => a + b, 0);
    let idx = 0;
    while (diff !== 0 && activeSubs.length > 0) {
      const pos = idx % activeSubs.length;
      if (diff > 0) {
        raw[pos] += 1;
        diff--;
      } else if (raw[pos] > 1) {
        raw[pos] -= 1;
        diff++;
      }
      idx++;
      if (idx > 500) break;
    }
    const map: Record<string, number> = {};
    activeSubs.forEach((s, i) => {
      map[s.id] = raw[i];
    });
    return map;
  }

  function applyProvaRealPreset(boardName: string) {
    const isCebraspe = boardName.toLowerCase().includes('cebraspe') || boardName.toLowerCase().includes('cespe');
    const target = isCebraspe ? 120 : 60;
    const allIds = subjects.map((s) => s.id);
    setGenMode('prova_real');
    setGenStyle(isCebraspe ? 'certo_errado' : 'multipla');
    setGenTotalCount(target);
    setGenSubjectIds(allIds);
    setGenSubjectCounts(computeRealisticExamCounts(target, subjects));
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

    const plan =
      genMode === 'prova_real'
        ? chosenSubs
            .map((sub) => ({
              subject: sub,
              count: Math.max(0, Number(genSubjectCounts[sub.id] ?? 0)),
            }))
            .filter((p) => p.count > 0)
        : (() => {
            const basePerSub = Math.floor(genTotalCount / chosenSubs.length);
            const remainder = genTotalCount % chosenSubs.length;
            return chosenSubs
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
      qty: number
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
                  t.qty
                );
                collected.push(...batchItems);
              } catch {
                if (t.qty > 1) {
                  for (let k = 0; k < t.qty; k++) {
                    const single = await fetchSimBatch(
                      t.subject,
                      t.topicTitle,
                      t.topicId,
                      1
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
            const isPartial = collected.length < totalSnap;
            const newSim: GeneratedSimulado = {
              id: `gensim-${Date.now()}`,
              title: isPartial ? `${titleSnap} (${collected.length}q)` : titleSnap,
              board: boardSnap,
              style: styleSnap,
              created_at: new Date().toISOString(),
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

  function startExamRunner(sim: GeneratedSimulado) {
    setActiveSim(sim);
    setExamIdx(0);
    setExamAnswers({});
    setExamFlagged({});
    setExamFinished(false);
    setExamElapsedSec(0);
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
          weight: 1,
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

      {/* Provas Geradas com IA prontas para resolver */}
      {generatedList.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-muted-theme">
            Simulados Interativos Gerados ({generatedList.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {generatedList.map((gs) => (
              <div
                key={gs.id}
                className="card-surface rounded-3xl p-5 border border-violet-500/25 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300">
                        {gs.board}
                      </span>
                      <span className="text-[10px] font-semibold text-muted-theme">
                        {gs.questions.length} questões ·{' '}
                        {gs.style === 'certo_errado' ? 'Certo/Errado' : 'Múltipla escolha'}
                      </span>
                    </div>
                    <h3 className="font-bold text-base mt-1 truncate">{gs.title}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      saveGeneratedList(generatedList.filter((x) => x.id !== gs.id))
                    }
                    className="p-2 rounded-xl hover:bg-rose-500/15 text-muted-theme hover:text-rose-500 shrink-0"
                    title="Excluir simulado"
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

                <button
                  type="button"
                  onClick={() => startExamRunner(gs)}
                  className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
                >
                  {gs.last_score ? (
                    <RotateCw className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {gs.last_score ? 'Refazer Simulado' : 'Iniciar Simulado Agora'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={subQty}
                            onChange={(e) =>
                              setGenSubjectCounts((prev) => ({
                                ...prev,
                                [s.id]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            className="w-16 rounded-lg bg-[var(--bg-card)] border border-theme px-2 py-1 text-center font-bold text-xs"
                            title="Questões desta matéria"
                          />
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-3xl rounded-3xl p-5 sm:p-6 my-6 space-y-5 shadow-2xl animate-pop-in">
            <div className="flex items-center justify-between gap-3 border-b border-theme pb-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs font-bold text-violet-600 truncate">
                  {activeSim.title} · {activeSim.board}
                </p>
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
                onClick={() => setActiveSim(null)}
                className="p-2 rounded-xl subtle-surface shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!examFinished && currentExamQ ? (
              <div className="space-y-4">
                {/* Grade de navegação rápida */}
                <div className="flex flex-wrap gap-1.5">
                  {activeSim.questions.map((q, idx) => {
                    const isCur = idx === examIdx;
                    const isAns = Boolean(examAnswers[q.id]);
                    const isFlag = Boolean(examFlagged[q.id]);
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setExamIdx(idx)}
                        className={`w-8 h-8 rounded-xl text-xs font-extrabold transition relative ${
                          isCur
                            ? 'bg-violet-600 text-white ring-2 ring-violet-400/50'
                            : isAns
                            ? 'bg-teal-600/20 text-teal-700 dark:text-teal-300 border border-teal-500/40'
                            : 'subtle-surface border border-theme text-muted-theme'
                        }`}
                      >
                        {idx + 1}
                        {isFlag && (
                          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-teal-600 text-white">
                      {currentExamQ.subject_name}
                    </span>
                    {currentExamQ.topic_title && (
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full subtle-surface border border-theme">
                        {currentExamQ.topic_title}
                      </span>
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

                <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                  <span className="font-extrabold mr-1.5">{examIdx + 1}.</span>
                  <DictionaryText text={currentExamQ.statement} />
                </p>

                <div className="space-y-2">
                  {currentExamQ.options.map((opt) => {
                    const letter = opt.letter.trim().toUpperCase();
                    const isPicked = examAnswers[currentExamQ.id] === letter;
                    return (
                      <button
                        key={letter}
                        type="button"
                        onClick={() =>
                          setExamAnswers((prev) => ({ ...prev, [currentExamQ.id]: letter }))
                        }
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

                  <button
                    type="button"
                    disabled={savingResult}
                    onClick={() => void handleFinishExam()}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {savingResult ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    {savingResult ? 'Corrigindo...' : 'Finalizar & Corrigir Simulado'}
                  </button>
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
                  const pct = calcAccuracy(hits, activeSim.questions.length);
                  return (
                    <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                          Resultado Final
                        </p>
                        <p className="text-2xl font-extrabold">
                          {hits}/{activeSim.questions.length} acertos ({pct}%)
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
                        {q.explanation && (
                          <p className="text-muted-theme leading-relaxed border-t border-theme pt-2">
                            <DictionaryText text={q.explanation} />
                          </p>
                        )}
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
