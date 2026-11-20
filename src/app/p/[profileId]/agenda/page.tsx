'use client';

import { useEffect, useMemo, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { addDaysISO, formatDateBR, todayISO } from '@/lib/utils';
import {
  Play,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
  CalendarRange,
  SlidersHorizontal,
  ArrowRight,
  RotateCcw,
  StickyNote,
  Plus,
  Trash2,
  Check,
} from 'lucide-react';

interface ScheduledBlock {
  id: string;
  date: string;
  subjectId: string;
  name: string;
  color: string;
  minutes: number;
  done: boolean;
  overdue: boolean;
}

interface DayNote {
  id: string;
  date: string;
  text: string;
  done: boolean;
}

interface AgendaPrefs {
  studyDays: number[];
  blockMinutes: number;
  anchorDate: string;
  completedBlockIds: string[];
  movedOverrides: Record<string, string>;
  notes: DayNote[];
}

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

// Paleta pastel harmoniosa com contraste agradável (inspirada no Estudei)
const PASTEL_STYLES = [
  { bg: 'rgba(59, 130, 246, 0.14)', border: '#3b82f6', text: '#1e3a8a' },
  { bg: 'rgba(16, 185, 129, 0.15)', border: '#10b981', text: '#065f46' },
  { bg: 'rgba(245, 158, 11, 0.16)', border: '#f59e0b', text: '#78350f' },
  { bg: 'rgba(244, 63, 94, 0.14)', border: '#f43f5e', text: '#881337' },
  { bg: 'rgba(139, 92, 246, 0.14)', border: '#8b5cf6', text: '#4c1d95' },
  { bg: 'rgba(6, 182, 212, 0.14)', border: '#06b6d4', text: '#155e75' },
  { bg: 'rgba(236, 72, 153, 0.14)', border: '#ec4899', text: '#831843' },
  { bg: 'rgba(20, 184, 166, 0.15)', border: '#14b8a6', text: '#115e59' },
];

function parseISO(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toISO(dt: Date) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

function startOfWeekMonday(iso: string) {
  const dt = parseISO(iso);
  const dow = dt.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + diff);
  return toISO(dt);
}

export default function AgendaPage() {
  const { profile, subjects, studyLogs, startStopwatch, theme } = useProfile();

  const today = todayISO();
  const storageKey = `sf_agenda_prefs_${profile?.id || 'default'}`;
  const isDark = theme === 'obsidian' || theme === 'navy';

  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [cursorDate, setCursorDate] = useState(today);
  const [selectedNoteDate, setSelectedNoteDate] = useState(today);
  const [noteInput, setNoteInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [moveTargetBlock, setMoveTargetBlock] = useState<ScheduledBlock | null>(null);
  const [moveToDate, setMoveToDate] = useState(today);

  const [prefs, setPrefs] = useState<AgendaPrefs>({
    studyDays: [1, 2, 3, 4, 5],
    blockMinutes: 90,
    anchorDate: startOfWeekMonday(today),
    completedBlockIds: [],
    movedOverrides: {},
    notes: [],
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AgendaPrefs>;
        setPrefs((prev) => ({
          ...prev,
          ...parsed,
          notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        }));
      }
    } catch {
      // ignore
    }
  }, [storageKey]);

  function savePrefs(next: AgendaPrefs) {
    setPrefs(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  const dailyMinutesGoal = Math.round((profile?.daily_hours_goal || 4) * 60);

  const subjectPaletteIndex = useMemo(() => {
    const map: Record<string, number> = {};
    subjects.forEach((s, idx) => {
      map[s.id] = idx % PASTEL_STYLES.length;
    });
    return map;
  }, [subjects]);

  const allBlocks = useMemo(() => {
    if (subjects.length === 0) return [] as ScheduledBlock[];

    const cycleUnitBlocks: { subjectId: string; name: string; color: string; minutes: number }[] =
      [];
    subjects.forEach((s) => {
      let rem = Math.max(30, s.cycle_hours * 60 + s.cycle_minutes);
      while (rem > 0) {
        const chunk = Math.min(prefs.blockMinutes, rem);
        cycleUnitBlocks.push({
          subjectId: s.id,
          name: s.name,
          color: s.color,
          minutes: chunk,
        });
        rem -= chunk;
      }
    });

    if (cycleUnitBlocks.length === 0) return [] as ScheduledBlock[];

    const loggedSet = new Set(studyLogs.map((l) => `${l.study_date}::${l.subject_id}`));
    const result: ScheduledBlock[] = [];
    const dayUsedMinutes: Record<string, number> = {};

    const startDt = parseISO(prefs.anchorDate);
    const endHorizon = addDaysISO(cursorDate > today ? cursorDate : today, 70);

    let currentIso = toISO(startDt);
    let seqIndex = 0;

    function nextAvailableDate(fromIso: string, neededMinutes: number): string {
      let d = fromIso;
      for (let guard = 0; guard < 200; guard++) {
        const dow = parseISO(d).getDay();
        const isStudyDay = prefs.studyDays.length === 0 || prefs.studyDays.includes(dow);
        const used = dayUsedMinutes[d] || 0;
        if (isStudyDay && used + neededMinutes <= dailyMinutesGoal + 15) {
          return d;
        }
        d = addDaysISO(d, 1);
      }
      return d;
    }

    while (currentIso <= endHorizon && seqIndex < 600) {
      const unit = cycleUnitBlocks[seqIndex % cycleUnitBlocks.length];
      const blockId = `blk_${seqIndex}`;

      const overrideDate = prefs.movedOverrides[blockId];
      if (overrideDate && overrideDate > currentIso) {
        currentIso = overrideDate;
      }

      const assignedDate = nextAvailableDate(currentIso, unit.minutes);
      dayUsedMinutes[assignedDate] = (dayUsedMinutes[assignedDate] || 0) + unit.minutes;
      currentIso = assignedDate;

      const isDone =
        prefs.completedBlockIds.includes(blockId) ||
        loggedSet.has(`${assignedDate}::${unit.subjectId}`);

      result.push({
        id: blockId,
        date: assignedDate,
        subjectId: unit.subjectId,
        name: unit.name,
        color: unit.color,
        minutes: unit.minutes,
        done: isDone,
        overdue: assignedDate < today && !isDone,
      });

      seqIndex++;
    }

    return result;
  }, [subjects, studyLogs, prefs, dailyMinutesGoal, cursorDate, today]);

  const overdueBlocks = useMemo(() => allBlocks.filter((b) => b.overdue), [allBlocks]);

  const blocksByDate = useMemo(() => {
    const map: Record<string, ScheduledBlock[]> = {};
    allBlocks.forEach((b) => {
      if (!map[b.date]) map[b.date] = [];
      map[b.date].push(b);
    });
    return map;
  }, [allBlocks]);

  const notesByDate = useMemo(() => {
    const map: Record<string, DayNote[]> = {};
    prefs.notes.forEach((n) => {
      if (!map[n.date]) map[n.date] = [];
      map[n.date].push(n);
    });
    return map;
  }, [prefs.notes]);

  function addDayNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteInput.trim()) return;
    const newNote: DayNote = {
      id: `note_${Date.now()}`,
      date: selectedNoteDate,
      text: noteInput.trim(),
      done: false,
    };
    savePrefs({ ...prefs, notes: [newNote, ...prefs.notes] });
    setNoteInput('');
  }

  function toggleDayNote(id: string) {
    savePrefs({
      ...prefs,
      notes: prefs.notes.map((n) => (n.id === id ? { ...n, done: !n.done } : n)),
    });
  }

  function deleteDayNote(id: string) {
    savePrefs({
      ...prefs,
      notes: prefs.notes.filter((n) => n.id !== id),
    });
  }

  function toggleBlockDone(blockId: string) {
    const exists = prefs.completedBlockIds.includes(blockId);
    const next = exists
      ? prefs.completedBlockIds.filter((id) => id !== blockId)
      : [...prefs.completedBlockIds, blockId];
    savePrefs({ ...prefs, completedBlockIds: next });
  }

  function moveBlockAndRecalculate(blockId: string, newDate: string) {
    savePrefs({
      ...prefs,
      movedOverrides: {
        ...prefs.movedOverrides,
        [blockId]: newDate,
      },
    });
    setMoveTargetBlock(null);
  }

  function rescheduleAllOverdueToToday() {
    if (overdueBlocks.length === 0) return;
    moveBlockAndRecalculate(overdueBlocks[0].id, today);
  }

  function toggleStudyDay(dayIndex: number) {
    const exists = prefs.studyDays.includes(dayIndex);
    const next = exists
      ? prefs.studyDays.filter((d) => d !== dayIndex)
      : [...prefs.studyDays, dayIndex].sort();
    if (next.length === 0) return;
    savePrefs({ ...prefs, studyDays: next });
  }

  const weekStart = startOfWeekMonday(cursorDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));

  const cursorDt = parseISO(cursorDate);
  const monthYear = cursorDt.getFullYear();
  const monthIdx = cursorDt.getMonth();
  const firstDayOfMonth = new Date(monthYear, monthIdx, 1);
  const daysInMonth = new Date(monthYear, monthIdx + 1, 0).getDate();
  const startPad = firstDayOfMonth.getDay();
  const monthCells: (string | null)[] = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      toISO(new Date(monthYear, monthIdx, i + 1))
    ),
  ];

  function navigatePeriod(delta: number) {
    if (viewMode === 'week') {
      setCursorDate(addDaysISO(cursorDate, delta * 7));
    } else {
      const nextDt = new Date(monthYear, monthIdx + delta, 1);
      setCursorDate(toISO(nextDt));
    }
  }

  const selectedDayNotes = notesByDate[selectedNoteDate] || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agenda & Anotações</h1>
          <p className="text-sm text-muted-theme">
            Planejamento semanal/mensal com cores harmoniosas, recálculo automático e lembretes por data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-2xl card-surface p-1">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition ${
                viewMode === 'week' ? 'bg-teal-600 text-white' : ''
              }`}
            >
              <CalendarRange className="w-3.5 h-3.5" />
              Semanal
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition ${
                viewMode === 'month' ? 'bg-teal-600 text-white' : ''
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              Mensal
            </button>
          </div>

          <button
            onClick={() => setShowSettings((v) => !v)}
            className="px-3.5 py-2 rounded-2xl card-surface text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Replanejar
          </button>
        </div>
      </div>

      {/* Personalização */}
      {showSettings && (
        <div className="card-surface rounded-3xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-bold">Dias da semana de estudo:</p>
              <div className="flex flex-wrap gap-1.5">
                {DAY_LABELS.map((lbl, idx) => {
                  const active = prefs.studyDays.includes(idx);
                  return (
                    <button
                      key={lbl}
                      onClick={() => toggleStudyDay(idx)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                        active ? 'bg-teal-600 text-white' : 'subtle-surface text-muted-theme'
                      }`}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div>
                <label className="block text-muted-theme mb-1">Duração do bloco</label>
                <select
                  value={prefs.blockMinutes}
                  onChange={(e) =>
                    savePrefs({ ...prefs, blockMinutes: Number(e.target.value) })
                  }
                  className="rounded-xl subtle-surface border border-theme px-3 py-1.5 font-semibold"
                >
                  <option value={60}>1h por bloco</option>
                  <option value={90}>1h30 por bloco</option>
                  <option value={120}>2h por bloco</option>
                </select>
              </div>

              <div>
                <label className="block text-muted-theme mb-1">Início da Agenda</label>
                <input
                  type="date"
                  value={prefs.anchorDate}
                  onChange={(e) =>
                    savePrefs({ ...prefs, anchorDate: e.target.value, movedOverrides: {} })
                  }
                  className="rounded-xl subtle-surface border border-theme px-3 py-1.5"
                />
              </div>

              <button
                onClick={() =>
                  savePrefs({
                    ...prefs,
                    anchorDate: startOfWeekMonday(today),
                    movedOverrides: {},
                  })
                }
                className="mt-4 px-3 py-1.5 rounded-xl subtle-surface text-xs font-semibold inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Resetar fila
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Atrasadas */}
      {overdueBlocks.length > 0 && (
        <div className="rounded-3xl bg-amber-500/10 border border-amber-500/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-700 dark:text-amber-300">
                {overdueBlocks.length} bloco(s) atrasado(s)
              </p>
              <p className="text-xs text-muted-theme">
                Primeiro atraso: <strong>{overdueBlocks[0].name}</strong> ({formatDateBR(overdueBlocks[0].date)}).
              </p>
            </div>
          </div>
          <button
            onClick={rescheduleAllOverdueToToday}
            className="px-4 py-2 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shrink-0"
          >
            Reagendar para Hoje
          </button>
        </div>
      )}

      {/* Layout Principal: Calendário + Anotações do Dia */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 space-y-4">
          {/* Navegação no tempo */}
          <div className="flex items-center justify-between gap-3 card-surface rounded-2xl px-4 py-3">
            <button
              onClick={() => navigatePeriod(-1)}
              className="p-2 rounded-full subtle-surface hover:opacity-80"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="text-center">
              <p className="font-bold text-sm">
                {viewMode === 'week'
                  ? `${formatDateBR(weekDays[0])} — ${formatDateBR(weekDays[6])}`
                  : `${MONTH_NAMES[monthIdx]} de ${monthYear}`}
              </p>
              <button
                onClick={() => {
                  setCursorDate(today);
                  setSelectedNoteDate(today);
                }}
                className="text-[11px] text-teal-600 hover:underline font-semibold"
              >
                Hoje ({formatDateBR(today)})
              </button>
            </div>

            <button
              onClick={() => navigatePeriod(1)}
              className="p-2 rounded-full subtle-surface hover:opacity-80"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* VISÃO SEMANAL (Pastel estilo Estudei) */}
          {viewMode === 'week' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-2.5">
              {weekDays.map((iso) => {
                const dt = parseISO(iso);
                const dayBlocks = blocksByDate[iso] || [];
                const dayNotes = notesByDate[iso] || [];
                const isToday = iso === today;
                const isSelected = iso === selectedNoteDate;
                const totalMin = dayBlocks.reduce((a, b) => a + b.minutes, 0);

                return (
                  <div
                    key={iso}
                    onClick={() => setSelectedNoteDate(iso)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const blkId = e.dataTransfer.getData('text/plain');
                      if (blkId) moveBlockAndRecalculate(blkId, iso);
                    }}
                    className={`card-surface rounded-2xl p-3 flex flex-col min-h-[240px] cursor-pointer transition ${
                      isSelected
                        ? 'ring-2 ring-teal-500'
                        : isToday
                        ? 'ring-1 ring-indigo-500/60'
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-theme">
                      <div>
                        <p className="text-xs font-bold">
                          {DAY_LABELS[dt.getDay()]}, {iso.slice(8, 10)}
                        </p>
                        <p className="text-[10px] text-muted-theme">
                          {totalMin > 0 ? `${(totalMin / 60).toFixed(1)}h` : 'Livre'}
                        </p>
                      </div>
                      {dayNotes.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                          <StickyNote className="w-2.5 h-2.5" />
                          {dayNotes.length}
                        </span>
                      )}
                    </div>

                    {dayBlocks.length === 0 ? (
                      <p className="text-[11px] text-muted-theme my-auto text-center opacity-60">
                        Descanso
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {dayBlocks.map((blk) => {
                          const pal =
                            PASTEL_STYLES[subjectPaletteIndex[blk.subjectId] ?? 0];
                          return (
                            <div
                              key={blk.id}
                              draggable
                              onDragStart={(e) => e.dataTransfer.setData('text/plain', blk.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded-xl p-2.5 cursor-grab active:cursor-grabbing space-y-1.5 transition"
                              style={{
                                backgroundColor: blk.done
                                  ? 'rgba(16, 185, 129, 0.16)'
                                  : blk.overdue
                                  ? 'rgba(244, 63, 94, 0.15)'
                                  : pal.bg,
                                color: isDark
                                  ? '#f1f5f9'
                                  : blk.done
                                  ? '#065f46'
                                  : blk.overdue
                                  ? '#9f1239'
                                  : pal.text,
                              }}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <p
                                  className={`text-[11px] font-bold leading-snug ${
                                    blk.done ? 'line-through opacity-80' : ''
                                  }`}
                                >
                                  {blk.name}
                                </p>
                                <button
                                  onClick={() => toggleBlockDone(blk.id)}
                                  className="shrink-0 opacity-75 hover:opacity-100"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <div className="flex items-center justify-between text-[10px] opacity-85">
                                <span>
                                  {Math.floor(blk.minutes / 60)}h
                                  {String(blk.minutes % 60).padStart(2, '0')}m
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      setMoveTargetBlock(blk);
                                      setMoveToDate(addDaysISO(iso, 1));
                                    }}
                                    className="px-1.5 py-0.5 rounded bg-black/10 hover:bg-black/20 font-semibold"
                                  >
                                    Mover
                                  </button>
                                  <button
                                    onClick={() => startStopwatch(blk.subjectId)}
                                    className="p-1 rounded bg-black/15 hover:bg-black/25"
                                    title="Iniciar"
                                  >
                                    <Play className="w-2.5 h-2.5 fill-current" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* VISÃO MENSAL */}
          {viewMode === 'month' && (
            <div className="card-surface rounded-3xl p-4 overflow-x-auto">
              <div className="grid grid-cols-7 gap-2 min-w-[640px]">
                {DAY_LABELS.map((d) => (
                  <div key={d} className="text-center text-xs font-bold text-muted-theme pb-2">
                    {d}
                  </div>
                ))}
                {monthCells.map((iso, idx) => {
                  if (!iso) return <div key={`empty-${idx}`} className="min-h-[92px]" />;
                  const dayBlocks = blocksByDate[iso] || [];
                  const dayNotes = notesByDate[iso] || [];
                  const isToday = iso === today;
                  const isSelected = iso === selectedNoteDate;

                  return (
                    <div
                      key={iso}
                      onClick={() => setSelectedNoteDate(iso)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const blkId = e.dataTransfer.getData('text/plain');
                        if (blkId) moveBlockAndRecalculate(blkId, iso);
                      }}
                      className={`subtle-surface rounded-2xl p-2 min-h-[100px] flex flex-col gap-1 cursor-pointer transition ${
                        isSelected
                          ? 'ring-2 ring-teal-500'
                          : isToday
                          ? 'ring-1 ring-indigo-500'
                          : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        {dayNotes.length > 0 ? (
                          <span className="text-[10px] font-bold text-amber-600 flex items-center gap-0.5">
                            <StickyNote className="w-2.5 h-2.5" />
                            {dayNotes.length}
                          </span>
                        ) : (
                          <span />
                        )}
                        <span
                          className={`text-[11px] font-bold ${
                            isToday ? 'text-teal-600' : 'text-muted-theme'
                          }`}
                        >
                          {Number(iso.slice(8, 10))}
                        </span>
                      </div>

                      {dayBlocks.slice(0, 3).map((blk) => {
                        const pal = PASTEL_STYLES[subjectPaletteIndex[blk.subjectId] ?? 0];
                        return (
                          <button
                            key={blk.id}
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData('text/plain', blk.id)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMoveTargetBlock(blk);
                              setMoveToDate(addDaysISO(iso, 1));
                            }}
                            className={`text-left text-[10px] font-semibold px-1.5 py-1 rounded-lg truncate ${
                              blk.done ? 'line-through opacity-70' : ''
                            }`}
                            style={{
                              backgroundColor: blk.done
                                ? 'rgba(16,185,129,0.18)'
                                : blk.overdue
                                ? 'rgba(244,63,94,0.18)'
                                : pal.bg,
                              color: isDark ? '#f1f5f9' : pal.text,
                            }}
                          >
                            {blk.name}
                          </button>
                        );
                      })}
                      {dayBlocks.length > 3 && (
                        <span className="text-[10px] text-muted-theme">
                          +{dayBlocks.length - 3}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Painel Lateral: Anotações & Lembretes do Calendário */}
        <div className="card-surface rounded-3xl p-5 flex flex-col gap-4 h-fit">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-theme flex items-center gap-1.5">
              <StickyNote className="w-4 h-4 text-amber-500" />
              Anotações do Dia
            </p>
            <p className="text-base font-bold mt-1">{formatDateBR(selectedNoteDate)}</p>
            <p className="text-xs text-muted-theme">
              Clique em qualquer dia do calendário para ver ou criar lembretes.
            </p>
          </div>

          <form onSubmit={addDayNote} className="space-y-2">
            <textarea
              rows={2}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Ex: Fazer 20 questões de Crase, esqueci de revisar art. 5º..."
              className="w-full rounded-2xl subtle-surface border border-theme p-3 text-xs focus:outline-none"
            />
            <button
              type="submit"
              className="w-full py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Adicionar Lembrete neste Dia
            </button>
          </form>

          <div className="space-y-2">
            {selectedDayNotes.length === 0 ? (
              <p className="text-xs text-muted-theme text-center py-4">
                Nenhuma anotação para {formatDateBR(selectedNoteDate)}.
              </p>
            ) : (
              selectedDayNotes.map((note) => (
                <div
                  key={note.id}
                  className={`rounded-2xl p-3 flex items-start justify-between gap-2 border transition ${
                    note.done
                      ? 'bg-emerald-500/10 border-emerald-500/25'
                      : 'subtle-surface border-transparent'
                  }`}
                >
                  <button
                    onClick={() => toggleDayNote(note.id)}
                    className="flex items-start gap-2.5 text-left flex-1 min-w-0"
                  >
                    <span
                      className={`mt-0.5 w-4 h-4 rounded-md flex items-center justify-center border shrink-0 ${
                        note.done
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'border-slate-400'
                      }`}
                    >
                      {note.done && <Check className="w-3 h-3" />}
                    </span>
                    <span
                      className={`text-xs break-words ${
                        note.done ? 'line-through text-muted-theme' : ''
                      }`}
                    >
                      {note.text}
                    </span>
                  </button>
                  <button
                    onClick={() => deleteDayNote(note.id)}
                    className="p-1 rounded-lg text-muted-theme hover:text-rose-500 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modal Mover Matéria */}
      {moveTargetBlock && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl">
            <h2 className="font-bold text-base">Mover Matéria e Recalcular Agenda</h2>
            <p className="text-xs text-muted-theme">
              Mover <strong>{moveTargetBlock.name}</strong> (de {formatDateBR(moveTargetBlock.date)}) para outra data vai recalcular automaticamente todas as matérias seguintes para frente.
            </p>
            <div>
              <label className="block text-xs text-muted-theme mb-1">Nova data:</label>
              <input
                type="date"
                value={moveToDate}
                onChange={(e) => setMoveToDate(e.target.value)}
                className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setMoveTargetBlock(null)}
                className="px-4 py-2 rounded-xl subtle-surface text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={() => moveBlockAndRecalculate(moveTargetBlock.id, moveToDate)}
                className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                Mover e Recalcular <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
