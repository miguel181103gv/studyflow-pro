'use client';

import { useEffect, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { getStudyMode } from '@/lib/studyModes';
import { useGlobal } from '@/components/GlobalProvider';
import { calcAccuracy, getYouTubeSearchUrl } from '@/lib/utils';
import type { Topic } from '@/lib/types';
import { Check, Star, ChevronDown, ChevronRight, Youtube, CheckCircle2, Trophy, X, Search, Copy } from 'lucide-react';

type Difficulty = 'facil' | 'medio' | 'dificil';

export default function ProgressoEditalPage() {
  const {
    profile,
    subjects,
    topics,
    studyLogs,
    reviews,
    theme,
    toggleTopicStudied,
    toggleSubjectStudied,
    toggleTopicPriority,
  } = useProfile();

  const { notify } = useGlobal();
  const [openSubjects, setOpenSubjects] = useState<Record<string, boolean>>({});
  const [editalSearch, setEditalSearch] = useState('');
  const [difficultyMap, setDifficultyMap] = useState<Record<string, Difficulty>>({});
  const [pendingDifficultyTopic, setPendingDifficultyTopic] = useState<Topic | null>(null);

  const studyMode = getStudyMode(profile);
  const isDark = theme === 'obsidian' || theme === 'navy';
  const diffStorageKey = `sf_topic_difficulty_${profile?.id || 'default'}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(diffStorageKey);
      if (raw) setDifficultyMap(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, [diffStorageKey]);

  function saveDifficulty(topicId: string, diff: Difficulty) {
    const next = { ...difficultyMap, [topicId]: diff };
    setDifficultyMap(next);
    try {
      localStorage.setItem(diffStorageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
    setPendingDifficultyTopic(null);
  }

  async function handleTopicCheck(topic: Topic) {
    const willBeStudied = !topic.studied;
    await toggleTopicStudied(topic);
    if (willBeStudied) {
      setPendingDifficultyTopic(topic);
    }
  }

  const totalTopics = topics.length;
  const totalDone = topics.filter((t) => t.studied).length;
  const overallPct = totalTopics > 0 ? Math.round((totalDone / totalTopics) * 100) : 0;

  function toggleExpandAll(expand: boolean) {
    const next: Record<string, boolean> = {};
    subjects.forEach((s) => {
      next[s.id] = expand;
    });
    setOpenSubjects(next);
  }

  function getTopicStage(topicId: string, studied: boolean) {
    if (!studied) {
      return { level: 0, label: 'Pendente', rev1: false, rev7: false, rev30: false };
    }
    const tRevs = reviews.filter((r) => r.topic_id === topicId);
    const rev1 = tRevs.some((r) => r.interval_days === 1 && r.completed);
    const rev7 = tRevs.some((r) => r.interval_days === 7 && r.completed);
    const rev30 = tRevs.some((r) => r.interval_days === 30 && r.completed);
    const completedCount = [rev1, rev7, rev30].filter(Boolean).length;

    if (completedCount === 3) {
      return { level: 4, label: 'Dominado (3/3 revisões)', rev1, rev7, rev30 };
    }
    if (completedCount === 2) {
      return { level: 3, label: 'Revisado 2x (falta 30d)', rev1, rev7, rev30 };
    }
    if (completedCount === 1) {
      return { level: 2, label: 'Revisado 1x', rev1, rev7, rev30 };
    }
    return { level: 1, label: 'Estudado (aguardando revisões)', rev1, rev7, rev30 };
  }

  function getStageColors(level: number) {
    if (level === 0) {
      return {
        bg: isDark ? 'rgba(255,255,255,0.03)' : '#f8fafc',
        border: isDark ? '#25324a' : '#e2e8f0',
        titleColor: isDark ? '#f1f5f9' : '#0f172a',
        badgeBg: isDark ? '#1e293b' : '#e2e8f0',
        badgeText: isDark ? '#94a3b8' : '#475569',
        checkBg: isDark ? '#1e293b' : '#ffffff',
        checkBorder: isDark ? '#475569' : '#cbd5e1',
      };
    }
    if (level === 1) {
      return {
        bg: isDark ? 'rgba(59,130,246,0.14)' : '#eff6ff',
        border: isDark ? 'rgba(96,165,250,0.4)' : '#bfdbfe',
        titleColor: isDark ? '#dbeafe' : '#1e3a8a',
        badgeBg: isDark ? 'rgba(59,130,246,0.28)' : '#dbeafe',
        badgeText: isDark ? '#93c5fd' : '#1d4ed8',
        checkBg: '#2563eb',
        checkBorder: '#2563eb',
      };
    }
    if (level === 2) {
      return {
        bg: isDark ? 'rgba(99,102,241,0.16)' : '#eef2ff',
        border: isDark ? 'rgba(129,140,248,0.45)' : '#c7d2fe',
        titleColor: isDark ? '#e0e7ff' : '#312e81',
        badgeBg: isDark ? 'rgba(99,102,241,0.3)' : '#e0e7ff',
        badgeText: isDark ? '#a5b4fc' : '#4338ca',
        checkBg: '#4f46e5',
        checkBorder: '#4f46e5',
      };
    }
    if (level === 3) {
      return {
        bg: isDark ? 'rgba(20,184,166,0.16)' : '#f0fdfa',
        border: isDark ? 'rgba(45,212,191,0.45)' : '#99f6e4',
        titleColor: isDark ? '#ccfbf1' : '#134e4a',
        badgeBg: isDark ? 'rgba(20,184,166,0.3)' : '#ccfbf1',
        badgeText: isDark ? '#5eead4' : '#0f766e',
        checkBg: '#0d9488',
        checkBorder: '#0d9488',
      };
    }
    return {
      bg: isDark ? 'rgba(16,185,129,0.18)' : '#ecfdf5',
      border: isDark ? 'rgba(52,211,153,0.5)' : '#a7f3d0',
      titleColor: isDark ? '#d1fae5' : '#064e3b',
      badgeBg: isDark ? 'rgba(16,185,129,0.32)' : '#d1fae5',
      badgeText: isDark ? '#6ee7b7' : '#047857',
      checkBg: '#059669',
      checkBorder: '#059669',
    };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{studyMode.syllabusPageTitle}</h1>
          <p className="text-sm text-muted-theme mt-1">
            Marque tópicos individuais ou a matéria inteira. Tópicos marcados como Médio ou Difícil vão automaticamente para Prioridades.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => toggleExpandAll(true)}
            className="px-4 py-2.5 rounded-2xl card-surface text-xs font-bold hover:opacity-85"
          >
            Expandir todas
          </button>
          <button
            onClick={() => toggleExpandAll(false)}
            className="px-4 py-2.5 rounded-2xl card-surface text-xs font-bold hover:opacity-85"
          >
            Recolher todas
          </button>
        </div>
      </div>

      {/* Progresso Geral */}
      <div className="card-surface rounded-3xl p-6 space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-theme">
              Progresso Geral no Edital
            </p>
            <p className="text-sm sm:text-base mt-1">
              <strong>{totalDone}</strong> de <strong>{totalTopics}</strong> tópicos concluídos em{' '}
              <strong>{subjects.length}</strong> disciplinas
            </p>
          </div>
          <span className="text-3xl font-extrabold text-teal-600">{overallPct}%</span>
        </div>
        <div className="w-full h-3 rounded-full subtle-surface overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${overallPct}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-semibold">
          <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800">1. Estudado</span>
          <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-800">2. Rev. 1d</span>
          <span className="px-3 py-1 rounded-full bg-teal-100 text-teal-800">3. Rev. 7d</span>
          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">
            4. Dominado (30d)
          </span>
        </div>
      </div>

      {/* Busca dentro do Edital */}
      <div className="card-surface rounded-2xl px-4 py-2.5 flex items-center gap-3">
        <Search className="w-4 h-4 text-muted-theme shrink-0" />
        <input
          value={editalSearch}
          onChange={(e) => setEditalSearch(e.target.value)}
          placeholder="Buscar tópico ou matéria dentro deste edital..."
          className="flex-1 bg-transparent text-sm focus:outline-none"
        />
        {editalSearch && (
          <button
            onClick={() => setEditalSearch('')}
            className="text-xs font-bold text-muted-theme hover:underline"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Lista de Disciplinas */}
      <div className="space-y-3.5">
        {subjects.map((sub) => {
          const q = editalSearch.trim().toLowerCase();
          const allSubTopics = topics.filter((t) => t.subject_id === sub.id);
          const subTopics = q
            ? allSubTopics.filter(
                (t) => t.title.toLowerCase().includes(q) || sub.name.toLowerCase().includes(q)
              )
            : allSubTopics;
          if (q && subTopics.length === 0) return null;
          const done = subTopics.filter((t) => t.studied).length;
          const pct = subTopics.length > 0 ? Math.round((done / subTopics.length) * 100) : 0;
          const isCompletedSubject = subTopics.length > 0 && done === subTopics.length;
          const isOpen = editalSearch.trim().length > 0 ? true : (openSubjects[sub.id] ?? false);

          const subLogs = studyLogs.filter((l) => l.subject_id === sub.id);
          const subQ = subLogs.reduce((a, b) => a + b.questions_total, 0);
          const subC = subLogs.reduce((a, b) => a + b.questions_correct, 0);
          const subAcc = calcAccuracy(subC, subQ);

          return (
            <div
              key={sub.id}
              className="rounded-3xl overflow-hidden transition-all card-surface"
              style={
                isCompletedSubject
                  ? {
                      borderColor: isDark ? '#34d399' : '#6ee7b7',
                      backgroundColor: isDark ? 'rgba(16,185,129,0.1)' : '#f0fdf4',
                    }
                  : undefined
              }
            >
              <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  {/* Checkbox para marcar/desmarcar a matéria inteira */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSubjectStudied(sub.id, !isCompletedSubject);
                    }}
                    title={
                      isCompletedSubject
                        ? 'Desmarcar todos os tópicos desta matéria'
                        : 'Marcar todos os tópicos desta matéria como estudados'
                    }
                    className="w-6 h-6 rounded-lg flex items-center justify-center border-2 shrink-0 transition"
                    style={{
                      backgroundColor: isCompletedSubject
                        ? '#059669'
                        : isDark
                        ? '#1e293b'
                        : '#ffffff',
                      borderColor: isCompletedSubject
                        ? '#059669'
                        : isDark
                        ? '#475569'
                        : '#cbd5e1',
                      color: '#ffffff',
                    }}
                  >
                    {isCompletedSubject && <Check className="w-4 h-4 stroke-[3]" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setOpenSubjects((prev) => ({ ...prev, [sub.id]: !isOpen }))}
                    className="flex items-center gap-3.5 min-w-0 flex-1 text-left"
                  >
                    <div
                      className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 font-bold"
                      style={{
                        backgroundColor: isCompletedSubject
                          ? 'rgba(16,185,129,0.2)'
                          : `${sub.color}20`,
                        color: isCompletedSubject ? '#059669' : sub.color,
                      }}
                    >
                      {isCompletedSubject ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : isOpen ? (
                        <ChevronDown className="w-5 h-5" />
                      ) : (
                        <ChevronRight className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-base truncate">{sub.name}</p>
                        {isCompletedSubject && (
                          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-600 text-white">
                            Concluída
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-theme">
                        {sub.category} · {done}/{subTopics.length} tópicos
                      </p>
                    </div>
                  </button>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  {subQ > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-theme font-medium">{subQ} q</span>
                      <span
                        className={`font-bold px-2.5 py-1 rounded-full text-xs ${
                          subAcc >= 80
                            ? 'bg-emerald-500/15 text-emerald-700'
                            : subAcc >= 60
                            ? 'bg-amber-500/15 text-amber-700'
                            : 'bg-rose-500/15 text-rose-700'
                        }`}
                      >
                        {subAcc}%
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <div className="w-28 h-2.5 rounded-full subtle-surface overflow-hidden hidden sm:block">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: isCompletedSubject ? '#059669' : sub.color,
                        }}
                      />
                    </div>
                    <span className="text-sm font-extrabold w-11 text-right">{pct}%</span>
                  </div>
                </div>
              </div>

              {isOpen && (
                <div className="px-6 pb-6 space-y-2.5 border-t border-theme pt-4 animate-fade-in-up">
                  {subTopics.map((topic) => {
                    const stage = getTopicStage(topic.id, topic.studied);
                    const sc = getStageColors(stage.level);
                    const diff = difficultyMap[topic.id];

                    return (
                      <div
                        key={topic.id}
                        className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border transition-all"
                        style={{
                          backgroundColor: sc.bg,
                          borderColor: sc.border,
                        }}
                      >
                        <button
                          onClick={() => handleTopicCheck(topic)}
                          className="flex items-start gap-3.5 text-left flex-1 min-w-0"
                        >
                          <span
                            className="mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center border-2 shrink-0 transition"
                            style={{
                              backgroundColor: sc.checkBg,
                              borderColor: sc.checkBorder,
                              color: '#ffffff',
                            }}
                          >
                            {topic.studied && <Check className="w-4 h-4 stroke-[3]" />}
                          </span>

                          <div className="min-w-0 space-y-1.5">
                            <p
                              className="text-sm font-semibold leading-snug"
                              style={{ color: sc.titleColor }}
                            >
                              {topic.title}
                            </p>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                                style={{ backgroundColor: sc.badgeBg, color: sc.badgeText }}
                              >
                                {stage.level === 4 && <Trophy className="w-3 h-3" />}
                                {stage.label}
                              </span>

                              {diff && (
                                <span
                                  className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                                    diff === 'dificil'
                                      ? 'bg-rose-500/15 text-rose-700'
                                      : diff === 'medio'
                                      ? 'bg-amber-500/15 text-amber-800'
                                      : 'bg-emerald-500/15 text-emerald-700'
                                  }`}
                                >
                                  {diff === 'dificil'
                                    ? '🔥 Difícil'
                                    : diff === 'medio'
                                    ? '🤔 Médio'
                                    : '😊 Fácil'}
                                </span>
                              )}

                              {topic.studied && (
                                <div className="flex items-center gap-1 text-[10px] font-bold">
                                  <span
                                    className={`px-2 py-0.5 rounded-full ${
                                      stage.rev1
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-black/5 text-muted-theme'
                                    }`}
                                  >
                                    {stage.rev1 ? '✓ 1d' : '1d'}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full ${
                                      stage.rev7
                                        ? 'bg-teal-600 text-white'
                                        : 'bg-black/5 text-muted-theme'
                                    }`}
                                  >
                                    {stage.rev7 ? '✓ 7d' : '7d'}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full ${
                                      stage.rev30
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-black/5 text-muted-theme'
                                    }`}
                                  >
                                    {stage.rev30 ? '✓ 30d' : '30d'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(topic.title);
                              notify('Nome do tópico copiado!');
                            }}
                            title="Copiar nome do tópico"
                            className="p-2.5 rounded-xl card-surface text-muted-theme hover:text-teal-600 transition"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <a
                            href={topic.video_url || getYouTubeSearchUrl(sub.name, topic.title)}
                            target="_blank"
                            rel="noreferrer"
                            title={topic.video_url ? 'Abrir vídeo salvo' : 'Buscar aula no YouTube'}
                            className={`p-2.5 rounded-xl transition ${
                              topic.video_url
                                ? 'bg-red-600 text-white hover:bg-red-500'
                                : 'card-surface text-muted-theme hover:text-red-500'
                            }`}
                          >
                            <Youtube className="w-4 h-4" />
                          </a>

                          <button
                            onClick={() => toggleTopicPriority(topic)}
                            title="Marcar prioridade"
                            className={`p-2.5 rounded-xl transition ${
                              topic.is_priority
                                ? 'bg-amber-500 text-white'
                                : 'card-surface text-muted-theme hover:text-amber-500'
                            }`}
                          >
                            <Star
                              className="w-4 h-4"
                              fill={topic.is_priority ? 'currentColor' : 'none'}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal: Esse tópico foi Fácil, Médio ou Difícil? */}
      {pendingDifficultyTopic && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-extrabold">Como foi estudar este tópico?</h2>
                <p className="text-xs text-muted-theme mt-1 line-clamp-2">
                  {pendingDifficultyTopic.title}
                </p>
              </div>
              <button
                onClick={() => setPendingDifficultyTopic(null)}
                className="p-1.5 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-theme">
              Tópicos marcados como <strong>Médio</strong> ou <strong>Difícil</strong> entram automaticamente na aba <strong>Prioridades</strong> em ordem de dificuldade.
            </p>

            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <button
                onClick={() => saveDifficulty(pendingDifficultyTopic.id, 'facil')}
                className="py-3.5 px-3 rounded-2xl bg-emerald-500/15 hover:bg-emerald-600 hover:text-white text-emerald-800 dark:text-emerald-200 font-bold text-sm transition"
              >
                😊 Fácil
              </button>
              <button
                onClick={() => saveDifficulty(pendingDifficultyTopic.id, 'medio')}
                className="py-3.5 px-3 rounded-2xl bg-amber-500/15 hover:bg-amber-500 hover:text-slate-950 text-amber-800 dark:text-amber-200 font-bold text-sm transition"
              >
                🤔 Médio
              </button>
              <button
                onClick={() => saveDifficulty(pendingDifficultyTopic.id, 'dificil')}
                className="py-3.5 px-3 rounded-2xl bg-rose-500/15 hover:bg-rose-600 hover:text-white text-rose-800 dark:text-rose-200 font-bold text-sm transition"
              >
                🔥 Difícil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
