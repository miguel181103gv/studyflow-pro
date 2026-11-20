'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { getYouTubeSearchUrl } from '@/lib/utils';
import { Check, Star, ChevronDown, ChevronRight, Youtube } from 'lucide-react';

export default function ProgressoEditalPage() {
  const { subjects, topics, toggleTopicStudied, toggleTopicPriority } = useProfile();

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
          <h1 className="text-2xl font-bold tracking-tight">Progresso do Edital</h1>
          <p className="text-sm text-muted-theme">
            Acompanhe sua porcentagem de avanço por matéria. As questões são registradas exclusivamente no Ciclo de Estudos para evitar duplicidade.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleExpandAll(true)}
            className="px-3 py-1.5 rounded-xl card-surface text-xs font-medium"
          >
            Expandir todas
          </button>
          <button
            onClick={() => toggleExpandAll(false)}
            className="px-3 py-1.5 rounded-xl card-surface text-xs font-medium"
          >
            Recolher todas
          </button>
        </div>
      </div>

      {/* Barra Geral do Edital */}
      <div className="card-surface rounded-2xl p-5 shadow-sm space-y-2">
        <div className="flex items-center justify-between text-sm font-bold">
          <span>Avanço Total do Edital</span>
          <span className="text-blue-600">
            {totalDone}/{totalTopics} tópicos ({overallPct}%)
          </span>
        </div>
        <div className="w-full h-3 rounded-full subtle-surface overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all duration-300"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {subjects.map((sub) => {
          const subTopics = topics.filter((t) => t.subject_id === sub.id);
          const done = subTopics.filter((t) => t.studied).length;
          const pct = subTopics.length > 0 ? Math.round((done / subTopics.length) * 100) : 0;
          const isOpen = openSubjects[sub.id] ?? false;

          return (
            <div key={sub.id} className="card-surface rounded-2xl overflow-hidden shadow-sm">
              <button
                onClick={() => setOpenSubjects((prev) => ({ ...prev, [sub.id]: !isOpen }))}
                className="w-full px-5 py-4 flex flex-col gap-2.5 text-left hover:opacity-90"
              >
                <div className="flex items-center justify-between gap-3 w-full">
                  <div className="flex items-center gap-3 min-w-0">
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0" />
                    )}
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: sub.color }}
                    />
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{sub.name}</p>
                      <p className="text-[11px] text-muted-theme">{sub.category}</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full subtle-surface shrink-0">
                    {done}/{subTopics.length} · {pct}%
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full subtle-surface overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: sub.color }}
                  />
                </div>
              </button>

              {isOpen && (
                <div className="px-5 pb-4 space-y-2 border-t border-theme pt-3">
                  {subTopics.map((topic) => (
                    <div
                      key={topic.id}
                      className="subtle-surface rounded-xl p-3 flex items-start justify-between gap-3"
                    >
                      <button
                        onClick={() => toggleTopicStudied(topic)}
                        className="flex items-start gap-3 text-left flex-1 min-w-0"
                      >
                        <span
                          className={`mt-0.5 w-5 h-5 rounded-lg flex items-center justify-center border shrink-0 transition ${
                            topic.studied
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-slate-400'
                          }`}
                        >
                          {topic.studied && <Check className="w-3.5 h-3.5" />}
                        </span>
                        <span
                          className={`text-xs sm:text-sm ${
                            topic.studied ? 'line-through text-muted-theme' : ''
                          }`}
                        >
                          {topic.title}
                        </span>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <a
                          href={topic.video_url || getYouTubeSearchUrl(sub.name, topic.title)}
                          target="_blank"
                          rel="noreferrer"
                          title={topic.video_url ? 'Abrir vídeo salvo' : 'Buscar aula no YouTube'}
                          className={`p-1.5 rounded-lg transition ${
                            topic.video_url
                              ? 'text-red-500 bg-red-500/15'
                              : 'text-muted-theme hover:text-red-500'
                          }`}
                        >
                          <Youtube className="w-4 h-4" />
                        </a>

                        <button
                          onClick={() => toggleTopicPriority(topic)}
                          title="Marcar prioridade"
                          className={`p-1.5 rounded-lg transition ${
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
