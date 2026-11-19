'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { addDaysISO, calcAccuracy, formatDurationHM, todayISO } from '@/lib/utils';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

export default function EvolucaoPage() {
  const { subjects, topics, studyLogs, errors } = useProfile();
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90 | 365>(30);
  const [subjectFilter, setSubjectFilter] = useState('');

  const today = todayISO();
  const minDate = addDaysISO(today, -rangeDays);

  const filteredLogs = studyLogs.filter(
    (l) => l.study_date >= minDate && (!subjectFilter || l.subject_id === subjectFilter)
  );

  const totalQ = filteredLogs.reduce((a, b) => a + b.questions_total, 0);
  const totalC = filteredLogs.reduce((a, b) => a + b.questions_correct, 0);
  const totalE = Math.max(0, totalQ - totalC);
  const totalSecs = filteredLogs.reduce((a, b) => a + b.duration_seconds, 0);

  const bySubjectData = subjects.map((s) => {
    const sLogs = filteredLogs.filter((l) => l.subject_id === s.id);
    const q = sLogs.reduce((a, b) => a + b.questions_total, 0);
    const c = sLogs.reduce((a, b) => a + b.questions_correct, 0);
    const secs = sLogs.reduce((a, b) => a + b.duration_seconds, 0);
    return {
      name: s.name.length > 18 ? `${s.name.slice(0, 18)}…` : s.name,
      fullName: s.name,
      Acertos: c,
      Total: q,
      pct: calcAccuracy(c, q),
      hours: Number((secs / 3600).toFixed(1)),
      color: s.color,
    };
  });

  const errorCauseMap: Record<string, number> = {};
  errors.forEach((e) => {
    errorCauseMap[e.error_cause] = (errorCauseMap[e.error_cause] || 0) + 1;
  });
  const errorCauses = Object.entries(errorCauseMap).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Minha Evolução & Insights</h1>
          <p className="text-sm text-muted-theme">
            Desempenho por matéria, horas líquidas, conclusão do edital e causas de erro.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {([7, 30, 90, 365] as const).map((d) => (
            <button
              key={d}
              onClick={() => setRangeDays(d)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                rangeDays === d ? 'bg-blue-600 text-white' : 'card-surface'
              }`}
            >
              {d === 365 ? 'Tudo' : `${d}d`}
            </button>
          ))}
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="rounded-xl card-surface px-3 py-1.5 text-xs"
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

      {/* Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-surface rounded-2xl p-4">
          <p className="text-xs text-muted-theme">Horas no Período</p>
          <p className="text-2xl font-bold mt-1">{formatDurationHM(totalSecs)}</p>
        </div>
        <div className="card-surface rounded-2xl p-4">
          <p className="text-xs text-muted-theme">Questões Feitas</p>
          <p className="text-2xl font-bold mt-1">{totalQ}</p>
        </div>
        <div className="card-surface rounded-2xl p-4">
          <p className="text-xs text-muted-theme">Aproveitamento</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600">
            {calcAccuracy(totalC, totalQ)}%
          </p>
        </div>
        <div className="card-surface rounded-2xl p-4">
          <p className="text-xs text-muted-theme">Erros Catalogados</p>
          <p className="text-2xl font-bold mt-1 text-red-500">{errors.length}</p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-surface rounded-2xl p-5 shadow-sm">
          <h2 className="font-bold text-sm mb-4">Acertos vs. Total de Questões por Matéria</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySubjectData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="Total" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Acertos" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-surface rounded-2xl p-5 shadow-sm flex flex-col items-center">
          <h2 className="font-bold text-sm self-start mb-2">Proporção Acertos vs. Erros</h2>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Acertos', value: totalC || 0 },
                    { name: 'Erros', value: totalE || 0 },
                  ]}
                  dataKey="value"
                  innerRadius={50}
                  outerRadius={80}
                >
                  <Cell fill="#10b981" />
                  <Cell fill="#ef4444" />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-theme">
            {totalC} acertos • {totalE} erros
          </p>
        </div>
      </div>

      {/* Edital Progress + Error Causes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-surface rounded-2xl p-5 shadow-sm space-y-3">
          <h2 className="font-bold text-sm">Progresso do Edital por Matéria</h2>
          {subjects.map((s) => {
            const sTopics = topics.filter((t) => t.subject_id === s.id);
            const done = sTopics.filter((t) => t.studied).length;
            const pct = sTopics.length ? Math.round((done / sTopics.length) * 100) : 0;
            return (
              <div key={s.id} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium truncate">{s.name}</span>
                  <span className="text-muted-theme">
                    {done}/{sTopics.length} ({pct}%)
                  </span>
                </div>
                <div className="w-full h-2 rounded-full subtle-surface overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: s.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="card-surface rounded-2xl p-5 shadow-sm space-y-3">
          <h2 className="font-bold text-sm">Causas dos Erros</h2>
          {errorCauses.length === 0 ? (
            <p className="text-xs text-muted-theme py-4">
              Cadastre questões no Caderno de Erros para ver suas principais causas de erro.
            </p>
          ) : (
            <div className="space-y-2.5">
              {errorCauses.map((c) => (
                <div
                  key={c.name}
                  className="subtle-surface rounded-xl px-4 py-3 flex items-center justify-between text-xs"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="font-bold text-red-500">{c.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
