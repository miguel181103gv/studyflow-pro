'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useProfile } from '@/components/ProfileProvider';
import { useGlobal } from '@/components/GlobalProvider';
import { getStudyMode } from '@/lib/studyModes';
import { buildGoogleCalendarUrl, downloadIcsFile } from '@/lib/calendarExport';
import { addDaysISO, daysBetween, formatDateBR, todayISO } from '@/lib/utils';
import {
  Play,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
  CalendarRange,
  Plus,
  Trash2,
  Check,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Sparkles,
  X,
  Clock,
  GraduationCap,
  FileCheck2,
  Download,
  ExternalLink,
  UserCheck,
  MapPin,
  RefreshCw,
  Pencil,
  ArrowRightCircle,
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

interface ClassSlot {
  id: string;
  dayOfWeek: number; // 0=Dom ... 6=Sab
  startTime: string;
  endTime: string;
  subjectId: string;
  subjectName: string;
  professor: string;
  location: string;
}

type AssessmentKind = 'Prova' | 'Trabalho' | 'Seminário' | 'Dever' | 'Entrega';

interface AssessmentItem {
  id: string;
  kind: AssessmentKind;
  title: string;
  subjectId: string;
  subjectName: string;
  professor: string;
  date: string;
  time: string;
  weight: string;
  notes: string;
  done: boolean;
}

interface DayNote {
  id: string;
  date: string;
  text: string;
  done: boolean;
  kind?: string;
}

interface StudyPlan {
  id: string;
  name: string;
  subjectIds: string[];
  dailyHoursByDow: Record<number, number>;
  blockMinutes: number;
  dailyReviewMinutes?: number;
  subjectsPerDay?: number;
  followCycle?: boolean;
  startDate: string;
  estimatedEndDate: string;
  completedBlockIds: string[];
  movedOverrides: Record<string, string>;
}

interface AgendaStore {
  activePlanId: string | null;
  plans: StudyPlan[];
  notes: DayNote[];
  classes: ClassSlot[];
  assessments: AssessmentItem[];
  subjectProfessors: Record<string, string>;
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

function parseISO(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toISO(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfWeekMonday(iso: string) {
  const d = parseISO(iso);
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return toISO(d);
}

function estimateFinishDate(
  startDate: string,
  remainingTopics: number,
  dailyHoursByDow: Record<number, number>,
  dailyReviewMinutes = 0
): string {
  const reviewHours = (Number(dailyReviewMinutes) || 0) / 60;
  const weeklyNetHours = Object.values(dailyHoursByDow).reduce((a, b) => {
    const h = Number(b) || 0;
    return a + (h > 0 ? Math.max(0.5, h - reviewHours) : 0);
  }, 0);
  if (weeklyNetHours <= 0) return addDaysISO(startDate, 90);
  let neededHours = Math.max(remainingTopics * 1.5, weeklyNetHours);
  let d = startDate;
  for (let i = 0; i < 730 && neededHours > 0; i++) {
    const dow = parseISO(d).getDay();
    const h = Number(dailyHoursByDow[dow] || 0);
    if (h > 0) neededHours -= Math.max(0.5, h - reviewHours);
    if (neededHours > 0) d = addDaysISO(d, 1);
  }
  return d;
}

type AgendaTab = 'aulas' | 'avaliacoes' | 'cronograma';

export default function AgendaPage() {
  const { profile, subjects, topics, reviews, studyLogs, startStopwatch, setSubjectOrder } = useProfile();
  const { notify } = useGlobal();

  const studyMode = getStudyMode(profile);
  const isSchoolOrCollege = studyMode.id === 'faculdade' || studyMode.id === 'escola';

  const today = todayISO();
  const storageKey = `sf_agenda_plans_v2_${profile?.id || 'default'}`;

  const [activeTab, setActiveTab] = useState<AgendaTab>(
    isSchoolOrCollege ? 'aulas' : 'cronograma'
  );
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [cursorDate, setCursorDate] = useState(today);
  const [moveTargetBlock, setMoveTargetBlock] = useState<ScheduledBlock | null>(null);
  const [moveToDate, setMoveToDate] = useState(today);

  // Store completo (começa VAZIO até o usuário montar cronograma / cadastrar aulas / provas)
  const [store, setStore] = useState<AgendaStore>({
    activePlanId: null,
    plans: [],
    notes: [],
    classes: [],
    assessments: [],
    subjectProfessors: {},
  });

  // Modais / formulários de Grade de Aulas & Professores
  const [showAddClass, setShowAddClass] = useState(false);
  const [showProfessors, setShowProfessors] = useState(false);
  const [clsDow, setClsDow] = useState<number>(1);
  const [clsStart, setClsStart] = useState('08:00');
  const [clsEnd, setClsEnd] = useState('09:40');
  const [clsSubjectId, setClsSubjectId] = useState('');
  const [clsCustomName, setClsCustomName] = useState('');
  const [clsProfessor, setClsProfessor] = useState('');
  const [clsLocation, setClsLocation] = useState('');

  // Formulário de Provas, Trabalhos & Entregas
  const [showAddAssess, setShowAddAssess] = useState(false);
  const [asKind, setAsKind] = useState<AssessmentKind>('Prova');
  const [asTitle, setAsTitle] = useState('');
  const [asSubjectId, setAsSubjectId] = useState('');
  const [asDate, setAsDate] = useState(today);
  const [asTime, setAsTime] = useState('');
  const [asWeight, setAsWeight] = useState('');
  const [asNotes, setAsNotes] = useState('');

  // Wizard de Criar Novo Cronograma (4 etapas)
  const [showWizard, setShowWizard] = useState(false);
  const [wizStep, setWizStep] = useState<1 | 2 | 3 | 4>(1);
  const [wizSubjectIds, setWizSubjectIds] = useState<string[]>([]);
  const [wizDailyHours, setWizDailyHours] = useState<Record<number, number>>({
    0: 0,
    1: 3,
    2: 3,
    3: 3,
    4: 3,
    5: 3,
    6: 0,
  });
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [wizBlockMin, setWizBlockMin] = useState(90);
  const [wizReviewMin, setWizReviewMin] = useState(30);
  const [wizSubjectsPerDay, setWizSubjectsPerDay] = useState(0); // 0 = automático
  const [wizFollowCycle, setWizFollowCycle] = useState(false);
  const [openReviewDays, setOpenReviewDays] = useState<Record<string, boolean>>({});
  const [wizName, setWizName] = useState('');
  const [wizStartDate, setWizStartDate] = useState(today);
  const [wizDragId, setWizDragId] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(isSchoolOrCollege ? 'aulas' : 'cronograma');
  }, [isSchoolOrCollege]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AgendaStore>;
        setStore({
          activePlanId: parsed.activePlanId || parsed.plans?.[0]?.id || null,
          plans: Array.isArray(parsed.plans) ? parsed.plans : [],
          notes: Array.isArray(parsed.notes) ? parsed.notes : [],
          classes: Array.isArray(parsed.classes) ? parsed.classes : [],
          assessments: Array.isArray(parsed.assessments) ? parsed.assessments : [],
          subjectProfessors: parsed.subjectProfessors || {},
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

  // Cronograma ativo — NULL quando vazio! (Agenda começa limpa!)
  const activePlan: StudyPlan | null = useMemo(() => {
    if (store.plans.length === 0) return null;
    return store.plans.find((p) => p.id === store.activePlanId) || store.plans[0] || null;
  }, [store.plans, store.activePlanId]);

  function updateActivePlan(updater: (p: StudyPlan) => StudyPlan) {
    if (!activePlan) return;
    const nextPlans = store.plans.map((p) => (p.id === activePlan.id ? updater(p) : p));
    saveStore({ ...store, plans: nextPlans });
  }

  async function selectPlan(plan: StudyPlan) {
    saveStore({ ...store, activePlanId: plan.id });
    if (plan.subjectIds.length > 0) {
      await setSubjectOrder(plan.subjectIds);
    }
    notify(`Cronograma "${plan.name}" ativado e sincronizado com o Ciclo!`, 'success');
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

  function openNewPlanWizard(followCyclePreset = false) {
    setEditingPlanId(null);
    setWizFollowCycle(followCyclePreset);
    setWizStep(followCyclePreset ? 3 : 1);
    setWizSubjectIds(subjects.map((s) => s.id));
    const goal = profile?.daily_hours_goal || 3;
    setWizDailyHours({ 0: 0, 1: goal, 2: goal, 3: goal, 4: goal, 5: goal, 6: 0 });
    setWizBlockMin(90);
    setWizReviewMin(30);
    setWizSubjectsPerDay(0);
    setWizName(
      followCyclePreset
        ? 'Agenda do Ciclo de Estudos'
        : store.plans.length === 0
        ? 'Meu Cronograma Principal'
        : `Cronograma ${store.plans.length + 1}`
    );
    setWizStartDate(today);
    setShowWizard(true);
  }

  function openEditPlanWizard(plan: StudyPlan) {
    setEditingPlanId(plan.id);
    setWizFollowCycle(Boolean(plan.followCycle));
    setWizStep(plan.followCycle ? 3 : 1);
    setWizSubjectIds(
      plan.subjectIds.length > 0 ? plan.subjectIds : subjects.map((s) => s.id)
    );
    setWizDailyHours({ ...plan.dailyHoursByDow });
    setWizBlockMin(plan.blockMinutes || 90);
    setWizReviewMin(plan.dailyReviewMinutes ?? 30);
    setWizSubjectsPerDay(plan.subjectsPerDay || 0);
    setWizName(plan.name);
    setWizStartDate(plan.startDate || today);
    setShowWizard(true);
  }

  async function finishWizard() {
    if (wizSubjectIds.length === 0) return;
    const remainingTopics = topics.filter(
      (t) => wizSubjectIds.includes(t.subject_id) && !t.studied
    ).length;
    const estEnd = estimateFinishDate(wizStartDate, remainingTopics, wizDailyHours, wizReviewMin);

    if (editingPlanId) {
      const nextPlans = store.plans.map((p) =>
        p.id === editingPlanId
          ? {
              ...p,
              name: wizName.trim() || p.name,
              subjectIds: wizSubjectIds,
              dailyHoursByDow: wizDailyHours,
              blockMinutes: wizBlockMin,
              dailyReviewMinutes: wizReviewMin,
              subjectsPerDay: wizSubjectsPerDay,
              followCycle: wizFollowCycle,
              startDate: wizStartDate,
              estimatedEndDate: estEnd,
              movedOverrides: {},
            }
          : p
      );
      saveStore({
        ...store,
        activePlanId: editingPlanId,
        plans: nextPlans,
      });
      if (!wizFollowCycle) {
        await setSubjectOrder(wizSubjectIds);
      }
      setEditingPlanId(null);
      setShowWizard(false);
      setActiveTab('cronograma');
      notify('Cronograma atualizado e agenda reorganizada!', 'success');
      return;
    }

    const newPlan: StudyPlan = {
      id: `plan-${Date.now()}`,
      name: wizName.trim() || 'Cronograma de Estudos',
      subjectIds: wizSubjectIds,
      dailyHoursByDow: wizDailyHours,
      blockMinutes: wizBlockMin,
      dailyReviewMinutes: wizReviewMin,
      subjectsPerDay: wizSubjectsPerDay,
      followCycle: wizFollowCycle,
      startDate: wizStartDate,
      estimatedEndDate: estEnd,
      completedBlockIds: [],
      movedOverrides: {},
    };
    saveStore({
      ...store,
      activePlanId: newPlan.id,
      plans: [...store.plans, newPlan],
    });
    if (!wizFollowCycle) {
      await setSubjectOrder(wizSubjectIds);
    }
    setShowWizard(false);
    setActiveTab('cronograma');
    notify(`Cronograma "${newPlan.name}" criado e ordem sincronizada com o Ciclo!`, 'success');
  }

  // Mapa de sessões registradas no Ciclo de Estudos por (data + matéria)
  const loggedByDateSubject = useMemo(() => {
    const map: Record<string, number> = {};
    for (const log of studyLogs) {
      if (!log.subject_id || !log.study_date) continue;
      const key = `${log.study_date}__${log.subject_id}`;
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [studyLogs]);

  // Gera blocos SOMENTE se existir um cronograma ativo!
  // Sincroniza automaticamente com o Ciclo de Estudos (quem estudou no Ciclo já aparece como concluído na Agenda!)
  const scheduledBlocks: ScheduledBlock[] = useMemo(() => {
    if (!activePlan) return [];
    const orderedSubjects = activePlan.followCycle
      ? subjects
      : (activePlan.subjectIds
          .map((id) => subjects.find((s) => s.id === id))
          .filter(Boolean) as typeof subjects);
    if (orderedSubjects.length === 0) return [];

    const out: ScheduledBlock[] = [];
    const completedSet = new Set(activePlan.completedBlockIds || []);
    const overrides = activePlan.movedOverrides || {};
    const genStart = activePlan.startDate || startOfWeekMonday(today);
    const usedLogs: Record<string, number> = {};
    const fixedPerDay = Number(activePlan.subjectsPerDay || 0);

    const isDoneWithCycleSync = (id: string, finalDate: string, subjectId: string) => {
      if (completedSet.has(id)) return true;
      const key = `${finalDate}__${subjectId}`;
      const avail = loggedByDateSubject[key] || 0;
      const used = usedLogs[key] || 0;
      if (used < avail) {
        usedLogs[key] = used + 1;
        return true;
      }
      return false;
    };

    if (activePlan.followCycle) {
      // Distribuição equilibrada seguindo a ordem e carga proporcional do Ciclo (evita blocos gigantes tipo 210 min + 30 min)
      const resetCyclePool = () =>
        orderedSubjects.map((s) => Math.max(30, s.cycle_hours * 60 + s.cycle_minutes));
      let remainingPool = resetCyclePool();
      let cursorIdx = 0;

      for (let dayOffset = 0; dayOffset < 42; dayOffset++) {
        const iso = addDaysISO(genStart, dayOffset);
        const dow = parseISO(iso).getDay();
        const hours = Number(activePlan.dailyHoursByDow[dow] || 0);
        if (hours <= 0) continue;

        let availableDayMin = Math.max(30, Math.round(hours * 60 - (activePlan.dailyReviewMinutes || 0)));
        const targetSlots =
          fixedPerDay > 0
            ? fixedPerDay
            : Math.max(1, Math.round(availableDayMin / (activePlan.blockMinutes || 90)));
        const slotCap = Math.max(30, Math.round(availableDayMin / targetSlots));
        const usedToday = new Set<number>();

        for (let blockIdx = 0; blockIdx < targetSlots && availableDayMin >= 20; blockIdx++) {
          if (remainingPool.every((m) => m <= 0)) {
            remainingPool = resetCyclePool();
          }

          // Procura próxima matéria na ordem do ciclo que ainda tem tempo e ainda não foi usada hoje
          let chosen = -1;
          for (let step = 0; step < orderedSubjects.length; step++) {
            const idx = (cursorIdx + step) % orderedSubjects.length;
            if (remainingPool[idx] > 0 && !usedToday.has(idx)) {
              chosen = idx;
              break;
            }
          }
          // Se todas com saldo já foram usadas hoje, pega a próxima com saldo
          if (chosen === -1) {
            for (let step = 0; step < orderedSubjects.length; step++) {
              const idx = (cursorIdx + step) % orderedSubjects.length;
              if (remainingPool[idx] > 0) {
                chosen = idx;
                break;
              }
            }
          }
          if (chosen === -1) break;

          const sub = orderedSubjects[chosen];
          const remainingSlots = targetSlots - blockIdx;
          const idealSlot = Math.max(25, Math.round(availableDayMin / remainingSlots));
          const maxForThisBlock = Math.min(availableDayMin, Math.max(slotCap, idealSlot));
          let sliceMin = Math.min(maxForThisBlock, remainingPool[chosen]);
          // Evita sobrar um restinho minúsculo (< 20 min) na matéria
          if (remainingPool[chosen] - sliceMin > 0 && remainingPool[chosen] - sliceMin < 20 && remainingPool[chosen] <= availableDayMin) {
            sliceMin = remainingPool[chosen];
          }
          // Se o saldo final da matéria for bem menor que o bloco ideal, usa pelo menos 30 min quando houver tempo
          if (sliceMin < 25 && availableDayMin >= 30) {
            sliceMin = Math.min(availableDayMin, 30);
          }

          const id = `${activePlan.id}-${iso}-${blockIdx}`;
          const finalDate = overrides[id] || iso;
          const done = isDoneWithCycleSync(id, finalDate, sub.id);

          out.push({
            id,
            date: finalDate,
            subjectId: sub.id,
            name: sub.name,
            color: sub.color,
            minutes: sliceMin,
            done,
            overdue: !done && finalDate < today,
          });

          availableDayMin -= sliceMin;
          remainingPool[chosen] = Math.max(0, remainingPool[chosen] - sliceMin);
          usedToday.add(chosen);
          cursorIdx = (chosen + 1) % orderedSubjects.length;
        }
      }
      return out;
    }

    let subjectIdx = 0;
    for (let dayOffset = 0; dayOffset < 42; dayOffset++) {
      const iso = addDaysISO(genStart, dayOffset);
      const dow = parseISO(iso).getDay();
      const hours = Number(activePlan.dailyHoursByDow[dow] || 0);
      if (hours <= 0) continue;

      const netStudyMinutes = Math.max(30, hours * 60 - (activePlan.dailyReviewMinutes || 0));
      const blocksToday =
        fixedPerDay > 0
          ? fixedPerDay
          : Math.max(1, Math.round(netStudyMinutes / (activePlan.blockMinutes || 90)));
      const perBlockMinutes =
        fixedPerDay > 0
          ? Math.max(20, Math.round(netStudyMinutes / blocksToday))
          : activePlan.blockMinutes || 90;

      for (let b = 0; b < blocksToday; b++) {
        const sub = orderedSubjects[subjectIdx % orderedSubjects.length];
        subjectIdx++;
        const id = `${activePlan.id}-${iso}-${b}`;
        const finalDate = overrides[id] || iso;
        const done = isDoneWithCycleSync(id, finalDate, sub.id);
        out.push({
          id,
          date: finalDate,
          subjectId: sub.id,
          name: sub.name,
          color: sub.color,
          minutes: perBlockMinutes,
          done,
          overdue: !done && finalDate < today,
        });
      }
    }
    return out;
  }, [activePlan, subjects, today, loggedByDateSubject]);

  const overdueBlocks = scheduledBlocks.filter((b) => b.overdue);
  const todayPendingBlocks = scheduledBlocks.filter((b) => b.date === today && !b.done);

  function reorganizePendingFrom(targetStartDate: string, includeTodayPending: boolean) {
    if (!activePlan) return;
    const delayed = scheduledBlocks
      .filter((b) => !b.done && (includeTodayPending ? b.date <= today : b.date < targetStartDate))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (delayed.length === 0) return;

    const delayedIds = new Set(delayed.map((b) => b.id));
    const upcoming = scheduledBlocks
      .filter((b) => !b.done && b.date >= targetStartDate && !delayedIds.has(b.id))
      .sort((a, b) => a.date.localeCompare(b.date));

    const queue = [...delayed, ...upcoming];
    const nextOverrides = { ...(activePlan.movedOverrides || {}) };
    const fixedPerDay = Number(activePlan.subjectsPerDay || 0);

    let cursor = targetStartDate;
    let cursorCap = 0;
    let usedToday = 0;

    const getDayCapacity = (iso: string) => {
      const dow = parseISO(iso).getDay();
      const hours = Number(activePlan.dailyHoursByDow[dow] || 0);
      if (hours <= 0) return 0;
      if (fixedPerDay > 0) return fixedPerDay;
      const netMin = Math.max(30, hours * 60 - (activePlan.dailyReviewMinutes || 0));
      return Math.max(1, Math.round(netMin / (activePlan.blockMinutes || 90)));
    };

    const advanceToStudyDay = (fromIso: string) => {
      let d = fromIso;
      for (let i = 0; i < 14; i++) {
        const cap = getDayCapacity(d);
        if (cap > 0) return { date: d, cap };
        d = addDaysISO(d, 1);
      }
      return { date: fromIso, cap: Math.max(1, fixedPerDay || 2) };
    };

    const first = advanceToStudyDay(cursor);
    cursor = first.date;
    cursorCap = first.cap;
    usedToday = 0;

    for (const blk of queue) {
      if (usedToday >= cursorCap) {
        const nxt = advanceToStudyDay(addDaysISO(cursor, 1));
        cursor = nxt.date;
        cursorCap = nxt.cap;
        usedToday = 0;
      }
      nextOverrides[blk.id] = cursor;
      usedToday++;
    }

    updateActivePlan((p) => ({ ...p, movedOverrides: nextOverrides }));
    return delayed.length;
  }

  // Reorganização automática ao virar o dia: matérias não estudadas de dias anteriores vão para hoje e empurram o resto em cascata!
  const autoRolloverKeyRef = useRef<string>('');
  useEffect(() => {
    if (!activePlan || overdueBlocks.length === 0) return;
    const key = `${activePlan.id}_${today}`;
    if (autoRolloverKeyRef.current === key) return;
    autoRolloverKeyRef.current = key;
    const movedCount = reorganizePendingFrom(today, false);
    if (movedCount && movedCount > 0) {
      notify(
        `${movedCount} ${movedCount === 1 ? 'matéria não estudada foi movida' : 'matérias não estudadas foram movidas'} para hoje e a agenda foi reorganizada!`,
        'info'
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlan?.id, overdueBlocks.length, today]);

  function pullOverdueForward() {
    const moved = reorganizePendingFrom(today, false);
    if (moved) {
      notify('Matérias atrasadas movidas para hoje e agenda reorganizada!', 'success');
    }
  }

  function moveTodayPendingToTomorrow() {
    const tomorrow = addDaysISO(today, 1);
    const moved = reorganizePendingFrom(tomorrow, true);
    if (moved) {
      notify(
        `${moved} ${moved === 1 ? 'matéria pendente de hoje foi movida' : 'matérias pendentes de hoje foram movidas'} para o próximo dia de estudo e a agenda foi reorganizada!`,
        'success'
      );
    }
  }

  function toggleBlockDone(blockId: string) {
    if (!activePlan) return;
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

  function confirmMoveBlock() {
    if (!moveTargetBlock || !activePlan) return;
    updateActivePlan((p) => ({
      ...p,
      movedOverrides: { ...(p.movedOverrides || {}), [moveTargetBlock.id]: moveToDate },
    }));
    setMoveTargetBlock(null);
  }

  // Grade de Aulas handlers
  function handleAddClass(e: React.FormEvent) {
    e.preventDefault();
    const selectedSub = subjects.find((s) => s.id === clsSubjectId);
    const subName = selectedSub?.name || clsCustomName.trim();
    if (!subName) return;
    const prof = clsProfessor.trim() || (selectedSub ? store.subjectProfessors[selectedSub.id] || '' : '');

    const newSlot: ClassSlot = {
      id: `cls-${Date.now()}`,
      dayOfWeek: clsDow,
      startTime: clsStart,
      endTime: clsEnd,
      subjectId: selectedSub?.id || '',
      subjectName: subName,
      professor: prof,
      location: clsLocation.trim(),
    };

    const nextProfs = { ...store.subjectProfessors };
    if (selectedSub && prof) {
      nextProfs[selectedSub.id] = prof;
    }

    saveStore({
      ...store,
      classes: [...store.classes, newSlot],
      subjectProfessors: nextProfs,
    });

    setShowAddClass(false);
    setClsCustomName('');
    setClsProfessor('');
    setClsLocation('');
    notify(`Aula de ${subName} adicionada à grade!`, 'success');
  }

  function deleteClassSlot(id: string) {
    saveStore({ ...store, classes: store.classes.filter((c) => c.id !== id) });
  }

  function updateSubjectProfessor(subjectId: string, profName: string) {
    saveStore({
      ...store,
      subjectProfessors: { ...store.subjectProfessors, [subjectId]: profName },
    });
  }

  // Provas, Trabalhos & Entregas handlers
  function handleAddAssessment(e: React.FormEvent) {
    e.preventDefault();
    if (!asTitle.trim() || !asDate) return;
    const sub = subjects.find((s) => s.id === asSubjectId);
    const item: AssessmentItem = {
      id: `assess-${Date.now()}`,
      kind: asKind,
      title: asTitle.trim(),
      subjectId: sub?.id || '',
      subjectName: sub?.name || '',
      professor: sub ? store.subjectProfessors[sub.id] || '' : '',
      date: asDate,
      time: asTime,
      weight: asWeight.trim(),
      notes: asNotes.trim(),
      done: false,
    };
    saveStore({
      ...store,
      assessments: [...store.assessments, item].sort((a, b) => a.date.localeCompare(b.date)),
    });
    setShowAddAssess(false);
    setAsTitle('');
    setAsTime('');
    setAsWeight('');
    setAsNotes('');
    notify(`${asKind} "${item.title}" agendado!`, 'success');
  }

  function toggleAssessmentDone(id: string) {
    saveStore({
      ...store,
      assessments: store.assessments.map((a) => (a.id === id ? { ...a, done: !a.done } : a)),
    });
  }

  function deleteAssessment(id: string) {
    saveStore({
      ...store,
      assessments: store.assessments.filter((a) => a.id !== id),
    });
  }

  // Exportação Google Agenda (.ics)
  function handleExportGoogleCalendar() {
    const safeName = (profile?.name || 'StudyFlow').replace(/[^a-zA-Z0-9_-]/g, '_');
    const count = downloadIcsFile({
      filename: `StudyFlow_${safeName}.ics`,
      calendarName: `StudyFlow — ${profile?.name || 'Estudos'}`,
      classes: store.classes,
      assessments: store.assessments,
      blocks: scheduledBlocks,
    });
    if (count === 0) {
      notify('Adicione aulas, provas ou monte um cronograma antes de exportar.', 'info');
      return;
    }
    notify(
      `${count} evento(s) exportado(s)! Importe o arquivo .ics no Google Agenda ou abra no iPhone.`,
      'success'
    );
  }

  // Semana / Mês helpers para Cronograma
  const weekStart = startOfWeekMonday(cursorDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));

  const monthDate = parseISO(cursorDate);
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthDaysCount = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const leadingBlanks = (monthStart.getDay() + 6) % 7;
  const monthGridCells = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: monthDaysCount }, (_, i) =>
      toISO(new Date(monthDate.getFullYear(), monthDate.getMonth(), i + 1))
    ),
  ];

  const sortedAssessments = [...store.assessments].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.date.localeCompare(b.date);
  });

  const pendingAssessCount = store.assessments.filter((a) => !a.done).length;

  const inputClass =
    'w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2 text-xs';

  return (
    <div className="space-y-6">
      {/* Cabeçalho + Botão Exportar para Google Agenda */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-teal-600" />
            {isSchoolOrCollege ? 'Grade de Aulas, Provas & Cronograma' : 'Agenda & Cronogramas'}
          </h1>
          <p className="text-sm text-muted-theme mt-0.5">
            {isSchoolOrCollege
              ? 'Organize seus horários de aula com professores, provas/trabalhos e exporte para o Google Agenda.'
              : 'Monte seu cronograma de estudos, agende provas e exporte seus eventos para o Google Agenda.'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportGoogleCalendar}
          className="px-4 py-2.5 rounded-xl subtle-surface border border-theme hover:border-teal-500/50 text-xs font-bold inline-flex items-center gap-2 shrink-0 self-start md:self-auto"
          title="Baixa um arquivo .ics compatível com Google Agenda (PC) e Calendário do iPhone"
        >
          <Download className="w-4 h-4 text-teal-600" />
          Exportar para Google Agenda (.ics)
        </button>
      </div>

      {/* Abas principais limpas */}
      <div className="inline-flex flex-wrap p-1 rounded-2xl subtle-surface gap-1">
        {isSchoolOrCollege && (
          <button
            type="button"
            onClick={() => setActiveTab('aulas')}
            className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
              activeTab === 'aulas'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-muted-theme hover:text-[var(--text-main)]'
            }`}
          >
            <GraduationCap className="w-4 h-4" />
            Grade de Aulas ({store.classes.length})
          </button>
        )}
        <button
          type="button"
          onClick={() => setActiveTab('avaliacoes')}
          className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
            activeTab === 'avaliacoes'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-muted-theme hover:text-[var(--text-main)]'
          }`}
        >
          <FileCheck2 className="w-4 h-4" />
          {isSchoolOrCollege ? 'Provas & Trabalhos' : 'Provas & Tarefas'}
          {pendingAssessCount > 0 && (
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                activeTab === 'avaliacoes'
                  ? 'bg-white/25 text-white'
                  : 'bg-teal-600/15 text-teal-700 dark:text-teal-300'
              }`}
            >
              {pendingAssessCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('cronograma')}
          className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
            activeTab === 'cronograma'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-muted-theme hover:text-[var(--text-main)]'
          }`}
        >
          <CalendarRange className="w-4 h-4" />
          Cronograma de Estudos
        </button>
      </div>

      {/* ============================================================
          ABA 1: GRADE DE AULAS SEMANAL (FACULDADE / ESCOLA)
          ============================================================ */}
      {activeTab === 'aulas' && isSchoolOrCollege && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-theme">
              Monte sua grade semanal de horários com matéria, professor e sala.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowProfessors((v) => !v)}
                className="px-3.5 py-2 rounded-xl subtle-surface border border-theme text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <UserCheck className="w-3.5 h-3.5 text-teal-600" />
                Professores por matéria
              </button>
              <button
                type="button"
                onClick={() => {
                  setClsSubjectId(subjects[0]?.id || '');
                  setClsProfessor(subjects[0] ? store.subjectProfessors[subjects[0].id] || '' : '');
                  setShowAddClass(true);
                }}
                className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Adicionar Aula
              </button>
            </div>
          </div>

          {/* Painel recolhível: Cadastro de Professor por Matéria */}
          {showProfessors && (
            <div className="card-surface rounded-2xl p-5 space-y-3 animate-fade-in-up">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-sm flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-teal-600" />
                  Professores das Matérias
                </h2>
                <button
                  type="button"
                  onClick={() => setShowProfessors(false)}
                  className="text-xs font-semibold text-muted-theme hover:underline"
                >
                  Fechar
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {subjects.map((sub) => (
                  <div key={sub.id} className="subtle-surface rounded-xl p-3 space-y-1.5">
                    <label className="text-xs font-bold flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: sub.color }}
                      />
                      <span className="truncate">{sub.name}</span>
                    </label>
                    <input
                      value={store.subjectProfessors[sub.id] || ''}
                      onChange={(e) => updateSubjectProfessor(sub.id, e.target.value)}
                      placeholder="Nome do(a) professor(a)..."
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Grade Semanal (Segunda a Sábado) */}
          {store.classes.length === 0 ? (
            <div className="card-surface rounded-2xl p-10 text-center space-y-3">
              <GraduationCap className="w-9 h-9 mx-auto text-teal-600 opacity-70" />
              <p className="font-bold text-sm">Sua grade de aulas está vazia</p>
              <p className="text-xs text-muted-theme max-w-md mx-auto">
                Adicione os horários das suas aulas (dia da semana, horário, matéria, professor e sala) para montar seu calendário escolar/universitário.
              </p>
              <button
                type="button"
                onClick={() => {
                  setClsSubjectId(subjects[0]?.id || '');
                  setShowAddClass(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Adicionar primeira aula
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((dow) => {
                const dayClasses = store.classes
                  .filter((c) => c.dayOfWeek === dow)
                  .sort((a, b) => a.startTime.localeCompare(b.startTime));
                const isTodayDow = new Date().getDay() === dow;

                return (
                  <div
                    key={dow}
                    className={`card-surface rounded-2xl p-4 space-y-3 ${
                      isTodayDow ? 'ring-2 ring-teal-500/40' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-theme pb-2">
                      <span className="font-bold text-sm flex items-center gap-2">
                        {DAY_FULL[dow]}
                        {isTodayDow && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-600 text-white">
                            Hoje
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setClsDow(dow);
                          setClsSubjectId(subjects[0]?.id || '');
                          setClsProfessor(
                            subjects[0] ? store.subjectProfessors[subjects[0].id] || '' : ''
                          );
                          setShowAddClass(true);
                        }}
                        className="p-1 rounded-lg subtle-surface hover:bg-teal-600 hover:text-white"
                        title={`Adicionar aula na ${DAY_FULL[dow]}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {dayClasses.length === 0 ? (
                      <p className="text-xs text-muted-theme py-3 text-center">Sem aulas</p>
                    ) : (
                      <div className="space-y-2">
                        {dayClasses.map((cls) => {
                          const sub = subjects.find((s) => s.id === cls.subjectId);
                          const prof =
                            cls.professor ||
                            (cls.subjectId ? store.subjectProfessors[cls.subjectId] : '');
                          const gcalUrl = buildGoogleCalendarUrl({
                            title: `Aula: ${cls.subjectName}`,
                            dateISO: today,
                            startTime: cls.startTime,
                            endTime: cls.endTime,
                            description: prof ? `Professor(a): ${prof}` : 'Aula — StudyFlow',
                            location: cls.location,
                            weeklyDow: cls.dayOfWeek,
                          });

                          return (
                            <div
                              key={cls.id}
                              className="subtle-surface rounded-xl p-3 space-y-1.5 border-l-4"
                              style={{ borderLeftColor: sub?.color || '#0d9488' }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold text-teal-700 dark:text-teal-300 inline-flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {cls.startTime} – {cls.endTime}
                                </span>
                                <div className="flex items-center gap-1">
                                  <a
                                    href={gcalUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Adicionar aula recorrente ao Google Agenda"
                                    className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-theme hover:text-teal-600"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => deleteClassSlot(cls.id)}
                                    title="Remover aula"
                                    className="p-1 rounded-lg hover:bg-rose-500/15 text-muted-theme hover:text-rose-600"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              <p className="font-bold text-xs">{cls.subjectName}</p>
                              {(prof || cls.location) && (
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-theme">
                                  {prof && (
                                    <span className="inline-flex items-center gap-1">
                                      <UserCheck className="w-3 h-3" />
                                      {prof}
                                    </span>
                                  )}
                                  {cls.location && (
                                    <span className="inline-flex items-center gap-1">
                                      <MapPin className="w-3 h-3" />
                                      {cls.location}
                                    </span>
                                  )}
                                </div>
                              )}
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
        </div>
      )}

      {/* ============================================================
          ABA 2: PROVAS, TRABALHOS & ENTREGAS
          ============================================================ */}
      {activeTab === 'avaliacoes' && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-muted-theme">
              Cadastre provas, trabalhos, seminários e entregas. Cada item pode ser enviado com 1 clique para o Google Agenda.
            </p>
            <button
              type="button"
              onClick={() => {
                setAsSubjectId(subjects[0]?.id || '');
                setAsDate(today);
                setShowAddAssess(true);
              }}
              className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Nova Prova / Trabalho
            </button>
          </div>

          {sortedAssessments.length === 0 ? (
            <div className="card-surface rounded-2xl p-10 text-center space-y-3">
              <FileCheck2 className="w-9 h-9 mx-auto text-teal-600 opacity-70" />
              <p className="font-bold text-sm">Nenhuma prova ou trabalho cadastrado</p>
              <p className="text-xs text-muted-theme max-w-md mx-auto">
                Registre suas próximas avaliações, datas de entrega e pesos para acompanhar tudo pelo painel e exportar para o Google Agenda.
              </p>
              <button
                type="button"
                onClick={() => setShowAddAssess(true)}
                className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Cadastrar primeira avaliação
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sortedAssessments.map((item) => {
                const diff = daysBetween(today, item.date);
                const prof =
                  item.professor ||
                  (item.subjectId ? store.subjectProfessors[item.subjectId] : '');
                const gcalUrl = buildGoogleCalendarUrl({
                  title: `[${item.kind}] ${item.title}`,
                  dateISO: item.date,
                  startTime: item.time || undefined,
                  description: [
                    item.subjectName ? `Matéria: ${item.subjectName}` : '',
                    prof ? `Professor(a): ${prof}` : '',
                    item.weight ? `Peso/Valor: ${item.weight}` : '',
                    item.notes || '',
                  ]
                    .filter(Boolean)
                    .join('\n'),
                });

                return (
                  <div
                    key={item.id}
                    className={`card-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      item.done ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleAssessmentDone(item.id)}
                        className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          item.done
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {item.done && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                            {item.kind}
                          </span>
                          {item.subjectName && (
                            <span className="text-[11px] font-semibold text-muted-theme">
                              {item.subjectName}
                            </span>
                          )}
                          {prof && (
                            <span className="text-[11px] text-muted-theme">· Prof. {prof}</span>
                          )}
                          {item.weight && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full subtle-surface">
                              {item.weight}
                            </span>
                          )}
                        </div>
                        <p className={`font-bold text-sm ${item.done ? 'line-through' : ''}`}>
                          {item.title}
                        </p>
                        {item.notes && (
                          <p className="text-xs text-muted-theme mt-0.5">{item.notes}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-xl ${
                          item.done
                            ? 'subtle-surface text-muted-theme'
                            : diff < 0
                            ? 'bg-rose-500/15 text-rose-600'
                            : diff === 0
                            ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                            : 'subtle-surface'
                        }`}
                      >
                        {formatDateBR(item.date)}
                        {item.time ? ` · ${item.time}` : ''}
                        {!item.done &&
                          (diff < 0
                            ? ' (Atrasado)'
                            : diff === 0
                            ? ' (Hoje!)'
                            : ` (em ${diff}d)`)}
                      </span>
                      <a
                        href={gcalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1.5 rounded-xl subtle-surface hover:border-teal-500/50 border border-theme text-xs font-semibold inline-flex items-center gap-1"
                        title="Abrir no Google Agenda"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-teal-600" />
                        Google Agenda
                      </a>
                      <button
                        type="button"
                        onClick={() => deleteAssessment(item.id)}
                        className="p-1.5 rounded-xl hover:bg-rose-500/15 text-muted-theme hover:text-rose-600"
                        title="Excluir"
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
      )}

      {/* ============================================================
          ABA 3: CRONOGRAMA DE ESTUDOS (COMEÇA VAZIO ATÉ MONTAR!)
          ============================================================ */}
      {activeTab === 'cronograma' && (
        <div className="space-y-5 animate-fade-in-up">
          {!activePlan ? (
            <div className="card-surface rounded-3xl p-10 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-teal-600/12 text-teal-600 flex items-center justify-center mx-auto">
                <CalendarRange className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h2 className="font-bold text-lg">Sua agenda de estudos está vazia</h2>
                <p className="text-xs text-muted-theme max-w-md mx-auto leading-relaxed">
                  Monte um cronograma escolhendo as matérias, a ordem desejada e sua carga horária por dia. Você pode criar vários cronogramas com nomes diferentes e alternar entre eles.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => openNewPlanWizard(true)}
                  className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-2 shadow-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Seguir meu Ciclo de Estudos
                </button>
                <button
                  type="button"
                  onClick={() => openNewPlanWizard(false)}
                  className="px-5 py-2.5 rounded-xl subtle-surface border border-theme hover:border-teal-500/50 text-xs font-bold inline-flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4 text-teal-600" />
                  Montar Cronograma Personalizado
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Barra de seleção entre múltiplos cronogramas */}
              <div className="card-surface rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {store.plans.map((p) => {
                    const isActive = p.id === activePlan.id;
                    return (
                      <div key={p.id} className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => selectPlan(p)}
                          className={`px-3.5 py-2 rounded-xl text-xs font-bold ${
                            isActive
                              ? 'bg-teal-600 text-white shadow-sm'
                              : 'subtle-surface hover:opacity-85'
                          }`}
                        >
                          {p.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditPlanWizard(p)}
                          className="p-1.5 rounded-lg text-muted-theme hover:text-teal-600"
                          title="Editar cronograma (matérias/dia, horários e ordem)"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePlan(p.id)}
                          className="p-1.5 rounded-lg text-muted-theme hover:text-rose-600"
                          title="Excluir cronograma"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => openNewPlanWizard(false)}
                    className="px-3.5 py-2 rounded-xl border border-dashed border-teal-500/50 text-teal-700 dark:text-teal-300 text-xs font-bold inline-flex items-center gap-1 hover:bg-teal-500/10"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Novo Cronograma
                  </button>
                </div>

                <div className="text-xs text-muted-theme flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      const nextFollow = !activePlan.followCycle;
                      updateActivePlan((p) => ({ ...p, followCycle: nextFollow }));
                      notify(
                        nextFollow
                          ? 'Agenda sincronizada ao vivo com a ordem e as horas do seu Ciclo de Estudos!'
                          : 'Modo personalizado ativado para este cronograma.',
                        'success'
                      );
                    }}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 border transition ${
                      activePlan.followCycle
                        ? 'bg-teal-600/12 border-teal-500/40 text-teal-700 dark:text-teal-300'
                        : 'subtle-surface border-theme text-muted-theme hover:text-[var(--text-main)]'
                    }`}
                    title="Usa automaticamente a ordem e a quantidade de horas definidas no seu Ciclo de Estudos"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {activePlan.followCycle
                      ? 'Seguindo Ciclo de Estudos'
                      : 'Seguir Ciclo de Estudos'}
                  </button>
                  {todayPendingBlocks.length > 0 && (
                    <button
                      type="button"
                      onClick={moveTodayPendingToTomorrow}
                      className="px-3 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 border border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 transition"
                      title="Move as matérias ainda não estudadas de hoje para amanhã e reorganiza os próximos dias"
                    >
                      <ArrowRightCircle className="w-3.5 h-3.5" />
                      Passar {todayPendingBlocks.length} pendente{todayPendingBlocks.length > 1 ? 's' : ''} de hoje p/ amanhã
                    </button>
                  )}
                  <span>
                    Término estimado:{' '}
                    <strong className="text-teal-700 dark:text-teal-300">
                      {formatDateBR(activePlan.estimatedEndDate)}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Sugestão inteligente de hoje (sem obrigar) */}
              {(() => {
                const nextTodayBlock = scheduledBlocks.find((b) => b.date === today && !b.done);
                if (!nextTodayBlock) return null;
                const h = Math.floor(nextTodayBlock.minutes / 60);
                const m = nextTodayBlock.minutes % 60;
                return (
                  <div className="card-surface rounded-2xl p-4 border-l-4 border-l-teal-600 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                        {activePlan.followCycle
                          ? 'Sugestão de hoje pelo seu Ciclo de Estudos'
                          : 'Próxima matéria sugerida para hoje'}
                      </p>
                      <p className="text-sm font-extrabold mt-0.5 truncate">
                        {nextTodayBlock.name}{' '}
                        <span className="font-semibold text-muted-theme">
                          ({h > 0 ? `${h}h` : ''}
                          {m > 0 ? ` ${m}min` : ''})
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-theme">
                        Apenas uma sugestão na ordem — você pode iniciar agora ou escolher outra matéria se preferir.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => startStopwatch(nextTodayBlock.subjectId)}
                      className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Iniciar sugestão
                    </button>
                  </div>
                );
              })()}

              {/* Aviso de blocos atrasados (puxar sem pular matéria) */}
              {overdueBlocks.length > 0 && (
                <div className="rounded-2xl bg-amber-500/12 border border-amber-500/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Você tem {overdueBlocks.length} bloco(s) pendente(s) de dias anteriores. Puxe para frente sem pular nenhuma matéria da ordem!
                  </span>
                  <button
                    type="button"
                    onClick={pullOverdueForward}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shrink-0"
                  >
                    Puxar atrasados para hoje
                  </button>
                </div>
              )}

              {/* Controles Semanal / Mensal */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setCursorDate(addDaysISO(cursorDate, viewMode === 'week' ? -7 : -30))
                    }
                    className="p-2 rounded-xl card-surface"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCursorDate(today)}
                    className="px-3 py-1.5 rounded-xl card-surface text-xs font-bold"
                  >
                    Hoje
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCursorDate(addDaysISO(cursorDate, viewMode === 'week' ? 7 : 30))
                    }
                    className="p-2 rounded-xl card-surface"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-bold ml-1">
                    {MONTH_NAMES[monthDate.getMonth()]} {monthDate.getFullYear()}
                  </span>
                </div>

                <div className="inline-flex p-1 rounded-xl subtle-surface gap-1 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setViewMode('week')}
                    className={`px-3 py-1.5 rounded-lg ${
                      viewMode === 'week' ? 'bg-teal-600 text-white' : 'text-muted-theme'
                    }`}
                  >
                    Semanal
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('month')}
                    className={`px-3 py-1.5 rounded-lg ${
                      viewMode === 'month' ? 'bg-teal-600 text-white' : 'text-muted-theme'
                    }`}
                  >
                    Mensal
                  </button>
                </div>
              </div>

              {/* Visão Semanal */}
              {viewMode === 'week' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
                  {weekDays.map((iso) => {
                    const dayBlocks = scheduledBlocks.filter((b) => b.date === iso);
                    const dow = parseISO(iso).getDay();
                    const isToday = iso === today;
                    return (
                      <div
                        key={iso}
                        className={`card-surface rounded-2xl p-3 space-y-2.5 min-h-[160px] ${
                          isToday ? 'ring-2 ring-teal-500/50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between border-b border-theme pb-1.5">
                          <span className="text-xs font-bold">{DAY_LABELS[dow]}</span>
                          <span
                            className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${
                              isToday ? 'bg-teal-600 text-white' : 'text-muted-theme'
                            }`}
                          >
                            {formatDateBR(iso).slice(0, 5)}
                          </span>
                        </div>
                        {dayBlocks.length === 0 ? (
                          <p className="text-[11px] text-muted-theme text-center py-4">Descanso</p>
                        ) : (
                          <div className="space-y-2">
                            {dayBlocks.map((b) => (
                              <div
                                key={b.id}
                                className={`rounded-xl p-2.5 text-xs border-l-4 subtle-surface space-y-1.5 ${
                                  b.done ? 'opacity-55' : ''
                                }`}
                                style={{ borderLeftColor: b.color }}
                              >
                                <p className={`font-bold leading-snug ${b.done ? 'line-through' : ''}`}>
                                  {b.name}
                                </p>
                                <p className="text-[10px] text-muted-theme">
                                  {b.minutes >= 60
                                    ? `${Math.floor(b.minutes / 60)}h${b.minutes % 60 > 0 ? ` ${b.minutes % 60}m` : ''}`
                                    : `${b.minutes} min`}
                                </p>
                                <div className="flex items-center gap-1 pt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleBlockDone(b.id)}
                                    title={b.done ? 'Desmarcar' : 'Concluir bloco'}
                                    className={`p-1 rounded-lg ${
                                      b.done
                                        ? 'bg-emerald-600 text-white'
                                        : 'card-surface hover:bg-emerald-600 hover:text-white'
                                    }`}
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startStopwatch(b.subjectId)}
                                    title="Iniciar cronômetro"
                                    className="p-1 rounded-lg card-surface hover:bg-teal-600 hover:text-white"
                                  >
                                    <Play className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMoveTargetBlock(b);
                                      setMoveToDate(b.date);
                                    }}
                                    title="Mover para outro dia"
                                    className="px-1.5 py-0.5 rounded-lg card-surface text-[10px] font-semibold ml-auto"
                                  >
                                    Mover
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Lembrete discreto e recolhível de Revisões do dia */}
                        {(() => {
                          const dayRevs = reviews.filter((r) => !r.completed && r.due_date === iso);
                          const revMin = activePlan.dailyReviewMinutes || 0;
                          const hasStudyDay = Number(activePlan.dailyHoursByDow[dow] || 0) > 0;
                          if (dayRevs.length === 0 && !(hasStudyDay && revMin > 0)) return null;
                          const isRevOpen = !!openReviewDays[iso];
                          return (
                            <div className="pt-1.5 border-t border-theme/70">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenReviewDays((prev) => ({ ...prev, [iso]: !isRevOpen }))
                                }
                                className="w-full text-left px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/15 text-[10px] font-bold text-amber-800 dark:text-amber-300 flex items-center justify-between gap-1"
                              >
                                <span className="truncate">
                                  Revisões{revMin > 0 ? ` (${revMin}m)` : ''}
                                  {dayRevs.length > 0 ? ` · ${dayRevs.length}` : ''}
                                </span>
                                <span>{isRevOpen ? '▲' : '▼'}</span>
                              </button>
                              {isRevOpen && (
                                <div className="mt-1.5 space-y-1 text-[10px] px-1">
                                  {dayRevs.length > 0 ? (
                                    dayRevs.slice(0, 4).map((r) => {
                                      const tp = topics.find((t) => t.id === r.topic_id);
                                      return (
                                        <p key={r.id} className="text-muted-theme truncate">
                                          • {tp?.title || 'Tópico'} ({r.interval_days}d)
                                        </p>
                                      );
                                    })
                                  ) : (
                                    <p className="text-muted-theme">
                                      Reserva diária de {revMin} min para revisões/flashcards.
                                    </p>
                                  )}
                                  <Link
                                    href={`/p/${profile?.id}/revisoes`}
                                    className="inline-block font-bold text-teal-700 dark:text-teal-300 hover:underline pt-0.5"
                                  >
                                    Abrir Revisões →
                                  </Link>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Visão Mensal */
                <div className="card-surface rounded-2xl p-4">
                  <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-bold text-muted-theme mb-2">
                    {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => (
                      <div key={d}>{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {monthGridCells.map((iso, idx) => {
                      if (!iso) return <div key={idx} className="min-h-[72px]" />;
                      const dayBlocks = scheduledBlocks.filter((b) => b.date === iso);
                      const isToday = iso === today;
                      return (
                        <div
                          key={iso}
                          className={`rounded-xl p-2 min-h-[78px] subtle-surface border ${
                            isToday ? 'border-teal-600' : 'border-transparent'
                          }`}
                        >
                          <p
                            className={`text-[11px] font-bold mb-1 ${
                              isToday ? 'text-teal-600' : 'text-muted-theme'
                            }`}
                          >
                            {Number(iso.slice(8, 10))}
                          </p>
                          <div className="space-y-1">
                            {dayBlocks.slice(0, 3).map((b) => (
                              <div
                                key={b.id}
                                className="text-[10px] font-semibold truncate px-1.5 py-0.5 rounded-md text-white"
                                style={{ backgroundColor: b.color, opacity: b.done ? 0.5 : 1 }}
                              >
                                {b.name}
                              </div>
                            ))}
                            {dayBlocks.length > 3 && (
                              <p className="text-[10px] text-muted-theme">
                                +{dayBlocks.length - 3}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ============================================================
          MODAL: ADICIONAR AULA NA GRADE SEMANAL
          ============================================================ */}
      {showAddClass && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-md rounded-3xl p-6 space-y-4 animate-pop-in">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-base">Adicionar Aula na Grade</h2>
              <button
                type="button"
                onClick={() => setShowAddClass(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddClass} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Dia da semana</label>
                <select
                  value={clsDow}
                  onChange={(e) => setClsDow(Number(e.target.value))}
                  className={inputClass}
                >
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <option key={d} value={d}>
                      {DAY_FULL[d]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Início</label>
                  <input
                    type="time"
                    required
                    value={clsStart}
                    onChange={(e) => setClsStart(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Término</label>
                  <input
                    type="time"
                    required
                    value={clsEnd}
                    onChange={(e) => setClsEnd(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Matéria / Disciplina</label>
                <select
                  value={clsSubjectId}
                  onChange={(e) => {
                    setClsSubjectId(e.target.value);
                    if (e.target.value && store.subjectProfessors[e.target.value]) {
                      setClsProfessor(store.subjectProfessors[e.target.value]);
                    }
                  }}
                  className={inputClass}
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value="">Outra (digitar abaixo)</option>
                </select>
              </div>

              {!clsSubjectId && (
                <input
                  required
                  value={clsCustomName}
                  onChange={(e) => setClsCustomName(e.target.value)}
                  placeholder="Nome da matéria..."
                  className={inputClass}
                />
              )}

              <div>
                <label className="block text-xs font-semibold mb-1">Professor(a)</label>
                <input
                  value={clsProfessor}
                  onChange={(e) => setClsProfessor(e.target.value)}
                  placeholder="Ex: Prof. Carlos Silva"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Sala / Local (opcional)</label>
                <input
                  value={clsLocation}
                  onChange={(e) => setClsLocation(e.target.value)}
                  placeholder="Ex: Bloco B · Sala 204 ou Link"
                  className={inputClass}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddClass(false)}
                  className="px-4 py-2 rounded-xl subtle-surface text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
                >
                  Salvar Aula
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: ADICIONAR PROVA / TRABALHO / ENTREGA
          ============================================================ */}
      {showAddAssess && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-md rounded-3xl p-6 space-y-4 animate-pop-in">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-base">Cadastrar Prova ou Trabalho</h2>
              <button
                type="button"
                onClick={() => setShowAddAssess(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddAssessment} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Tipo</label>
                  <select
                    value={asKind}
                    onChange={(e) => setAsKind(e.target.value as AssessmentKind)}
                    className={inputClass}
                  >
                    <option value="Prova">Prova</option>
                    <option value="Trabalho">Trabalho</option>
                    <option value="Seminário">Seminário</option>
                    <option value="Dever">Dever / Atividade</option>
                    <option value="Entrega">Entrega</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Matéria</label>
                  <select
                    value={asSubjectId}
                    onChange={(e) => setAsSubjectId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Geral</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Título *</label>
                <input
                  required
                  value={asTitle}
                  onChange={(e) => setAsTitle(e.target.value)}
                  placeholder="Ex: Prova P1 — Contratos, Trabalho de Cálculo..."
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Data *</label>
                  <input
                    type="date"
                    required
                    value={asDate}
                    onChange={(e) => setAsDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Horário (opcional)</label>
                  <input
                    type="time"
                    value={asTime}
                    onChange={(e) => setAsTime(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Peso / Nota (opcional)</label>
                <input
                  value={asWeight}
                  onChange={(e) => setAsWeight(e.target.value)}
                  placeholder="Ex: Vale 30 pontos, Peso 2"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Observações (opcional)</label>
                <textarea
                  rows={2}
                  value={asNotes}
                  onChange={(e) => setAsNotes(e.target.value)}
                  placeholder="Capítulos que caem na prova, regras do trabalho..."
                  className={inputClass}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddAssess(false)}
                  className="px-4 py-2 rounded-xl subtle-surface text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: MOVER BLOCO PARA OUTRA DATA
          ============================================================ */}
      {moveTargetBlock && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-sm rounded-3xl p-6 space-y-4 animate-pop-in">
            <h2 className="font-bold text-base">Mover bloco de estudo</h2>
            <p className="text-xs text-muted-theme">
              Mover <strong>{moveTargetBlock.name}</strong> para qual data?
            </p>
            <input
              type="date"
              value={moveToDate}
              onChange={(e) => setMoveToDate(e.target.value)}
              className={inputClass}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveTargetBlock(null)}
                className="px-4 py-2 rounded-xl subtle-surface text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmMoveBlock}
                className="px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-bold"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          WIZARD 4 ETAPAS: MONTAR NOVO CRONOGRAMA
          ============================================================ */}
      {showWizard && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-xl rounded-3xl p-6 space-y-5 my-8 animate-pop-in">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-teal-600">
                  {editingPlanId ? 'Editar Cronograma · ' : ''}Etapa {wizStep} de 4
                </span>
                <h2 className="font-bold text-lg">
                  {wizStep === 1 && 'Escolha as matérias do cronograma'}
                  {wizStep === 2 && 'Defina a ordem das matérias'}
                  {wizStep === 3 && 'Carga horária por dia da semana'}
                  {wizStep === 4 && 'Nome e previsão de término'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowWizard(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {wizStep === 1 && (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {subjects.map((s) => {
                  const checked = wizSubjectIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setWizSubjectIds((prev) =>
                          checked ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                        )
                      }
                      className={`w-full text-left px-4 py-3 rounded-xl border flex items-center justify-between text-xs font-semibold ${
                        checked
                          ? 'border-teal-600 bg-teal-600/10'
                          : 'border-theme subtle-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.name}
                      </span>
                      {checked && <Check className="w-4 h-4 text-teal-600" />}
                    </button>
                  );
                })}
              </div>
            )}

            {wizStep === 2 && (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                <p className="text-xs text-muted-theme">
                  Arraste ou use as setas. Essa ordem também será aplicada ao seu Ciclo de Estudos.
                </p>
                {wizSubjectIds.map((id, idx) => {
                  const s = subjects.find((x) => x.id === id);
                  if (!s) return null;
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={() => setWizDragId(id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (!wizDragId || wizDragId === id) return;
                        setWizSubjectIds((prev) => {
                          const from = prev.indexOf(wizDragId);
                          const to = prev.indexOf(id);
                          const copy = [...prev];
                          const [item] = copy.splice(from, 1);
                          copy.splice(to, 0, item);
                          return copy;
                        });
                        setWizDragId(null);
                      }}
                      className="subtle-surface rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold cursor-grab"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <GripVertical className="w-4 h-4 text-muted-theme shrink-0" />
                        <span className="w-5 h-5 rounded-md bg-teal-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="truncate">{s.name}</span>
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() =>
                            setWizSubjectIds((prev) => {
                              const copy = [...prev];
                              [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                              return copy;
                            })
                          }
                          className="p-1 rounded-lg card-surface disabled:opacity-30"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === wizSubjectIds.length - 1}
                          onClick={() =>
                            setWizSubjectIds((prev) => {
                              const copy = [...prev];
                              [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                              return copy;
                            })
                          }
                          className="p-1 rounded-lg card-surface disabled:opacity-30"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {wizStep === 3 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-theme">
                  Defina quantas horas por dia você pretende estudar. Se perder um dia, a sequência continua de onde parou sem pular matérias.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                    <div key={dow} className="subtle-surface rounded-xl p-2.5 space-y-1">
                      <label className="text-xs font-bold block">{DAY_LABELS[dow]}</label>
                      <input
                        type="number"
                        min={0}
                        max={16}
                        step={0.5}
                        value={wizDailyHours[dow] ?? 0}
                        onChange={(e) =>
                          setWizDailyHours((prev) => ({
                            ...prev,
                            [dow]: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className={inputClass}
                      />
                    </div>
                  ))}
                </div>
                <div className="subtle-surface rounded-2xl p-3.5 border border-theme space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-bold">Quantas matérias estudar por dia?</label>
                    <span className="text-[11px] text-teal-600 dark:text-teal-400 font-bold">
                      {wizSubjectsPerDay === 0
                        ? 'Automático (pela carga horária)'
                        : `${wizSubjectsPerDay} ${wizSubjectsPerDay === 1 ? 'matéria' : 'matérias'}/dia`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setWizSubjectsPerDay(n)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                          wizSubjectsPerDay === n
                            ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                            : 'card-surface border-theme hover:border-teal-500/50'
                        }`}
                      >
                        {n === 0 ? 'Auto' : `${n}/dia`}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-theme">
                    Ao definir um número fixo (ex: 2/dia ou 3/dia), a agenda reorganiza todos os dias dividindo suas horas entre essa quantidade de matérias.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {wizFollowCycle ? (
                    <div className="flex items-center gap-2 rounded-xl bg-teal-600/10 border border-teal-500/30 px-3 py-2 text-xs text-teal-800 dark:text-teal-200 font-semibold">
                      <RefreshCw className="w-4 h-4 shrink-0" />
                      Usando a ordem e as horas exatas do seu Ciclo
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 subtle-surface rounded-xl px-3 py-2">
                      <label className="text-xs font-semibold">Duração do bloco:</label>
                      <select
                        value={wizBlockMin}
                        onChange={(e) => setWizBlockMin(Number(e.target.value))}
                        className="rounded-lg bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs font-semibold"
                      >
                        <option value={45}>45 min</option>
                        <option value={60}>1 hora</option>
                        <option value={90}>1h 30m</option>
                        <option value={120}>2 horas</option>
                      </select>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 subtle-surface rounded-xl px-3 py-2">
                    <label className="text-xs font-semibold">Tempo de revisão/dia:</label>
                    <select
                      value={wizReviewMin}
                      onChange={(e) => setWizReviewMin(Number(e.target.value))}
                      className="rounded-lg bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs font-semibold"
                    >
                      <option value={0}>Sem reserva (0 min)</option>
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={45}>45 min</option>
                      <option value={60}>1 hora</option>
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-muted-theme">
                  O tempo de revisão diário já é descontado automaticamente da sua carga horária ao calcular os blocos de matéria nova e a data prevista de término.
                </p>
              </div>
            )}

            {wizStep === 4 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Nome do Cronograma</label>
                  <input
                    value={wizName}
                    onChange={(e) => setWizName(e.target.value)}
                    placeholder="Ex: Reta Final, Semestre 2026.1..."
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Data de início</label>
                  <input
                    type="date"
                    value={wizStartDate}
                    onChange={(e) => setWizStartDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="rounded-2xl bg-teal-600/10 border border-teal-500/30 p-4 text-xs space-y-1">
                  <p className="font-bold text-teal-700 dark:text-teal-300">
                    Previsão estimada de término:{' '}
                    {formatDateBR(
                      estimateFinishDate(
                        wizStartDate,
                        topics.filter(
                          (t) => wizSubjectIds.includes(t.subject_id) && !t.studied
                        ).length,
                        wizDailyHours,
                        wizReviewMin
                      )
                    )}
                  </p>
                  <p className="text-muted-theme">
                    Calculado com base nos tópicos pendentes das {wizSubjectIds.length} matérias selecionadas e na sua carga horária semanal.
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2 border-t border-theme">
              <button
                type="button"
                onClick={() =>
                  wizStep === 1 || (wizFollowCycle && wizStep === 3)
                    ? setShowWizard(false)
                    : setWizStep((wizStep - 1) as 1 | 2 | 3 | 4)
                }
                className="px-4 py-2 rounded-xl subtle-surface text-xs font-semibold"
              >
                {wizStep === 1 ? 'Cancelar' : 'Voltar'}
              </button>
              {wizStep < 4 ? (
                <button
                  type="button"
                  disabled={wizStep === 1 && wizSubjectIds.length === 0}
                  onClick={() => setWizStep((wizStep + 1) as 1 | 2 | 3 | 4)}
                  className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold disabled:opacity-40"
                >
                  Continuar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finishWizard}
                  className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
                >
                  {editingPlanId ? 'Salvar Alterações' : 'Criar Cronograma'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
