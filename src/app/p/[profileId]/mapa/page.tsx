'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { calcAccuracy } from '@/lib/utils';

export default function MapaAcertosPage() {
  const { profile, subjects, topics, studyLogs } = useProfile();
  const target = profile?.target_accuracy || 80;

  const [subjectFilter, setSubjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'with_q' | 'below' | 'above'>('all');
  const [searchTopic, setSearchTopic] = useState('');

  const visibleSubjects = subjectFilter
    ? subjects.filter((s) => s.id === subjectFilter)
    : subjects;

  const q = searchTopic.trim().toLowerCase();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mapa de Acertos</h1>
        <p className="text-sm text-muted-theme">
          Visão térmica de desempenho por matéria e tópico (Meta: {target}%).
        </p>
      </div>

      {/* Filtros do Mapa de Acertos */}
      <div className="card-surface rounded-2xl p-3 flex flex-col sm:flex-row gap-2.5">
        <input
          value={searchTopic}
          onChange={(e) => setSearchTopic(e.target.value)}
          placeholder="Buscar tópico ou matéria..."
          className="flex-1 rounded-xl subtle-surface border border-theme px-3.5 py-2 text-xs"
        />
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold sm:w-56"
        >
          <option value="">Todas as matérias</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold sm:w-48"
        >
          <option value="all">Todos os tópicos</option>
          <option value="with_q">Só com questões</option>
          <option value="below">Abaixo da meta (&lt; {target}%)</option>
          <option value="above">Na meta (&ge; {target}%)</option>
        </select>
      </div>

      <div className="space-y-4">
        {visibleSubjects.map((sub) => {
          const sLogs = studyLogs.filter((l) => l.subject_id === sub.id);
          const sQ = sLogs.reduce((a, b) => a + b.questions_total, 0);
          const sC = sLogs.reduce((a, b) => a + b.questions_correct, 0);
          const sAcc = calcAccuracy(sC, sQ);
          const subTopics = topics
            .filter((t) => t.subject_id === sub.id)
            .filter((t) => {
              if (q && !t.title.toLowerCase().includes(q) && !sub.name.toLowerCase().includes(q)) {
                return false;
              }
              if (statusFilter === 'all') return true;
              const tLogs = studyLogs.filter((l) => l.topic_id === t.id);
              const tQ = tLogs.reduce((a, b) => a + b.questions_total, 0);
              const tC = tLogs.reduce((a, b) => a + b.questions_correct, 0);
              const tAcc = calcAccuracy(tC, tQ);
              if (statusFilter === 'with_q') return tQ > 0;
              if (statusFilter === 'below') return tQ > 0 && tAcc < target;
              return tQ > 0 && tAcc >= target;
            });

          if ((q || statusFilter !== 'all') && subTopics.length === 0) return null;

          return (
            <div key={sub.id} className="card-surface rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold text-sm">{sub.name}</h2>
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    sQ === 0
                      ? 'subtle-surface text-muted-theme'
                      : sAcc >= target
                      ? 'bg-emerald-500/15 text-emerald-600'
                      : sAcc >= 60
                      ? 'bg-amber-500/15 text-amber-600'
                      : 'bg-red-500/15 text-red-500'
                  }`}
                >
                  {sQ > 0 ? `${sAcc}% (${sC}/${sQ})` : 'Sem questões'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {subTopics.map((t) => {
                  const tLogs = studyLogs.filter((l) => l.topic_id === t.id);
                  const tQ = tLogs.reduce((a, b) => a + b.questions_total, 0);
                  const tC = tLogs.reduce((a, b) => a + b.questions_correct, 0);
                  const tAcc = calcAccuracy(tC, tQ);

                  let tone = 'subtle-surface text-muted-theme';
                  if (tQ > 0) {
                    if (tAcc >= target) tone = 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30';
                    else if (tAcc >= 60) tone = 'bg-amber-500/15 text-amber-700 border border-amber-500/30';
                    else tone = 'bg-red-500/15 text-red-600 border border-red-500/30';
                  }

                  return (
                    <div
                      key={t.id}
                      className={`rounded-xl px-3 py-2 text-xs flex items-center justify-between gap-2 ${tone}`}
                    >
                      <span className="truncate">{t.title}</span>
                      <span className="font-bold shrink-0">
                        {tQ > 0 ? `${tAcc}% (${tC}/${tQ})` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
