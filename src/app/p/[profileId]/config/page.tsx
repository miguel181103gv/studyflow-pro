'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { createClient } from '@/lib/supabase/client';
import type { ThemeId } from '@/lib/types';
import { STUDY_MODES, STUDY_MODE_LIST, encodeStudyModeSlug, getStudyModeId, type StudyMode } from '@/lib/studyModes';
import { Check, CheckCircle2, Download, Upload, Loader2 } from 'lucide-react';

const THEMES: { id: ThemeId; name: string; desc: string }[] = [
  { id: 'clean', name: 'Claro Clean', desc: 'Visual moderno e leve para estudo diurno' },
  { id: 'sepia', name: 'Sépia Papel', desc: 'Confortável para leituras longas' },
  { id: 'obsidian', name: 'Escuro Obsidian', desc: 'Ideal para estudar à noite' },
  { id: 'navy', name: 'Azul Noturno', desc: 'Foco profundo com contraste suave' },
];

export default function ConfigPage() {
  const {
    profile,
    subjects,
    topics,
    highlights,
    studyLogs,
    reviews,
    errors,
    flashcards,
    simulados,
    reports,
    theme,
    setTheme,
    updateProfile,
    refreshAll,
    userEmail,
    userId,
  } = useProfile();

  const [studyMode, setStudyMode] = useState<StudyMode>(() => getStudyModeId(profile));
  const modeCfg = STUDY_MODES[studyMode];
  const [name, setName] = useState(profile?.name || '');
  const [roleTitle, setRoleTitle] = useState(profile?.role_title || '');
  const [dailyGoal, setDailyGoal] = useState(String(profile?.daily_hours_goal || 4));
  const [targetAcc, setTargetAcc] = useState(String(profile?.target_accuracy || 80));
  const [examDate, setExamDate] = useState(profile?.exam_date || '');
  const [salaryBase, setSalaryBase] = useState(profile?.salary_base || '');
  const [vale, setVale] = useState(profile?.vale_alimentacao || '');
  const [workload, setWorkload] = useState(profile?.workload || '');
  const [statusText, setStatusText] = useState(profile?.status_text || '');
  const [extras, setExtras] = useState(profile?.extras || '');
  const [savedMsg, setSavedMsg] = useState(false);

  const [importing, setImporting] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await updateProfile({
      slug: encodeStudyModeSlug(studyMode),
      name: name.trim() || profile?.name,
      role_title: roleTitle.trim(),
      daily_hours_goal: Number(dailyGoal) || 4,
      target_accuracy: Number(targetAcc) || 80,
      exam_date: examDate || null,
      salary_base: salaryBase,
      vale_alimentacao: vale,
      workload,
      status_text: statusText,
      extras,
    });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 3000);
  }

  function handleExportBackup() {
    if (!profile) return;
    let agendaPrefs: unknown = null;
    try {
      const raw = localStorage.getItem(`sf_agenda_prefs_${profile.id}`);
      if (raw) agendaPrefs = JSON.parse(raw);
    } catch {
      // ignore
    }

    const payload = {
      exported_at: new Date().toISOString(),
      version: 'studyflow-pro-v7',
      profile,
      subjects,
      topics,
      highlights,
      studyLogs,
      reviews,
      errors,
      flashcards,
      simulados,
      reports,
      agendaPrefs,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (profile.name || 'concurso').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `StudyFlow_Backup_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupMsg('Backup exportado com sucesso!');
  }

  async function handleImportBackup(file: File) {
    if (!profile || !userId) return;
    setImporting(true);
    setBackupMsg(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const supabase = createClient();

      // Restaura notas da agenda local
      if (data.agendaPrefs) {
        try {
          localStorage.setItem(
            `sf_agenda_prefs_${profile.id}`,
            JSON.stringify(data.agendaPrefs)
          );
        } catch {
          // ignore
        }
      }

      // Mapeia matérias por nome para preservar vínculos
      const subjectMap = new Map<string, string>();
      subjects.forEach((s) => subjectMap.set(s.name.toLowerCase(), s.id));

      if (Array.isArray(data.subjects)) {
        for (const oldSub of data.subjects) {
          const existingId = subjectMap.get(String(oldSub.name || '').toLowerCase());
          if (existingId) {
            subjectMap.set(oldSub.id, existingId);
          } else {
            const { data: createdSub } = await supabase
              .from('subjects')
              .insert({
                user_id: userId,
                profile_id: profile.id,
                name: oldSub.name,
                category: oldSub.category || 'Importada',
                color: oldSub.color || '#0d9488',
                cycle_hours: oldSub.cycle_hours ?? 1,
                cycle_minutes: oldSub.cycle_minutes ?? 30,
                cycle_order: subjects.length,
              })
              .select('id')
              .single();
            if (createdSub) subjectMap.set(oldSub.id, createdSub.id);
          }
        }
      }

      // Restaura studyLogs
      if (Array.isArray(data.studyLogs) && data.studyLogs.length > 0) {
        const rows = data.studyLogs
          .map((l: Record<string, unknown>) => ({
            user_id: userId,
            profile_id: profile.id,
            subject_id: subjectMap.get(String(l.subject_id)) || subjects[0]?.id,
            topic_id: null,
            duration_seconds: Number(l.duration_seconds) || 0,
            study_date: String(l.study_date || new Date().toISOString().slice(0, 10)),
            period: String(l.period || 'Manhã'),
            method: String(l.method || 'PDF + Questões'),
            questions_total: Number(l.questions_total) || 0,
            questions_correct: Number(l.questions_correct) || 0,
            stop_point: String(l.stop_point || ''),
            notes: String(l.notes || ''),
          }))
          .filter((r: { subject_id?: string }) => !!r.subject_id);
        if (rows.length > 0) await supabase.from('study_logs').insert(rows);
      }

      // Restaura flashcards
      if (Array.isArray(data.flashcards) && data.flashcards.length > 0) {
        const rows = data.flashcards
          .map((c: Record<string, unknown>) => ({
            user_id: userId,
            profile_id: profile.id,
            subject_id: subjectMap.get(String(c.subject_id)) || subjects[0]?.id,
            topic_id: null,
            front: String(c.front || ''),
            back: String(c.back || ''),
            ease_factor: Number(c.ease_factor) || 2.5,
            interval_days: Number(c.interval_days) || 0,
            repetitions: Number(c.repetitions) || 0,
            due_date: String(c.due_date || new Date().toISOString().slice(0, 10)),
          }))
          .filter((r: { subject_id?: string; front: string }) => !!r.subject_id && !!r.front);
        if (rows.length > 0) await supabase.from('flashcards').insert(rows);
      }

      // Restaura erros
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const rows = data.errors
          .map((er: Record<string, unknown>) => ({
            user_id: userId,
            profile_id: profile.id,
            subject_id: subjectMap.get(String(er.subject_id)) || subjects[0]?.id,
            topic_id: null,
            question_text: String(er.question_text || ''),
            user_answer: String(er.user_answer || ''),
            correct_answer: String(er.correct_answer || ''),
            error_cause: String(er.error_cause || 'Lacuna teórica'),
            explanation: String(er.explanation || ''),
            golden_rule: String(er.golden_rule || ''),
          }))
          .filter((r: { subject_id?: string }) => !!r.subject_id);
        if (rows.length > 0) await supabase.from('error_entries').insert(rows);
      }

      // Restaura simulados
      if (Array.isArray(data.simulados) && data.simulados.length > 0) {
        const rows = data.simulados.map((sm: Record<string, unknown>) => ({
          user_id: userId,
          profile_id: profile.id,
          title: String(sm.title || 'Simulado Importado'),
          exam_date: String(sm.exam_date || new Date().toISOString().slice(0, 10)),
          board: String(sm.board || ''),
          total_questions: Number(sm.total_questions) || 60,
          correct_answers: Number(sm.correct_answers) || 0,
          duration_minutes: Number(sm.duration_minutes) || 240,
          notes: String(sm.notes || ''),
          subject_scores: Array.isArray(sm.subject_scores) ? sm.subject_scores : [],
        }));
        if (rows.length > 0) await supabase.from('simulados').insert(rows);
      }

      await refreshAll();
      setBackupMsg('Dados restaurados com sucesso na nuvem!');
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : 'Erro ao importar arquivo JSON.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
          Configurações & Backup
        </h1>
        <p className="text-sm text-muted-theme mt-1">
          Escolha o modo de estudo, edite metas e datas, ajuste o tema ou faça backup dos seus dados.
        </p>
      </div>

      {/* Status da Conta */}
      <div className="card-surface rounded-3xl p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold">Sincronização Automática Ativa</p>
            <p className="text-xs text-muted-theme">
              Conectado como {userEmail} · PC e iPhone sempre iguais
            </p>
          </div>
        </div>
      </div>

      {/* Edição Completa das Informações do Edital */}
      <form onSubmit={handleSave} className="card-surface rounded-3xl p-6 space-y-4">
        <h2 className="font-bold text-base">Modo de Estudo & Metas</h2>

        <div>
          <label className="block text-xs font-semibold text-muted-theme mb-1.5">
            Para que você está usando este plano?
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {STUDY_MODE_LIST.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setStudyMode(m.id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border text-left flex items-center gap-1.5 ${
                  studyMode === m.id
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'subtle-surface border-theme hover:opacity-85'
                }`}
              >
                <span>{m.icon}</span>
                <span className="truncate">{m.shortLabel}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">
              {modeCfg.nameLabel.replace(" *", "")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">{modeCfg.roleLabel}</label>
            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">
              {modeCfg.examDateLabel}
            </label>
            <input
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">
              Meta Diária (horas)
            </label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="16"
              value={dailyGoal}
              onChange={(e) => setDailyGoal(e.target.value)}
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">
              Meta de Acertos (%)
            </label>
            <input
              type="number"
              min="40"
              max="100"
              value={targetAcc}
              onChange={(e) => setTargetAcc(e.target.value)}
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
            />
          </div>
        </div>

        {modeCfg.hasSalaryRaioX && (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">
              Salário Base
            </label>
            <input
              value={salaryBase}
              onChange={(e) => setSalaryBase(e.target.value)}
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">
              Vale-Alimentação
            </label>
            <input
              value={vale}
              onChange={(e) => setVale(e.target.value)}
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">Jornada</label>
            <input
              value={workload}
              onChange={(e) => setWorkload(e.target.value)}
              placeholder="Ex: 40h/sem"
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">
              Status do Concurso
            </label>
            <input
              value={statusText}
              onChange={(e) => setStatusText(e.target.value)}
              placeholder="Ex: Edital publicado / Autorizado"
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">
              Benefícios / Extras
            </label>
            <input
              value={extras}
              onChange={(e) => setExtras(e.target.value)}
              placeholder="Ex: Aux. Saúde, Home Office, PLR..."
              className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
            />
          </div>
        </div>
        </>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            className="px-6 py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold shadow-sm"
          >
            Salvar Alterações do Edital
          </button>
          {savedMsg && (
            <span className="text-xs text-emerald-600 font-bold">Salvo na nuvem!</span>
          )}
        </div>
      </form>

      {/* Exportação e Recuperação de Dados (JSON) */}
      <div className="card-surface rounded-3xl p-6 space-y-4">
        <div>
          <h2 className="font-bold text-base">Exportar & Recuperar Seus Dados</h2>
          <p className="text-xs text-muted-theme mt-1">
            Baixe uma cópia completa (sessões, progresso, flashcards, erros, simulados e notas da agenda) em JSON ou restaure um arquivo salvo anteriormente.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportBackup}
            className="px-5 py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold inline-flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Exportar Backup (.json)
          </button>

          <label className="cursor-pointer px-5 py-3 rounded-2xl subtle-surface border border-theme hover:opacity-85 text-sm font-bold inline-flex items-center gap-2">
            {importing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {importing ? 'Restaurando...' : 'Recuperar Backup (.json)'}
            <input
              type="file"
              accept="application/json"
              className="hidden"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportBackup(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {backupMsg && (
          <p className="text-xs font-bold text-teal-700 dark:text-teal-300">{backupMsg}</p>
        )}
      </div>

      {/* Temas */}
      <div className="card-surface rounded-3xl p-6 space-y-3">
        <h2 className="font-bold text-base">Aparência / Tema</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`text-left rounded-2xl p-4 border transition flex items-center justify-between ${
                theme === t.id
                  ? 'border-teal-600 bg-teal-600/10'
                  : 'border-theme subtle-surface hover:opacity-85'
              }`}
            >
              <div>
                <p className="text-sm font-bold">{t.name}</p>
                <p className="text-xs text-muted-theme">{t.desc}</p>
              </div>
              {theme === t.id && <Check className="w-4 h-4 text-teal-600 shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
