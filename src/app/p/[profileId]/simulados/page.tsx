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
    Record<string, { total: string; correct: string; weight: string }>
  >({});

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const breakdown: SimuladoSubjectScore[] = subjects
      .map((s) => {
        const entry = subjectScores[s.id];
        const t = Number(entry?.total || 0);
        const c = Math.min(t, Number(entry?.correct || 0));
        const w = Math.max(0.1, Number(entry?.weight || 1));
        return { subject_id: s.id, subject_name: s.name, total: t, correct: c, weight: w };
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
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Simulados</h1>
          <p className="text-sm text-muted-theme mt-1">
            Registre seus simulados completos com suporte a pesos diferentes por matéria (padrão 1).
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-5 py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          Registrar Simulado
        </button>
      </div>

      {simulados.length === 0 ? (
        <div className="card-surface rounded-3xl p-12 text-center space-y-2">
          <ClipboardCheck className="w-12 h-12 mx-auto text-teal-500 opacity-75" />
          <p className="font-bold text-base">Nenhum simulado registrado</p>
          <p className="text-sm text-muted-theme">
            Registre seu primeiro simulado para acompanhar a nota bruta e ponderada por matéria!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {simulados.map((sim) => {
            const scores = Array.isArray(sim.subject_scores) ? sim.subject_scores : [];
            const hasWeighted = scores.some((sc) => (sc.weight ?? 1) !== 1);
            const weightedEarned = scores.reduce((a, b) => a + b.correct * (b.weight ?? 1), 0);
            const weightedMax = scores.reduce((a, b) => a + b.total * (b.weight ?? 1), 0);
            const displayPct =
              hasWeighted && weightedMax > 0
                ? Math.round((weightedEarned / weightedMax) * 100)
                : calcAccuracy(sim.correct_answers, sim.total_questions);

            return (
              <div key={sim.id} className="card-surface rounded-3xl p-6 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-bold text-base">{sim.title}</h2>
                    <p className="text-xs text-muted-theme mt-0.5">
                      {formatDateBR(sim.exam_date)} • {sim.board} • {sim.duration_minutes} min
                    </p>
                  </div>
                  <button
                    onClick={() => deleteSimulado(sim.id)}
                    className="p-2 rounded-xl hover:bg-rose-500/15 text-muted-theme hover:text-rose-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-3xl font-extrabold text-teal-600">{displayPct}%</span>
                  <span className="text-xs text-muted-theme">
                    {sim.correct_answers}/{sim.total_questions} questões
                    {hasWeighted && (
                      <strong className="ml-2 text-indigo-600">
                        · {weightedEarned.toFixed(1)}/{weightedMax.toFixed(1)} pts (ponderado)
                      </strong>
                    )}
                  </span>
                </div>

                {scores.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {scores.map((sc, i) => (
                      <span
                        key={i}
                        className="text-xs px-2.5 py-1 rounded-xl subtle-surface font-medium"
                      >
                        {sc.subject_name}: <strong>{sc.correct}/{sc.total}</strong>
                        {(sc.weight ?? 1) !== 1 && (
                          <span className="text-indigo-600 font-bold"> (p.{sc.weight})</span>
                        )}
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
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-xl rounded-3xl p-6 space-y-4 my-8 max-h-[90vh] overflow-y-auto animate-pop-in">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">Registrar Simulado</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-xl subtle-surface">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nome (ex: Prova TRT-4 2022 ou Simulado 01)"
                className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={board}
                  onChange={(e) => setBoard(e.target.value)}
                  placeholder="Banca"
                  className="rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                />
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="text-xs text-muted-theme font-medium">Total Questões</label>
                  <input
                    type="number"
                    value={totalQ}
                    onChange={(e) => setTotalQ(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-theme font-medium">Total Acertos</label>
                  <input
                    type="number"
                    value={correctQ}
                    onChange={(e) => setCorrectQ(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-theme font-medium">Tempo (min)</label>
                  <input
                    type="number"
                    value={durationMin}
                    onChange={(e) => setDurationMin(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2 text-sm mt-1"
                  />
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-theme">
                <div className="flex items-center justify-between text-xs font-bold text-muted-theme">
                  <span>Acertos & Peso por Matéria (padrão = 1)</span>
                  <div className="flex items-center gap-3 pr-1">
                    <span className="w-14 text-center">Acert.</span>
                    <span className="w-14 text-center">Total</span>
                    <span className="w-14 text-center">Peso</span>
                  </div>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {subjects.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate flex-1 font-medium">{s.name}</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={subjectScores[s.id]?.correct || ''}
                        onChange={(e) =>
                          setSubjectScores((prev) => ({
                            ...prev,
                            [s.id]: {
                              total: prev[s.id]?.total || '',
                              correct: e.target.value,
                              weight: prev[s.id]?.weight || '1',
                            },
                          }))
                        }
                        className="w-14 rounded-xl subtle-surface border border-theme px-2 py-1.5 text-center"
                      />
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={subjectScores[s.id]?.total || ''}
                        onChange={(e) =>
                          setSubjectScores((prev) => ({
                            ...prev,
                            [s.id]: {
                              total: e.target.value,
                              correct: prev[s.id]?.correct || '',
                              weight: prev[s.id]?.weight || '1',
                            },
                          }))
                        }
                        className="w-14 rounded-xl subtle-surface border border-theme px-2 py-1.5 text-center"
                      />
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={subjectScores[s.id]?.weight ?? '1'}
                        onChange={(e) =>
                          setSubjectScores((prev) => ({
                            ...prev,
                            [s.id]: {
                              total: prev[s.id]?.total || '',
                              correct: prev[s.id]?.correct || '',
                              weight: e.target.value,
                            },
                          }))
                        }
                        className="w-14 rounded-xl subtle-surface border border-theme px-2 py-1.5 text-center font-bold text-indigo-600"
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
                className="w-full rounded-2xl subtle-surface border border-theme p-3 text-xs"
              />
              <button
                type="submit"
                className="w-full py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold"
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
