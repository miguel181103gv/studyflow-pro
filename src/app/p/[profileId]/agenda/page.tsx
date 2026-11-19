'use client';

import { useProfile } from '@/components/ProfileProvider';
import { Play } from 'lucide-react';

const WEEK_DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

export default function AgendaPage() {
  const { profile, subjects, startStopwatch } = useProfile();
  const dailyMinutesGoal = Math.round((profile?.daily_hours_goal || 4) * 60);

  // Distribute subjects across Mon-Fri matching cycle order and daily hours goal
  const queue = subjects.map((s) => ({
    subject: s,
    remaining: Math.max(30, s.cycle_hours * 60 + s.cycle_minutes),
  }));

  const schedule: {
    day: string;
    blocks: { subjectId: string; name: string; color: string; minutes: number }[];
  }[] = [];

  let cursor = 0;
  for (const day of WEEK_DAYS) {
    let left = dailyMinutesGoal;
    const blocks: { subjectId: string; name: string; color: string; minutes: number }[] = [];
    let guard = 0;
    while (left >= 30 && subjects.length > 0 && guard < 20) {
      guard++;
      const current = queue[cursor % queue.length];
      const alloc = Math.min(left, Math.min(90, current.remaining));
      if (alloc > 0) {
        blocks.push({
          subjectId: current.subject.id,
          name: current.subject.name,
          color: current.subject.color,
          minutes: alloc,
        });
        left -= alloc;
        current.remaining -= alloc;
        if (current.remaining <= 0) {
          current.remaining = Math.max(30, current.subject.cycle_hours * 60 + current.subject.cycle_minutes);
        }
      }
      cursor++;
    }
    schedule.push({ day, blocks });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agenda Semanal</h1>
        <p className="text-sm text-muted-theme">
          Gerada automaticamente a partir da ordem do seu Ciclo e da meta de{' '}
          <strong>{profile?.daily_hours_goal || 4}h/dia</strong> (Segunda a Sexta). Sábado e Domingo livres para simulados e revisões.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {schedule.map((col) => (
          <div key={col.day} className="card-surface rounded-2xl p-4 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-theme">
              <h2 className="font-bold text-sm">{col.day}</h2>
              <span className="text-[11px] text-muted-theme">
                {(col.blocks.reduce((a, b) => a + b.minutes, 0) / 60).toFixed(1)}h
              </span>
            </div>
            <div className="space-y-2.5 flex-1">
              {col.blocks.map((blk, i) => (
                <div
                  key={i}
                  className="subtle-surface rounded-xl p-3 border-l-4 flex items-center justify-between gap-2"
                  style={{ borderLeftColor: blk.color }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{blk.name}</p>
                    <p className="text-[11px] text-muted-theme">
                      {Math.floor(blk.minutes / 60)}h{String(blk.minutes % 60).padStart(2, '0')}m
                    </p>
                  </div>
                  <button
                    onClick={() => startStopwatch(blk.subjectId)}
                    className="p-1.5 rounded-lg bg-blue-600/15 text-blue-600 hover:bg-blue-600 hover:text-white transition shrink-0"
                    title="Iniciar matéria"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
