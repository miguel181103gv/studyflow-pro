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
  ArrowRight,
  ArrowLeft,
  StickyNote,
  Plus,
  Trash2,
  Check,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Sparkles,
  X,
  Clock,
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

type NoteKind = 'Nota' | 'Aula' | 'Trabalho' | 'Prova' | 'Tarefa';

interface DayNote {
  id: string;
  date: string;
  text: string;
  done: boolean;
  kind?: NoteKind;
}

interface StudyPlan {
  id: string;
  name: string;
  subjectIds: string[]; // Ordem exata das matérias
  dailyHoursByDow: Record<number, number>; // 0=Dom ... 6=Sab
  blockMinutes: number;
  startDate: string;
  estimatedEndDate: string;
  completedBlockIds: string[];
  movedOverrides: Record<string, string>;
}

interface AgendaStore {
  activePlanId: string | null;
  plans: StudyPlan[];
  notes: DayNote[];
}

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAY_FULL = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];
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

function estimateFinishDate(
  startDate: string,
  remainingTopicsCount: number,
  dailyHoursByDow: Record<number, number>,
  avgHoursPerTopic = 2.0
): string {
  const weeklyHours = Object.values(dailyHoursByDow).reduce((a, b) => a + (Number(b) || 0), 0);
  if (weeklyHours <= 0 || remainingTopicsCount <= 0) return startDate;

  let neededHours = remainingTopicsCount * avgHoursPerTopic;
  let d = startDate;
  for (let guard = 0; guard < 1500 && neededHours > 0; guard++) {
    const dow = parseISO(d).getDay();
    const h = Number(dailyHoursByDow[dow] || 0);
    if (h > 0) neededHours -= h;
    if (neededHours > 0) d = addDaysISO(d, 1);
  }
  return d;
}

