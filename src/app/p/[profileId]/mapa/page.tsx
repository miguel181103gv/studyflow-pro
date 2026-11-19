'use client';

import { useProfile } from '@/components/ProfileProvider';
import { calcAccuracy } from '@/lib/utils';

export default function MapaAcertosPage() {
  const { profile, subjects, topics, studyLogs } = useProfile();
  const target = profile?.target_accuracy || 80;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mapa de Acertos</h1>
        <p className="text-sm text-muted-theme">
          Visão térmica de desempenho por matéria e tópico (Meta: {target}%).
        </p>
      </div>

      <div className="space-y-4">
        {subjects.map((sub) => {
          const sLogs = studyLogs.filter((l) => l.subject_id === sub.id);
          const sQ = sLogs.reduce((a, b) => a + b.questions_total, 0);
          const sC = sLogs.reduce((a, b) => a + b.questions_correct, 0);
          const sAcc = calcAccuracy(sC, sQ);
          const subTopics = topics.filter((t) => t.subject_id === sub.id);

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
                        {tQ > 0 ? `${tAcc}%` : '—'}
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
