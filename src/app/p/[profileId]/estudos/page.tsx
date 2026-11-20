'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { calcAccuracy, getYouTubeSearchUrl } from '@/lib/utils';
import { Check, Star, ChevronDown, ChevronRight, Youtube, CheckCircle2 } from 'lucide-react';

export default function ProgressoEditalPage() {
  const { subjects, topics, studyLogs, toggleTopicStudied, toggleTopicPriority } = useProfile();

  const [openSubjects, setOpenSubjects] = useState<Record<string, boolean>>({});

  const totalTopics = topics.length;
  const totalDone = topics.filter((t) => t.studied).length;
  const overallPct = totalTopics > 0 ? Math.round((totalDone / totalTopics) * 100) : 0;

  function toggleExpandAll(expand: boolean) {
    const next: Record<string, boolean> = {};
    subjects.forEach((s) => {
      next[s.id] = expand;
    });
    setOpenSubjects(next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edital Verticalizado</h1>
          <p className="text-sm text-muted-theme">
            Acompanhe tópico por tópico com cores semânticas de conclusão e desempenho por disciplina.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleExpandAll(true)}
            className="px-3.5 py-2 rounded-2xl card-surface text-xs font-semibold hover:opacity-85"
          >
            Expandir todas
          </button>
          <button
            onClick={() => toggleExpandAll(false)}
            className="px-3.5 py-2 rounded-2xl card-surface text-xs font-semibold hover:opacity-85"
          >
            Recolher todas
          </button>
        </div>
      </div>

      {/* Card de Progresso Geral estilo Estudei */}
      <div className="card-surface rounded-3xl p-6 space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-theme">
              Progresso no Edital
            </p>
            <p className="text-sm mt-1">
              <strong>{totalDone}</strong> de <strong>{totalTopics}</strong> tópicos concluídos em{' '}
              <strong>{subjects.length}</strong> disciplinas
            </p>
          </div>
          <span className="text-3xl font-extrabold text-teal-600">{overallPct}%</span>
        </div>
        <div className="w-full h-2.5 rounded-full subtle-surface overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      </div>

      {/* Lista de Disciplinas */}
      <div className="space-y-3">
        {subjects.map((sub) => {
          const subTopics = topics.filter((t) => t.subject_id === sub.id);
          const done = subTopics.filter((t) => t.studied).length;
          const pct = subTopics.length > 0 ? Math.round((done / subTopics.length) * 100) : 0;
          const isCompletedSubject = subTopics.length > 0 && done === subTopics.length;
          const isOpen = openSubjects[sub.id] ?? false;

          const subLogs = studyLogs.filter((l) => l.subject_id === sub.id);
          const subQ = subLogs.reduce((a, b) => a + b.questions_total, 0);
          const subC = subLogs.reduce((a, b) => a + b.questions_correct, 0);
          const subAcc = calcAccuracy(subC, subQ);

          return (
            <div
              key={sub.id}
              className={`rounded-3xl overflow-hidden transition-all border ${
                isCompletedSubject
                  ? 'bg-emerald-500/8 border-emerald-500/35 shadow-sm'
                  : 'card-surface'
              }`}
            >
              <button
                onClick={() => setOpenSubjects((prev) => ({ ...prev, [sub.id]: !isOpen }))}
                className="w-full px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left hover:opacity-95"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 font-bold text-xs"
                    style={{
                      backgroundColor: isCompletedSubject ? 'rgba(16,185,129,0.18)' : `${sub.color}1F`,
                      color: isCompletedSubject ? '#059669' : sub.color,
                    }}
                  >
                    {isCompletedSubject ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : isOpen ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm truncate">{sub.name}</p>
                      {isCompletedSubject && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                          Concluída
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-theme">{sub.category}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  {subQ > 0 && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted-theme">{subQ} q</span>
                      <span
                        className={`font-bold px-2 py-0.5 rounded-full text-[11px] ${
                          subAcc >= 80
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : subAcc >= 60
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : 'bg-rose-500/15 text-rose-600'
                        }`}
                      >
                        {subAcc}%
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2.5">
                    <div className="w-24 h-2 rounded-full subtle-surface overflow-hidden hidden sm:block">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: isCompletedSubject ? '#10b981' : sub.color,
                        }}
                      />
                    </div>
                    <span className="text-xs font-bold w-10 text-right">{pct}%</span>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 space-y-2 border-t border-theme pt-3.5">
                  {subTopics.map((topic) => (
                    <div
                      key={topic.id}
                      className={`rounded-2xl p-3.5 flex items-start justify-between gap-3 border transition-all ${
                        topic.studied
                          ? 'bg-emerald-500/10 border-emerald-500/25'
                          : 'subtle-surface border-transparent hover:border-theme'
                      }`}
                    >
                      <button
                        onClick={() => toggleTopicStudied(topic)}
                        className="flex items-start gap-3 text-left flex-1 min-w-0"
                      >
                        <span
                          className={`mt-0.5 w-5 h-5 rounded-lg flex items-center justify-center border shrink-0 transition ${
                            topic.studied
                              ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                          }`}
                        >
                          {topic.studied && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                        </span>
                        <div className="min-w-0">
                          <span
                            className={`text-xs sm:text-sm font-medium block ${
                              topic.studied
                                ? 'text-emerald-900 dark:text-emerald-200'
                                : ''
                            }`}
                          >
                            {topic.title}
                          </span>
                          {topic.studied && (
                            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                              Concluído · Revisões 1/7/30d agendadas
                            </span>
                          )}
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <a
                          href={topic.video_url || getYouTubeSearchUrl(sub.name, topic.title)}
                          target="_blank"
                          rel="noreferrer"
                          title={topic.video_url ? 'Abrir vídeo salvo' : 'Buscar aula no YouTube'}
                          className={`p-1.5 rounded-xl transition ${
                            topic.video_url
                              ? 'text-red-500 bg-red-500/12'
                              : 'text-muted-theme hover:text-red-500'
                          }`}
                        >
                          <Youtube className="w-4 h-4" />
                        </a>

                        <button
                          onClick={() => toggleTopicPriority(topic)}
                          title="Marcar prioridade"
                          className={`p-1.5 rounded-xl transition ${
                            topic.is_priority
                              ? 'text-amber-500 bg-amber-500/15'
                              : 'text-muted-theme hover:text-amber-500'
                          }`}
                        >
                          <Star
                            className="w-4 h-4"
                            fill={topic.is_priority ? 'currentColor' : 'none'}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