export default function AgendaPage() {
  const { profile, subjects, topics, studyLogs, startStopwatch, setSubjectOrder, theme } =
    useProfile();

  const today = todayISO();
  const storageKey = `sf_agenda_plans_v2_${profile?.id || 'default'}`;
  const isDark = theme === 'obsidian' || theme === 'navy';

  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [cursorDate, setCursorDate] = useState(today);
  const [selectedNoteDate, setSelectedNoteDate] = useState(today);
  const [noteInput, setNoteInput] = useState('');
  const [moveTargetBlock, setMoveTargetBlock] = useState<ScheduledBlock | null>(null);
  const [moveToDate, setMoveToDate] = useState(today);

  // Store de múltiplos cronogramas + anotações
  const [store, setStore] = useState<AgendaStore>({
    activePlanId: null,
    plans: [],
    notes: [],
  });

  // Wizard de Criar Novo Cronograma (4 etapas)
  const [showWizard, setShowWizard] = useState(false);
  const [wizStep, setWizStep] = useState<1 | 2 | 3 | 4>(1);
  const [wizSubjectIds, setWizSubjectIds] = useState<string[]>([]);
  const [wizDailyHours, setWizDailyHours] = useState<Record<number, number>>({
    0: 0,
    1: 4,
    2: 4,
    3: 4,
    4: 4,
    5: 4,
    6: 0,
  });
  const [wizBlockMin, setWizBlockMin] = useState(90);
  const [wizName, setWizName] = useState('');
  const [wizStartDate, setWizStartDate] = useState(today);
  const [wizDragId, setWizDragId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as AgendaStore;
        setStore({
          activePlanId: parsed.activePlanId || parsed.plans?.[0]?.id || null,
          plans: Array.isArray(parsed.plans) ? parsed.plans : [],
          notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        });
      }
    } catch {
      // ignore
    }
  }, [storageKey]);

  function saveStore(next: AgendaStore) {
    setStore(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  // Cronograma ativo (ou fallback automático com todas as matérias)
  const defaultGoal = profile?.daily_hours_goal || 4;
  const activePlan: StudyPlan = useMemo(() => {
    const found = store.plans.find((p) => p.id === store.activePlanId) || store.plans[0];
    if (found) return found;
    return {
      id: 'default',
      name: 'Cronograma Padrão',
      subjectIds: subjects.map((s) => s.id),
      dailyHoursByDow: { 0: 0, 1: defaultGoal, 2: defaultGoal, 3: defaultGoal, 4: defaultGoal, 5: defaultGoal, 6: 0 },
      blockMinutes: 90,
      startDate: startOfWeekMonday(today),
      estimatedEndDate: estimateFinishDate(
        today,
        topics.filter((t) => !t.studied).length,
        { 0: 0, 1: defaultGoal, 2: defaultGoal, 3: defaultGoal, 4: defaultGoal, 5: defaultGoal, 6: 0 }
      ),
      completedBlockIds: [],
      movedOverrides: {},
    };
  }, [store.plans, store.activePlanId, subjects, topics, defaultGoal, today]);

  function updateActivePlan(updater: (p: StudyPlan) => StudyPlan) {
    if (store.plans.length === 0) {
      const created = updater(activePlan);
      saveStore({ ...store, activePlanId: created.id, plans: [created] });
      return;
    }
    const nextPlans = store.plans.map((p) => (p.id === activePlan.id ? updater(p) : p));
    saveStore({ ...store, plans: nextPlans });
  }

  async function selectPlan(plan: StudyPlan) {
    saveStore({ ...store, activePlanId: plan.id });
    if (plan.subjectIds.length > 0) {
      await setSubjectOrder(plan.subjectIds);
    }
  }

  function deletePlan(id: string) {
    if (!confirm('Excluir este cronograma?')) return;
    const remaining = store.plans.filter((p) => p.id !== id);
    saveStore({
      ...store,
      plans: remaining,
      activePlanId: remaining[0]?.id || null,
    });
  }

  function openNewPlanWizard() {
    setWizStep(1);
    setWizSubjectIds(subjects.map((s) => s.id));
    setWizDailyHours({
      0: 0,
      1: defaultGoal,
      2: defaultGoal,
      3: defaultGoal,
      4: defaultGoal,
      5: defaultGoal,
      6: 0,
    });
    setWizBlockMin(90);
    setWizName(`Cronograma ${store.plans.length + 1}`);
    setWizStartDate(today);
    setShowWizard(true);
  }

  const wizRemainingTopics = useMemo(
    () => topics.filter((t) => wizSubjectIds.includes(t.subject_id) && !t.studied).length,
    [topics, wizSubjectIds]
  );

  const wizEstimatedEnd = useMemo(
    () => estimateFinishDate(wizStartDate, wizRemainingTopics, wizDailyHours, 2.0),
    [wizStartDate, wizRemainingTopics, wizDailyHours]
  );

  async function finishWizard() {
    if (wizSubjectIds.length === 0) return;
    const newPlan: StudyPlan = {
      id: `plan_${Date.now()}`,
      name: wizName.trim() || `Cronograma ${store.plans.length + 1}`,
      subjectIds: wizSubjectIds,
      dailyHoursByDow: wizDailyHours,
      blockMinutes: wizBlockMin,
      startDate: wizStartDate,
      estimatedEndDate: wizEstimatedEnd,
      completedBlockIds: [],
      movedOverrides: {},
    };
    saveStore({
      ...store,
      activePlanId: newPlan.id,
      plans: [...store.plans, newPlan],
    });
    await setSubjectOrder(wizSubjectIds);
    setShowWizard(false);
    setCursorDate(wizStartDate);
  }

  const subjectPaletteIndex = useMemo(() => {
    const map: Record<string, number> = {};
    subjects.forEach((s, idx) => {
      map[s.id] = idx % PASTEL_STYLES.length;
    });
    return map;
  }, [subjects]);

  // Gera cronograma seguindo a ORDEM EXATA das matérias do cronograma ativo (nunca pula matéria!)
  const allBlocks = useMemo(() => {
    const orderedSubjects = activePlan.subjectIds
      .map((id) => subjects.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));

    const effectiveSubjects = orderedSubjects.length > 0 ? orderedSubjects : subjects;
    if (effectiveSubjects.length === 0) return [] as ScheduledBlock[];

    const cycleUnitBlocks: { subjectId: string; name: string; color: string; minutes: number }[] =
      [];
    effectiveSubjects.forEach((s) => {
      let rem = Math.max(30, s.cycle_hours * 60 + s.cycle_minutes);
      while (rem > 0) {
        const chunk = Math.min(activePlan.blockMinutes || 90, rem);
        cycleUnitBlocks.push({
          subjectId: s.id,
          name: s.name,
          color: s.color,
          minutes: chunk,
        });
        rem -= chunk;
      }
    });

    const loggedSet = new Set(studyLogs.map((l) => `${l.study_date}::${l.subject_id}`));
    const result: ScheduledBlock[] = [];
    const dayUsedMinutes: Record<string, number> = {};

    const startIso = activePlan.startDate || startOfWeekMonday(today);
    const endHorizon = addDaysISO(cursorDate > today ? cursorDate : today, 70);

    let currentIso = startIso;
    let seqIndex = 0;

    function nextAvailableDate(fromIso: string, neededMinutes: number): string {
      let d = fromIso;
      for (let guard = 0; guard < 240; guard++) {
        const dow = parseISO(d).getDay();
        const capMin = Math.round((Number(activePlan.dailyHoursByDow[dow]) || 0) * 60);
        const used = dayUsedMinutes[d] || 0;
        if (capMin > 0 && used + neededMinutes <= capMin + 15) {
          return d;
        }
        d = addDaysISO(d, 1);
      }
      return d;
    }

    while (currentIso <= endHorizon && seqIndex < 550) {
      const unit = cycleUnitBlocks[seqIndex % cycleUnitBlocks.length];
      const blockId = `${activePlan.id}_blk_${seqIndex}`;

      const overrideDate = activePlan.movedOverrides?.[blockId];
      if (overrideDate && overrideDate > currentIso) {
        currentIso = overrideDate;
      }

      const assignedDate = nextAvailableDate(currentIso, unit.minutes);
      dayUsedMinutes[assignedDate] = (dayUsedMinutes[assignedDate] || 0) + unit.minutes;
      currentIso = assignedDate;

      const isDone =
        (activePlan.completedBlockIds || []).includes(blockId) ||
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
  }, [activePlan, subjects, studyLogs, cursorDate, today]);

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
    store.notes.forEach((n) => {
      if (!map[n.date]) map[n.date] = [];
      map[n.date].push(n);
    });
    return map;
  }, [store.notes]);

  function addDayNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteInput.trim()) return;
    const newNote: DayNote = {
      id: `note_${Date.now()}`,
      date: selectedNoteDate,
      text: noteInput.trim(),
      done: false,
    };
    saveStore({ ...store, notes: [newNote, ...store.notes] });
    setNoteInput('');
  }

  function toggleDayNote(id: string) {
    saveStore({
      ...store,
      notes: store.notes.map((n) => (n.id === id ? { ...n, done: !n.done } : n)),
    });
  }

  function deleteDayNote(id: string) {
    saveStore({
      ...store,
      notes: store.notes.filter((n) => n.id !== id),
    });
  }

  function toggleBlockDone(blockId: string) {
    updateActivePlan((p) => {
      const exists = p.completedBlockIds.includes(blockId);
      return {
        ...p,
        completedBlockIds: exists
          ? p.completedBlockIds.filter((id) => id !== blockId)
          : [...p.completedBlockIds, blockId],
      };
    });
  }

  function moveBlockAndRecalculate(blockId: string, newDate: string) {
    updateActivePlan((p) => ({
      ...p,
      movedOverrides: { ...p.movedOverrides, [blockId]: newDate },
    }));
    setMoveTargetBlock(null);
  }

  function rescheduleAllOverdueToToday() {
    if (overdueBlocks.length === 0) return;
    // Mantém a ordem exata das matérias empurrando a 1ª não estudada para hoje (nunca pula!)
    moveBlockAndRecalculate(overdueBlocks[0].id, today);
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
      {/* Header + Botão Montar Novo Cronograma */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Agenda & Cronogramas
          </h1>
          <p className="text-sm text-muted-theme mt-1">
            Crie vários cronogramas personalizados. A sequência escolhida sincroniza com o Ciclo e nunca pula matérias se você faltar um dia.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openNewPlanWizard}
            className="px-4 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Montar Novo Cronograma
          </button>

          <div className="flex rounded-2xl card-surface p-1">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                viewMode === 'week' ? 'bg-teal-600 text-white' : ''
              }`}
            >
              <CalendarRange className="w-3.5 h-3.5" />
              Semanal
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                viewMode === 'month' ? 'bg-teal-600 text-white' : ''
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              Mensal
            </button>
          </div>
        </div>
      </div>

      {/* Seletor de Cronogramas Salvos + Estimativa de Término */}
      <div className="card-surface rounded-3xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {store.plans.length === 0 ? (
            <span className="px-3.5 py-2 rounded-2xl bg-teal-600 text-white text-xs font-bold">
              Cronograma Padrão (Todas as matérias)
            </span>
          ) : (
            store.plans.map((pl) => {
              const isCurrent = pl.id === activePlan.id;
              return (
                <div key={pl.id} className="inline-flex items-center gap-1">
                  <button
                    onClick={() => selectPlan(pl)}
                    className={`px-3.5 py-2 rounded-2xl text-xs font-bold transition ${
                      isCurrent
                        ? 'bg-teal-600 text-white shadow-xs'
                        : 'subtle-surface hover:opacity-85'
                    }`}
                  >
                    {pl.name} ({pl.subjectIds.length} mat.)
                  </button>
                  <button
                    onClick={() => deletePlan(pl.id)}
                    className="p-1.5 rounded-xl text-muted-theme hover:text-rose-500"
                    title="Excluir cronograma"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="text-xs text-muted-theme flex items-center gap-2 shrink-0">
          <Clock className="w-4 h-4 text-teal-600 shrink-0" />
          <span>
            Início: <strong>{formatDateBR(activePlan.startDate)}</strong> · Previsão de término:{' '}
            <strong className="text-teal-700 dark:text-teal-300">
              {formatDateBR(activePlan.estimatedEndDate)}
            </strong>
          </span>
        </div>
      </div>

      {/* Atrasadas (mantendo a ordem exata sem pular!) */}
      {overdueBlocks.length > 0 && (
        <div className="rounded-3xl bg-amber-500/10 border border-amber-500/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                {overdueBlocks.length} bloco(s) não estudado(s) anteriormente
              </p>
              <p className="text-xs text-muted-theme">
                Para não pular nenhuma matéria, puxe <strong>{overdueBlocks[0].name}</strong> para hoje e toda a sequência se ajusta para frente.
              </p>
            </div>
          </div>
          <button
            onClick={rescheduleAllOverdueToToday}
            className="px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shrink-0"
          >
            Puxar sequência para Hoje
          </button>
        </div>
      )}

      {/* Calendário + Anotações */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 space-y-4">
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
                className="text-xs text-teal-600 hover:underline font-semibold"
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
                    className={`card-surface rounded-2xl p-3 flex flex-col min-h-[230px] cursor-pointer transition ${
                      isSelected ? 'ring-2 ring-teal-500' : isToday ? 'ring-1 ring-indigo-500/60' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-theme">
                      <div>
                        <p className="text-xs font-bold">
                          {DAY_LABELS[dt.getDay()]}, {iso.slice(8, 10)}
                        </p>
                        <p className="text-[11px] text-muted-theme">
                          {totalMin > 0 ? `${(totalMin / 60).toFixed(1)}h` : 'Livre'}
                        </p>
                      </div>
                      {dayNotes.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300">
                          <StickyNote className="w-2.5 h-2.5" />
                          {dayNotes.length}
                        </span>
                      )}
                    </div>

                    {dayBlocks.length === 0 ? (
                      <p className="text-xs text-muted-theme my-auto text-center opacity-60">
                        Descanso
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {dayBlocks.map((blk) => {
                          const pal = PASTEL_STYLES[subjectPaletteIndex[blk.subjectId] ?? 0];
                          return (
                            <div
                              key={blk.id}
                              draggable
                              onDragStart={(e) => e.dataTransfer.setData('text/plain', blk.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded-xl p-2.5 cursor-grab active:cursor-grabbing space-y-1.5"
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
                                <button onClick={() => toggleBlockDone(blk.id)} className="shrink-0">
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
                      className={`subtle-surface rounded-2xl p-2 min-h-[100px] flex flex-col gap-1 cursor-pointer ${
                        isSelected ? 'ring-2 ring-teal-500' : isToday ? 'ring-1 ring-indigo-500' : ''
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
                              backgroundColor: blk.done ? 'rgba(16,185,129,0.18)' : pal.bg,
                              color: isDark ? '#f1f5f9' : pal.text,
                            }}
                          >
                            {blk.name}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Anotações do Dia */}
        <div className="card-surface rounded-3xl p-5 flex flex-col gap-4 h-fit">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-theme flex items-center gap-1.5">
              <StickyNote className="w-4 h-4 text-amber-500" />
              Anotações do Dia
            </p>
            <p className="text-base font-bold mt-1">{formatDateBR(selectedNoteDate)}</p>
          </div>
          <form onSubmit={addDayNote} className="space-y-2">
            <textarea
              rows={2}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Ex: Revisar art. 5º, fazer 20 questões de Crase..."
              className="w-full rounded-2xl subtle-surface border border-theme p-3 text-xs focus:outline-none"
            />
            <button
              type="submit"
              className="w-full py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Salvar Lembrete
            </button>
          </form>
          <div className="space-y-2">
            {selectedDayNotes.length === 0 ? (
              <p className="text-xs text-muted-theme text-center py-3">
                Nenhuma anotação para este dia.
              </p>
            ) : (
              selectedDayNotes.map((note) => (
                <div
                  key={note.id}
                  className={`rounded-2xl p-3 flex items-start justify-between gap-2 border ${
                    note.done ? 'bg-emerald-500/10 border-emerald-500/25' : 'subtle-surface border-transparent'
                  }`}
                >
                  <button
                    onClick={() => toggleDayNote(note.id)}
                    className="flex items-start gap-2.5 text-left flex-1 min-w-0"
                  >
                    <span
                      className={`mt-0.5 w-4 h-4 rounded-md flex items-center justify-center border shrink-0 ${
                        note.done ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-400'
                      }`}
                    >
                      {note.done && <Check className="w-3 h-3" />}
                    </span>
                    <span className={`text-xs break-words ${note.done ? 'line-through text-muted-theme' : ''}`}>
                      {note.text}
                    </span>
                  </button>
                  <button onClick={() => deleteDayNote(note.id)} className="p-1 text-muted-theme hover:text-rose-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* WIZARD: MONTAR NOVO CRONOGRAMA EM 4 ETAPAS */}
      {showWizard && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-2xl rounded-3xl p-6 space-y-5 shadow-2xl my-8 animate-pop-in">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-teal-600" />
                <h2 className="text-lg font-extrabold">Montar Cronograma de Estudos</h2>
              </div>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4].map((n) => (
                  <span
                    key={n}
                    className={`w-7 h-7 rounded-xl text-xs font-extrabold flex items-center justify-center ${
                      wizStep === n
                        ? 'bg-teal-600 text-white'
                        : wizStep > n
                        ? 'bg-emerald-500/20 text-emerald-700'
                        : 'subtle-surface text-muted-theme'
                    }`}
                  >
                    {n}
                  </span>
                ))}
                <button onClick={() => setShowWizard(false)} className="ml-2 p-2 rounded-xl subtle-surface">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Etapa 1: Escolher matérias */}
            {wizStep === 1 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold">1. Escolha as matérias que farão parte</p>
                  <button
                    type="button"
                    onClick={() =>
                      setWizSubjectIds(
                        wizSubjectIds.length === subjects.length ? [] : subjects.map((s) => s.id)
                      )
                    }
                    className="text-xs font-bold text-teal-600 hover:underline"
                  >
                    {wizSubjectIds.length === subjects.length ? 'Desmarcar todas' : 'Selecionar todas'}
                  </button>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {subjects.map((s) => {
                    const checked = wizSubjectIds.includes(s.id);
                    const tCount = topics.filter((t) => t.subject_id === s.id).length;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() =>
                          setWizSubjectIds((prev) =>
                            checked ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                          )
                        }
                        className={`w-full rounded-2xl p-3.5 flex items-center justify-between gap-3 border text-left transition ${
                          checked ? 'border-teal-600 bg-teal-600/10' : 'border-theme subtle-surface'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`w-5 h-5 rounded-md flex items-center justify-center border-2 shrink-0 ${
                              checked ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-400'
                            }`}
                          >
                            {checked && <Check className="w-3.5 h-3.5" />}
                          </span>
                          <span className="text-sm font-bold truncate">{s.name}</span>
                        </div>
                        <span className="text-xs text-muted-theme shrink-0">{tCount} tópicos</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Etapa 2: Ordem das matérias (sincroniza com o Ciclo!) */}
            {wizStep === 2 && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-bold">2. Defina a sequência de estudos</p>
                  <p className="text-xs text-muted-theme mt-0.5">
                    Arraste ou use as setas. Ao ativar este cronograma, a ordem do seu <strong>Ciclo de Estudos</strong> será atualizada automaticamente!
                  </p>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {wizSubjectIds.map((id, idx) => {
                    const s = subjects.find((sb) => sb.id === id);
                    if (!s) return null;
                    return (
                      <div
                        key={id}
                        draggable
                        onDragStart={() => setWizDragId(id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (!wizDragId || wizDragId === id) return;
                          const next = [...wizSubjectIds];
                          const from = next.indexOf(wizDragId);
                          const to = next.indexOf(id);
                          next.splice(from, 1);
                          next.splice(to, 0, wizDragId);
                          setWizSubjectIds(next);
                          setWizDragId(null);
                        }}
                        className="subtle-surface rounded-2xl p-3.5 flex items-center justify-between gap-3 cursor-grab"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <GripVertical className="w-4 h-4 text-muted-theme shrink-0" />
                          <span
                            className="w-7 h-7 rounded-xl text-white text-xs font-extrabold flex items-center justify-center shrink-0"
                            style={{ backgroundColor: s.color }}
                          >
                            {idx + 1}
                          </span>
                          <span className="text-sm font-bold truncate">{s.name}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => {
                              const next = [...wizSubjectIds];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              setWizSubjectIds(next);
                            }}
                            className="p-1.5 rounded-lg card-surface disabled:opacity-30"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === wizSubjectIds.length - 1}
                            onClick={() => {
                              const next = [...wizSubjectIds];
                              [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                              setWizSubjectIds(next);
                            }}
                            className="p-1.5 rounded-lg card-surface disabled:opacity-30"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Etapa 3: Carga horária por dia da semana */}
            {wizStep === 3 && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-bold">3. Determine sua carga horária de cada dia</p>
                  <p className="text-xs text-muted-theme mt-0.5">
                    Coloque 0h nos dias de descanso. Se você não estudar em algum dia, a sequência não pula nenhuma matéria!
                  </p>
                </div>

                <div className="space-y-2">
                  {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                    <div
                      key={dow}
                      className="subtle-surface rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="font-semibold">{DAY_FULL[dow]}</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="14"
                          value={wizDailyHours[dow] ?? 0}
                          onChange={(e) =>
                            setWizDailyHours((prev) => ({
                              ...prev,
                              [dow]: Math.max(0, Number(e.target.value)),
                            }))
                          }
                          className="w-20 rounded-xl card-surface px-3 py-1.5 text-center font-bold text-sm"
                        />
                        <span className="text-xs text-muted-theme w-8">horas</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-muted-theme">Duração de cada bloco:</span>
                  <select
                    value={wizBlockMin}
                    onChange={(e) => setWizBlockMin(Number(e.target.value))}
                    className="rounded-xl subtle-surface border border-theme px-3 py-1.5 font-bold"
                  >
                    <option value={60}>1h por bloco</option>
                    <option value={90}>1h30 por bloco</option>
                    <option value={120}>2h por bloco</option>
                  </select>
                </div>
              </div>
            )}

            {/* Etapa 4: Nome, Data de Início e Estimativa de Término */}
            {wizStep === 4 && (
              <div className="space-y-4">
                <p className="text-sm font-bold">4. Nome do cronograma e estimativa de conclusão</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-muted-theme mb-1">
                      Nome do Cronograma
                    </label>
                    <input
                      value={wizName}
                      onChange={(e) => setWizName(e.target.value)}
                      placeholder="Ex: Reta Final TRT, Rotina 4h..."
                      className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-theme mb-1">
                      Data de Início
                    </label>
                    <input
                      type="date"
                      value={wizStartDate}
                      onChange={(e) => setWizStartDate(e.target.value)}
                      className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
                    />
                  </div>
                </div>

                <div className="rounded-2xl bg-teal-600/12 border border-teal-500/30 p-5 space-y-2 text-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                    Estimativa de Conclusão do Edital
                  </p>
                  <p className="text-2xl font-extrabold text-teal-700 dark:text-teal-300">
                    {formatDateBR(wizEstimatedEnd)}
                  </p>
                  <p className="text-xs text-muted-theme">
                    Baseado em <strong>{wizRemainingTopics} tópicos pendentes</strong> nas{' '}
                    <strong>{wizSubjectIds.length} matérias escolhidas</strong> com{' '}
                    <strong>
                      {Object.values(wizDailyHours).reduce((a, b) => a + b, 0)}h/semana
                    </strong>
                    .
                  </p>
                </div>
              </div>
            )}

            {/* Rodapé Wizard */}
            <div className="pt-3 border-t border-theme flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={wizStep === 1}
                onClick={() => setWizStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
                className="px-4 py-2.5 rounded-2xl subtle-surface text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-35"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </button>

              {wizStep < 4 ? (
                <button
                  type="button"
                  disabled={wizStep === 1 && wizSubjectIds.length === 0}
                  onClick={() => setWizStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s))}
                  className="px-5 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  Continuar
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finishWizard}
                  className="px-6 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-md"
                >
                  <Check className="w-4 h-4" />
                  Criar e Ativar Cronograma
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Mover Matéria */}
      {moveTargetBlock && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl">
            <h2 className="font-bold text-base">Mover Matéria e Recalcular Sequência</h2>
            <p className="text-xs text-muted-theme">
              Mover <strong>{moveTargetBlock.name}</strong> para outra data recalcula toda a ordem seguinte sem pular nenhuma matéria.
            </p>
            <input
              type="date"
              value={moveToDate}
              onChange={(e) => setMoveToDate(e.target.value)}
              className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMoveTargetBlock(null)}
                className="px-4 py-2 rounded-xl subtle-surface text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={() => moveBlockAndRecalculate(moveTargetBlock.id, moveToDate)}
                className="px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-bold"
              >
                Mover e Recalcular
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
