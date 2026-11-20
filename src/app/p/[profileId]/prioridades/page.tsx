'use client';

import { useEffect, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { calcAccuracy } from '@/lib/utils';
import { Star, Play } from 'lucide-react';

type Difficulty = 'facil' | 'medio' | 'dificil';

export default function PrioridadesPage() {
  const { profile, subjects, topics, studyLogs, errors, toggleTopicPriority, startStopwatch } =
    useProfile();

  const [difficultyMap, setDifficultyMap] = useState<Record<string, Difficulty>>({});
  const diffStorageKey = `sf_topic_difficulty_${profile?.id || 'default'}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(diffStorageKey);
      if (raw) setDifficultyMap(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, [diffStorageKey]);

  const target = profile?.target_accuracy || 80;

  const ranked = topics
    .map((t) => {
      const sub = subjects.find((s) => s.id === t.subject_id);
      const tLogs = studyLogs.filter((l) => l.topic_id === t.id);
      const q = tLogs.reduce((a, b) => a + b.questions_total, 0);
      const c = tLogs.reduce((a, b) => a + b.questions_correct, 0);
      const acc = q > 0 ? calcAccuracy(c, q) : null;
      const errCnt = errors.filter((e) => e.topic_id === t.id).length;
      const diff = difficultyMap[t.id];

      let urgency = 0;
      const reasons: string[] = [];

      if (diff === 'dificil') {
        urgency += 200;
        reasons.push('Marcado como Difícil');
      } else if (diff === 'medio') {
        urgency += 100;
        reasons.push('Marcado como Médio');
      }
      if (t.is_priority) {
        urgency += 40;
        reasons.push('Favorito (★)');
      }
      if (errCnt > 0) {
        urgency += errCnt * 15;
        reasons.push(`${errCnt} erro(s) no caderno`);
      }
      if (acc !== null && acc < target) {
        urgency += target - acc;
        reasons.push(`${acc}% de acerto (abaixo de ${target}%)`);
      }

      return { topic: t, subject: sub, q, acc, errCnt, diff, reasons, urgency };
    })
    .filter((r) => r.urgency > 0)
    .sort((a, b) => b.urgency - a.urgency);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Prioridades de Revisão</h1>
        <p className="text-sm text-muted-theme mt-1">
          Ordenado por dificuldade (<strong>Difícil → Médio</strong>), erros no caderno, estrelas (★) e desempenho abaixo de {target}%.
        </p>
      </div>

      {ranked.length === 0 ? (
        <div className="card-surface rounded-3xl p-10 text-center text-sm text-muted-theme">
          Nenhum tópico prioritário ainda. Conclua tópicos no <strong>Edital Verticalizado</strong> marcando como <strong>Médio</strong> ou <strong>Difícil</strong>, ou marque ★ nos pontos críticos!
        </div>
      ) : (
        <div className="space-y-3">
          {ranked.map((item, idx) => (
            <div
              key={item.topic.id}
              className="card-surface rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3.5 min-w-0">
                <span className="w-8 h-8 rounded-xl subtle-surface text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                  #{idx + 1}
                </span>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold">{item.topic.title}</p>
                    {item.diff === 'dificil' && (
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-700">
                        🔥 Difícil
                      </span>
                    )}
                    {item.diff === 'medio' && (
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-800">
                        🤔 Médio
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-theme">
                    <strong>{item.subject?.name}</strong> · Motivo: {item.reasons.join(' · ')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <button
                  onClick={() => toggleTopicPriority(item.topic)}
                  className={`p-2.5 rounded-xl ${
                    item.topic.is_priority ? 'bg-amber-500 text-white' : 'subtle-surface'
                  }`}
                >
                  <Star
                    className="w-4 h-4"
                    fill={item.topic.is_priority ? 'currentColor' : 'none'}
                  />
                </button>
                <button
                  onClick={() => startStopwatch(item.topic.subject_id, item.topic.id)}
                  className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Revisar agora
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
