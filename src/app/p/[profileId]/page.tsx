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
  Flame,
  Play,
  ArrowRight,
  Layers,
  Calendar,
  TrendingUp,
  TrendingDown,
  Award,
  Check,
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
    flashcards,
    startStopwatch,
    completeReview,
  } = useProfile();

  const today = todayISO();
  const currentMonthPrefix = today.slice(0, 7); // YYYY-MM

  // Calcula mês anterior (YYYY-MM)
  const [curY, curM] = currentMonthPrefix.split('-').map(Number);
  const prevDt = new Date(curY, curM - 2, 1);
  const prevMonthPrefix = `${prevDt.getFullYear()}-${String(prevDt.getMonth() + 1).padStart(
    2,
    '0'
  )}`;

  // Totais gerais
  const totalSecondsAll = studyLogs.reduce((acc, l) => acc + l.duration_seconds, 0);
  const totalQuestions = studyLogs.reduce((acc, l) => acc + l.questions_total, 0);
  const totalCorrect = studyLogs.reduce((acc, l) => acc + l.questions_correct, 0);
  const accuracy = calcAccuracy(totalCorrect, totalQuestions);

  // Comparativo Mês Atual vs Mês Passado
  const thisMonthLogs = studyLogs.filter((l) => l.study_date.startsWith(currentMonthPrefix));
  const prevMonthLogs = studyLogs.filter((l) => l.study_date.startsWith(prevMonthPrefix));

  const thisMonthSecs = thisMonthLogs.reduce((a, b) => a + b.duration_seconds, 0);
  const prevMonthSecs = prevMonthLogs.reduce((a, b) => a + b.duration_seconds, 0);
  const hoursDeltaPct =
    prevMonthSecs > 0
      ? Math.round(((thisMonthSecs - prevMonthSecs) / prevMonthSecs) * 100)
      : thisMonthSecs > 0
      ? 100
      : 0;

  const thisMonthQ = thisMonthLogs.reduce((a, b) => a + b.questions_total, 0);
  const thisMonthC = thisMonthLogs.reduce((a, b) => a + b.questions_correct, 0);
  const thisMonthAcc = calcAccuracy(thisMonthC, thisMonthQ);

  const prevMonthQ = prevMonthLogs.reduce((a, b) => a + b.questions_total, 0);
  const prevMonthC = prevMonthLogs.reduce((a, b) => a + b.questions_correct, 0);
  const prevMonthAcc = calcAccuracy(prevMonthC, prevMonthQ);
  const accDeltaPP = prevMonthQ > 0 ? thisMonthAcc - prevMonthAcc : 0;

  // Tópicos concluídos no mês
  const studiedTopicsCount = topics.filter((t) => t.studied).length;
  const editalProgress = topics.length
    ? Math.round((studiedTopicsCount / topics.length) * 100)
    : 0;
  const topicsThisMonth = topics.filter(
    (t) => t.studied && t.studied_at && t.studied_at.startsWith(currentMonthPrefix)
  ).length;

  // Metas semanais (últimos 7 dias)
  const weekStart = addDaysISO(today, -6);
  const weekLogs = studyLogs.filter((l) => l.study_date >= weekStart);
  const weekSecs = weekLogs.reduce((a, b) => a + b.duration_seconds, 0);
  const weekGoalSecs = (profile?.daily_hours_goal || 4) * 5 * 3600;
  const weekHoursPct = weekGoalSecs > 0 ? Math.min(100, Math.round((weekSecs / weekGoalSecs) * 100)) : 0;
  const weekQuestions = weekLogs.reduce((a, b) => a + b.questions_total, 0);

  // Constância nos últimos 30 dias (faixa visual estilo Estudei)
  const studyDateSet = new Set(studyLogs.map((l) => l.study_date));
  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const iso = addDaysISO(today, i - 29);
    return { iso, studied: studyDateSet.has(iso) };
  });

  let streakDays = 0;
  let cursorDate = studyDateSet.has(today) ? today : addDaysISO(today, -1);
  while (studyDateSet.has(cursorDate) && streakDays < 365) {
    streakDays++;
    cursorDate = addDaysISO(cursorDate, -1);
  }

  const dueReviews = reviews.filter((r) => !r.completed && r.due_date <= today);
  const dueFlashcards = flashcards.filter((c) => c.due_date <= today);
  const daysToExam = profile?.exam_date ? daysBetween(today, profile.exam_date) : null;

  // 7-day chart
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

  const nextSubject = subjects[0];

  return (
    <div className="space-y-6">
      {/* Cabeçalho leve estilo SaaS */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {getGreeting()}, Miguel
          </h1>
          <p className="text-sm text-muted-theme mt-0.5">
            Pronto para mais um dia focado em <strong>{profile?.name}</strong>?
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {profile?.salary_base && (
            <span className="px-3 py-1.5 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-semibold">
              💰 {profile.salary_base}
              {profile.vale_alimentacao ? ` + ${profile.vale_alimentacao}` : ''}
            </span>
          )}
          {daysToExam !== null && (
            <span className="px-3 py-1.5 rounded-full bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 font-semibold">
              🎯 {daysToExam >= 0 ? `Faltam ${daysToExam} dias para a prova` : 'Prova realizada'}
            </span>
          )}
        </div>
      </div>

      {/* 4 KPI Cards com Comparativo vs Mês Passado (estilo Estudei) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Tempo de Estudo */}
        <div className="card-surface rounded-3xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-theme">
              Tempo de Estudo
            </span>
            <div className="w-8 h-8 rounded-xl bg-teal-500/12 text-teal-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-extrabold tracking-tight">
            {formatDurationHM(totalSecondsAll)}
          </p>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-theme">
              Neste mês: <strong>{formatDurationHM(thisMonthSecs)}</strong>
            </span>
            <span
              className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                hoursDeltaPct >= 0
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-500/15 text-rose-600'
              }`}
            >
              {hoursDeltaPct >= 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {hoursDeltaPct >= 0 ? `+${hoursDeltaPct}%` : `${hoursDeltaPct}%`}
            </span>
          </div>
        </div>

        {/* Desempenho & Questões */}
        <div className="card-surface rounded-3xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-theme">
              Desempenho
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/12 text-emerald-600 flex items-center justify-center">
              <Target className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-extrabold tracking-tight">{accuracy}%</p>
            <span className="text-xs text-muted-theme">
              ({totalQuestions.toLocaleString('pt-BR')} questões)
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-theme">
              Neste mês: <strong>{thisMonthAcc}%</strong> ({thisMonthQ}q)
            </span>
            {prevMonthQ > 0 && (
              <span
                className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                  accDeltaPP >= 0
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-500/15 text-rose-600'
                }`}
              >
                {accDeltaPP >= 0 ? `+${accDeltaPP}` : accDeltaPP} p.p.
              </span>
            )}
          </div>
        </div>

        {/* Progresso no Edital */}
        <div className="card-surface rounded-3xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-theme">
              Progresso no Edital
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-500/12 text-indigo-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-extrabold tracking-tight">{editalProgress}%</p>
            <span className="text-xs text-muted-theme">
              ({studiedTopicsCount} de {topics.length} tópicos)
            </span>
          </div>
          <p className="text-xs text-muted-theme">
            Neste mês: <strong>{topicsThisMonth}</strong> tópico(s) concluído(s)
          </p>
        </div>

        {/* Revisões & Flashcards */}
        <div className="card-surface rounded-3xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-theme">
              Pendências de Hoje
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/12 text-amber-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-4">
            <Link href={`/p/${profile?.id}/revisoes`} className="hover:opacity-80">
              <p className="text-2xl font-extrabold">{dueReviews.length}</p>
              <p className="text-[11px] text-muted-theme">Revisões</p>
            </Link>
            <div className="w-px h-8 bg-slate-200 dark:bg-slate-700" />
            <Link href={`/p/${profile?.id}/flashcards`} className="hover:opacity-80">
              <p className="text-2xl font-extrabold text-indigo-600">{dueFlashcards.length}</p>
              <p className="text-[11px] text-muted-theme">Flashcards</p>
            </Link>
          </div>
          <p className="text-xs text-muted-theme">Clique para revisar agora</p>
        </div>
      </div>

      {/* Constância nos Estudos (30 dias visuais estilo Estudei) */}
      <div className="card-surface rounded-3xl p-5 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-theme">
              Constância nos Estudos (Últimos 30 dias)
            </p>
            <p className="text-sm font-bold flex items-center gap-1.5 mt-1">
              <Flame className="w-4 h-4 text-orange-500" />
              {streakDays === 0
                ? 'Estude hoje para iniciar sua corrente!'
                : `${streakDays} ${streakDays === 1 ? 'dia seguido' : 'dias seguidos'} mantendo o ritmo.`}
            </p>
          </div>
          <Link
            href={`/p/${profile?.id}/evolucao`}
            className="text-xs font-semibold text-teal-600 hover:underline inline-flex items-center gap-1"
          >
            Ver detalhes <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-10 sm:grid-cols-15 gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(24px, 1fr))" }}>
          {last30Days.map((d) => (
            <div
              key={d.iso}
              title={`${d.iso.split('-').reverse().join('/')} — ${
                d.studied ? 'Estudado' : 'Sem registro'
              }`}
              className={`h-8 rounded-xl flex items-center justify-center border transition ${
                d.studied
                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-600'
                  : 'subtle-surface border-transparent text-muted-theme/30'
              }`}
            >
              {d.studied ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
            </div>
          ))}
        </div>
      </div>

      {/* Grid Inferior: Próximo Estudo + Metas Semanais + Gráfico 7 dias */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Card Destaque: Próximo do Dia (estilo Estudei) */}
          {nextSubject && (
            <div className="card-surface rounded-3xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-theme">
                  Planejamento do Dia
                </p>
                <Link
                  href={`/p/${profile?.id}/agenda`}
                  className="text-xs font-semibold text-teal-600 hover:underline"
                >
                  Ver agenda completa →
                </Link>
              </div>

              <div className="rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-700 text-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-md">
                <div className="space-y-1">
                  <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-black/20">
                    Próxima do Ciclo
                  </span>
                  <h2 className="text-lg font-bold">{nextSubject.name}</h2>
                  <p className="text-xs text-emerald-100">
                    Meta no ciclo: {nextSubject.cycle_hours}h
                    {String(nextSubject.cycle_minutes).padStart(2, '0')}m
                  </p>
                </div>
                <button
                  onClick={() => startStopwatch(nextSubject.id)}
                  className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-lg transition shrink-0"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Iniciar Estudo
                </button>
              </div>
            </div>
          )}

          {/* Gráfico 7 dias */}
          <div className="card-surface rounded-3xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-base">Questões nos Últimos 7 Dias</h2>
                <p className="text-xs text-muted-theme">Acertos vs. Erros diários</p>
              </div>
              <Link
                href={`/p/${profile?.id}/evolucao`}
                className="text-xs font-semibold text-teal-600 hover:underline inline-flex items-center gap-1"
              >
                Evolução <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={last7Days}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="day" fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="Acertos" stackId="a" fill="#10b981" radius={[0, 0, 6, 6]} />
                  <Bar dataKey="Erros" stackId="a" fill="#f43f5e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Coluna Direita: Metas Semanais + Revisões */}
        <div className="space-y-6">
          <div className="card-surface rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-theme flex items-center gap-1.5">
                <Award className="w-4 h-4 text-indigo-500" />
                Metas Semanais
              </h2>
              <Link
                href={`/p/${profile?.id}/config`}
                className="text-xs font-semibold text-muted-theme hover:underline"
              >
                Ajustar
              </Link>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold">Horas de Estudo</span>
                  <span className="font-bold text-indigo-600">{weekHoursPct}%</span>
                </div>
                <p className="text-[11px] text-muted-theme">
                  {formatDurationHM(weekSecs)} / {(profile?.daily_hours_goal || 4) * 5}h planejadas
                </p>
                <div className="w-full h-2 rounded-full subtle-surface overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full transition-all"
                    style={{ width: `${weekHoursPct}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-theme">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold">Questões na Semana</span>
                  <span className="font-bold text-emerald-600">{weekQuestions}</span>
                </div>
                <p className="text-[11px] text-muted-theme">
                  Total acumulado: {totalQuestions.toLocaleString('pt-BR')} questões
                </p>
              </div>
            </div>
          </div>

          <div className="card-surface rounded-3xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-sm flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-500" />
                Revisões de Hoje
              </h2>
              <Link
                href={`/p/${profile?.id}/revisoes`}
                className="text-xs font-semibold text-teal-600 hover:underline"
              >
                Ver todas
              </Link>
            </div>
            {dueReviews.length === 0 ? (
              <p className="text-xs text-muted-theme py-3">
                Nenhuma revisão pendente hoje. Excelente ritmo!
              </p>
            ) : (
              <div className="space-y-2">
                {dueReviews.slice(0, 4).map((r) => {
                  const t = topics.find((tp) => tp.id === r.topic_id);
                  const s = subjects.find((sb) => sb.id === r.subject_id);
                  return (
                    <div
                      key={r.id}
                      className="subtle-surface rounded-2xl p-3 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{t?.title || 'Tópico'}</p>
                        <p className="text-[11px] text-muted-theme">
                          {s?.name} · {r.interval_days}d
                        </p>
                      </div>
                      <button
                        onClick={() => completeReview(r.id)}
                        className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shrink-0"
                      >
                        Revisar
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
