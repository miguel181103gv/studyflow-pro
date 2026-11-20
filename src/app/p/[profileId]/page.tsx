'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useProfile } from '@/components/ProfileProvider';
import { getStudyMode } from '@/lib/studyModes';
import {
  calcAccuracy,
  daysBetween,
  formatDateBR,
  formatDurationHM,
  formatDurationHMS,
  getGreeting,
  todayISO,
  addDaysISO,
} from '@/lib/utils';
import {
  Clock,
  Target,
  CheckCircle2,
  Flame,
  Play,
  Pause,
  ArrowRight,
  Layers,
  Calendar,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Pencil,
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

export default function DashboardPage() {
  const {
    userEmail,
    profile,
    subjects,
    topics,
    studyLogs,
    reviews,
    errors,
    flashcards,
    stopwatch,
    startStopwatch,
    pauseStopwatch,
    completeReview,
  } = useProfile();

  const today = todayISO();
  const studyMode = getStudyMode(profile);
  const [showRaioX, setShowRaioX] = useState(false);
  const [showConsistency, setShowConsistency] = useState(false);
  const [chartSubjectFilter, setChartSubjectFilter] = useState('');
  const [selectedDayISO, setSelectedDayISO] = useState<string | null>(null);
  const [agendaItems, setAgendaItems] = useState<
    { id: string; date: string; text: string; done: boolean; kind?: string }[]
  >([]);

  useEffect(() => {
    if (!profile?.id) return;
    try {
      const raw = localStorage.getItem(`sf_agenda_plans_v2_${profile.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const list: { id: string; date: string; text: string; done: boolean; kind?: string }[] = [];
        if (Array.isArray(parsed?.assessments)) {
          parsed.assessments.forEach((a: { id: string; date: string; title: string; subjectName?: string; done?: boolean; kind?: string }) => {
            list.push({
              id: a.id,
              date: a.date,
              text: a.subjectName ? `${a.title} (${a.subjectName})` : a.title,
              done: Boolean(a.done),
              kind: a.kind || 'Prova',
            });
          });
        }
        if (Array.isArray(parsed?.notes)) {
          parsed.notes.forEach((n: { id: string; date: string; text: string; done?: boolean; kind?: string }) => {
            list.push({
              id: n.id,
              date: n.date,
              text: n.text,
              done: Boolean(n.done),
              kind: n.kind || 'Tarefa',
            });
          });
        }
        setAgendaItems(list);
      }
    } catch {
      // ignore
    }
  }, [profile?.id]);

  const upcomingAgendaTasks = agendaItems
    .filter((n) => !n.done && n.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 1. Métricas de HOJE
  const todaySeconds = studyLogs
    .filter((l) => l.study_date === today)
    .reduce((acc, l) => acc + l.duration_seconds, 0);
  const dailyGoalHours = profile?.daily_hours_goal || 4;

  // 2. Métricas NESTA SEMANA (últimos 7 dias)
  const weekStart = addDaysISO(today, -6);
  const weekLogs = studyLogs.filter((l) => l.study_date >= weekStart);
  const weekQuestions = weekLogs.reduce((a, b) => a + b.questions_total, 0);
  const weekCorrect = weekLogs.reduce((a, b) => a + b.questions_correct, 0);
  const weekAccuracy = calcAccuracy(weekCorrect, weekQuestions);

  // 3. Progresso do Edital
  const studiedTopicsCount = topics.filter((t) => t.studied).length;
  const editalProgress = topics.length
    ? Math.round((studiedTopicsCount / topics.length) * 100)
    : 0;

  // 4. Pendências de Hoje
  const overdueReviews = reviews.filter((r) => !r.completed && r.due_date < today);
  const dueReviews = reviews.filter((r) => !r.completed && r.due_date <= today);
  const dueFlashcards = flashcards.filter((c) => c.due_date <= today);

  const daysToExam = profile?.exam_date ? daysBetween(today, profile.exam_date) : null;
  const isNewUser = studyLogs.length === 0 && studiedTopicsCount === 0;

  // Próximo estudo + último ponto de parada
  const activeStudySubject = stopwatch.subjectId
    ? subjects.find((s) => s.id === stopwatch.subjectId)
    : null;
  const nextStudySubject = subjects[0];
  const lastLogForNext = nextStudySubject
    ? studyLogs.find((l) => l.subject_id === nextStudySubject.id)
    : undefined;

  // Tendência dos últimos 7 dias (com filtro opcional por matéria)
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysISO(today, i - 6);
    const dayLogs = studyLogs.filter(
      (l) =>
        l.study_date === iso && (!chartSubjectFilter || l.subject_id === chartSubjectFilter)
    );
    const qTotal = dayLogs.reduce((a, b) => a + b.questions_total, 0);
    const qCorrect = dayLogs.reduce((a, b) => a + b.questions_correct, 0);
    const secs = dayLogs.reduce((a, b) => a + b.duration_seconds, 0);
    return {
      iso,
      day: formatDateBR(iso).slice(0, 5),
      Acertos: qCorrect,
      Erros: Math.max(0, qTotal - qCorrect),
      total: qTotal,
      secs,
    };
  });

  const inspectedDay = selectedDayISO
    ? last7Days.find((d) => d.iso === selectedDayISO)
    : null;

  // Prioridades explicadas ("O que está mais em risco?")
  const targetAcc = profile?.target_accuracy || 80;
  const explainedPriorities = subjects
    .map((s) => {
      const sLogs = studyLogs.filter((l) => l.subject_id === s.id);
      const q = sLogs.reduce((a, b) => a + b.questions_total, 0);
      const c = sLogs.reduce((a, b) => a + b.questions_correct, 0);
      const acc = q > 0 ? calcAccuracy(c, q) : null;
      const errCount = errors.filter((e) => e.subject_id === s.id).length;
      const overdueSubRev = overdueReviews.filter((r) => r.subject_id === s.id).length;

      const reasons: string[] = [];
      let riskScore = 0;

      if (errCount > 0) {
        reasons.push(`${errCount} erro(s) no caderno`);
        riskScore += errCount * 15;
      }
      if (acc !== null && acc < targetAcc) {
        reasons.push(`${acc}% de acerto (abaixo da meta de ${targetAcc}%)`);
        riskScore += targetAcc - acc;
      }
      if (overdueSubRev > 0) {
        reasons.push(`${overdueSubRev} revisão(ões) atrasada(s)`);
        riskScore += overdueSubRev * 20;
      }

      return { subject: s, reasons, riskScore };
    })
    .filter((item) => item.riskScore > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 3);

  // Constância 30 dias (da esquerda para a direita a partir do início dos estudos ou janela de 30 dias)
  const studyDateSet = new Set(studyLogs.map((l) => l.study_date));
  const windowMinISO = addDaysISO(today, -29);
  const recentStudyDates = Array.from(studyDateSet)
    .filter((d) => d >= windowMinISO && d <= today)
    .sort();
  const consistencyStartISO =
    recentStudyDates.length > 0 ? recentStudyDates[0] : today;
  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const iso = addDaysISO(consistencyStartISO, i);
    return { iso, studied: studyDateSet.has(iso), isFuture: iso > today };
  });
  let streakDays = 0;
  let cursorDate = studyDateSet.has(today) ? today : addDaysISO(today, -1);
  while (studyDateSet.has(cursorDate) && streakDays < 365) {
    streakDays++;
    cursorDate = addDaysISO(cursorDate, -1);
  }

  return (
    <div className="space-y-6">
      {/* 1. CONCURSO ATIVO + TEMPO ATÉ A PROVA + RAIO-X RECOLHÍVEL */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {getGreeting()}{userEmail ? `, ${userEmail.split('@')[0].replace(/[0-9._-]+/g, ' ').trim().split(' ')[0].replace(/^./, (c) => c.toUpperCase())}` : ''}
            </h1>
            <p className="text-sm text-muted-theme mt-0.5">
              <strong>{profile?.name}</strong>
              {profile?.role_title ? ` · ${profile.role_title}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-3.5 py-2 rounded-2xl card-surface font-bold">
              {daysToExam !== null
                ? daysToExam >= 0
                  ? `🎯 Prova em ${daysToExam} dias (${formatDateBR(profile?.exam_date)})`
                  : '🎯 Prova realizada'
                : '🎯 Data da prova não definida'}
            </span>
            {studyMode.hasSalaryRaioX && (
              <button
                onClick={() => setShowRaioX((v) => !v)}
                className="px-3.5 py-2 rounded-2xl subtle-surface border border-theme font-bold inline-flex items-center gap-1.5"
              >
                Raio-X do concurso
                {showRaioX ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
            <Link
              href={`/p/${profile?.id}/config`}
              className="p-2 rounded-2xl subtle-surface border border-theme text-muted-theme hover:text-teal-600"
              title="Editar dados do edital e data da prova"
            >
              <Pencil className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Cartão Recolhível Raio-X (sem competir com o estudo de hoje) */}
        {studyMode.hasSalaryRaioX && showRaioX && (
          <div className="card-surface rounded-3xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs animate-fade-in-up">
            <div>
              <p className="text-muted-theme font-semibold">Salário base</p>
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                {profile?.salary_base || 'Não informado'}
              </p>
            </div>
            <div>
              <p className="text-muted-theme font-semibold">Vale-alimentação</p>
              <p className="text-sm font-bold text-teal-700 dark:text-teal-300 mt-0.5">
                {profile?.vale_alimentacao || 'Não informado'}
              </p>
            </div>
            <div>
              <p className="text-muted-theme font-semibold">Jornada</p>
              <p className="text-sm font-bold mt-0.5">{profile?.workload || 'Não informada'}</p>
            </div>
            <div>
              <p className="text-muted-theme font-semibold">Status & Benefícios</p>
              <p className="text-xs font-medium mt-0.5">
                {profile?.status_text || 'Em preparação'}
                {profile?.extras ? ` · ${profile.extras}` : ''}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* PRIMEIRO ACESSO: AÇÃO INICIAL CLARA SEM CARTÕES VAZIOS */}
      {isNewUser && (
        <div className="card-surface rounded-3xl p-6 border-l-4 border-l-teal-600 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-base font-bold flex items-center gap-2 text-teal-700 dark:text-teal-300">
                <Sparkles className="w-4 h-4" />
                Seu espaço está pronto. Vamos organizar seu primeiro estudo?
              </p>
              <p className="text-xs text-muted-theme mt-0.5">
                Você pode adicionar matérias agora ou planejar sua primeira sessão.
              </p>
            </div>
            <Link href={`/p/${profile?.id}/onboarding`} className="text-xs font-semibold text-teal-600 hover:underline shrink-0">
              Assistente guiado →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link
              href={`/p/${profile?.id}/materias`}
              className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold"
            >
              Adicionar matéria
            </Link>
            <Link
              href={`/p/${profile?.id}/agenda`}
              className="px-4 py-2.5 rounded-xl subtle-surface border border-theme hover:opacity-85 text-xs font-semibold"
            >
              Planejar primeira sessão
            </Link>
            {nextStudySubject && (
              <button
                onClick={() => startStopwatch(nextStudySubject.id)}
                className="px-4 py-2.5 rounded-xl subtle-surface border border-theme hover:border-teal-500/50 text-xs font-semibold text-teal-700 dark:text-teal-300"
              >
                Iniciar agora ({nextStudySubject.name})
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. AÇÃO DE ESTUDO PARA AGORA (NO CENTRO, SEM CONCORRÊNCIA) */}
      <div className="rounded-3xl bg-gradient-to-r from-teal-700 to-emerald-700 text-white p-6 shadow-lg">
        {activeStudySubject ? (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="space-y-1.5">
              <span className="inline-block text-xs font-bold px-3 py-1 rounded-full bg-white/20">
                {stopwatch.running ? '⏱️ Estudo em andamento' : '⏸️ Estudo pausado'}
              </span>
              <h2 className="text-2xl font-extrabold">{activeStudySubject.name}</h2>
              <p className="text-sm text-emerald-100 font-mono font-bold">
                Sessão atual: {formatDurationHMS(stopwatch.elapsedSeconds)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                onClick={() =>
                  stopwatch.running
                    ? pauseStopwatch()
                    : startStopwatch(activeStudySubject.id, stopwatch.topicId)
                }
                className="px-6 py-3.5 rounded-2xl bg-white text-teal-900 hover:bg-emerald-50 text-sm font-extrabold inline-flex items-center gap-2 shadow-md"
              >
                {stopwatch.running ? (
                  <>
                    <Pause className="w-4 h-4" />
                    Pausar estudo
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    Retomar estudo
                  </>
                )}
              </button>
              <Link
                href={`/p/${profile?.id}/ciclo`}
                className="px-5 py-3.5 rounded-2xl bg-black/25 hover:bg-black/35 text-white text-sm font-bold"
              >
                Encerrar e salvar
              </Link>
            </div>
          </div>
        ) : (
          nextStudySubject && (
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="space-y-1.5">
                <span className="inline-block text-xs font-bold px-3 py-1 rounded-full bg-white/20">
                  Próximo estudo do ciclo
                </span>
                <h2 className="text-2xl font-extrabold">{nextStudySubject.name}</h2>
                <p className="text-sm text-emerald-100">
                  Meta: {nextStudySubject.cycle_hours}h
                  {String(nextStudySubject.cycle_minutes).padStart(2, '0')}m no ciclo
                  {lastLogForNext?.stop_point
                    ? ` · Último ponto: ${lastLogForNext.stop_point}`
                    : ''}
                </p>
              </div>
              <button
                onClick={() => startStopwatch(nextStudySubject.id)}
                className="px-6 py-3.5 rounded-2xl bg-white text-teal-900 hover:bg-emerald-50 text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-md shrink-0"
              >
                <Play className="w-4 h-4 fill-current" />
                {lastLogForNext ? 'Continuar estudo' : 'Iniciar estudo'}
              </button>
            </div>
          )
        )}
      </div>

      {/* 3. PENDÊNCIAS DE HOJE (REVISÕES ATRASADAS + HOJE + FLASHCARDS) */}
      {dueReviews.length > 0 || dueFlashcards.length > 0 ? (
        <div className="card-surface rounded-3xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="font-bold text-base flex items-center gap-2">
              <Calendar className="w-5 h-5 text-amber-500" />
              Pendências de Hoje
              {overdueReviews.length > 0 && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-600 font-bold">
                  {overdueReviews.length} atrasada(s)
                </span>
              )}
            </h2>
            <div className="flex items-center gap-3 text-xs font-bold">
              {dueFlashcards.length > 0 && (
                <Link
                  href={`/p/${profile?.id}/flashcards`}
                  className="text-teal-700 dark:text-teal-300 hover:underline inline-flex items-center gap-1"
                >
                  <Layers className="w-3.5 h-3.5" />
                  {dueFlashcards.length} flashcard(s) hoje →
                </Link>
              )}
              <Link
                href={`/p/${profile?.id}/revisoes`}
                className="text-muted-theme hover:underline"
              >
                Ver todas
              </Link>
            </div>
          </div>

          {dueReviews.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {dueReviews.slice(0, 4).map((r) => {
                const t = topics.find((tp) => tp.id === r.topic_id);
                const s = subjects.find((sb) => sb.id === r.subject_id);
                const isOverdue = r.due_date < today;
                return (
                  <div
                    key={r.id}
                    className={`rounded-2xl p-3.5 flex items-center justify-between gap-3 border ${
                      isOverdue
                        ? 'bg-rose-500/8 border-rose-500/25'
                        : 'subtle-surface border-transparent'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{t?.title || 'Tópico'}</p>
                      <p className="text-xs text-muted-theme">
                        {s?.name} · Revisão {r.interval_days}d
                        {isOverdue ? ` · Atrasada (${formatDateBR(r.due_date)})` : ' · Para hoje'}
                      </p>
                    </div>
                    <button
                      onClick={() => completeReview(r.id)}
                      className="px-3.5 py-2 rounded-xl card-surface hover:bg-teal-600 hover:text-white text-xs font-bold shrink-0 border border-theme"
                    >
                      Concluir
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="card-surface rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4" />
            Nenhuma revisão ou flashcard pendente hoje — foco livre no seu ciclo!
          </span>
          <Link href={`/p/${profile?.id}/revisoes`} className="font-bold text-muted-theme hover:underline">
            Ver agenda
          </Link>
        </div>
      )}

            {/* TAREFAS, AULAS, TRABALHOS E PROVAS (FACULDADE / ESCOLA) */}
      {studyMode.showAgendaTasksHighlight && (
        <div className="card-surface rounded-3xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-500" />
              {studyMode.id === 'faculdade'
                ? 'Próximas Aulas, Trabalhos & Provas'
                : 'Deveres & Provas da Semana'}
            </h2>
            <Link
              href={`/p/${profile?.id}/agenda`}
              className="text-xs font-bold text-teal-700 dark:text-teal-300 hover:underline"
            >
              Gerenciar na Agenda →
            </Link>
          </div>
          {upcomingAgendaTasks.length === 0 ? (
            <p className="text-xs text-muted-theme">
              Nenhuma aula, trabalho ou prova agendada ainda. Registre entregas e avaliações na aba <strong>Agenda & Notas</strong> para acompanhar tudo aqui.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {upcomingAgendaTasks.slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  className="subtle-surface rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <span className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 mb-1">
                      {item.kind || 'Tarefa'}
                    </span>
                    <p className="font-semibold truncate">{item.text}</p>
                  </div>
                  <span className="font-bold text-muted-theme shrink-0">
                    {formatDateBR(item.date).slice(0, 5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. RESUMO DO PROGRESSO (4 INDICADORES COM PERÍODO E DENOMINADOR) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Link
          href={`/p/${profile?.id}/ciclo`}
          className="card-surface rounded-3xl p-5 hover:border-teal-500/40 block space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-theme">
              Estudo Hoje
            </span>
            <Clock className="w-4 h-4 text-teal-600" />
          </div>
          <p className="text-2xl font-extrabold">{formatDurationHM(todaySeconds)}</p>
          <p className="text-xs text-muted-theme">
            de uma meta diária de <strong>{dailyGoalHours}h</strong>
          </p>
          <div className="h-1.5 w-full rounded-full subtle-surface overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-600 transition-all duration-300"
              style={{ width: `${Math.min(100, Math.round((todaySeconds / (dailyGoalHours * 3600)) * 100))}%` }}
            />
          </div>
        </Link>

        {studyMode.showAgendaTasksHighlight ? (
          <Link
            href={`/p/${profile?.id}/agenda`}
            className="card-surface rounded-3xl p-5 hover:border-teal-500/40 block space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-theme">
                {studyMode.id === 'faculdade' ? 'Provas & Trabalhos' : 'Deveres & Provas'}
              </span>
              <Calendar className="w-4 h-4 text-indigo-500" />
            </div>
            <p className="text-2xl font-extrabold">
              {upcomingAgendaTasks.length}{' '}
              {upcomingAgendaTasks.length === 1 ? 'pendente' : 'pendentes'}
            </p>
            <p className="text-xs text-muted-theme truncate">
              {upcomingAgendaTasks[0]
                ? `Próx: ${upcomingAgendaTasks[0].text} (${formatDateBR(upcomingAgendaTasks[0].date).slice(0, 5)})`
                : 'Adicione aulas, trabalhos e provas na Agenda'}
            </p>
          </Link>
        ) : studyMode.id === 'livre' || studyMode.id === 'outro' ? (
          <Link
            href={`/p/${profile?.id}/evolucao`}
            className="card-surface rounded-3xl p-5 hover:border-teal-500/40 block space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-theme">
                Sessões na Semana
              </span>
              <Target className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-2xl font-extrabold">
              {weekLogs.length} {weekLogs.length === 1 ? 'sessão' : 'sessões'}
            </p>
            <p className="text-xs text-muted-theme">
              nos últimos 7 dias · constância de {streakDays}d
            </p>
          </Link>
        ) : (
          <Link
            href={`/p/${profile?.id}/evolucao`}
            className="card-surface rounded-3xl p-5 hover:border-teal-500/40 block space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-theme">
                Questões na Semana
              </span>
              <Target className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-2xl font-extrabold">
              {weekQuestions > 0 ? `${weekAccuracy}%` : '0 questões'}
            </p>
            <p className="text-xs text-muted-theme">
              {weekQuestions > 0
                ? `${weekCorrect} acertos de ${weekQuestions} nos últimos 7 dias`
                : 'Registre suas baterias no Ciclo'}
            </p>
          </Link>
        )}

        <Link
          href={`/p/${profile?.id}/estudos`}
          className="card-surface rounded-3xl p-5 hover:border-teal-500/40 block space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-theme">
              {studyMode.syllabusShort} Concluído
            </span>
            <CheckCircle2 className="w-4 h-4 text-teal-600" />
          </div>
          <p className="text-2xl font-extrabold">
            {studiedTopicsCount} de {topics.length}
          </p>
          <p className="text-xs text-muted-theme">
            tópicos concluídos ({editalProgress}% do {studyMode.syllabusShort.toLowerCase()})
          </p>
          <div className="h-1.5 w-full rounded-full subtle-surface overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-600 transition-all duration-300"
              style={{ width: `${editalProgress}%` }}
            />
          </div>
        </Link>

        <Link
          href={`/p/${profile?.id}/revisoes`}
          className="card-surface rounded-3xl p-5 hover:border-teal-500/40 block space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-theme">
              Revisões de Hoje
            </span>
            <Layers className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-extrabold">{dueReviews.length} pendentes</p>
          <p className="text-xs text-muted-theme">
            + {dueFlashcards.length} flashcard(s) vencido(s)
          </p>
        </Link>
      </div>

      {/* 5. TENDÊNCIA RECENTE (7 DIAS) + O QUE ESTÁ MAIS EM RISCO */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-surface rounded-3xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-base">Desempenho nos Últimos 7 Dias</h2>
              <div className="flex items-center gap-4 text-xs text-muted-theme mt-1">
                <span className="inline-flex items-center gap-1.5 font-semibold text-teal-700 dark:text-teal-300">
                  <span className="w-2.5 h-2.5 rounded-sm bg-teal-600 inline-block" /> ✓ Acertos
                </span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-rose-600">
                  <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" /> ✕ Erros
                </span>
              </div>
            </div>

            <select
              value={chartSubjectFilter}
              onChange={(e) => setChartSubjectFilter(e.target.value)}
              className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold"
            >
              <option value="">Todas as matérias</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={last7Days}
                onClick={(state) => {
                  const payload = state?.activePayload?.[0]?.payload as
                    | { iso?: string }
                    | undefined;
                  if (payload?.iso) setSelectedDayISO(payload.iso);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.18} />
                <XAxis dataKey="day" fontSize={12} axisLine={false} tickLine={false} />
                <YAxis fontSize={12} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(13, 148, 136, 0.08)' }}
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.94)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '14px',
                    color: '#f8fafc',
                    fontSize: '12px',
                    boxShadow: '0 10px 25px -5px rgba(0,0,0,0.35)',
                    padding: '10px 14px',
                  }}
                  itemStyle={{ color: '#f1f5f9', fontWeight: 600 }}
                  labelStyle={{ color: '#94a3b8', fontWeight: 700, marginBottom: '4px' }}
                />
                <Bar dataKey="Acertos" stackId="a" fill="#0d9488" radius={[0, 0, 6, 6]} />
                <Bar dataKey="Erros" stackId="a" fill="#f43f5e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {inspectedDay && (
            <div className="subtle-surface rounded-2xl px-4 py-2.5 flex items-center justify-between text-xs">
              <span>
                <strong>Dia {formatDateBR(inspectedDay.iso)}:</strong>{' '}
                {inspectedDay.Acertos} acertos de {inspectedDay.total} questões (
                {calcAccuracy(inspectedDay.Acertos, inspectedDay.total)}%) ·{' '}
                {formatDurationHM(inspectedDay.secs)} estudados
              </span>
              <button
                onClick={() => setSelectedDayISO(null)}
                className="font-bold text-muted-theme hover:underline"
              >
                Fechar
              </button>
            </div>
          )}
        </div>

        {/* Prioridades com Motivo Explícito */}
        <div className="card-surface rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Em Risco / Prioridade
            </h2>
            <Link
              href={`/p/${profile?.id}/prioridades`}
              className="text-xs font-bold text-teal-700 dark:text-teal-300 hover:underline"
            >
              Ver ranking
            </Link>
          </div>

          {explainedPriorities.length === 0 ? (
            <p className="text-xs text-muted-theme leading-relaxed py-2">
              Nenhum ponto crítico detectado ainda. Conforme você registrar questões e erros, as matérias que exigem atenção aparecerão aqui com o motivo.
            </p>
          ) : (
            <div className="space-y-3">
              {explainedPriorities.map((item) => (
                <div key={item.subject.id} className="subtle-surface rounded-2xl p-4 space-y-2">
                  <p className="text-sm font-bold">{item.subject.name}</p>
                  <p className="text-xs text-muted-theme leading-relaxed">
                    <strong>Motivo:</strong> {item.reasons.join(' · ')}.
                  </p>
                  <button
                    onClick={() => startStopwatch(item.subject.id)}
                    className="px-3.5 py-2 rounded-xl card-surface hover:bg-teal-600 hover:text-white text-xs font-bold border border-theme inline-flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Revisar matéria agora
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 6. DETALHE SECUNDÁRIO RECOLHÍVEL: CONSTÂNCIA 30 DIAS */}
      <div className="card-surface rounded-3xl p-5">
        <button
          onClick={() => setShowConsistency((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <span className="text-sm font-bold flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500" />
            Constância nos últimos 30 dias:{' '}
            <span className="text-teal-700 dark:text-teal-300">
              {streakDays} {streakDays === 1 ? 'dia seguido' : 'dias seguidos'}
            </span>
          </span>
          <span className="text-xs font-bold text-muted-theme inline-flex items-center gap-1">
            {showConsistency ? 'Recolher' : 'Expandir'}
            {showConsistency ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </span>
        </button>

        {showConsistency && (
          <div className="pt-4 space-y-3 animate-fade-in-up">
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(26px, 1fr))' }}
            >
              {last30Days.map((d) => (
                <div
                  key={d.iso}
                  title={`${formatDateBR(d.iso)} — ${
                    d.studied ? 'Estudado' : d.isFuture ? 'Próximo dia' : 'Sem registro'
                  }`}
                  className={`h-8 rounded-xl flex items-center justify-center border transition-colors ${
                    d.studied
                      ? 'bg-orange-500/15 border-orange-500/40 text-orange-500'
                      : 'subtle-surface border-transparent'
                  }`}
                >
                  {d.studied && <Flame className="w-4 h-4 fill-orange-500 text-orange-500" />}
                </div>
              ))}
            </div>
            <Link
              href={`/p/${profile?.id}/evolucao`}
              className="text-xs font-bold text-teal-700 dark:text-teal-300 hover:underline inline-flex items-center gap-1"
            >
              Ver evolução completa <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
