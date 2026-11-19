'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { addDaysISO, formatDateBR, todayISO } from '@/lib/utils';
import { CheckCircle2, Sparkles, FileText, PlusCircle, Loader2, X } from 'lucide-react';

interface QuizQuestion {
  statement: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export default function RevisoesPage() {
  const { profile, reviews, subjects, topics, highlights, completeReview, addStudyLog } =
    useProfile();

  const today = todayISO();
  const next7 = addDaysISO(today, 7);
  const [filter, setFilter] = useState<'overdue' | 'today' | 'upcoming' | 'completed'>('today');

  // Quiz Gemini modal
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizTitle, setQuizTitle] = useState('');
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizError, setQuizError] = useState<string | null>(null);

  // Grifos modal
  const [highlightsTopicId, setHighlightsTopicId] = useState<string | null>(null);

  const filtered = reviews.filter((r) => {
    if (filter === 'completed') return r.completed;
    if (r.completed) return false;
    if (filter === 'overdue') return r.due_date < today;
    if (filter === 'today') return r.due_date <= today;
    return r.due_date > today && r.due_date <= next7;
  });

  async function openGeminiQuiz(subjectName: string, topicTitle: string) {
    setQuizTitle(`${subjectName} — ${topicTitle}`);
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizError(null);
    setQuizLoading(true);
    try {
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
      setQuizQuestions(json.data.questions || []);
    } catch (err) {
      setQuizError(err instanceof Error ? err.message : 'Erro ao gerar quiz.');
    } finally {
      setQuizLoading(false);
    }
  }

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
        <h1 className="text-2xl font-bold tracking-tight">Agenda de Revisões (1 · 7 · 30 dias)</h1>
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
              filter === tab.id ? 'bg-blue-600 text-white' : 'card-surface hover:opacity-80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card-surface rounded-2xl p-8 text-center text-sm text-muted-theme">
          Nenhuma revisão nesta aba. Marque tópicos em &ldquo;Registrar Estudos&rdquo; para agendar revisões!
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((rev) => {
            const sub = subjects.find((s) => s.id === rev.subject_id);
            const topic = topics.find((t) => t.id === rev.topic_id);
            const hlCount = highlights.filter((h) => h.topic_id === rev.topic_id).length;

            return (
              <div
                key={rev.id}
                className="card-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span
                      className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: sub?.color || '#2563eb' }}
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
                      openGeminiQuiz(sub?.name || 'Matéria', topic?.title || 'Tópico')
                    }
                    className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Quiz Gemini
                  </button>
                  {!rev.completed && (
                    <button
                      onClick={() => completeReview(rev.id)}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Concluir
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Grifos Modal */}
      {highlightsTopicId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-lg rounded-3xl p-6 max-h-[80vh] overflow-y-auto">
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
                Nenhum grifo salvo neste tópico ainda. Adicione grifos na aba &ldquo;Matérias e PDFs&rdquo;.
              </p>
            ) : (
              <div className="space-y-3">
                {topicHighlights.map((h) => (
                  <div
                    key={h.id}
                    className="rounded-xl p-3 text-sm text-slate-900"
                    style={{ backgroundColor: h.color }}
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
      {(quizLoading || quizQuestions.length > 0 || quizError) && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-2xl rounded-3xl p-6 my-8 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-600" />
                <h2 className="font-bold text-base">{quizTitle}</h2>
              </div>
              <button
                onClick={() => {
                  setQuizLoading(false);
                  setQuizQuestions([]);
                  setQuizError(null);
                }}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {quizLoading && (
              <div className="py-12 flex flex-col items-center gap-3 text-sm text-muted-theme">
                <Loader2 className="w-7 h-7 animate-spin text-violet-600" />
                <span>Gemini está elaborando 5 questões inéditas...</span>
              </div>
            )}

            {quizError && (
              <div className="p-4 rounded-xl bg-red-500/15 text-red-500 text-sm">{quizError}</div>
            )}

            <div className="space-y-5">
              {quizQuestions.map((q, qIdx) => {
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
                          else if (isChosen) style = 'bg-red-600 text-white';
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
          </div>
        </div>
      )}
    </div>
  );
}
