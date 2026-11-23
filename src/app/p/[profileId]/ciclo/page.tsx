'use client';

import { useEffect, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { useGlobal } from '@/components/GlobalProvider';
import { addDaysISO, formatDurationHMS, formatDurationHM, formatDateBR, todayISO } from '@/lib/utils';
import {
  Play,
  Pause,
  RotateCcw,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Save,
  Plus,
  Minus,
  Trash2,
  X,
  BarChart3,
  Clock,
  Check,
  CheckSquare,
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

interface CustomTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; payload: { color: string; pct: number } }[];
}

function CycleTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const h = Math.floor(item.value / 60);
  const m = item.value % 60;
  return (
    <div className="rounded-2xl bg-slate-900/95 text-white px-4 py-3 shadow-2xl border border-white/10 backdrop-blur-md text-xs space-y-1">
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: item.payload.color }}
        />
        <span className="font-bold">{item.name}</span>
      </div>
      <p className="text-slate-300 pl-4">
        <strong className="text-white">
          {h}h {String(m).padStart(2, '0')}m
        </strong>{' '}
        · {item.payload.pct}% do ciclo
      </p>
    </div>
  );
}

export default function CicloPage() {
  const {
    profile,
    subjects,
    topics,
    studyLogs,
    stopwatch,
    startStopwatch,
    pauseStopwatch,
    resetStopwatch,
    setStopwatchNote,
    updateSubject,
    moveSubject,
    reorderSubject,
    addStudyLog,
    deleteStudyLog,
    deleteSubjectsBatch,
    toggleTopicStudied,
  } = useProfile();

  const [showModal, setShowModal] = useState(false);
  const [modalSubjectId, setModalSubjectId] = useState('');
  const [modalSelectedTopicIds, setModalSelectedTopicIds] = useState<string[]>([]);
  const [markTopicsDone, setMarkTopicsDone] = useState(true);
  const [modalHours, setModalHours] = useState('1');
  const [modalMinutes, setModalMinutes] = useState('0');
  const [modalDate, setModalDate] = useState(todayISO());
  const [modalPeriod, setModalPeriod] = useState('Manhã');
  const [modalMethod, setModalMethod] = useState('PDF + Questões');
  const [modalTotalQ, setModalTotalQ] = useState('0');
  const [modalCorrectQ, setModalCorrectQ] = useState('0');
  const [modalStopPoint, setModalStopPoint] = useState('');
  const [saving, setSaving] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [selectSubjectsMode, setSelectSubjectsMode] = useState(false);
  const [selectedSubIds, setSelectedSubIds] = useState<string[]>([]);
  const { notify } = useGlobal();

  // Reiniciar Ciclo: guarda apenas o marco temporal (preserva 100% das horas e estatísticas!)
  const cycleResetKey = `sf_cycle_reset_${profile?.id || 'default'}`;
  const [cycleResetAt, setCycleResetAt] = useState<string | null>(null);
  const [cycleNumber, setCycleNumber] = useState<number>(1);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(cycleResetKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setCycleResetAt(parsed.resetAt || null);
        setCycleNumber(parsed.cycleNumber || 1);
      } else {
        setCycleResetAt(null);
        setCycleNumber(1);
      }
    } catch {
      // ignore
    }
  }, [cycleResetKey]);

  function handleResetCycle() {
    if (
      !confirm(
        'Reiniciar o progresso deste ciclo para 0%? Todas as suas horas estudadas e estatísticas continuarão salvas normalmente.'
      )
    ) {
      return;
    }
    const nowIso = new Date().toISOString();
    const nextNum = cycleNumber + 1;
    setCycleResetAt(nowIso);
    setCycleNumber(nextNum);
    try {
      localStorage.setItem(
        cycleResetKey,
        JSON.stringify({ resetAt: nowIso, cycleNumber: nextNum })
      );
    } catch {
      // ignore
    }
    notify(`Ciclo #${nextNum} iniciado! Suas horas anteriores continuam salvas nas estatísticas.`, 'success');
  }

  const totalCycleMinutes = subjects.reduce(
    (acc, s) => acc + s.cycle_hours * 60 + s.cycle_minutes,
    0
  );
  const cycleLogs = cycleResetAt
    ? studyLogs.filter((l) => l.created_at > cycleResetAt)
    : studyLogs;
  const cycleStudiedSeconds = cycleLogs.reduce((acc, l) => acc + l.duration_seconds, 0);
  const totalStudiedSeconds = studyLogs.reduce((acc, l) => acc + l.duration_seconds, 0);

  const donutData = subjects.map((s) => {
    const val = Math.max(15, s.cycle_hours * 60 + s.cycle_minutes);
    return {
      name: s.name,
      value: val,
      color: s.color,
      pct: totalCycleMinutes > 0 ? Math.round((val / totalCycleMinutes) * 100) : 0,
    };
  });

  function adjustSubjectTime(subjectId: string, currentH: number, currentM: number, deltaMin: number) {
    const total = Math.max(15, Math.min(20 * 60, currentH * 60 + currentM + deltaMin));
    const nextH = Math.floor(total / 60);
    const nextM = total % 60;
    updateSubject(subjectId, { cycle_hours: nextH, cycle_minutes: nextM });
  }

  function openRegisterModal(prefillSubjectId?: string, useStopwatch = false) {
    const subId = prefillSubjectId || stopwatch.subjectId || subjects[0]?.id || '';
    setModalSubjectId(subId);
    setModalSelectedTopicIds([]);
    setMarkTopicsDone(true);
    if (useStopwatch && stopwatch.elapsedSeconds > 0) {
      const h = Math.floor(stopwatch.elapsedSeconds / 3600);
      const m = Math.max(1, Math.floor((stopwatch.elapsedSeconds % 3600) / 60));
      setModalHours(String(h));
      setModalMinutes(String(m));
    } else {
      setModalHours('1');
      setModalMinutes('0');
    }
    setModalDate(todayISO());
    setModalStopPoint(useStopwatch && stopwatch.quickNote ? stopwatch.quickNote : '');
    setShowModal(true);
  }

  async function handleSaveStudy(e: React.FormEvent) {
    e.preventDefault();
    if (!modalSubjectId) return;
    setSaving(true);
    const secs = (Number(modalHours) || 0) * 3600 + (Number(modalMinutes) || 0) * 60;
    const selectedTopicObjs = modalSelectedTopicIds
      .map((id) => topics.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    const notesText =
      selectedTopicObjs.length > 1
        ? `Tópicos estudados: ${selectedTopicObjs.map((t) => t.title).join(' | ')}`
        : '';

    await addStudyLog({
      subject_id: modalSubjectId,
      topic_id: modalSelectedTopicIds[0] || null,
      duration_seconds: secs,
      study_date: modalDate,
      period: modalPeriod,
      method: modalMethod,
      questions_total: Number(modalTotalQ) || 0,
      questions_correct: Math.min(Number(modalTotalQ) || 0, Number(modalCorrectQ) || 0),
      stop_point: modalStopPoint.slice(0, 500),
      notes: notesText,
    });

    let markedCount = 0;
    if (markTopicsDone && selectedTopicObjs.length > 0) {
      for (const tp of selectedTopicObjs) {
        if (!tp.studied) {
          await toggleTopicStudied(tp);
          markedCount++;
        }
      }
    }

    if (stopwatch.subjectId === modalSubjectId) {
      resetStopwatch();
    }
    setSaving(false);
    setShowModal(false);
    if (markedCount > 0) {
      notify(
        `Sessão salva! ${markedCount} ${markedCount === 1 ? 'tópico abatido' : 'tópicos abatidos'} da Agenda e próximos atualizados!`,
        'success'
      );
    } else {
      notify('Sessão salva e sincronizada com a Agenda!', 'success');
    }
  }

  const subjectTopics = topics.filter((t) => t.subject_id === modalSubjectId);

  // Estatísticas de Horas no Ciclo de Estudos
  const todayStr = todayISO();
  const last7Cutoff = addDaysISO(todayStr, -6);
  const last30Cutoff = addDaysISO(todayStr, -29);

  const todaySeconds = studyLogs
    .filter((l) => l.study_date === todayStr)
    .reduce((acc, l) => acc + l.duration_seconds, 0);
  const last7Seconds = studyLogs
    .filter((l) => l.study_date >= last7Cutoff && l.study_date <= todayStr)
    .reduce((acc, l) => acc + l.duration_seconds, 0);
  const last30Seconds = studyLogs
    .filter((l) => l.study_date >= last30Cutoff && l.study_date <= todayStr)
    .reduce((acc, l) => acc + l.duration_seconds, 0);
  const totalAllSeconds = studyLogs.reduce((acc, l) => acc + l.duration_seconds, 0);
  const avgDaily7Seconds = Math.round(last7Seconds / 7);

  const hoursBySubject = subjects
    .map((s) => {
      const secs = studyLogs
        .filter((l) => l.subject_id === s.id)
        .reduce((acc, l) => acc + l.duration_seconds, 0);
      const pct = totalAllSeconds > 0 ? Math.round((secs / totalAllSeconds) * 100) : 0;
      return { id: s.id, name: s.name, color: s.color || '#0d9488', secs, pct };
    })
    .sort((a, b) => b.secs - a.secs);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Ciclo de Estudos</h1>
          <p className="text-sm text-muted-theme mt-1">
            Arraste para ordenar suas matérias, ajuste a carga horária e use o cronômetro ao vivo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleResetCycle}
            title="Zera as barras do ciclo atual sem apagar suas horas estudadas nem estatísticas"
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl subtle-surface border border-theme hover:border-teal-500/50 text-xs font-bold transition"
          >
            <RotateCcw className="w-4 h-4 text-teal-600" />
            Reiniciar Ciclo
          </button>
          <button
            onClick={() => openRegisterModal()}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Registrar Estudo Manual
          </button>
        </div>
      </div>

      {/* Top Row: Donut Refinado + Cronômetro */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card-surface rounded-3xl p-6 flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-2">
            <h2 className="font-bold text-base">Distribuição do Ciclo</h2>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full subtle-surface text-muted-theme">
              {subjects.length} matérias
            </span>
          </div>

          <div className="relative h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={64}
                  outerRadius={94}
                  paddingAngle={3}
                  cornerRadius={8}
                  stroke="none"
                >
                  {donutData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CycleTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            {/* Texto central dentro do gráfico */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-theme">
                Meta Total
              </span>
              <span className="text-xl font-extrabold">
                {Math.floor(totalCycleMinutes / 60)}h {String(totalCycleMinutes % 60).padStart(2, '0')}m
              </span>
            </div>
          </div>

          <div className="w-full mt-2 pt-3 border-t border-theme space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-theme font-medium">Neste ciclo (#{cycleNumber}):</span>
              <span className="font-extrabold text-teal-600">
                {formatDurationHMS(cycleStudiedSeconds)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-theme">Total histórico acumulado:</span>
              <span className="font-bold text-muted-theme">
                {formatDurationHMS(totalStudiedSeconds)}
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 card-surface rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="font-bold text-lg mb-1">Cronômetro de Sessão</h2>
            <p className="text-sm text-muted-theme">
              Selecione qualquer matéria abaixo e clique em Estudar. Ao terminar, salve direto no seu histórico.
            </p>
          </div>

          <div className="my-6 flex flex-col sm:flex-row items-center justify-between gap-4 subtle-surface rounded-3xl p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-theme">
                Matéria ativa
              </p>
              <p className="text-lg font-extrabold mt-0.5">
                {subjects.find((s) => s.id === stopwatch.subjectId)?.name ||
                  'Nenhuma matéria selecionada'}
              </p>
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-extrabold tracking-wider text-teal-600">
              {formatDurationHMS(stopwatch.elapsedSeconds)}
            </div>
            <div className="flex items-center gap-2.5">
              {stopwatch.subjectId && (
                <>
                  <button
                    onClick={() =>
                      stopwatch.running
                        ? pauseStopwatch()
                        : startStopwatch(stopwatch.subjectId!)
                    }
                    className="p-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
                  >
                    {stopwatch.running ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={resetStopwatch}
                    className="p-3.5 rounded-2xl card-surface hover:opacity-80"
                    title="Zerar"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => openRegisterModal(stopwatch.subjectId!, true)}
                    className="px-5 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm"
                  >
                    <Save className="w-4 h-4" />
                    Finalizar & Salvar
                  </button>
                </>
              )}
            </div>
          </div>

          {stopwatch.subjectId ? (
            <input
              value={stopwatch.quickNote || ''}
              onChange={(e) => setStopwatchNote(e.target.value)}
              placeholder="Nota rápida / ponto de parada durante a sessão (já preenche ao salvar)..."
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-xs"
            />
          ) : (
            <p className="text-xs text-muted-theme">
              Dica: atalho <strong>Alt + P</strong> pausa ou retoma o cronômetro de qualquer tela.
            </p>
          )}
        </div>
      </div>

      {/* Lista de Matérias com Controles Grandes e Confortáveis */}
      <div className="card-surface rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="font-bold text-lg">Ordem e Carga Horária das Matérias</h2>
            <p className="text-xs text-muted-theme">
              Arraste os cartões para reordenar e use os botões − / + para ajustar de 15 em 15 minutos.
            </p>
          </div>
          {subjects.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {selectSubjectsMode && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedSubIds((prev) =>
                        prev.length === subjects.length ? [] : subjects.map((s) => s.id)
                      )
                    }
                    className="px-3 py-1.5 rounded-xl subtle-surface border border-theme text-xs font-bold"
                  >
                    {selectedSubIds.length === subjects.length ? 'Desmarcar todas' : 'Selecionar todas'}
                  </button>
                  <button
                    type="button"
                    disabled={selectedSubIds.length === 0}
                    onClick={async () => {
                      if (selectedSubIds.length === 0) return;
                      if (
                        !confirm(
                          `Excluir ${selectedSubIds.length} ${
                            selectedSubIds.length === 1 ? 'matéria selecionada' : 'matérias selecionadas'
                          } e seus tópicos? (Se quiser migrar grifos/vídeos antes, faça pelo Edital Verticalizado.)`
                        )
                      ) {
                        return;
                      }
                      await deleteSubjectsBatch(selectedSubIds);
                      setSelectedSubIds([]);
                      setSelectSubjectsMode(false);
                      notify('Matérias selecionadas excluídas!', 'success');
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Excluir ({selectedSubIds.length})
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectSubjectsMode((v) => !v);
                  setSelectedSubIds([]);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition ${
                  selectSubjectsMode
                    ? 'bg-rose-600 border-rose-600 text-white'
                    : 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20'
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {selectSubjectsMode ? 'Cancelar seleção' : 'Selecionar p/ excluir'}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {subjects.map((s, idx) => {
            const studiedForSubject = cycleLogs
              .filter((l) => l.subject_id === s.id)
              .reduce((a, b) => a + b.duration_seconds, 0);
            const targetSecs = (s.cycle_hours * 60 + s.cycle_minutes) * 60;
            const pct =
              targetSecs > 0 ? Math.min(100, Math.round((studiedForSubject / targetSecs) * 100)) : 0;

            const isDragging = draggedId === s.id;
            const isOver = dragOverId === s.id && draggedId !== s.id;

            return (
              <div
                key={s.id}
                draggable
                onDragStart={() => setDraggedId(s.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverId !== s.id) setDragOverId(s.id);
                }}
                onDragLeave={() => {
                  if (dragOverId === s.id) setDragOverId(null);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  if (draggedId && draggedId !== s.id) {
                    await moveSubject(draggedId, s.id);
                  }
                  setDraggedId(null);
                  setDragOverId(null);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDragOverId(null);
                }}
                className={`subtle-surface rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-grab active:cursor-grabbing transition-all ${
                  isDragging ? 'opacity-40 scale-[0.98]' : ''
                } ${isOver ? 'ring-2 ring-teal-500 bg-teal-500/10' : ''}`}
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  {selectSubjectsMode ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSubIds((prev) =>
                          prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                        );
                      }}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 shrink-0 transition ${
                        selectedSubIds.includes(s.id)
                          ? 'bg-rose-600 border-rose-600 text-white'
                          : 'bg-white dark:bg-slate-800 border-rose-400'
                      }`}
                    >
                      {selectedSubIds.includes(s.id) && <Check className="w-4 h-4 stroke-[3]" />}
                    </button>
                  ) : (
                    <GripVertical className="w-5 h-5 text-muted-theme shrink-0" />
                  )}
                  <span
                    className="w-10 h-10 rounded-2xl text-white text-sm font-extrabold flex items-center justify-center shrink-0 shadow-xs"
                    style={{ backgroundColor: s.color }}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-base truncate">{s.name}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <div className="w-36 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: s.color }}
                        />
                      </div>
                      <span className="text-xs font-medium text-muted-theme">
                        {formatDurationHM(studiedForSubject)} estudados ({pct}%)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Controles grandes de Tempo (- / +) + Botão Estudar */}
                <div className="flex items-center justify-between md:justify-end gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 card-surface rounded-2xl p-1.5 shadow-xs">
                    <button
                      type="button"
                      onClick={() => adjustSubjectTime(s.id, s.cycle_hours, s.cycle_minutes, -15)}
                      className="w-10 h-10 rounded-xl subtle-surface hover:bg-rose-500/15 hover:text-rose-600 flex items-center justify-center font-bold"
                      title="Diminuir 15 minutos"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <div className="px-3 text-center min-w-[82px]">
                      <p className="text-sm font-extrabold leading-none">
                        {s.cycle_hours}h {String(s.cycle_minutes).padStart(2, '0')}m
                      </p>
                      <p className="text-[10px] text-muted-theme mt-0.5">Meta</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => adjustSubjectTime(s.id, s.cycle_hours, s.cycle_minutes, 15)}
                      className="w-10 h-10 rounded-xl subtle-surface hover:bg-teal-500/15 hover:text-teal-600 flex items-center justify-center font-bold"
                      title="Aumentar 15 minutos"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex sm:hidden items-center gap-1.5">
                    <button
                      onClick={() => reorderSubject(s.id, 'up')}
                      disabled={idx === 0}
                      className="p-2.5 rounded-xl card-surface disabled:opacity-30"
                      title="Subir"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => reorderSubject(s.id, 'down')}
                      disabled={idx === subjects.length - 1}
                      className="p-2.5 rounded-xl card-surface disabled:opacity-30"
                      title="Descer"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    onClick={() => startStopwatch(s.id)}
                    className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Estudar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Últimos Estudos */}
      <div className="card-surface rounded-3xl p-6">
        <h2 className="font-bold text-lg mb-4">Últimos Estudos Registrados</h2>
        {studyLogs.length === 0 ? (
          <p className="text-sm text-muted-theme">Nenhum estudo registrado ainda.</p>
        ) : (
          <div className="space-y-2.5">
            {studyLogs.slice(0, 15).map((log) => {
              const s = subjects.find((sb) => sb.id === log.subject_id);
              const t = topics.find((tp) => tp.id === log.topic_id);
              return (
                <div
                  key={log.id}
                  className="subtle-surface rounded-2xl p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{s?.name || 'Matéria'}</span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full card-surface font-medium">
                        {log.method}
                      </span>
                      <span className="text-xs text-muted-theme">
                        {formatDateBR(log.study_date)} • {log.period}
                      </span>
                    </div>
                    {t && <p className="text-xs text-muted-theme truncate mt-1">{t.title}</p>}
                    {log.stop_point && (
                      <p className="text-xs text-teal-600 font-medium mt-1">
                        Parada: {log.stop_point}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right text-xs">
                      <p className="font-extrabold text-sm">{formatDurationHM(log.duration_seconds)}</p>
                      {log.questions_total > 0 && (
                        <p className="text-muted-theme font-medium">
                          {log.questions_correct}/{log.questions_total} q
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => deleteStudyLog(log.id)}
                      className="p-2 rounded-xl hover:bg-rose-500/15 text-muted-theme hover:text-rose-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Estatísticas de Horas */}
      <div className="card-surface rounded-3xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-base">Estatísticas de Horas</h2>
              <p className="text-xs text-muted-theme">
                Acompanhe seu tempo estudado por período e o total acumulado em cada matéria.
              </p>
            </div>
          </div>
          <span className="text-[11px] font-bold px-3 py-1 rounded-full subtle-surface border border-theme text-muted-theme inline-flex items-center gap-1">
            <Clock className="w-3 h-3 text-teal-600" />
            Média 7d: {formatDurationHM(avgDaily7Seconds)}/dia
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="subtle-surface rounded-2xl p-4 border border-theme">
            <p className="text-[11px] font-semibold text-muted-theme">Hoje</p>
            <p className="text-xl font-extrabold text-teal-600 dark:text-teal-400 mt-0.5">
              {formatDurationHM(todaySeconds)}
            </p>
          </div>
          <div className="subtle-surface rounded-2xl p-4 border border-theme">
            <p className="text-[11px] font-semibold text-muted-theme">Últimos 7 dias</p>
            <p className="text-xl font-extrabold mt-0.5">{formatDurationHM(last7Seconds)}</p>
          </div>
          <div className="subtle-surface rounded-2xl p-4 border border-theme">
            <p className="text-[11px] font-semibold text-muted-theme">Últimos 30 dias</p>
            <p className="text-xl font-extrabold mt-0.5">{formatDurationHM(last30Seconds)}</p>
          </div>
          <div className="subtle-surface rounded-2xl p-4 border border-theme">
            <p className="text-[11px] font-semibold text-muted-theme">Total Geral</p>
            <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
              {formatDurationHM(totalAllSeconds)}
            </p>
          </div>
        </div>

        {hoursBySubject.length > 0 && (
          <div className="space-y-2.5">
            <p className="text-xs font-bold text-muted-theme">Horas acumuladas por matéria</p>
            <div className="space-y-2">
              {hoursBySubject.map((item) => (
                <div key={item.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="font-semibold truncate">{item.name}</span>
                    </div>
                    <span className="font-bold shrink-0">
                      {formatDurationHM(item.secs)}{' '}
                      <span className="text-muted-theme font-normal">({item.pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full subtle-surface overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(item.secs > 0 ? 3 : 0, item.pct)}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modal Registrar Estudo */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-lg rounded-3xl p-6 shadow-2xl animate-pop-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Registrar Estudo</h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveStudy} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-theme mb-1">Matéria</label>
                <select
                  value={modalSubjectId}
                  onChange={(e) => {
                    setModalSubjectId(e.target.value);
                    setModalSelectedTopicIds([]);
                  }}
                  className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {(() => {
                const mainTopics = subjectTopics.filter((t) => !t.title.trim().startsWith('↳'));
                const unstudiedMain = mainTopics.filter((t) => !t.studied);
                const studiedMain = mainTopics.filter((t) => t.studied);
                const orderedList = [...unstudiedMain, ...studiedMain];
                const nextTwoIds = unstudiedMain.slice(0, 2).map((t) => t.id);

                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <label className="text-xs font-semibold text-muted-theme">
                        Tópicos estudados nesta sessão ({modalSelectedTopicIds.length} selecionado
                        {modalSelectedTopicIds.length === 1 ? '' : 's'})
                      </label>
                      {nextTwoIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setModalSelectedTopicIds(nextTwoIds)}
                          className="text-[11px] font-bold text-teal-600 dark:text-teal-400 hover:underline"
                        >
                          Selecionar os {nextTwoIds.length} previstos da Agenda
                        </button>
                      )}
                    </div>

                    {orderedList.length === 0 ? (
                      <p className="text-xs text-muted-theme subtle-surface rounded-xl px-3 py-2">
                        Nenhum tópico cadastrado nesta matéria ainda.
                      </p>
                    ) : (
                      <div className="max-h-40 overflow-y-auto rounded-2xl subtle-surface border border-theme p-2 space-y-1">
                        {orderedList.map((t) => {
                          const isChecked = modalSelectedTopicIds.includes(t.id);
                          const isPlannedToday = nextTwoIds.includes(t.id);
                          return (
                            <label
                              key={t.id}
                              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl cursor-pointer text-xs transition ${
                                isChecked
                                  ? 'bg-teal-500/15 font-bold'
                                  : 'hover:bg-black/5 dark:hover:bg-white/5'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() =>
                                  setModalSelectedTopicIds((prev) =>
                                    prev.includes(t.id)
                                      ? prev.filter((id) => id !== t.id)
                                      : [...prev, t.id]
                                  )
                                }
                                className="rounded accent-teal-600 shrink-0"
                              />
                              <span className={`flex-1 truncate ${t.studied ? 'line-through opacity-60' : ''}`}>
                                {t.title}
                              </span>
                              {isPlannedToday && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-600/15 text-teal-700 dark:text-teal-300 shrink-0">
                                  Previsto
                                </span>
                              )}
                              {t.studied && (
                                <span className="text-[10px] font-semibold text-emerald-600 shrink-0">
                                  Já estudado
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {modalSelectedTopicIds.length > 0 && (
                      <label className="flex items-center gap-2 text-[11px] font-semibold text-teal-700 dark:text-teal-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={markTopicsDone}
                          onChange={(e) => setMarkTopicsDone(e.target.checked)}
                          className="rounded accent-teal-600"
                        />
                        Marcar como vistos no Edital Verticalizado e abater automaticamente da Agenda (atualiza os próximos tópicos)
                      </label>
                    )}
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Horas</label>
                  <input
                    type="number"
                    min={0}
                    value={modalHours}
                    onChange={(e) => setModalHours(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Minutos</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={modalMinutes}
                    onChange={(e) => setModalMinutes(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2.5 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-muted-theme mb-1">Data</label>
                  <input
                    type="date"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Período</label>
                  <select
                    value={modalPeriod}
                    onChange={(e) => setModalPeriod(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2.5 text-sm"
                  >
                    <option>Manhã</option>
                    <option>Tarde</option>
                    <option>Noite</option>
                    <option>Madrugada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Método de Estudo</label>
                  <select
                    value={modalMethod}
                    onChange={(e) => setModalMethod(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2.5 text-sm"
                  >
                    <option>PDF + Questões</option>
                    <option>Videoaula</option>
                    <option>Lei Seca</option>
                    <option>Questões</option>
                    <option>Revisão / Grifos</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Total de Exercícios</label>
                  <input
                    type="number"
                    min={0}
                    value={modalTotalQ}
                    onChange={(e) => setModalTotalQ(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Número de Acertos</label>
                  <input
                    type="number"
                    min={0}
                    value={modalCorrectQ}
                    onChange={(e) => setModalCorrectQ(e.target.value)}
                    className="w-full rounded-2xl subtle-surface border border-theme px-3 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted-theme mb-1">
                  Ponto de Parada ({modalStopPoint.length}/500)
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={modalStopPoint}
                  onChange={(e) => setModalStopPoint(e.target.value)}
                  placeholder="Ex: Aula 03, página 28, parei em Atos Administrativos..."
                  className="w-full rounded-2xl subtle-surface border border-theme p-3 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 rounded-2xl subtle-surface text-sm font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold"
                >
                  {saving ? 'Salvando...' : 'Salvar Sessão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
