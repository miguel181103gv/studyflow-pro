'use client';

import Link from 'next/link';
import { useProfile } from '@/components/ProfileProvider';
import {
  calcAccuracy,
  daysBetween,
  formatDurationHM,
  getGreeting,
  todayISO,
  addDaysISO,
} from '@/lib/utils';
import {
  Clock,
  Target,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Flame,
  Play,
  Sparkles,
  ArrowRight,
  Star,
  Layers,
  ListChecks,
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
    profile,
    subjects,
    topics,
    studyLogs,
    reviews,
    errors,
    flashcards,
    startStopwatch,
    completeReview,
  } = useProfile();

  const today = todayISO();

  const totalSecondsAll = studyLogs.reduce((acc, l) => acc + l.duration_seconds, 0);
  const todaySeconds = studyLogs
    .filter((l) => l.study_date === today)
    .reduce((acc, l) => acc + l.duration_seconds, 0);

  const totalQuestions = studyLogs.reduce((acc, l) => acc + l.questions_total, 0);
  const totalCorrect = studyLogs.reduce((acc, l) => acc + l.questions_correct, 0);
  const accuracy = calcAccuracy(totalCorrect, totalQuestions);

  const studiedTopicsCount = topics.filter((t) => t.studied).length;
  const editalProgress = topics.length
    ? Math.round((studiedTopicsCount / topics.length) * 100)
    : 0;

  const dueReviews = reviews.filter((r) => !r.completed && r.due_date <= today);
  const dueFlashcards = flashcards.filter((c) => c.due_date <= today);
  const daysToExam = profile?.exam_date ? daysBetween(today, profile.exam_date) : null;

  // Sequência de dias estudando (Streak)
  const studyDateSet = new Set(studyLogs.map((l) => l.study_date));
  let streakDays = 0;
  let cursorDate = studyDateSet.has(today) ? today : addDaysISO(today, -1);
  while (studyDateSet.has(cursorDate) && streakDays < 365) {
    streakDays++;
    cursorDate = addDaysISO(cursorDate, -1);
  }

  // 7-day chart data
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysISO(today, i - 6);
    const dayLogs = studyLogs.filter((l) => l.study_date === iso);
    const qTotal = dayLogs.reduce((a, b) => a + b.questions_total, 0);
    const qCorrect = dayLogs.reduce((a, b) => a + b.questions_correct, 0);
    const [, m, d] = iso.split('-');
    return {
      day: `${d}/${m}`,
      Acertos: qCorrect,
      Erros: Math.max(0, qTotal - qCorrect),
    };
  });

  // Top 5 revision priorities
  const priorityTopics = topics
    .map((t) => {
      const sub = subjects.find((s) => s.id === t.subject_id);
      const tLogs = studyLogs.filter((l) => l.topic_id === t.id);
      const tQ = tLogs.reduce((a, b) => a + b.questions_total, 0);
      const tC = tLogs.reduce((a, b) => a + b.questions_correct, 0);
      const tAcc = tQ > 0 ? calcAccuracy(tC, tQ) : null;
      const errCount = errors.filter((e) => e.topic_id === t.id).length;
      const score =
        (t.is_priority ? 50 : 0) +
        errCount * 15 +
        (tAcc !== null && tAcc < (profile?.target_accuracy || 80) ? 40 : 0);
      return { topic: t, subject: sub, accuracy: tAcc, errCount, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const todayLogs = studyLogs.filter((l) => l.study_date === today);

  return (
    <div className="space-y-6">
      {/* Hero Greeting + Streak + Raio-X Motivacional */}
      <div className="rounded-3xl bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 text-white p-6 shadow-xl border border-white/10">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-xs font-medium text-blue-200">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                {profile?.status_text || 'Foco total na aprovação'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-400/30 text-xs font-bold text-orange-300">
                <Flame className="w-3.5 h-3.5 text-orange-400" />
                {streakDays === 0
                  ? 'Comece sua sequência hoje'
                  : `${streakDays} ${streakDays === 1 ? 'dia seguido' : 'dias seguidos'}`}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {getGreeting()}, Miguel!
            </h1>
            <p className="text-sm text-slate-300">
              {profile?.icon} <strong>{profile?.name}</strong> — {profile?.role_title}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
            <div className="rounded-2xl bg-white/10 backdrop-blur px-4 py-3 border border-white/10">
              <p className="text-[11px] text-slate-300">Salário Base</p>
              <p className="text-sm font-bold text-emerald-300">
                {profile?.salary_base || '—'}
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 backdrop-blur px-4 py-3 border border-white/10">
              <p className="text-[11px] text-slate-300">Vale / Auxílio</p>
              <p className="text-sm font-bold text-sky-300">
                {profile?.vale_alimentacao || '—'}
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 backdrop-blur px-4 py-3 border border-white/10">
              <p className="text-[11px] text-slate-300">Jornada</p>
              <p className="text-sm font-bold text-white">{profile?.workload || '—'}</p>
            </div>
            <div className="rounded-2xl bg-white/10 backdrop-blur px-4 py-3 border border-white/10">
              <p className="text-[11px] text-slate-300">Contagem Prova</p>
              <p className="text-sm font-bold text-amber-300">
                {daysToExam !== null
                  ? daysToExam >= 0
                    ? `${daysToExam} dias`
                    : 'Realizada'
                  : 'Definir'}
              </p>
            </div>
          </div>
        </div>
        {profile?.extras && (
          <p className="mt-4 pt-3 border-t border-white/10 text-xs text-blue-200/90">
            Benefícios: {profile.extras}
          </p>
        )}
      </div>

      {/* Placar Acumulado em Destaque: Horas Estudadas & Questões Resolvidas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card-surface rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4 border-l-4 border-l-blue-600">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-theme">
              Horas Estudadas (Total)
            </p>
            <p className="text-3xl font-extrabold mt-1 text-blue-600">
              {formatDurationHM(totalSecondsAll)}
            </p>
            <p className="text-xs text-muted-theme mt-1">
              Hoje: <strong>{formatDurationHM(todaySeconds)}</strong> de {profile?.daily_hours_goal || 4}h
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-600/15 text-blue-600 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="card-surface rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4 border-l-4 border-l-emerald-600">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-theme">
              Questões Resolvidas (Total)
            </p>
            <p className="text-3xl font-extrabold mt-1 text-emerald-600">
              {totalQuestions.toLocaleString('pt-BR')}
            </p>
            <p className="text-xs text-muted-theme mt-1">
              {totalCorrect.toLocaleString('pt-BR')} acertos · <strong>{accuracy}%</strong> (Meta: {profile?.target_accuracy || 80}%)
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-600/15 text-emerald-600 flex items-center justify-center shrink-0">
            <ListChecks className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* 4 KPI Cards Secundários */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card-surface rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-theme">Taxa de Acertos</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
              <Target className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold">{accuracy}%</p>
          <p className="text-xs text-muted-theme mt-1">
            Meta do concurso: {profile?.target_accuracy || 80}%
          </p>
        </div>

        <div className="card-surface rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-theme">Edital Concluído</span>
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 text-violet-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold">{editalProgress}%</p>
          <div className="w-full h-1.5 rounded-full subtle-surface mt-2 overflow-hidden">
            <div
              className="h-full bg-violet-600 rounded-full transition-all"
              style={{ width: `${editalProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted-theme mt-1">
            {studiedTopicsCount} de {topics.length} tópicos
          </p>
        </div>

        <Link
          href={`/p/${profile?.id}/revisoes`}
          className="card-surface rounded-2xl p-5 shadow-sm hover:opacity-90 transition block"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-theme">Revisões Pendentes</span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold">{dueReviews.length}</p>
          <p className="text-xs text-muted-theme mt-1">
            {errors.length} erros no caderno
          </p>
        </Link>

        <Link
          href={`/p/${profile?.id}/flashcards`}
          className="card-surface rounded-2xl p-5 shadow-sm hover:opacity-90 transition block"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-theme">Flashcards Hoje</span>
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 text-sky-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold">{dueFlashcards.length}</p>
          <p className="text-xs text-muted-theme mt-1">
            {flashcards.length} cards no total
          </p>
        </Link>
      </div>

      {/* Main Grid: Chart + Cycle + Reviews + Priorities */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card-surface rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-base">Questões nos Últimos 7 Dias</h2>
                <p className="text-xs text-muted-theme">Acertos vs. Erros diários</p>
              </div>
              <Link
                href={`/p/${profile?.id}/evolucao`}
                className="text-xs font-medium text-blue-600 hover:underline inline-flex items-center gap-1"
              >
                Ver evolução completa <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={last7Days}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="day" fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="Acertos" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="Erros" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card-surface rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-base">Próximas Matérias do Ciclo</h2>
                <p className="text-xs text-muted-theme">
                  Dê play para iniciar e registre suas questões no Ciclo de Estudos
                </p>
              </div>
              <Link
                href={`/p/${profile?.id}/ciclo`}
                className="text-xs font-medium text-blue-600 hover:underline inline-flex items-center gap-1"
              >
                Abrir Ciclo <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {subjects.slice(0, 4).map((s, idx) => (
                <div
                  key={s.id}
                  className="subtle-surface rounded-2xl p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="w-7 h-7 rounded-xl text-white text-xs font-bold flex items-center justify-center shrink-0"
                      style={{ backgroundColor: s.color }}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{s.name}</p>
                      <p className="text-[11px] text-muted-theme">
                        Meta: {s.cycle_hours}h{String(s.cycle_minutes).padStart(2, '0')}m
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => startStopwatch(s.id)}
                    className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition shrink-0"
                    title="Iniciar cronômetro"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col */}
        <div className="space-y-6">
          <div className="card-surface rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-base flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-500" />
                Revisões de Hoje
              </h2>
              <Link
                href={`/p/${profile?.id}/revisoes`}
                className="text-xs text-blue-600 hover:underline"
              >
                Ver todas
              </Link>
            </div>
            {dueReviews.length === 0 ? (
              <p className="text-xs text-muted-theme py-3">
                Nenhuma revisão atrasada ou para hoje. Excelente ritmo!
              </p>
            ) : (
              <div className="space-y-2">
                {dueReviews.slice(0, 4).map((r) => {
                  const t = topics.find((tp) => tp.id === r.topic_id);
                  const s = subjects.find((sb) => sb.id === r.subject_id);
                  return (
                    <div
                      key={r.id}
                      className="subtle-surface rounded-xl p-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{t?.title || 'Tópico'}</p>
                        <p className="text-[11px] text-muted-theme">
                          {s?.name} • {r.interval_days}d
                        </p>
                      </div>
                      <button
                        onClick={() => completeReview(r.id)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-medium shrink-0"
                      >
                        Concluir
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card-surface rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-base flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-500" />
                Top 5 Prioridades
              </h2>
              <Link
                href={`/p/${profile?.id}/prioridades`}
                className="text-xs text-blue-600 hover:underline"
              >
                Ranking
              </Link>
            </div>
            {priorityTopics.length === 0 ? (
              <p className="text-xs text-muted-theme">
                Marque estrelas (★) nos tópicos mais importantes ou registre questões no Ciclo para ver o ranking.
              </p>
            ) : (
              <div className="space-y-2">
                {priorityTopics.map((item) => (
                  <div key={item.topic.id} className="subtle-surface rounded-xl p-2.5">
                    <p className="text-xs font-semibold truncate">{item.topic.title}</p>
                    <p className="text-[11px] text-muted-theme">
                      {item.subject?.name}
                      {item.accuracy !== null ? ` • ${item.accuracy}% acerto` : ''}
                      {item.errCount > 0 ? ` • ${item.errCount} erros` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {todayLogs.length > 0 && (
            <div className="card-surface rounded-2xl p-5 shadow-sm">
              <h2 className="font-bold text-base mb-3">Estudado Hoje</h2>
              <div className="space-y-2">
                {todayLogs.slice(0, 4).map((l) => {
                  const s = subjects.find((sb) => sb.id === l.subject_id);
                  return (
                    <div
                      key={l.id}
                      className="text-xs flex justify-between items-center py-1 border-b border-theme last:border-0"
                    >
                      <span className="font-medium truncate">{s?.name}</span>
                      <span className="text-muted-theme shrink-0">
                        {formatDurationHM(l.duration_seconds)}
                        {l.questions_total > 0 ? ` · ${l.questions_correct}/${l.questions_total}q` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
