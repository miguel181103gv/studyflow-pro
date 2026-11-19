'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { formatDurationHMS, formatDurationHM, formatDateBR, todayISO } from '@/lib/utils';
import {
  Play,
  Pause,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  Save,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

export default function CicloPage() {
  const {
    subjects,
    topics,
    studyLogs,
    stopwatch,
    startStopwatch,
    pauseStopwatch,
    resetStopwatch,
    updateSubject,
    reorderSubject,
    addStudyLog,
    deleteStudyLog,
  } = useProfile();

  const [showModal, setShowModal] = useState(false);
  const [modalSubjectId, setModalSubjectId] = useState('');
  const [modalTopicId, setModalTopicId] = useState('');
  const [modalHours, setModalHours] = useState('1');
  const [modalMinutes, setModalMinutes] = useState('0');
  const [modalDate, setModalDate] = useState(todayISO());
  const [modalPeriod, setModalPeriod] = useState('Manhã');
  const [modalMethod, setModalMethod] = useState('PDF + Questões');
  const [modalTotalQ, setModalTotalQ] = useState('0');
  const [modalCorrectQ, setModalCorrectQ] = useState('0');
  const [modalStopPoint, setModalStopPoint] = useState('');
  const [saving, setSaving] = useState(false);

  const totalCycleMinutes = subjects.reduce(
    (acc, s) => acc + s.cycle_hours * 60 + s.cycle_minutes,
    0
  );
  const totalStudiedSeconds = studyLogs.reduce((acc, l) => acc + l.duration_seconds, 0);

  const donutData = subjects.map((s) => ({
    name: s.name,
    value: Math.max(15, s.cycle_hours * 60 + s.cycle_minutes),
    color: s.color,
  }));

  function openRegisterModal(prefillSubjectId?: string, useStopwatch = false) {
    const subId = prefillSubjectId || stopwatch.subjectId || subjects[0]?.id || '';
    setModalSubjectId(subId);
    setModalTopicId('');
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
    setModalStopPoint('');
    setShowModal(true);
  }

  async function handleSaveStudy(e: React.FormEvent) {
    e.preventDefault();
    if (!modalSubjectId) return;
    setSaving(true);
    const secs = (Number(modalHours) || 0) * 3600 + (Number(modalMinutes) || 0) * 60;
    await addStudyLog({
      subject_id: modalSubjectId,
      topic_id: modalTopicId || null,
      duration_seconds: secs,
      study_date: modalDate,
      period: modalPeriod,
      method: modalMethod,
      questions_total: Number(modalTotalQ) || 0,
      questions_correct: Math.min(Number(modalTotalQ) || 0, Number(modalCorrectQ) || 0),
      stop_point: modalStopPoint.slice(0, 500),
      notes: '',
    });
    if (stopwatch.subjectId === modalSubjectId) {
      resetStopwatch();
    }
    setSaving(false);
    setShowModal(false);
  }

  const subjectTopics = topics.filter((t) => t.subject_id === modalSubjectId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ciclo de Estudos</h1>
          <p className="text-sm text-muted-theme">
            Ordene suas matérias, ajuste a carga horária e use o cronômetro ao vivo.
          </p>
        </div>
        <button
          onClick={() => openRegisterModal()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          Registrar Estudo Manual
        </button>
      </div>

      {/* Top Row: Donut + Active Stopwatch */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card-surface rounded-2xl p-5 shadow-sm flex flex-col items-center">
          <h2 className="font-bold text-sm self-start mb-2">Distribuição do Ciclo</h2>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {donutData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `${Math.floor(v / 60)}h ${v % 60}m`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="text-center mt-1">
            <p className="text-xs text-muted-theme">Estudado vs. Meta do Ciclo</p>
            <p className="text-sm font-bold">
              {formatDurationHMS(totalStudiedSeconds)} / {Math.floor(totalCycleMinutes / 60)}h{' '}
              {String(totalCycleMinutes % 60).padStart(2, '0')}m
            </p>
          </div>
        </div>

        <div className="lg:col-span-2 card-surface rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="font-bold text-base mb-1">Cronômetro de Sessão</h2>
            <p className="text-xs text-muted-theme">
              Selecione qualquer matéria abaixo e clique em Play. Ao terminar, salve direto no seu histórico.
            </p>
          </div>

          <div className="my-6 flex flex-col sm:flex-row items-center justify-between gap-4 subtle-surface rounded-2xl p-5">
            <div>
              <p className="text-xs text-muted-theme">Matéria ativa</p>
              <p className="text-lg font-bold">
                {subjects.find((s) => s.id === stopwatch.subjectId)?.name ||
                  'Nenhuma matéria selecionada'}
              </p>
            </div>
            <div className="text-4xl font-mono font-bold tracking-wider text-blue-600">
              {formatDurationHMS(stopwatch.elapsedSeconds)}
            </div>
            <div className="flex items-center gap-2">
              {stopwatch.subjectId && (
                <>
                  <button
                    onClick={() =>
                      stopwatch.running
                        ? pauseStopwatch()
                        : startStopwatch(stopwatch.subjectId!)
                    }
                    className="p-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    {stopwatch.running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={resetStopwatch}
                    className="p-3 rounded-xl card-surface hover:opacity-80"
                    title="Zerar"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openRegisterModal(stopwatch.subjectId!, true)}
                    className="px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Save className="w-4 h-4" />
                    Finalizar & Salvar
                  </button>
                </>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-theme">
            Dica: você pode navegar por outras abas enquanto o cronômetro continua rodando no topo.
          </p>
        </div>
      </div>

      {/* Reorderable Subject List */}
      <div className="card-surface rounded-2xl p-5 shadow-sm">
        <h2 className="font-bold text-base mb-4">Ordem e Carga Horária das Matérias</h2>
        <div className="space-y-2.5">
          {subjects.map((s, idx) => {
            const studiedForSubject = studyLogs
              .filter((l) => l.subject_id === s.id)
              .reduce((a, b) => a + b.duration_seconds, 0);
            const targetSecs = (s.cycle_hours * 60 + s.cycle_minutes) * 60;
            const pct = targetSecs > 0 ? Math.min(100, Math.round((studiedForSubject / targetSecs) * 100)) : 0;

            return (
              <div
                key={s.id}
                className="subtle-surface rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    className="w-8 h-8 rounded-xl text-white text-xs font-bold flex items-center justify-center shrink-0"
                    style={{ backgroundColor: s.color }}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{s.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-28 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: s.color }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-theme">
                        {formatDurationHM(studiedForSubject)} estudados ({pct}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 text-xs card-surface rounded-xl px-2 py-1">
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={s.cycle_hours}
                      onChange={(e) =>
                        updateSubject(s.id, { cycle_hours: Math.max(0, Number(e.target.value)) })
                      }
                      className="w-10 text-center bg-transparent font-semibold focus:outline-none"
                    />
                    <span className="text-muted-theme">h</span>
                    <input
                      type="number"
                      min={0}
                      max={55}
                      step={5}
                      value={s.cycle_minutes}
                      onChange={(e) =>
                        updateSubject(s.id, {
                          cycle_minutes: Math.min(59, Math.max(0, Number(e.target.value))),
                        })
                      }
                      className="w-10 text-center bg-transparent font-semibold focus:outline-none"
                    />
                    <span className="text-muted-theme">m</span>
                  </div>

                  <button
                    onClick={() => reorderSubject(s.id, 'up')}
                    disabled={idx === 0}
                    className="p-2 rounded-xl card-surface disabled:opacity-30"
                    title="Subir"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => reorderSubject(s.id, 'down')}
                    disabled={idx === subjects.length - 1}
                    className="p-2 rounded-xl card-surface disabled:opacity-30"
                    title="Descer"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => startStopwatch(s.id)}
                    className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Estudar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Últimos Estudos */}
      <div className="card-surface rounded-2xl p-5 shadow-sm">
        <h2 className="font-bold text-base mb-4">Últimos Estudos Registrados</h2>
        {studyLogs.length === 0 ? (
          <p className="text-sm text-muted-theme">Nenhum estudo registrado ainda.</p>
        ) : (
          <div className="space-y-2">
            {studyLogs.slice(0, 15).map((log) => {
              const s = subjects.find((sb) => sb.id === log.subject_id);
              const t = topics.find((tp) => tp.id === log.topic_id);
              return (
                <div
                  key={log.id}
                  className="subtle-surface rounded-xl p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{s?.name || 'Matéria'}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full card-surface">
                        {log.method}
                      </span>
                      <span className="text-[11px] text-muted-theme">
                        {formatDateBR(log.study_date)} • {log.period}
                      </span>
                    </div>
                    {t && <p className="text-xs text-muted-theme truncate mt-0.5">{t.title}</p>}
                    {log.stop_point && (
                      <p className="text-xs text-blue-600 mt-0.5">Parada: {log.stop_point}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right text-xs">
                      <p className="font-bold">{formatDurationHM(log.duration_seconds)}</p>
                      {log.questions_total > 0 && (
                        <p className="text-muted-theme">
                          {log.questions_correct}/{log.questions_total} q
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => deleteStudyLog(log.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-theme hover:text-red-500"
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

      {/* Modal Registrar Estudo */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-lg rounded-3xl p-6 shadow-2xl">
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
                <label className="block text-xs font-medium text-muted-theme mb-1">Matéria</label>
                <select
                  value={modalSubjectId}
                  onChange={(e) => {
                    setModalSubjectId(e.target.value);
                    setModalTopicId('');
                  }}
                  className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-theme mb-1">
                  Tópico (opcional)
                </label>
                <select
                  value={modalTopicId}
                  onChange={(e) => setModalTopicId(e.target.value)}
                  className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                >
                  <option value="">Geral da matéria</option>
                  {subjectTopics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Horas</label>
                  <input
                    type="number"
                    min={0}
                    value={modalHours}
                    onChange={(e) => setModalHours(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
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
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-muted-theme mb-1">Data</label>
                  <input
                    type="date"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Período</label>
                  <select
                    value={modalPeriod}
                    onChange={(e) => setModalPeriod(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
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
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
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
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Número de Acertos</label>
                  <input
                    type="number"
                    min={0}
                    value={modalCorrectQ}
                    onChange={(e) => setModalCorrectQ(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
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
                  className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl subtle-surface text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
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
