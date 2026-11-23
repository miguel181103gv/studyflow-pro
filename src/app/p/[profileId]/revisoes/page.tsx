'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { useGlobal } from '@/components/GlobalProvider';
import { addDaysISO, formatDateBR, todayISO } from '@/lib/utils';
import { CheckCircle2, Sparkles, FileText, PlusCircle, Loader2, X, Trash2 } from 'lucide-react';

interface QuizQuestion {
  statement: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface QuizResultData {
  title: string;
  questions: QuizQuestion[];
}

export default function RevisoesPage() {
  const {
    profile,
    reviews,
    subjects,
    topics,
    highlights,
    completeReview,
    postponeReview,
    deleteReview,
    addStudyLog,
  } = useProfile();
  const { aiJobs, runAiJob, dismissAiJob } = useGlobal();

  const today = todayISO();
  const next7 = addDaysISO(today, 7);
  const [filter, setFilter] = useState<'overdue' | 'today' | 'upcoming' | 'completed'>('today');

  // Active Quiz modal (backed by GlobalProvider so it persists even if user leaves screen)
  const [activeQuizJobId, setActiveQuizJobId] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});

  // Grifos modal
  const [highlightsTopicId, setHighlightsTopicId] = useState<string | null>(null);

  const filtered = reviews.filter((r) => {
    if (filter === 'completed') return r.completed;
    if (r.completed) return false;
    if (filter === 'overdue') return r.due_date < today;
    if (filter === 'today') return r.due_date <= today;
    return r.due_date > today && r.due_date <= next7;
  });

  function openGeminiQuiz(reviewId: string, subjectName: string, topicTitle: string) {
    const jobId = `quiz:${profile?.id || 'default'}:${reviewId}`;
    setQuizAnswers({});
    setActiveQuizJobId(jobId);

    const existing = aiJobs[jobId];
    if (existing?.status === 'running' || (existing?.status === 'done' && existing.result)) {
      return;
    }

    const title = `${subjectName} — ${topicTitle}`;
    runAiJob<QuizResultData>({
      id: jobId,
      kind: 'quiz',
      label: `Quiz Gemini: ${topicTitle}`,
      route: profile ? `/p/${profile.id}/revisoes` : undefined,
      successMsg: `Quiz de "${topicTitle}" pronto na aba Revisões!`,
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
          questions: (json.data.questions || []) as QuizQuestion[],
        };
      },
    });
  }

  const activeQuizJob = activeQuizJobId ? aiJobs[activeQuizJobId] : undefined;
  const activeQuizData = activeQuizJob?.result as QuizResultData | undefined;

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
            const isQuizReady = job?.status === 'done' && Boolean(job.result);

            return (
              <div
                key={rev.id}
                className="card-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span
                      className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: sub?.color || '#0d9488' }}
                    >
                      {sub?.name}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full subtle-surface font-medium">
                      Revisão {rev.interval_days}d
                    </span>
                    <span className="text-[11px] text-muted-theme">
                      Data: {formatDateBR(rev.due_date)}
                    </span>
                  </div>
                  <p className="font-semibold text-sm">{topic?.title || 'Tópico'}</p>
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <button
                    onClick={() => setHighlightsTopicId(rev.topic_id)}
                    className="px-3 py-1.5 rounded-xl subtle-surface text-xs font-medium inline-flex items-center gap-1"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Grifos ({hlCount})
                  </button>
                  <button
                    onClick={() => quickAddQuestions(rev.subject_id, rev.topic_id)}
                    className="px-3 py-1.5 rounded-xl subtle-surface text-xs font-medium inline-flex items-center gap-1"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    Questões
                  </button>
                  <button
                    onClick={() =>
                      openGeminiQuiz(rev.id, sub?.name || 'Matéria', topic?.title || 'Tópico')
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
                      : isQuizReady
                      ? 'Abrir Quiz Pronto'
                      : 'Quiz Gemini'}
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
      {activeQuizJobId && activeQuizJob && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-2xl rounded-3xl p-6 my-8 max-h-[88vh] overflow-y-auto animate-pop-in">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-600" />
                <h2 className="font-bold text-base">
                  {activeQuizData?.title || activeQuizJob.label}
                </h2>
              </div>
              <button
                onClick={() => {
                  if (activeQuizJob.status === 'done' || activeQuizJob.status === 'error') {
                    dismissAiJob(activeQuizJobId);
                  }
                  setActiveQuizJobId(null);
                }}
                className="p-2 rounded-xl subtle-surface"
                title={
                  activeQuizJob.status === 'running'
                    ? 'Fechar janela (o Gemini continuará gerando em segundo plano)'
                    : 'Fechar'
                }
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeQuizJob.status === 'running' && (
              <div className="py-12 flex flex-col items-center gap-3 text-sm text-muted-theme text-center">
                <Loader2 className="w-7 h-7 animate-spin text-violet-600" />
                <span>Gemini está elaborando 5 questões inéditas...</span>
                <span className="text-xs opacity-75">
                  Você pode fechar esta janela ou trocar de aba — avisaremos assim que ficar pronto.
                </span>
              </div>
            )}

            {activeQuizJob.status === 'error' && (
              <div className="p-4 rounded-xl bg-rose-500/15 text-rose-600 text-sm">
                {activeQuizJob.error}
              </div>
            )}

            {activeQuizData && (
              <div className="space-y-5">
                {activeQuizData.questions.map((q, qIdx) => {
                  const chosen = quizAnswers[qIdx];
                  return (
                    <div key={qIdx} className="subtle-surface rounded-2xl p-4 space-y-3">
                      <p className="text-sm font-semibold">
                        {qIdx + 1}. {q.statement}
                      </p>
                      <div className="space-y-1.5">
                        {q.options.map((opt, oIdx) => {
                          const isChosen = chosen === oIdx;
                          const isRight = q.correctIndex === oIdx;
                          let style = 'card-surface hover:opacity-85';
                          if (chosen !== undefined) {
                            if (isRight) style = 'bg-emerald-600 text-white';
                            else if (isChosen) style = 'bg-rose-600 text-white';
                          }
                          return (
                            <button
                              key={oIdx}
                              disabled={chosen !== undefined}
                              onClick={() =>
                                setQuizAnswers((prev) => ({ ...prev, [qIdx]: oIdx }))
                              }
                              className={`w-full text-left px-3 py-2 rounded-xl text-xs transition ${style}`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                      {chosen !== undefined && (
                        <p className="text-xs text-muted-theme pt-2 border-t border-theme">
                          <strong>Comentário:</strong> {q.explanation}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
