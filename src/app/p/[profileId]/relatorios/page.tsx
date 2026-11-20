'use client';

import { useMemo, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { addDaysISO, calcAccuracy, formatDateBR, formatDurationHM, todayISO } from '@/lib/utils';
import { Sparkles, Loader2, FileBarChart2, AlertTriangle } from 'lucide-react';

export default function RelatoriosPage() {
  const { profile, subjects, topics, studyLogs, reviews, errors, simulados, reports, addAIReport } =
    useProfile();

  const today = todayISO();
  const [periodPreset, setPeriodPreset] = useState<'7' | '30' | '90' | 'all' | 'custom'>('30');
  const [startDate, setStartDate] = useState(addDaysISO(today, -30));
  const [endDate, setEndDate] = useState(today);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [questionOrigin, setQuestionOrigin] = useState<'all' | 'estudo' | 'revisao' | 'simulado'>(
    'all'
  );

  // Mentor Gemini AI
  const [periodType, setPeriodType] = useState<'Semanal' | 'Mensal' | 'Anual'>('Semanal');
  const [generating, setGenerating] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  function applyPreset(p: '7' | '30' | '90' | 'all') {
    setPeriodPreset(p);
    setEndDate(today);
    setStartDate(p === 'all' ? '2020-01-01' : addDaysISO(today, -Number(p)));
  }

  // Filtragem consistente do período e matéria
  const periodLogs = useMemo(
    () =>
      studyLogs.filter(
        (l) =>
          l.study_date >= startDate &&
          l.study_date <= endDate &&
          (!subjectFilter || l.subject_id === subjectFilter)
      ),
    [studyLogs, startDate, endDate, subjectFilter]
  );

  const periodSimulados = useMemo(
    () => simulados.filter((s) => s.exam_date >= startDate && s.exam_date <= endDate),
    [simulados, startDate, endDate]
  );

  const periodReviews = useMemo(
    () => reviews.filter((r) => !subjectFilter || r.subject_id === subjectFilter),
    [reviews, subjectFilter]
  );

  const periodErrors = useMemo(
    () => errors.filter((e) => !subjectFilter || e.subject_id === subjectFilter),
    [errors, subjectFilter]
  );

  // 1. Consistência e Carga de Estudo
  const totalSeconds = periodLogs.reduce((a, b) => a + b.duration_seconds, 0);
  const sessionsCount = periodLogs.length;
  const activeDays = new Set(periodLogs.map((l) => l.study_date)).size;
  const rangeDaysCount = Math.max(
    1,
    Math.min(
      365,
      Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
      ) + 1
    )
  );
  const plannedHours = Math.round(((rangeDaysCount * 5) / 7) * (profile?.daily_hours_goal || 4));
  const realizedHours = Number((totalSeconds / 3600).toFixed(1));

  // 2. Desempenho em Questões separado por origem
  const studyOriginLogs = periodLogs.filter(
    (l) => !l.method.toLowerCase().includes('revis')
  );
  const reviewOriginLogs = periodLogs.filter((l) =>
    l.method.toLowerCase().includes('revis')
  );

  const qStudyTotal = studyOriginLogs.reduce((a, b) => a + b.questions_total, 0);
  const qStudyCorrect = studyOriginLogs.reduce((a, b) => a + b.questions_correct, 0);
  const qRevTotal = reviewOriginLogs.reduce((a, b) => a + b.questions_total, 0);
  const qRevCorrect = reviewOriginLogs.reduce((a, b) => a + b.questions_correct, 0);
  const qSimTotal = periodSimulados.reduce((a, b) => a + b.total_questions, 0);
  const qSimCorrect = periodSimulados.reduce((a, b) => a + b.correct_answers, 0);

  const displayedQ =
    questionOrigin === 'estudo'
      ? { total: qStudyTotal, correct: qStudyCorrect }
      : questionOrigin === 'revisao'
      ? { total: qRevTotal, correct: qRevCorrect }
      : questionOrigin === 'simulado'
      ? { total: qSimTotal, correct: qSimCorrect }
      : {
          total: qStudyTotal + qRevTotal + qSimTotal,
          correct: qStudyCorrect + qRevCorrect + qSimCorrect,
        };

  // 3. Progresso (Cobertura) vs Domínio (Revisados + Acertos)
  const relevantTopics = topics.filter(
    (t) => !subjectFilter || t.subject_id === subjectFilter
  );
  const reviewedTopicIds = new Set(
    periodReviews.filter((r) => r.completed).map((r) => r.topic_id)
  );
  const notStartedTopics = relevantTopics.filter((t) => !t.studied).length;
  const studiedOnlyTopics = relevantTopics.filter(
    (t) => t.studied && !reviewedTopicIds.has(t.id)
  ).length;
  const reviewedTopics = relevantTopics.filter(
    (t) => t.studied && reviewedTopicIds.has(t.id)
  ).length;

  // 4. Revisões
  const revPending = periodReviews.filter((r) => !r.completed && r.due_date >= today).length;
  const revOverdue = periodReviews.filter((r) => !r.completed && r.due_date < today).length;
  const revDone = periodReviews.filter((r) => r.completed).length;

  // 5. Causas de erro e prioridades explicadas
  const causeCounts: Record<string, number> = {};
  periodErrors.forEach((e) => {
    causeCounts[e.error_cause] = (causeCounts[e.error_cause] || 0) + 1;
  });
  const topCauses = Object.entries(causeCounts).sort((a, b) => b[1] - a[1]);

  const targetAcc = profile?.target_accuracy || 80;
  const subjectBreakdown = subjects
    .filter((s) => !subjectFilter || s.id === subjectFilter)
    .map((s) => {
      const sLogs = periodLogs.filter((l) => l.subject_id === s.id);
      const q = sLogs.reduce((a, b) => a + b.questions_total, 0);
      const c = sLogs.reduce((a, b) => a + b.questions_correct, 0);
      const sTopics = topics.filter((t) => t.subject_id === s.id);
      const sStudied = sTopics.filter((t) => t.studied).length;
      const sErr = periodErrors.filter((e) => e.subject_id === s.id).length;
      return {
        subject: s,
        q,
        c,
        acc: calcAccuracy(c, q),
        coveragePct: sTopics.length ? Math.round((sStudied / sTopics.length) * 100) : 0,
        sStudied,
        sTotal: sTopics.length,
        sErr,
      };
    });

  async function handleGenerateReport() {
    if (!profile) return;
    setGenerating(true);
    setErrMsg(null);
    try {
      const metricsSummary = {
        concurso: profile.name,
        periodo: `${formatDateBR(startDate)} a ${formatDateBR(endDate)}`,
        horas_liquidas: realizedHours,
        horas_planejadas: plannedHours,
        sessoes: sessionsCount,
        dias_ativos: activeDays,
        questoes_total: displayedQ.total,
        questoes_acertos: displayedQ.correct,
        taxa_acertos_pct: calcAccuracy(displayedQ.correct, displayedQ.total),
        revisoes_atrasadas: revOverdue,
        revisoes_concluidas: revDone,
        erros_total: periodErrors.length,
        simulados_total: periodSimulados.length,
      };

      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'report',
          profileName: profile.name,
          periodType,
          metricsSummary,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao gerar relatório.');

      await addAIReport({
        period_type: periodType,
        period_label: `${periodType} · ${formatDateBR(today)}`,
        content_markdown: json.data.markdown,
        metrics_snapshot: metricsSummary,
      });
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Erro ao gerar relatório.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho com concurso, período e quantidade de dados usada */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Relatórios & Mentor Gemini AI
            </h1>
            <p className="text-xs sm:text-sm text-muted-theme mt-1">
              <strong>{profile?.name}</strong> · Período: {formatDateBR(startDate)} a{' '}
              {formatDateBR(endDate)} · Base: {sessionsCount} sessões, {displayedQ.total} questões,{' '}
              {periodSimulados.length} simulados.
            </p>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(['7', '30', '90', 'all'] as const).map((p) => (
              <button
                key={p}
                onClick={() => applyPreset(p)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                  periodPreset === p ? 'bg-teal-600 text-white' : 'card-surface'
                }`}
              >
                {p === 'all' ? 'Tudo' : `${p}d`}
              </button>
            ))}
          </div>
        </div>

        <div className="card-surface rounded-2xl p-3.5 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-theme font-bold">De:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPeriodPreset('custom');
              }}
              className="rounded-xl subtle-surface border border-theme px-2.5 py-1.5"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-theme font-bold">Até:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPeriodPreset('custom');
              }}
              className="rounded-xl subtle-surface border border-theme px-2.5 py-1.5"
            />
          </div>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="rounded-xl subtle-surface border border-theme px-3 py-1.5 sm:ml-auto font-semibold"
          >
            <option value="">Todas as matérias</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 1. Consistência e Carga + 2. Desempenho em Questões */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-surface rounded-3xl p-6 space-y-4">
          <h2 className="font-bold text-base">1. Consistência e Carga de Estudo</h2>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="subtle-surface rounded-2xl p-3.5">
              <p className="text-muted-theme">Horas líquidas</p>
              <p className="text-xl font-extrabold mt-0.5">{formatDurationHM(totalSeconds)}</p>
              <p className="text-muted-theme mt-0.5">Meta estimada: {plannedHours}h</p>
            </div>
            <div className="subtle-surface rounded-2xl p-3.5">
              <p className="text-muted-theme">Sessões & Dias ativos</p>
              <p className="text-xl font-extrabold mt-0.5">{activeDays} dias</p>
              <p className="text-muted-theme mt-0.5">{sessionsCount} sessões registradas</p>
            </div>
          </div>
        </div>

        <div className="card-surface rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-bold text-base">2. Desempenho em Questões</h2>
            <div className="flex gap-1 text-[11px] font-bold">
              {(
                [
                  { id: 'all', label: 'Todas' },
                  { id: 'estudo', label: 'Estudo' },
                  { id: 'revisao', label: 'Revisão' },
                  { id: 'simulado', label: 'Simulado' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setQuestionOrigin(tab.id)}
                  className={`px-2.5 py-1 rounded-lg ${
                    questionOrigin === tab.id ? 'bg-teal-600 text-white' : 'subtle-surface'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="subtle-surface rounded-2xl p-4 flex items-baseline justify-between gap-3">
            <div>
              <p className="text-2xl font-extrabold text-teal-600">
                {calcAccuracy(displayedQ.correct, displayedQ.total)}%
              </p>
              <p className="text-xs text-muted-theme mt-0.5">
                <strong>{displayedQ.correct}</strong> acertos de{' '}
                <strong>{displayedQ.total}</strong> questões
              </p>
            </div>
            <p className="text-xs text-muted-theme">Meta: {targetAcc}%</p>
          </div>
        </div>
      </div>

      {/* 3. Cobertura vs Domínio + 4. Revisões & Simulados */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-surface rounded-3xl p-6 space-y-4">
          <div>
            <h2 className="font-bold text-base">3. Cobertura vs. Domínio do Edital</h2>
            <p className="text-xs text-muted-theme">
              Marcar como estudado mostra cobertura; domínio exige revisões concluídas e acerto alto.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
            <div className="subtle-surface rounded-2xl p-3">
              <p className="text-lg font-extrabold">{notStartedTopics}</p>
              <p className="text-muted-theme">Não iniciados</p>
            </div>
            <div className="rounded-2xl p-3 bg-blue-500/10 text-blue-800 dark:text-blue-200">
              <p className="text-lg font-extrabold">{studiedOnlyTopics}</p>
              <p>Estudados</p>
            </div>
            <div className="rounded-2xl p-3 bg-emerald-500/12 text-emerald-800 dark:text-emerald-200">
              <p className="text-lg font-extrabold">{reviewedTopics}</p>
              <p>Revisados</p>
            </div>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1 text-xs">
            {subjectBreakdown.map((row) => (
              <div
                key={row.subject.id}
                className="subtle-surface rounded-xl px-3 py-2 flex items-center justify-between gap-2"
              >
                <span className="font-semibold truncate">{row.subject.name}</span>
                <span className="shrink-0 text-muted-theme">
                  Edital: <strong>{row.sStudied}/{row.sTotal}</strong> · Questões:{' '}
                  <strong>{row.q > 0 ? `${row.c}/${row.q} (${row.acc}%)` : '—'}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card-surface rounded-3xl p-6 space-y-4">
          <h2 className="font-bold text-base">4. Revisões, Simulados & Causas de Erro</h2>
          <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
            <div className="rounded-2xl p-3 bg-rose-500/10 text-rose-700 dark:text-rose-300">
              <p className="text-lg font-extrabold">{revOverdue}</p>
              <p>Atrasadas</p>
            </div>
            <div className="subtle-surface rounded-2xl p-3">
              <p className="text-lg font-extrabold">{revPending}</p>
              <p className="text-muted-theme">Programadas</p>
            </div>
            <div className="rounded-2xl p-3 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              <p className="text-lg font-extrabold">{revDone}</p>
              <p>Concluídas</p>
            </div>
          </div>

          <div className="subtle-surface rounded-2xl p-3.5 text-xs space-y-1">
            <p className="font-bold">Simulados no período: {periodSimulados.length}</p>
            {periodSimulados.length > 0 ? (
              <p className="text-muted-theme">
                Desempenho em simulados: <strong>{qSimCorrect}</strong> de{' '}
                <strong>{qSimTotal}</strong> questões ({calcAccuracy(qSimCorrect, qSimTotal)}%).
              </p>
            ) : (
              <p className="text-muted-theme">Nenhum simulado registrado neste período.</p>
            )}
          </div>

          {topCauses.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                Principais causas de erro ({periodErrors.length} erros)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {topCauses.map(([cause, count]) => (
                  <span
                    key={cause}
                    className="text-xs px-2.5 py-1 rounded-full bg-rose-500/12 text-rose-700 dark:text-rose-300 font-semibold"
                  >
                    {cause}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mentor Gemini AI */}
      <div className="card-surface rounded-3xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-base flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-teal-600" />
              Diagnóstico do Mentor Gemini AI
            </h2>
            <p className="text-xs text-muted-theme">
              Gera uma análise textual e plano de ação com base nos números reais acima.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as typeof periodType)}
              className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-bold"
            >
              <option value="Semanal">Semanal</option>
              <option value="Mensal">Mensal</option>
              <option value="Anual">Anual</option>
            </select>
            <button
              onClick={handleGenerateReport}
              disabled={generating}
              className="px-4 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {generating ? 'Analisando...' : 'Gerar Diagnóstico IA'}
            </button>
          </div>
        </div>

        {errMsg && (
          <div className="p-3 rounded-2xl bg-rose-500/15 text-rose-600 text-xs">{errMsg}</div>
        )}

        {reports.length === 0 ? (
          <div className="subtle-surface rounded-2xl p-6 text-center space-y-1">
            <FileBarChart2 className="w-8 h-8 mx-auto text-teal-600 opacity-70" />
            <p className="font-bold text-xs">Nenhum diagnóstico IA salvo ainda</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((rep) => (
              <div key={rep.id} className="subtle-surface rounded-2xl p-5 space-y-2">
                <div className="flex items-center justify-between border-b border-theme pb-2 text-xs font-bold">
                  <span>Relatório {rep.period_label}</span>
                  <span className="text-muted-theme">
                    {new Date(rep.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {rep.content_markdown}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
