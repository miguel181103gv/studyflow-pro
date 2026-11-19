'use client';

import { useProfile } from '@/components/ProfileProvider';
import { calcAccuracy } from '@/lib/utils';
import { Star, Play } from 'lucide-react';

export default function PrioridadesPage() {
  const { profile, subjects, topics, studyLogs, errors, toggleTopicPriority, startStopwatch } =
    useProfile();

  const target = profile?.target_accuracy || 80;

  const ranked = topics
    .map((t) => {
      const sub = subjects.find((s) => s.id === t.subject_id);
      const tLogs = studyLogs.filter((l) => l.topic_id === t.id);
      const q = tLogs.reduce((a, b) => a + b.questions_total, 0);
      const c = tLogs.reduce((a, b) => a + b.questions_correct, 0);
      const acc = q > 0 ? calcAccuracy(c, q) : null;
      const errCnt = errors.filter((e) => e.topic_id === t.id).length;

      let urgency = 0;
      if (t.is_priority) urgency += 50;
      urgency += errCnt * 15;
      if (acc !== null && acc < target) urgency += (target - acc);

      return { topic: t, subject: sub, q, acc, errCnt, urgency };
    })
    .filter((r) => r.urgency > 0)
    .sort((a, b) => b.urgency - a.urgency);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Prioridade de Revisão</h1>
        <p className="text-sm text-muted-theme">
          Ranking inteligente que combina estrelas (★), erros cadastrados e taxa abaixo de {target}%.
        </p>
      </div>

      {ranked.length === 0 ? (
        <div className="card-surface rounded-2xl p-8 text-center text-sm text-muted-theme">
          Nenhum ponto crítico encontrado ainda. Marque ★ em tópicos importantes ou registre questões!
        </div>
      ) : (
        <div className="space-y-2.5">
          {ranked.map((item, idx) => (
            <div
              key={item.topic.id}
              className="card-surface rounded-2xl p-4 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-7 h-7 rounded-xl subtle-surface text-xs font-bold flex items-center justify-center shrink-0">
                  #{idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{item.topic.title}</p>
                  <p className="text-xs text-muted-theme">
                    {item.subject?.name}
                    {item.acc !== null ? ` • ${item.acc}% acerto` : ''}
                    {item.errCnt > 0 ? ` • ${item.errCnt} erros` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleTopicPriority(item.topic)}
                  className={`p-2 rounded-xl ${
                    item.topic.is_priority ? 'text-amber-500 bg-amber-500/15' : 'subtle-surface'
                  }`}
                >
                  <Star
                    className="w-4 h-4"
                    fill={item.topic.is_priority ? 'currentColor' : 'none'}
                  />
                </button>
                <button
                  onClick={() => startStopwatch(item.topic.subject_id, item.topic.id)}
                  className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold inline-flex items-center gap-1"
                >
                  <Play className="w-3.5 h-3.5" />
                  Revisar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
