'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { calcAccuracy, formatDateBR, todayISO } from '@/lib/utils';
import type { SimuladoSubjectScore } from '@/lib/types';
import { Plus, Trash2, ClipboardCheck, X } from 'lucide-react';

export default function SimuladosPage() {
  const { subjects, simulados, addSimulado, deleteSimulado } = useProfile();

  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [board, setBoard] = useState('FCC / FGV');
  const [examDate, setExamDate] = useState(todayISO());
  const [totalQ, setTotalQ] = useState('60');
  const [correctQ, setCorrectQ] = useState('42');
  const [durationMin, setDurationMin] = useState('240');
  const [notes, setNotes] = useState('');
  const [subjectScores, setSubjectScores] = useState<
    Record<string, { total: string; correct: string }>
  >({});

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const breakdown: SimuladoSubjectScore[] = subjects
      .map((s) => {
        const entry = subjectScores[s.id];
        const t = Number(entry?.total || 0);
        const c = Math.min(t, Number(entry?.correct || 0));
        return { subject_id: s.id, subject_name: s.name, total: t, correct: c };
      })
      .filter((x) => x.total > 0);

    const computedTotal =
      breakdown.length > 0
        ? breakdown.reduce((a, b) => a + b.total, 0)
        : Number(totalQ) || 60;
    const computedCorrect =
      breakdown.length > 0
        ? breakdown.reduce((a, b) => a + b.correct, 0)
        : Math.min(computedTotal, Number(correctQ) || 0);

    await addSimulado({
      title: title.trim(),
      board,
      exam_date: examDate,
      total_questions: computedTotal,
      correct_answers: computedCorrect,
      duration_minutes: Number(durationMin) || 240,
      notes,
      subject_scores: breakdown,
    });
    setTitle('');
    setNotes('');
    setSubjectScores({});
    setShowAdd(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Simulados</h1>
          <p className="text-sm text-muted-theme">
            Registre seus simulados completos, acompanhe o tempo de prova e os acertos matéria por matéria.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Registrar Simulado
        </button>
      </div>

      {simulados.length === 0 ? (
        <div className="card-surface rounded-2xl p-10 text-center space-y-2">
          <ClipboardCheck className="w-10 h-10 mx-auto text-blue-500 opacity-70" />
          <p className="font-semibold text-sm">Nenhum simulado registrado</p>
          <p className="text-xs text-muted-theme">
            Registre seu primeiro simulado para acompanhar sua evolução geral e por matéria!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {simulados.map((sim) => {
            const pct = calcAccuracy(sim.correct_answers, sim.total_questions);
            return (
              <div key={sim.id} className="card-surface rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-bold text-base">{sim.title}</h2>
                    <p className="text-xs text-muted-theme">
                      {formatDateBR(sim.exam_date)} • {sim.board} • {sim.duration_minutes} min
                    </p>
                  </div>
                  <button
                    onClick={() => deleteSimulado(sim.id)}
                    className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-theme hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-blue-600">{pct}%</span>
                  <span className="text-xs text-muted-theme">
                    {sim.correct_answers} de {sim.total_questions} questões
                  </span>
                </div>

                {Array.isArray(sim.subject_scores) && sim.subject_scores.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {sim.subject_scores.map((sc, i) => (
                      <span
                        key={i}
                        className="text-[11px] px-2 py-0.5 rounded-lg subtle-surface"
                      >
                        {sc.subject_name}: <strong>{sc.correct}/{sc.total}</strong> ({calcAccuracy(sc.correct, sc.total)}%)
                      </span>
                    ))}
                  </div>
                )}

                {sim.notes && <p className="text-xs text-muted-theme">{sim.notes}</p>}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-lg rounded-3xl p-6 space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">Registrar Simulado</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-xl subtle-surface">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nome (ex: Prova TRT-4 2022 ou Simulado 01)"
                className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={board}
                  onChange={(e) => setBoard(e.target.value)}
                  placeholder="Banca"
                  className="rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                />
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-muted-theme">Total Questões</label>
                  <input
                    type="number"
                    value={totalQ}
                    onChange={(e) => setTotalQ(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-theme">Total Acertos</label>
                  <input
                    type="number"
                    value={correctQ}
                    onChange={(e) => setCorrectQ(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-theme">Tempo (min)</label>
                  <input
                    type="number"
                    value={durationMin}
                    onChange={(e) => setDurationMin(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-theme">
                <p className="text-xs font-bold text-muted-theme">
                  Acertos por Matéria (opcional — se preencher, calcula o total automaticamente)
                </p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {subjects.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate flex-1">{s.name}</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="Acert."
                        value={subjectScores[s.id]?.correct || ''}
                        onChange={(e) =>
                          setSubjectScores((prev) => ({
                            ...prev,
                            [s.id]: {
                              total: prev[s.id]?.total || '',
                              correct: e.target.value,
                            },
                          }))
                        }
                        className="w-16 rounded-lg subtle-surface border border-theme px-2 py-1 text-center"
                      />
                      <span>/</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="Total"
                        value={subjectScores[s.id]?.total || ''}
                        onChange={(e) =>
                          setSubjectScores((prev) => ({
                            ...prev,
                            [s.id]: {
                              total: e.target.value,
                              correct: prev[s.id]?.correct || '',
                            },
                          }))
                        }
                        className="w-16 rounded-lg subtle-surface border border-theme px-2 py-1 text-center"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observações (tempo, nota da redação/discursiva, cansaço...)"
                className="w-full rounded-xl subtle-surface border border-theme p-3 text-xs"
              />
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold"
              >
                Salvar Simulado
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
