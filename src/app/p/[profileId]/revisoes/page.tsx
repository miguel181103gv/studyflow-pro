'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAiProviderName } from '@/lib/useAiProvider';
import { useProfile } from '@/components/ProfileProvider';
import { DictionaryText } from '@/components/DictionaryText';
import { useGlobal } from '@/components/GlobalProvider';
import { addDaysISO, formatDateBR, todayISO } from '@/lib/utils';
import { BookOpen, Layers, CheckCircle2, Sparkles, FileText, PlusCircle, Loader2, X, Trash2, RefreshCw, ArrowLeft, ArrowRight, XCircle } from 'lucide-react';

interface QuizQuestion {
  statement: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface QuizResultData {
  title: string;
  subjectId: string;
  topicId: string;
  questions: QuizQuestion[];
}

const Q_MARKER = '<!--SF_Q_JSON:';
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

export default function RevisoesPage() {
  const {
    profile,
    reviews,
    subjects,
    topics,
    highlights,
    errors,
    completeReview,
    postponeReview,
    deleteReview,
    addStudyLog,
    addErrorEntry,
  } = useProfile();
  const aiName = useAiProviderName();
  const { aiJobs, runAiJob, dismissAiJob, notify } = useGlobal();

  const today = todayISO();
  const next7 = addDaysISO(today, 7);
  const [filter, setFilter] = useState<'overdue' | 'today' | 'upcoming' | 'completed'>('today');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [searchTopic, setSearchTopic] = useState('');

  // Active Quiz modal + histórico persistido por revisão (mantém o quiz salvo e permite gerar outro)
  interface SavedReviewQuiz {
    title: string;
    subjectId: string;
    topicId: string;
    subjectName: string;
    topicTitle: string;
    questions: QuizQuestion[];
    answers: Record<number, number>;
    savedStats?: { correct: number; total: number };
  }
  const reviewQuizStorageKey = `sf_review_quizzes_${profile?.id || 'default'}`;
  const [savedQuizzesByRev, setSavedQuizzesByRev] = useState<Record<string, SavedReviewQuiz>>({});
  const [activeQuizRevId, setActiveQuizRevId] = useState<string | null>(null);
  const [activeQuizJobId, setActiveQuizJobId] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizIdx, setQuizIdx] = useState(0);
  const [savedQuizJobs, setSavedQuizJobs] = useState<Record<string, { correct: number; total: number }>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(reviewQuizStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setSavedQuizzesByRev(parsed);
      } else {
        setSavedQuizzesByRev({});
      }
    } catch {
      setSavedQuizzesByRev({});
    }
  }, [reviewQuizStorageKey]);

  function persistSavedQuiz(revId: string, record: SavedReviewQuiz) {
    setSavedQuizzesByRev((prev) => {
      const next = { ...prev, [revId]: record };
      try {
        localStorage.setItem(reviewQuizStorageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Grifos modal
  const [highlightsTopicId, setHighlightsTopicId] = useState<string | null>(null);

  const filtered = reviews.filter((r) => {
    if (filter === 'completed') {
      if (!r.completed) return false;
    } else {
      if (r.completed) return false;
      if (filter === 'overdue' && !(r.due_date < today)) return false;
      if (filter === 'today' && !(r.due_date <= today)) return false;
      if (filter === 'upcoming' && !(r.due_date > today && r.due_date <= next7)) return false;
    }
    if (subjectFilter && r.subject_id !== subjectFilter) return false;
    const sq = searchTopic.trim().toLowerCase();
    if (sq) {
      const tp = topics.find((t) => t.id === r.topic_id);
      const sb = subjects.find((s) => s.id === r.subject_id);
      const hay = `${tp?.title || ''} ${sb?.name || ''}`.toLowerCase();
      if (!hay.includes(sq)) return false;
    }
    return true;
  });

  function saveQuizQuestionsToBank(subjectId: string, topicId: string, subjectName: string, list: QuizQuestion[]) {
    if (!profile?.id || list.length === 0) return;
    const bankKey = `sf_question_bank_${profile.id}`;
    try {
      const raw = localStorage.getItem(bankKey);
      const existing = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(existing) ? existing : [];
      const existingStmts = new Set(
        arr.map((q: { statement?: string }) => String(q.statement || '').trim().slice(0, 80).toLowerCase())
      );

      const newItems = list
        .filter((q) => !existingStmts.has(q.statement.trim().slice(0, 80).toLowerCase()))
        .map((q, idx) => ({
          id: `q-rev-${Date.now()}-${idx}`,
          subject_id: subjectId,
          topic_id: topicId || null,
          header: `Quiz Gemini · ${subjectName}`,
          statement: q.statement,
          options: q.options.map((optText, oIdx) => ({
            letter: LETTERS[oIdx] || String(oIdx + 1),
            text: String(optText).replace(/^\(?[A-Ea-e]\)?[).:\-–—]\s+/, '').trim(),
          })),
          correct_answer: LETTERS[q.correctIndex] || 'A',
          explanation: q.explanation || '',
          created_at: new Date().toISOString(),
        }));

      if (newItems.length > 0) {
        localStorage.setItem(bankKey, JSON.stringify([...newItems, ...arr]));
      }
    } catch {
      // ignore storage errors
    }
  }

  function openGeminiQuiz(
    reviewId: string,
    subjectId: string,
    topicId: string,
    subjectName: string,
    topicTitle: string,
    forceNew = false
  ) {
    const jobId = `quiz:${profile?.id || 'default'}:${reviewId}`;
    setActiveQuizRevId(reviewId);
    setActiveQuizJobId(jobId);
    setQuizIdx(0);

    const saved = savedQuizzesByRev[reviewId];
    if (!forceNew && saved && saved.questions.length > 0) {
      setQuizAnswers(saved.answers || {});
      return;
    }

    if (forceNew) {
      dismissAiJob(jobId);
    }

    setQuizAnswers({});

    const existing = !forceNew ? aiJobs[jobId] : undefined;
    if (existing?.status === 'running' || (existing?.status === 'done' && existing.result)) {
      return;
    }

    const title = `${subjectName} — ${topicTitle}`;
    runAiJob<QuizResultData>({
      id: jobId,
      kind: 'quiz',
      label: `Quiz Gemini: ${topicTitle}`,
      route: profile ? `/p/${profile.id}/revisoes` : undefined,
      successMsg: `Quiz de "${topicTitle}" pronto e salvo no Banco de Questões!`,
      keepResult: true,
      task: async () => {
        const res = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'quiz',
            profileName: profile?.name || 'Concurso Público',
            subjectName,
            topicTitle,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao gerar quiz.');
        return {
          title,
          subjectId,
          topicId,
          questions: (json.data.questions || []) as QuizQuestion[],
        };
      },
      onDone: async (resData) => {
        saveQuizQuestionsToBank(resData.subjectId, resData.topicId, subjectName, resData.questions);
        persistSavedQuiz(reviewId, {
          title: resData.title,
          subjectId: resData.subjectId,
          topicId: resData.topicId,
          subjectName,
          topicTitle,
          questions: resData.questions,
          answers: {},
        });
      },
    });
  }

  async function saveQuizStatsToEvolution(jobId: string, data: QuizResultData, answersMap: Record<number, number>) {
    if (savedQuizJobs[jobId]) return;
    const answeredEntries = Object.entries(answersMap);
    if (answeredEntries.length === 0) return;

    const total = answeredEntries.length;
    const correct = answeredEntries.reduce((acc, [qIdxStr, chosenIdx]) => {
      const q = data.questions[Number(qIdxStr)];
      return acc + (q && q.correctIndex === chosenIdx ? 1 : 0);
    }, 0);

    setSavedQuizJobs((prev) => ({ ...prev, [jobId]: { correct, total } }));
    if (activeQuizRevId && savedQuizzesByRev[activeQuizRevId]) {
      persistSavedQuiz(activeQuizRevId, {
        ...savedQuizzesByRev[activeQuizRevId],
        answers: answersMap,
        savedStats: { correct, total },
      });
    }
    await addStudyLog({
      subject_id: data.subjectId,
      topic_id: data.topicId || null,
      duration_seconds: 0,
      study_date: today,
      period: 'Revisão',
      method: 'Quiz Gemini (Revisão)',
      questions_total: total,
      questions_correct: correct,
      stop_point: '',
      notes: `Quiz Gemini: ${data.title}`,
    });
    notify(`Resultado (${correct}/${total}) salvo em Evolução & Mapa de Acertos!`, 'success');
  }

  async function handleAnswerQuizQuestion(
    jobId: string,
    data: QuizResultData,
    qIdx: number,
    oIdx: number
  ) {
    if (quizAnswers[qIdx] !== undefined) return;
    const nextAnswers = { ...quizAnswers, [qIdx]: oIdx };
    setQuizAnswers(nextAnswers);
    if (activeQuizRevId && savedQuizzesByRev[activeQuizRevId]) {
      persistSavedQuiz(activeQuizRevId, {
        ...savedQuizzesByRev[activeQuizRevId],
        answers: nextAnswers,
      });
    }

    const q = data.questions[qIdx];
    if (q && oIdx !== q.correctIndex) {
      const normStmt = q.statement.trim().slice(0, 80).toLowerCase();
      const alreadyInErrors = errors.some((e) =>
        (e.question_text || '').toLowerCase().includes(normStmt)
      );
      if (!alreadyInErrors) {
        const formattedOptions = q.options.map((optText, idx) => ({
          letter: LETTERS[idx] || String(idx + 1),
          text: String(optText).replace(/^\(?[A-Ea-e]\)?[).:\-–—]\s+/, '').trim(),
        }));
        const encoded = `${Q_MARKER}${JSON.stringify({
          header: `Quiz Gemini · ${data.title}`,
          statement: q.statement,
          options: formattedOptions,
        })}-->
${q.statement}`;
        void addErrorEntry({
          subject_id: data.subjectId,
          topic_id: data.topicId || null,
          question_text: encoded,
          image_path: null,
          user_answer: LETTERS[oIdx] || '',
          correct_answer: LETTERS[q.correctIndex] || '',
          error_cause: 'Erro no Quiz de Revisão',
          explanation: q.explanation || '',
          golden_rule: '',
          review_count: 0,
          last_reviewed_at: null,
          next_review_date: today,
        });
      }
    }

    if (Object.keys(nextAnswers).length === data.questions.length && !savedQuizJobs[jobId]) {
      await saveQuizStatsToEvolution(jobId, data, nextAnswers);
    }
  }

  const activeSavedQuiz = activeQuizRevId ? savedQuizzesByRev[activeQuizRevId] : undefined;
  const activeQuizJob = activeQuizJobId ? aiJobs[activeQuizJobId] : undefined;
  const activeQuizData: QuizResultData | undefined =
    activeQuizJob?.status === 'running'
      ? undefined
      : (activeQuizJob?.result as QuizResultData | undefined) ||
        (activeSavedQuiz
          ? {
              title: activeSavedQuiz.title,
              subjectId: activeSavedQuiz.subjectId,
              topicId: activeSavedQuiz.topicId,
              questions: activeSavedQuiz.questions,
            }
          : undefined);

  async function quickAddQuestions(subjectId: string, topicId: string) {
    const total = Number(prompt('Quantas questões você fez nesta revisão?', '10') || '0');
    if (!total) return;
    const correct = Number(prompt('Quantas você acertou?', '8') || '0');
    await addStudyLog({
      subject_id: subjectId,
      topic_id: topicId,
      duration_seconds: 0,
      study_date: today,
      period: 'Revisão',
      method: 'Questões de Revisão',
      questions_total: total,
      questions_correct: Math.min(total, correct),
      stop_point: '',
      notes: '',
    });
  }

  const topicHighlights = highlightsTopicId
    ? highlights.filter((h) => h.topic_id === highlightsTopicId)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agenda de Revisões (1 · 7 · 30 · 90 dias)</h1>
        <p className="text-sm text-muted-theme">
          Revisões espaçadas geradas automaticamente ao concluir cada tópico do edital.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'today', label: 'Para Hoje & Atrasadas' },
          { id: 'overdue', label: 'Só Atrasadas' },
          { id: 'upcoming', label: 'Próximos 7 dias' },
          { id: 'completed', label: 'Concluídas' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id as typeof filter)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
              filter === tab.id ? 'bg-teal-600 text-white shadow-sm' : 'card-surface hover:opacity-85'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {reviews.length > 0 && (
        <div className="card-surface rounded-2xl p-3 flex flex-col sm:flex-row gap-2.5">
          <input
            value={searchTopic}
            onChange={(e) => setSearchTopic(e.target.value)}
            placeholder="Buscar revisão por tópico ou matéria..."
            className="flex-1 rounded-xl subtle-surface border border-theme px-3.5 py-2 text-xs"
          />
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold sm:w-64"
          >
            <option value="">Todas as matérias</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card-surface rounded-2xl p-8 text-center text-sm text-muted-theme">
          Nenhuma revisão nesta aba. Marque tópicos em &ldquo;Edital Verticalizado&rdquo; para agendar revisões!
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((rev) => {
            const sub = subjects.find((s) => s.id === rev.subject_id);
            const topic = topics.find((t) => t.id === rev.topic_id);
            const hlCount = highlights.filter((h) => h.topic_id === rev.topic_id).length;
            const jobId = `quiz:${profile?.id || 'default'}:${rev.id}`;
            const job = aiJobs[jobId];
            const isQuizRunning = job?.status === 'running';
            const savedQuiz = savedQuizzesByRev[rev.id];
            const isQuizReady = (job?.status === 'done' && Boolean(job.result)) || Boolean(savedQuiz);

            return (
              <div
                key={rev.id}
                className="card-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Link
                      href={`/p/${profile?.id}/estudos?subject=${encodeURIComponent(rev.subject_id)}&topic=${encodeURIComponent(rev.topic_id)}`}
                      title="Abrir matéria e tópico no Edital Verticalizado"
                      className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white hover:opacity-90 hover:underline transition"
                      style={{ backgroundColor: sub?.color || '#0d9488' }}
                    >
                      {sub?.name}
                    </Link>
                    <span className="text-[11px] px-2 py-0.5 rounded-full subtle-surface font-medium">
                      Revisão {rev.interval_days}d
                    </span>
                    <span className="text-[11px] text-muted-theme">
                      Data: {formatDateBR(rev.due_date)}
                    </span>
                  </div>
                  <Link
                    href={`/p/${profile?.id}/estudos?subject=${encodeURIComponent(rev.subject_id)}&topic=${encodeURIComponent(rev.topic_id)}`}
                    title="Abrir este tópico no Edital Verticalizado"
                    className="font-semibold text-sm hover:text-teal-500 hover:underline transition inline-block"
                  >
                    {topic?.title || 'Tópico'}
                  </Link>
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <button
                    onClick={() => setHighlightsTopicId(rev.topic_id)}
                    className="px-3 py-1.5 rounded-xl subtle-surface text-xs font-medium inline-flex items-center gap-1"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Grifos ({hlCount})
                  </button>
                  <Link
                    href={`/p/${profile?.id}/flashcards?subject=${encodeURIComponent(rev.subject_id)}&topic=${encodeURIComponent(rev.topic_id)}`}
                    title="Abrir Flashcards desta matéria"
                    className="px-3 py-1.5 rounded-xl subtle-surface hover:border-teal-500/50 border border-transparent text-xs font-medium inline-flex items-center gap-1 transition"
                  >
                    <Layers className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    Flashcards
                  </Link>
                  <Link
                    href={`/p/${profile?.id}/questoes?subject=${encodeURIComponent(rev.subject_id)}&topic=${encodeURIComponent(rev.topic_id)}`}
                    title="Ir para o Banco de Questões desta matéria"
                    className="px-3 py-1.5 rounded-xl subtle-surface hover:border-teal-500/50 border border-transparent text-xs font-medium inline-flex items-center gap-1 transition"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    Questões
                  </Link>
                  <button
                    onClick={() => quickAddQuestions(rev.subject_id, rev.topic_id)}
                    title="Registrar quantidade de questões feitas manualmente"
                    className="px-2.5 py-1.5 rounded-xl subtle-surface text-xs font-medium inline-flex items-center gap-1"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    + Qtd
                  </button>
                  <button
                    onClick={() =>
                      openGeminiQuiz(
                        rev.id,
                        rev.subject_id,
                        rev.topic_id,
                        sub?.name || 'Matéria',
                        topic?.title || 'Tópico'
                      )
                    }
                    className={`px-3 py-1.5 rounded-xl text-white text-xs font-semibold inline-flex items-center gap-1 ${
                      isQuizReady
                        ? 'bg-emerald-600 hover:bg-emerald-500'
                        : 'bg-violet-600 hover:bg-violet-500'
                    }`}
                  >
                    {isQuizRunning ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {isQuizRunning
                      ? 'Gerando Quiz...'
                      : savedQuiz?.savedStats
                      ? `Ver Quiz (${savedQuiz.savedStats.correct}/${savedQuiz.savedStats.total})`
                      : isQuizReady
                      ? 'Abrir Quiz Salvo'
                      : `Quiz ${aiName}`}
                  </button>
                  {!rev.completed && (
                    <>
                      <button
                        onClick={() => postponeReview(rev.id, addDaysISO(today, 1))}
                        className="px-3 py-1.5 rounded-xl subtle-surface hover:opacity-85 text-xs font-semibold"
                        title={`Adiar para ${formatDateBR(addDaysISO(today, 1))}`}
                      >
                        Adiar → {formatDateBR(addDaysISO(today, 1)).slice(0, 5)}
                      </button>
                      <button
                        onClick={() => completeReview(rev.id)}
                        className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Concluir
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => deleteReview(rev.id)}
                    title="Excluir revisão"
                    aria-label="Excluir revisão"
                    className="p-1.5 rounded-xl subtle-surface hover:bg-rose-500/15 text-muted-theme hover:text-rose-600 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Grifos Modal */}
      {highlightsTopicId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-lg rounded-3xl p-6 max-h-[80vh] overflow-y-auto animate-pop-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-base">Grifos do Tópico</h2>
              <button
                onClick={() => setHighlightsTopicId(null)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {topicHighlights.length === 0 ? (
              <p className="text-sm text-muted-theme">
                Nenhum grifo salvo neste tópico ainda. Adicione grifos na aba &ldquo;Matérias & Vídeos&rdquo;.
              </p>
            ) : (
              <div className="space-y-3">
                {topicHighlights.map((h) => (
                  <div
                    key={h.id}
                    className="rounded-xl p-3 text-sm border-l-4"
                    style={{
                      backgroundColor: h.color,
                      borderLeftColor:
                        h.color === '#fee2e2' || h.color === '#fbcfe8'
                          ? '#dc2626'
                          : h.color === '#dcfce7' || h.color === '#bbf7d0'
                          ? '#16a34a'
                          : '#d97706',
                      color:
                        h.color === '#fee2e2' || h.color === '#fbcfe8'
                          ? '#7f1d1d'
                          : h.color === '#dcfce7' || h.color === '#bbf7d0'
                          ? '#14532d'
                          : '#78350f',
                    }}
                  >
                    <p className="font-medium">&ldquo;{h.text}&rdquo;</p>
                    {h.note && <p className="text-xs mt-1 opacity-80">Obs: {h.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quiz Gemini Modal */}
      {activeQuizJobId && (activeQuizJob || activeQuizData) && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-2xl rounded-3xl p-6 my-8 max-h-[88vh] overflow-y-auto animate-pop-in">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-5 h-5 text-violet-600 shrink-0" />
                <h2 className="font-bold text-base truncate">
                  {activeQuizData?.title || activeQuizJob?.label || `Quiz ${aiName}`}
                </h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activeQuizData && activeQuizRevId && activeQuizJob?.status !== 'running' && (
                  <button
                    type="button"
                    onClick={() => {
                      const rev = reviews.find((r) => r.id === activeQuizRevId);
                      const sub = subjects.find((s) => s.id === (rev?.subject_id || activeQuizData.subjectId));
                      const tp = topics.find((t) => t.id === (rev?.topic_id || activeQuizData.topicId));
                      openGeminiQuiz(
                        activeQuizRevId,
                        activeQuizData.subjectId,
                        activeQuizData.topicId,
                        sub?.name || activeSavedQuiz?.subjectName || 'Matéria',
                        tp?.title || activeSavedQuiz?.topicTitle || 'Tópico',
                        true
                      );
                    }}
                    className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                    title="Mantém seu histórico anterior salvo nas estatísticas e gera 5 questões inéditas"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Gerar Novo Quiz
                  </button>
                )}
                <button
                  onClick={() => {
                    if (activeQuizJob?.status === 'error') {
                      dismissAiJob(activeQuizJobId);
                    }
                    setActiveQuizJobId(null);
                    setActiveQuizRevId(null);
                  }}
                  className="p-2 rounded-xl subtle-surface"
                  title={
                    activeQuizJob?.status === 'running'
                      ? 'Fechar janela (o Gemini continuará gerando em segundo plano)'
                      : 'Fechar (o quiz continuará salvo)'
                  }
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {activeQuizJob?.status === 'running' && (
              <div className="py-12 flex flex-col items-center gap-3 text-sm text-muted-theme text-center">
                <Loader2 className="w-7 h-7 animate-spin text-violet-600" />
                <span>Gemini está elaborando 5 questões inéditas...</span>
                <span className="text-xs opacity-75">
                  Você pode fechar esta janela ou trocar de aba — avisaremos assim que ficar pronto.
                </span>
              </div>
            )}

            {activeQuizJob?.status === 'error' && (
              <div className="p-4 rounded-xl bg-rose-500/15 text-rose-600 text-sm">
                {activeQuizJob.error}
              </div>
            )}

            {activeQuizData && activeQuizData.questions.length > 0 && (() => {
              const totalQ = activeQuizData.questions.length;
              const safeIdx = Math.min(quizIdx, totalQ - 1);
              const q = activeQuizData.questions[safeIdx];
              const chosen = quizAnswers[safeIdx];
              const answeredCount = Object.keys(quizAnswers).length;
              const hitsCount = Object.entries(quizAnswers).reduce((acc, [i, ans]) => {
                const item = activeQuizData.questions[Number(i)];
                return acc + (item && item.correctIndex === ans ? 1 : 0);
              }, 0);
              const savedStats = savedQuizJobs[activeQuizJobId] || activeSavedQuiz?.savedStats;

              return (
                <div className="space-y-4">
                  {/* Barra de progresso e navegação rápida entre questões */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-theme">
                    <span className="text-xs font-bold text-muted-theme">
                      Questão {safeIdx + 1} de {totalQ} ·{' '}
                      <span className="text-emerald-600">{hitsCount} acerto(s)</span>
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {activeQuizData.questions.map((item, idx) => {
                        const ans = quizAnswers[idx];
                        const isCur = idx === safeIdx;
                        let pillCls = 'subtle-surface border border-theme text-muted-theme';
                        if (ans !== undefined) {
                          pillCls =
                            ans === item.correctIndex
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-rose-600 text-white border-rose-600';
                        }
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setQuizIdx(idx)}
                            className={`w-7 h-7 rounded-lg text-xs font-extrabold transition ${pillCls} ${
                              isCur ? 'ring-2 ring-teal-500 ring-offset-1' : 'opacity-85 hover:opacity-100'
                            }`}
                          >
                            {idx + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Enunciado */}
                  <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                    <DictionaryText text={q.statement} />
                  </p>

                  {/* Alternativas no estilo Banco de Questões */}
                  <div className="space-y-2">
                    {q.options.map((opt, oIdx) => {
                      const letter = LETTERS[oIdx] || String(oIdx + 1);
                      const cleanOpt = String(opt)
                        .replace(/^\(?[A-Ea-e]\)?[).:\-–—]\s+/, '')
                        .trim();
                      const isChosen = chosen === oIdx;
                      const isRight = chosen !== undefined && q.correctIndex === oIdx;
                      const isWrong = chosen !== undefined && isChosen && q.correctIndex !== oIdx;

                      let cls = 'border-theme bg-[var(--bg-card)] hover:border-teal-500/60';
                      let bdg = 'subtle-surface border border-theme';
                      if (isRight) {
                        cls = 'border-2 border-emerald-500 bg-emerald-500/15 shadow-xs';
                        bdg = 'bg-emerald-600 text-white border-emerald-600';
                      } else if (isWrong) {
                        cls = 'border-2 border-rose-500 bg-rose-500/15 shadow-xs';
                        bdg = 'bg-rose-600 text-white border-rose-600';
                      }

                      return (
                        <button
                          key={oIdx}
                          type="button"
                          disabled={chosen !== undefined}
                          onClick={() =>
                            void handleAnswerQuizQuestion(activeQuizJobId, activeQuizData, safeIdx, oIdx)
                          }
                          className={`w-full text-left rounded-2xl border p-3.5 flex items-start gap-3 transition ${cls}`}
                        >
                          <span
                            className={`w-7 h-7 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${bdg}`}
                          >
                            {letter}
                          </span>
                          <span className="flex-1 text-sm leading-relaxed"><DictionaryText text={cleanOpt} /></span>
                          {isRight && (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                          )}
                          {isWrong && (
                            <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Feedback imediato + Explicação */}
                  {chosen !== undefined && (
                    <div className="space-y-2.5 animate-fade-in-up">
                      {chosen === q.correctIndex ? (
                        <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-500/15 px-4 py-3 flex items-center gap-2.5 text-emerald-800 dark:text-emerald-200">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <div className="text-xs">
                            <p className="font-extrabold text-sm">Você acertou!</p>
                            <p>Gabarito: alternativa <strong>{LETTERS[q.correctIndex]}</strong>.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border-2 border-rose-500 bg-rose-500/15 px-4 py-3 flex items-center gap-2.5 text-rose-800 dark:text-rose-200">
                          <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                          <div className="text-xs">
                            <p className="font-extrabold text-sm">Você errou esta questão</p>
                            <p>
                              Você marcou <strong>{LETTERS[chosen]}</strong> · Gabarito:{' '}
                              <strong>{LETTERS[q.correctIndex]}</strong>. Enviada automaticamente para o{' '}
                              <strong>Caderno de Erros</strong>!
                            </p>
                          </div>
                        </div>
                      )}

                      {q.explanation && (
                        <div className="rounded-2xl subtle-surface p-4 text-xs text-muted-theme leading-relaxed whitespace-pre-wrap">
                          <strong>Comentário:</strong> <DictionaryText text={q.explanation} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Navegação Anterior / Próxima + Status */}
                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-theme flex-wrap">
                    <button
                      type="button"
                      disabled={safeIdx === 0}
                      onClick={() => setQuizIdx((i) => Math.max(0, i - 1))}
                      className="px-4 py-2 rounded-xl subtle-surface border border-theme text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Anterior
                    </button>

                    <div className="text-[11px] text-muted-theme text-center">
                      {savedStats
                        ? `✓ Salvo (${savedStats.correct}/${savedStats.total}) em Evolução & Mapa`
                        : `${answeredCount}/${totalQ} respondidas`}
                    </div>

                    {safeIdx < totalQ - 1 ? (
                      <button
                        type="button"
                        onClick={() => setQuizIdx((i) => Math.min(totalQ - 1, i + 1))}
                        className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                      >
                        Próxima
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    ) : !savedStats && answeredCount > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          void saveQuizStatsToEvolution(activeQuizJobId, activeQuizData, quizAnswers)
                        }
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                      >
                        Salvar Resultado ({hitsCount}/{answeredCount})
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveQuizJobId(null);
                          setActiveQuizRevId(null);
                        }}
                        className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
                      >
                        Concluir
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
