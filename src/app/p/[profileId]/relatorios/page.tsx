'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { addDaysISO, calcAccuracy, formatDateBR, todayISO } from '@/lib/utils';
import { Sparkles, Loader2, FileBarChart2 } from 'lucide-react';

export default function RelatoriosPage() {
  const { profile, subjects, studyLogs, reviews, errors, simulados, reports, addAIReport } =
    useProfile();

  const [periodType, setPeriodType] = useState<'Semanal' | 'Mensal' | 'Anual'>('Semanal');
  const [generating, setGenerating] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function handleGenerateReport() {
    if (!profile) return;
    setGenerating(true);
    setErrMsg(null);
    try {
      const today = todayISO();
      const days = periodType === 'Semanal' ? 7 : periodType === 'Mensal' ? 30 : 365;
      const minDate = addDaysISO(today, -days);
      const logs = studyLogs.filter((l) => l.study_date >= minDate);

      const totalHours = Number(
        (logs.reduce((a, b) => a + b.duration_seconds, 0) / 3600).toFixed(1)
      );
      const totalQ = logs.reduce((a, b) => a + b.questions_total, 0);
      const totalC = logs.reduce((a, b) => a + b.questions_correct, 0);

      const bySubject = subjects.map((s) => {
        const sLogs = logs.filter((l) => l.subject_id === s.id);
        const q = sLogs.reduce((a, b) => a + b.questions_total, 0);
        const c = sLogs.reduce((a, b) => a + b.questions_correct, 0);
        const h = Number((sLogs.reduce((a, b) => a + b.duration_seconds, 0) / 3600).toFixed(1));
        return {
          materia: s.name,
          horas: h,
          questoes: q,
          acertos_pct: calcAccuracy(c, q),
        };
      });

      const metricsSummary = {
        periodo: periodType,
        horas_liquidas: totalHours,
        meta_diaria_horas: profile.daily_hours_goal,
        questoes_total: totalQ,
        taxa_acertos_geral: calcAccuracy(totalC, totalQ),
        meta_acertos_pct: profile.target_accuracy,
        revisoes_atrasadas: reviews.filter((r) => !r.completed && r.due_date < today).length,
        erros_cadastrados: errors.length,
        simulados_no_periodo: simulados.filter((sm) => sm.exam_date >= minDate).length,
        por_materia: bySubject,
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatórios & Mentor Gemini AI</h1>
          <p className="text-sm text-muted-theme">
            Diagnósticos inteligentes cruzando horas, questões, revisões, erros e simulados.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={periodType}
            onChange={(e) => setPeriodType(e.target.value as typeof periodType)}
            className="rounded-xl card-surface px-3 py-2 text-xs font-semibold"
          >
            <option value="Semanal">Semanal (7d)</option>
            <option value="Mensal">Mensal (30d)</option>
            <option value="Anual">Anual (365d)</option>
          </select>
          <button
            onClick={handleGenerateReport}
            disabled={generating}
            className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
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
        <div className="p-4 rounded-2xl bg-red-500/15 text-red-500 text-xs">{errMsg}</div>
      )}

      {reports.length === 0 ? (
        <div className="card-surface rounded-2xl p-10 text-center space-y-2">
          <FileBarChart2 className="w-10 h-10 mx-auto text-violet-500 opacity-70" />
          <p className="font-semibold text-sm">Nenhum relatório gerado ainda</p>
          <p className="text-xs text-muted-theme">
            Clique em &ldquo;Gerar Diagnóstico IA&rdquo; acima para receber seu plano de ação.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((rep) => (
            <div key={rep.id} className="card-surface rounded-2xl p-6 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-theme pb-3">
                <span className="font-bold text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-500" />
                  Relatório {rep.period_label}
                </span>
                <span className="text-[11px] text-muted-theme">
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
  );
}
