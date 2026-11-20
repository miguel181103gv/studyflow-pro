'use client';

import { useMemo, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { addDaysISO, calcAccuracy, formatDateBR, formatDurationHM, todayISO } from '@/lib/utils';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

function SemiGauge({
  label,
  pct,
  color,
  subtitle,
}: {
  label: string;
  pct: number;
  color: string;
  subtitle: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = 34;
  const circ = Math.PI * r;
  const offset = circ - (clamped / 100) * circ;

  return (
    <div className="flex flex-col items-center text-center p-2">
      <svg width="88" height="52" viewBox="0 0 88 52" className="overflow-visible">
        <path
          d="M 10 46 A 34 34 0 0 1 78 46"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.12"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d="M 10 46 A 34 34 0 0 1 78 46"
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <p className="text-lg font-extrabold -mt-3">{clamped}%</p>
      <p className="text-xs font-semibold truncate max-w-[110px] mt-0.5" title={label}>
        {label}
      </p>
      <p className="text-[10px] text-muted-theme">{subtitle}</p>
    </div>
  );
}

export default function EvolucaoPage() {
  const { subjects, topics, studyLogs, errors } = useProfile();

  const today = todayISO();
  const [activePreset, setActivePreset] = useState<'7' | '30' | '90' | 'all' | 'custom'>('30');
  const [startDate, setStartDate] = useState(addDaysISO(today, -30));
  const [endDate, setEndDate] = useState(today);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [metricTab, setMetricTab] = useState<'accuracy' | 'questions' | 'hours'>('accuracy');

  function applyPreset(preset: '7' | '30' | '90' | 'all') {
    setActivePreset(preset);
    setEndDate(today);
    if (preset === 'all') {
      setStartDate('2020-01-01');
    } else {
      setStartDate(addDaysISO(today, -Number(preset)));
    }
  }

  const filteredLogs = useMemo(
    () =>
      studyLogs.filter(
        (l) =>
          l.study_date >= startDate &&
          l.study_date <= endDate &&
          (!subjectFilter || l.subject_id === subjectFilter)
      ),
    [studyLogs, startDate, endDate, subjectFilter]
  );

  const totalQ = filteredLogs.reduce((a, b) => a + b.questions_total, 0);
  const totalC = filteredLogs.reduce((a, b) => a + b.questions_correct, 0);
  const totalSecs = filteredLogs.reduce((a, b) => a + b.duration_seconds, 0);
  const overallAcc = calcAccuracy(totalC, totalQ);

  // Série temporal para o gráfico suave de Área (agrupado por data)
  const timelineData = useMemo(() => {
    const byDate: Record<string, { q: number; c: number; secs: number }> = {};
    filteredLogs.forEach((l) => {
      if (!byDate[l.study_date]) byDate[l.study_date] = { q: 0, c: 0, secs: 0 };
      byDate[l.study_date].q += l.questions_total;
      byDate[l.study_date].c += l.questions_correct;
      byDate[l.study_date].secs += l.duration_seconds;
    });

    const sortedDates = Object.keys(byDate).sort();
    return sortedDates.map((iso) => {
      const d = byDate[iso];
      return {
        label: formatDateBR(iso).slice(0, 5),
        accuracy: calcAccuracy(d.c, d.q),
        questions: d.q,
        hours: Number((d.secs / 3600).toFixed(1)),
      };
    });
  }, [filteredLogs]);

  const bySubjectData = subjects.map((s) => {
    const sLogs = filteredLogs.filter((l) => l.subject_id === s.id);
    const q = sLogs.reduce((a, b) => a + b.questions_total, 0);
    const c = sLogs.reduce((a, b) => a + b.questions_correct, 0);
    const secs = sLogs.reduce((a, b) => a + b.duration_seconds, 0);
    return {
      id: s.id,
      name: s.name.length > 18 ? `${s.name.slice(0, 18)}…` : s.name,
      fullName: s.name,
      Acertos: c,
      Total: q,
      pct: calcAccuracy(c, q),
      hours: Number((secs / 3600).toFixed(1)),
      color: s.color,
    };
  });

  const gaugeSubjects = bySubjectData.slice(0, 5);

  const errorCauseMap: Record<string, number> = {};
  errors.forEach((e) => {
    errorCauseMap[e.error_cause] = (errorCauseMap[e.error_cause] || 0) + 1;
  });
  const errorCauses = Object.entries(errorCauseMap).map(([name, value]) => ({ name, value }));

  const headlineMetric =
    metricTab === 'accuracy'
      ? `${overallAcc}%`
      : metricTab === 'questions'
      ? `${totalQ} q`
      : formatDurationHM(totalSecs);

  const chartColor =
    metricTab === 'accuracy' ? '#3730a3' : metricTab === 'questions' ? '#0d9488' : '#2563eb';

  return (
    <div className="space-y-6">
      {/* Cabeçalho + Filtros de Data */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Resultados & Evolução</h1>
            <p className="text-sm text-muted-theme">
              Período: <strong>{formatDateBR(startDate)}</strong> até{' '}
              <strong>{formatDateBR(endDate)}</strong>
            </p>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(
              [
                { id: '7', label: '7d' },
                { id: '30', label: '30d' },
                { id: '90', label: '90d' },
                { id: 'all', label: 'Tudo' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                  activePreset === p.id ? 'bg-indigo-700 text-white' : 'card-surface'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card-surface rounded-2xl p-3.5 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <label className="text-muted-theme font-semibold">De:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setActivePreset('custom');
              }}
              className="rounded-xl subtle-surface border border-theme px-3 py-1.5 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-muted-theme font-semibold">Até:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setActivePreset('custom');
              }}
              className="rounded-xl subtle-surface border border-theme px-3 py-1.5 text-xs"
            />
          </div>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="rounded-xl subtle-surface border border-theme px-3 py-1.5 text-xs sm:ml-auto"
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

      {/* Gráfico Principal Curvo estilo Aprova Total */}
      <div className="card-surface rounded-3xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {(
              [
                { id: 'questions', label: 'Questões' },
                { id: 'accuracy', label: '% de acerto' },
                { id: 'hours', label: 'Horas' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setMetricTab(tab.id)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition ${
                  metricTab === tab.id
                    ? 'bg-indigo-800 text-white shadow-sm'
                    : 'text-muted-theme hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span className="text-2xl font-extrabold" style={{ color: chartColor }}>
            {headlineMetric}
          </span>
        </div>

        <div className="h-64 w-full">
          {timelineData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-theme">
              Registre estudos no Ciclo dentro deste período para ver a curva de evolução.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="evolGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColor} stopOpacity={0.22} />
                    <stop offset="95%" stopColor={chartColor} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" vertical={false} opacity={0.18} />
                <XAxis dataKey="label" fontSize={11} axisLine={false} tickLine={false} />
                <YAxis fontSize={11} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey={metricTab}
                  stroke={chartColor}
                  strokeWidth={3}
                  fill="url(#evolGradient)"
                  dot={{ r: 5, fill: chartColor, stroke: '#ffffff', strokeWidth: 2 }}
                  activeDot={{ r: 7 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Semi-círculos de Desempenho por Matéria (estilo Competências) */}
      <div className="card-surface rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-theme">
              Desempenho por Disciplina
            </p>
            <h2 className="font-bold text-base">Medidores de Precisão</h2>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-theme">Média Geral</p>
            <p className="text-2xl font-extrabold">{overallAcc}%</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-1">
          {gaugeSubjects.map((s) => (
            <SemiGauge
              key={s.id}
              label={s.fullName}
              pct={s.pct}
              color={s.pct >= 80 ? '#10b981' : s.pct >= 60 ? '#3730a3' : '#f97316'}
              subtitle={`${s.Acertos}/${s.Total} q`}
            />
          ))}
        </div>
      </div>

      {/* Gráfico de Barras + Progresso do Edital & Causas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-surface rounded-3xl p-5">
          <h2 className="font-bold text-sm mb-4">Questões por Matéria</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySubjectData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                <XAxis dataKey="name" fontSize={11} axisLine={false} tickLine={false} />
                <YAxis fontSize={11} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="Total" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Acertos" fill="#0d9488" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-surface rounded-3xl p-5 space-y-3">
          <h2 className="font-bold text-sm">Progresso do Edital & Causas de Erro</h2>
          <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
            {subjects.map((s) => {
              const sTopics = topics.filter((t) => t.subject_id === s.id);
              const done = sTopics.filter((t) => t.studied).length;
              const pct = sTopics.length ? Math.round((done / sTopics.length) * 100) : 0;
              return (
                <div key={s.id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium truncate">{s.name}</span>
                    <span className="text-muted-theme font-semibold">{pct}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full subtle-surface overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: pct === 100 ? '#10b981' : s.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {errorCauses.length > 0 && (
            <div className="pt-2 border-t border-theme flex flex-wrap gap-1.5">
              {errorCauses.map((c) => (
                <span
                  key={c.name}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-rose-500/12 text-rose-600 font-semibold"
                >
                  {c.name}: {c.value}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
