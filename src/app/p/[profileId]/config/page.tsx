'use client';

import { useCallback, useEffect, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import type { ThemeId } from '@/lib/types';
import { STUDY_MODES, STUDY_MODE_LIST, encodeStudyModeSlug, getStudyModeId, type StudyMode } from '@/lib/studyModes';
import {
  BACKUP_RETENTION_DAYS,
  buildBackupPayload,
  createRestorePoint,
  deleteRestorePoint,
  listRestorePoints,
  loadRestorePointPayload,
  restoreBackupPayload,
  type BackupPayload,
  type RestorePointMeta,
} from '@/lib/backupManager';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  Download,
  HardDrive,
  History,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

const THEMES: { id: ThemeId; name: string; desc: string }[] = [
  { id: 'clean', name: 'Claro Clean', desc: 'Visual moderno e leve para estudo diurno' },
  { id: 'sepia', name: 'Sépia Papel', desc: 'Confortável para leituras longas' },
  { id: 'obsidian', name: 'Escuro Obsidian', desc: 'Ideal para estudar à noite' },
  { id: 'navy', name: 'Azul Noturno', desc: 'Foco profundo com contraste suave' },
];

function formatDateTimeBR(ms: number): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString('pt-BR');
  }
}

function formatRelativeBR(ms: number): string {
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'ontem';
  return `há ${diffD} dias`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

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

  // Pontos de Restauração (últimos 7 dias)
  const [restorePoints, setRestorePoints] = useState<RestorePointMeta[]>([]);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [creatingPoint, setCreatingPoint] = useState(false);
  const [restoringPointId, setRestoringPointId] = useState<string | null>(null);
  const [confirmRestoreTarget, setConfirmRestoreTarget] = useState<RestorePointMeta | null>(null);
  const [pointStatusMsg, setPointStatusMsg] = useState<string | null>(null);

  const fetchPoints = useCallback(async () => {
    if (!userId || !profile?.id) return;
    setLoadingPoints(true);
    try {
      const pts = await listRestorePoints(userId, profile.id);
      setRestorePoints(pts);
    } catch {
      // ignore
    } finally {
      setLoadingPoints(false);
    }
  }, [userId, profile?.id]);

  useEffect(() => {
    void fetchPoints();
  }, [fetchPoints]);

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

  async function handleCreateRestorePointNow() {
    if (!profile || !userId || creatingPoint) return;
    setCreatingPoint(true);
    setPointStatusMsg(null);
    try {
      const res = await createRestorePoint({
        userId,
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
        reason: 'manual',
        label: 'Ponto manual',
      });
      await fetchPoints();
      setPointStatusMsg(
        res.cloudSaved
          ? 'Ponto de restauração salvo na nuvem e no navegador!'
          : 'Ponto de restauração salvo localmente no navegador!'
      );
    } catch (err) {
      setPointStatusMsg(err instanceof Error ? err.message : 'Erro ao criar ponto de restauração.');
    } finally {
      setCreatingPoint(false);
    }
  }

  async function handleConfirmRestore() {
    if (!confirmRestoreTarget || !profile || !userId) return;
    const target = confirmRestoreTarget;
    setRestoringPointId(target.id);
    setPointStatusMsg(null);
    try {
      const payload = await loadRestorePointPayload(target);
      if (!payload) {
        throw new Error('Não foi possível baixar os dados deste ponto de restauração.');
      }
      const { restoredCounts } = await restoreBackupPayload({
        payload,
        userId,
        currentProfile: profile,
        currentData: {
          subjects,
          topics,
          highlights,
          studyLogs,
          reviews,
          errors,
          flashcards,
          simulados,
          reports,
        },
        createSafetyPoint: true,
      });
      await refreshAll();
      await fetchPoints();
      setConfirmRestoreTarget(null);
      setPointStatusMsg(
        `Restaurado com sucesso (${restoredCounts.subjects} matérias, ${restoredCounts.topics} tópicos, ${restoredCounts.highlights} grifos, ${restoredCounts.studyLogs} sessões). Um ponto de segurança dos dados anteriores também foi salvo!`
      );
    } catch (err) {
      setPointStatusMsg(err instanceof Error ? err.message : 'Erro ao restaurar ponto.');
    } finally {
      setRestoringPointId(null);
    }
  }

  async function handleDownloadPoint(point: RestorePointMeta) {
    if (!profile) return;
    try {
      const payload = await loadRestorePointPayload(point);
      if (!payload) {
        setPointStatusMsg('Não foi possível baixar este ponto.');
        return;
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (profile.name || 'estudos').replace(/[^a-zA-Z0-9_-]/g, '_');
      const stamp = new Date(point.timestampMs).toISOString().replace(/[:.]/g, '-').slice(0, 16);
      a.download = `StudyFlow_Ponto_${safeName}_${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setPointStatusMsg('Erro ao baixar o arquivo JSON deste ponto.');
    }
  }

  async function handleDeletePoint(point: RestorePointMeta) {
    await deleteRestorePoint(point);
    setRestorePoints((prev) => prev.filter((p) => p.id !== point.id));
  }

  function handleExportBackup() {
    if (!profile) return;
    const payload = buildBackupPayload({
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
      reason: 'manual',
      label: 'Exportação manual',
    });

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (profile.name || 'concurso').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `StudyFlow_Backup_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupMsg('Backup completo exportado com sucesso!');
  }

  async function handleImportBackup(file: File) {
    if (!profile || !userId) return;
    setImporting(true);
    setBackupMsg(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as BackupPayload;
      const { restoredCounts } = await restoreBackupPayload({
        payload: data,
        userId,
        currentProfile: profile,
        currentData: {
          subjects,
          topics,
          highlights,
          studyLogs,
          reviews,
          errors,
          flashcards,
          simulados,
          reports,
        },
        createSafetyPoint: true,
      });
      await refreshAll();
      await fetchPoints();
      setBackupMsg(
        `Backup restaurado com sucesso (${restoredCounts.subjects} matérias, ${restoredCounts.topics} tópicos, ${restoredCounts.highlights} grifos, ${restoredCounts.studyLogs} sessões)! Um ponto de segurança anterior foi salvo automaticamente.`
      );
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
          Escolha o modo de estudo, edite metas e datas, gerencie pontos de restauração automáticos ou ajuste o tema.
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

      {/* Pontos de Restauração Automáticos (A cada hora · Últimos 7 dias) */}
      <div className="card-surface rounded-3xl p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-bold text-base">Pontos de Restauração Automáticos</h2>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Ativo · a cada 1h · últimos {BACKUP_RETENTION_DAYS} dias
                </span>
              </div>
              <p className="text-xs text-muted-theme mt-1">
                Enquanto você usa o StudyFlow, um ponto de restauração completo (matérias, tópicos, vídeos, links de PDFs, grifos, textos, flashcards, erros, questões, dicionário e agenda) é salvo automaticamente na nuvem e no navegador. Pontos com mais de {BACKUP_RETENTION_DAYS} dias são limpos automaticamente.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleCreateRestorePointNow}
            disabled={creatingPoint}
            className="px-4 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
          >
            {creatingPoint ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {creatingPoint ? 'Salvando ponto...' : 'Criar ponto agora'}
          </button>

          <button
            type="button"
            onClick={() => void fetchPoints()}
            disabled={loadingPoints}
            className="px-4 py-2.5 rounded-2xl subtle-surface border border-theme hover:opacity-85 text-xs font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingPoints ? 'animate-spin' : ''}`} />
            Atualizar lista
          </button>

          {restorePoints.length > 0 && (
            <span className="text-[11px] text-muted-theme ml-auto">
              {restorePoints.length} {restorePoints.length === 1 ? 'ponto disponível' : 'pontos disponíveis'}
            </span>
          )}
        </div>

        {pointStatusMsg && (
          <div className="rounded-2xl bg-teal-500/10 border border-teal-500/25 px-4 py-2.5 text-xs font-semibold text-teal-800 dark:text-teal-200">
            {pointStatusMsg}
          </div>
        )}

        {loadingPoints && restorePoints.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-theme flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando pontos de restauração...
          </div>
        ) : restorePoints.length === 0 ? (
          <div className="rounded-2xl subtle-surface border border-dashed border-theme p-5 text-center space-y-1">
            <p className="text-xs font-bold">Nenhum ponto de restauração salvo ainda</p>
            <p className="text-[11px] text-muted-theme">
              Clique em &quot;Criar ponto agora&quot; ou aguarde o primeiro salvamento automático horário.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {restorePoints.map((pt) => {
              const isRestoringThis = restoringPointId === pt.id;
              return (
                <div
                  key={pt.id}
                  className="rounded-2xl subtle-surface border border-theme px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                      <span className="text-xs font-bold">{formatDateTimeBR(pt.timestampMs)}</span>
                      <span className="text-[11px] text-muted-theme">({formatRelativeBR(pt.timestampMs)})</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          pt.reason === 'auto'
                            ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                            : pt.reason === 'pre-restore'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                        }`}
                      >
                        {pt.reason === 'auto'
                          ? 'Automático'
                          : pt.reason === 'pre-restore'
                          ? 'Pré-restauração'
                          : 'Manual'}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-500/10 text-muted-theme inline-flex items-center gap-1">
                        {pt.source === 'cloud+local' ? (
                          <>
                            <Cloud className="w-2.5 h-2.5" /> Nuvem + Local
                          </>
                        ) : pt.source === 'cloud' ? (
                          <>
                            <Cloud className="w-2.5 h-2.5" /> Nuvem
                          </>
                        ) : (
                          <>
                            <HardDrive className="w-2.5 h-2.5" /> Local
                          </>
                        )}
                      </span>
                      {pt.sizeBytes ? (
                        <span className="text-[10px] text-muted-theme">{formatBytes(pt.sizeBytes)}</span>
                      ) : null}
                    </div>
                    {pt.summary && (
                      <p className="text-[11px] text-muted-theme truncate">
                        {pt.summary.subjects} matérias · {pt.summary.topics} tópicos · {pt.summary.highlights} grifos ·{' '}
                        {pt.summary.studyLogs} sessões · {pt.summary.errors} erros · {pt.summary.flashcards} cards
                        {pt.summary.notes > 0 ? ` · ${pt.summary.notes} textos` : ''}
                        {pt.summary.words > 0 ? ` · ${pt.summary.words} palavras` : ''}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={Boolean(restoringPointId)}
                      onClick={() => setConfirmRestoreTarget(pt)}
                      className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-[11px] font-bold inline-flex items-center gap-1"
                    >
                      {isRestoringThis ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3 h-3" />
                      )}
                      Restaurar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadPoint(pt)}
                      title="Baixar arquivo .json deste ponto"
                      className="p-1.5 rounded-xl border border-theme hover:opacity-80 text-muted-theme"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeletePoint(pt)}
                      title="Apagar este ponto"
                      className="p-1.5 rounded-xl border border-theme hover:text-rose-500 text-muted-theme"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
              {modeCfg.nameLabel.replace(' *', '')}
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

      {/* Exportação e Recuperação Manual (JSON) */}
      <div className="card-surface rounded-3xl p-6 space-y-4">
        <div>
          <h2 className="font-bold text-base">Exportar & Recuperar Arquivo (.json)</h2>
          <p className="text-xs text-muted-theme mt-1">
            Baixe uma cópia completa para guardar no seu computador/Google Drive ou restaure um arquivo .json salvo anteriormente.
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
                if (f) void handleImportBackup(f);
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

      {/* Modal de Confirmação de Restauração */}
      {confirmRestoreTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-surface rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-theme">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base">Restaurar ponto salvo?</h3>
                  <p className="text-xs text-muted-theme">
                    {formatDateTimeBR(confirmRestoreTarget.timestampMs)} ({formatRelativeBR(confirmRestoreTarget.timestampMs)})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmRestoreTarget(null)}
                disabled={Boolean(restoringPointId)}
                className="p-1.5 rounded-xl hover:opacity-75 text-muted-theme"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-2xl subtle-surface border border-theme p-3.5 text-xs space-y-1.5">
              <p>
                Este perfil voltará exatamente ao estado de <strong>{formatDateTimeBR(confirmRestoreTarget.timestampMs)}</strong> (matérias, tópicos, vídeos, links de PDFs, grifos, textos, sessões, revisões, erros, flashcards, simulados, questões, dicionário e agenda).
              </p>
              <p className="text-emerald-700 dark:text-emerald-300 font-semibold">
                Fique tranquilo: antes de restaurar, o StudyFlow cria automaticamente um ponto de segurança com seus dados atuais caso você queira desfazer.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmRestoreTarget(null)}
                disabled={Boolean(restoringPointId)}
                className="px-4 py-2.5 rounded-2xl subtle-surface border border-theme text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRestore()}
                disabled={Boolean(restoringPointId)}
                className="px-4 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                {restoringPointId ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                {restoringPointId ? 'Restaurando...' : 'Sim, restaurar este ponto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
