'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAiProviderName } from '@/lib/useAiProvider';
import { useProfile } from './ProfileProvider';
import { useGlobal } from './GlobalProvider';
import { formatDurationHMS, todayISO } from '@/lib/utils';
import type { ThemeId } from '@/lib/types';
import { getStudyMode } from '@/lib/studyModes';
import { dispatchDictionaryUpdated, type DictEntryLite } from './DictionaryText';
import { syncDictionaryToCloud } from '@/lib/dictSync';
import { findSimilarItems } from '@/lib/similarity';
import { DuplicateWarningBanner } from './DuplicateWarningBanner';
import {
  Home,
  RefreshCw,
  CalendarDays,
  CheckSquare,
  Clock,
  BookOpen,
  AlertTriangle,
  TrendingUp,
  FileBarChart2,
  Grid3X3,
  ClipboardCheck,
  Star,
  Settings,
  Menu,
  X,
  ArrowLeftRight,
  CheckCircle2,
  Cloud,
  Pause,
  Play,
  Square,
  Palette,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  FileText,
  Highlighter,
  ChevronDown,
  ChevronRight,
  ListChecks,
  BookA,
  Scale,
  Sparkles,
  Loader2,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeKey?: 'reviews' | 'flashcards';
}

const GROUP_ACCENTS: Record<
  string,
  { dot: string; headerText: string; headerBg: string; iconText: string; cardBorder: string }
> = {
  Estudar: {
    dot: 'bg-teal-500',
    headerText: 'text-teal-700 dark:text-teal-300',
    headerBg: 'bg-teal-500/10',
    iconText: 'text-teal-600 dark:text-teal-400',
    cardBorder: 'border-teal-500/20',
  },
  Revisar: {
    dot: 'bg-amber-500',
    headerText: 'text-amber-700 dark:text-amber-300',
    headerBg: 'bg-amber-500/10',
    iconText: 'text-amber-600 dark:text-amber-400',
    cardBorder: 'border-amber-500/20',
  },
  Desempenho: {
    dot: 'bg-indigo-500',
    headerText: 'text-indigo-700 dark:text-indigo-300',
    headerBg: 'bg-indigo-500/10',
    iconText: 'text-indigo-600 dark:text-indigo-400',
    cardBorder: 'border-indigo-500/20',
  },
  Ferramentas: {
    dot: 'bg-violet-500',
    headerText: 'text-violet-700 dark:text-violet-300',
    headerBg: 'bg-violet-500/10',
    iconText: 'text-violet-600 dark:text-violet-400',
    cardBorder: 'border-violet-500/20',
  },
};

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Estudar',
    items: [
      { href: '', label: 'Início', icon: Home },
      { href: '/ciclo', label: 'Ciclo de Estudos', icon: RefreshCw },
      { href: '/agenda', label: 'Agenda & Notas', icon: CalendarDays },
      { href: '/estudos', label: 'Edital Verticalizado', icon: CheckSquare },
      { href: '/lei-seca', label: 'Lei Seca', icon: Scale },
    ],
  },
  {
    title: 'Revisar',
    items: [
      { href: '/revisoes', label: 'Revisões (1/7/30/90d)', icon: Clock, badgeKey: 'reviews' },
      { href: '/flashcards', label: 'Flashcards', icon: Layers, badgeKey: 'flashcards' },
      { href: '/questoes', label: 'Questões (Quiz)', icon: ListChecks },
      { href: '/erros', label: 'Caderno de Erros', icon: AlertTriangle },
      { href: '/dicionario', label: 'Dicionário', icon: BookA },
    ],
  },
  {
    title: 'Desempenho',
    items: [
      { href: '/evolucao', label: 'Resultados & Evolução', icon: TrendingUp },
      { href: '/mapa', label: 'Mapa de Acertos', icon: Grid3X3 },
      { href: '/simulados', label: 'Simulados', icon: ClipboardCheck },
      { href: '/prioridades', label: 'Prioridades', icon: Star },
    ],
  },
  {
    title: 'Ferramentas',
    items: [
      { href: '/relatorios', label: 'Mentor Gemini AI', icon: FileBarChart2 },
      { href: '/config', label: 'Configurações & Backup', icon: Settings },
    ],
  },
];

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'clean', label: 'Claro Clean' },
  { id: 'sepia', label: 'Sépia Papel' },
  { id: 'obsidian', label: 'Escuro Obsidian' },
  { id: 'navy', label: 'Azul Noturno' },
];

export function AppShell({
  profileId,
  children,
}: {
  profileId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    userId,
    profile,
    loading,
    syncing,
    theme,
    setTheme,
    stopwatch,
    subjects,
    topics,
    highlights,
    reviews,
    flashcards,
    errors,
    pauseStopwatch,
    startStopwatch,
    resetStopwatch,
  } = useProfile();
  const aiName = useAiProviderName();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [showSwitchGuard, setShowSwitchGuard] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const { notify } = useGlobal();
  const [searchQuery, setSearchQuery] = useState('');

  // Seleção / Botão direito -> Adicionar palavra ao Dicionário
  const [selDictMenu, setSelDictMenu] = useState<{ text: string; x: number; y: number } | null>(null);
  const [quickDictOpen, setQuickDictOpen] = useState(false);
  const [quickDictWord, setQuickDictWord] = useState('');
  const [quickDictMeaning, setQuickDictMeaning] = useState('');
  const [quickDictExample, setQuickDictExample] = useState('');
  const [quickDictSubjectId, setQuickDictSubjectId] = useState('');
  const [quickDictAiBusy, setQuickDictAiBusy] = useState(false);
  const [quickDictConfirmDup, setQuickDictConfirmDup] = useState(false);
  const [quickDictExisting, setQuickDictExisting] = useState<DictEntryLite[]>([]);

  const basePath = `/p/${profileId}`;

  useEffect(() => {
    try {
      if (profileId) localStorage.setItem('sf_last_profile_id', profileId);
    } catch {
      // ignore
    }
  }, [profileId]);
  const studyMode = getStudyMode(profile);
  const activeSubject = subjects.find((s) => s.id === stopwatch.subjectId);
  const today = todayISO();
  const dueReviewsCount = reviews.filter((r) => !r.completed && r.due_date <= today).length;
  const dueFlashcardsCount = flashcards.filter((c) => c.due_date <= today).length;

  useEffect(() => {
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
      if (e.altKey && e.key.toLowerCase() === 'p' && stopwatch.subjectId) {
        e.preventDefault();
        if (stopwatch.running) pauseStopwatch();
        else startStopwatch(stopwatch.subjectId, stopwatch.topicId);
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [stopwatch.subjectId, stopwatch.running, stopwatch.topicId, pauseStopwatch, startStopwatch]);

  useEffect(() => {
    const captureSelection = (clientX?: number, clientY?: number) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')
      ) {
        return;
      }
      const sel = window.getSelection();
      const raw = sel ? sel.toString().replace(/\s+/g, ' ').trim() : '';
      if (!raw || raw.length < 2 || raw.length > 65) {
        setSelDictMenu(null);
        return;
      }
      let x = clientX ?? window.innerWidth / 2;
      let y = clientY ?? 120;
      if ((clientX === undefined || clientY === undefined) && sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          x = rect.left + rect.width / 2;
          y = rect.top - 10;
        }
      }
      const clampedX = Math.max(110, Math.min(window.innerWidth - 110, x));
      const clampedY = Math.max(56, Math.min(window.innerHeight - 60, y));
      setSelDictMenu({ text: raw, x: clampedX, y: clampedY });
    };

    const onMouseUp = (e: MouseEvent) => {
      // Ignora clique dentro do próprio botão flutuante
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-dict-pill="true"]')) return;
      window.setTimeout(() => captureSelection(), 20);
    };
    const onTouchEnd = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-dict-pill="true"]')) return;
      window.setTimeout(() => captureSelection(), 120);
    };
    const onContextMenu = (e: MouseEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      const sel = window.getSelection();
      const raw = sel ? sel.toString().replace(/\s+/g, ' ').trim() : '';
      if (raw && raw.length >= 2 && raw.length <= 65) {
        e.preventDefault();
        captureSelection(e.clientX, e.clientY);
      }
    };

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('contextmenu', onContextMenu);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  function openQuickDictModal(selectedText: string) {
    setSelDictMenu(null);
    setQuickDictWord(selectedText);
    setQuickDictMeaning('');
    setQuickDictExample('');
    setQuickDictSubjectId('');
    setQuickDictConfirmDup(false);
    try {
      const dictKey = `sf_dictionary_${profile?.id || 'default'}`;
      const raw = localStorage.getItem(dictKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setQuickDictExisting(Array.isArray(parsed) ? parsed : []);
    } catch {
      setQuickDictExisting([]);
    }
    setQuickDictOpen(true);
  }

  const quickDictMatches = useMemo(() => {
    if (!quickDictOpen || !quickDictWord.trim()) return [];
    return findSimilarItems(quickDictWord, quickDictExisting, (e) => e.word, 'short', 3);
  }, [quickDictOpen, quickDictWord, quickDictExisting]);

  async function generateQuickDictMeaning(targetWord: string): Promise<{ corrected_word?: string; meaning: string; example?: string } | null> {
    if (!targetWord.trim()) return null;
    setQuickDictAiBusy(true);
    try {
      const sub = subjects.find((s) => s.id === quickDictSubjectId);
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'define_word',
          word: targetWord.trim(),
          subjectName: sub?.name || '',
          profileName: profile?.name || '',
          roleTitle: profile?.role_title || '',
          subjectsContext: subjects.map((s) => s.name).slice(0, 12).join(', '),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data?.meaning) {
        throw new Error(json.error || 'Erro ao gerar significado com Gemini.');
      }
      return {
        corrected_word: json.data.corrected_word ? String(json.data.corrected_word).trim() : undefined,
        meaning: String(json.data.meaning).trim(),
        example: json.data.example ? String(json.data.example).trim() : undefined,
      };
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao consultar o Gemini.', 'error');
      return null;
    } finally {
      setQuickDictAiBusy(false);
    }
  }

  async function saveQuickDictConfirmed() {
    if (!quickDictWord.trim() || !profile?.id) return;
    let finalWord = quickDictWord.trim();
    let finalMeaning = quickDictMeaning.trim();
    let finalExample = quickDictExample.trim();

    if (!finalMeaning) {
      const aiData = await generateQuickDictMeaning(finalWord);
      if (!aiData) return;
      if (aiData.corrected_word) finalWord = aiData.corrected_word;
      finalMeaning = aiData.meaning;
      if (!finalExample && aiData.example) finalExample = aiData.example;
    }

    const dictKey = `sf_dictionary_${profile.id}`;
    try {
      const raw = localStorage.getItem(dictKey);
      const prev = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(prev) ? prev : [];
      const next = [
        ...arr,
        {
          id: `dict-${Date.now()}`,
          word: finalWord,
          meaning: finalMeaning,
          example: finalExample || undefined,
          subject_id: quickDictSubjectId || undefined,
          created_at: new Date().toISOString(),
        },
      ].sort((a, b) => a.word.localeCompare(b.word, 'pt-BR', { sensitivity: 'base' }));
      localStorage.setItem(dictKey, JSON.stringify(next));
      dispatchDictionaryUpdated();
      if (userId && profile?.id) {
        void syncDictionaryToCloud(userId, profile.id, next);
      }
      setQuickDictConfirmDup(false);
      setQuickDictOpen(false);
      notify(`"${finalWord}" adicionado ao Dicionário!`, 'success');
    } catch {
      notify('Não foi possível salvar no Dicionário.', 'error');
    }
  }

  async function handleSaveQuickDict(e: React.FormEvent) {
    e.preventDefault();
    if (!quickDictWord.trim() || !profile?.id) return;
    if (quickDictMatches.length > 0 && !quickDictConfirmDup) {
      setQuickDictConfirmDup(true);
      return;
    }
    await saveQuickDictConfirmed();
  }

  const searchResults = useMemo(() => {
    const rawQ = searchQuery.trim();
    if (rawQ.length < 2) return [];

    const normText = (s: string) =>
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\bartigo\b/g, 'art')
        .replace(/[.,;:º°ª()\[\]\-\/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const qTokens = normText(rawQ).split(' ').filter(Boolean);
    if (qTokens.length === 0) return [];

    const smartMatch = (hay: string) => {
      const n = normText(hay);
      return qTokens.every((t) => n.includes(t));
    };

    const out: {
      id: string;
      type: 'Matéria' | 'Tópico' | 'PDF' | 'Grifo' | 'Flashcard' | 'Erro' | 'Dicionário' | 'Lei Seca';
      title: string;
      subtitle: string;
      href: string;
    }[] = [];

    // Busca na Lei Seca (artigos e blocos salvos)
    try {
      const rawLs = localStorage.getItem(`sf_lei_seca_${profile?.id || 'default'}`);
      const lsItems = rawLs ? JSON.parse(rawLs) : [];
      if (Array.isArray(lsItems)) {
        const numM = rawQ.match(/\d+(?:-[A-Za-z]+)?/);
        const exactArtRe = numM
          ? new RegExp(`\\bArt\\.?\\s*${numM[0]}[º°oª]?(?:-[A-Za-z]+)?[^\n]{0,110}`, 'i')
          : null;

        lsItems.forEach((a: { id: string; title?: string; lawName?: string; rawText?: string; note?: string }) => {
          const fullHay = `${a.title || ''} ${a.lawName || ''} ${a.rawText || ''} ${a.note || ''}`;
          if (smartMatch(fullHay)) {
            const artSnippet = exactArtRe ? (a.rawText || '').match(exactArtRe)?.[0] : null;
            const cleanSnippet = artSnippet
              ? artSnippet.replace(/\s+/g, ' ').trim()
              : (a.rawText || '').replace(/\s+/g, ' ').slice(0, 100);
            const artParam = numM ? `Art. ${numM[0]}` : '';
            const params = new URLSearchParams();
            params.set('id', a.id);
            if (artParam) params.set('art', artParam);
            if (a.lawName) params.set('law', a.lawName);
            out.push({
              id: `ls-${a.id}`,
              type: 'Lei Seca',
              title: `${a.title || 'Lei Seca'}${a.lawName ? ` · ${a.lawName}` : ''}`,
              subtitle: cleanSnippet,
              href: `${basePath}/lei-seca?${params.toString()}`,
            });
          }
        });
      }
    } catch {
      // ignore
    }

    subjects.forEach((s) => {
      if (smartMatch(s.name)) {
        out.push({
          id: `sub-${s.id}`,
          type: 'Matéria',
          title: s.name,
          subtitle: s.category,
          href: `${basePath}/ciclo`,
        });
      }
    });

    topics.forEach((t) => {
      const sub = subjects.find((s) => s.id === t.subject_id);
      if (smartMatch(t.title)) {
        out.push({
          id: `top-${t.id}`,
          type: 'Tópico',
          title: t.title,
          subtitle: sub?.name || 'Edital',
          href: `${basePath}/estudos`,
        });
      }
      if (t.pdf_name && smartMatch(t.pdf_name)) {
        out.push({
          id: `pdf-${t.id}`,
          type: 'PDF',
          title: t.pdf_name,
          subtitle: `${sub?.name || ''} · ${t.title}`,
          href: `${basePath}/estudos`,
        });
      }
    });

    highlights.forEach((h) => {
      if (smartMatch(`${h.text} ${h.note}`)) {
        const t = topics.find((tp) => tp.id === h.topic_id);
        out.push({
          id: `hl-${h.id}`,
          type: 'Grifo',
          title: h.text.slice(0, 90),
          subtitle: t?.title || 'Grifo salvo',
          href: `${basePath}/estudos`,
        });
      }
    });

    try {
      const rawDict = localStorage.getItem(`sf_dictionary_${profile?.id || 'default'}`);
      const dictEntries = rawDict ? JSON.parse(rawDict) : [];
      if (Array.isArray(dictEntries)) {
        dictEntries.forEach((d: DictEntryLite) => {
          const hay = `${d.word || ''} ${d.meaning || ''} ${d.example || ''}`;
          if (smartMatch(hay)) {
            const sub = subjects.find((s) => s.id === d.subject_id);
            out.push({
              id: `dict-${d.id}`,
              type: 'Dicionário',
              title: d.word,
              subtitle: `${sub?.name ? sub.name + ' · ' : ''}${(d.meaning || '').slice(0, 80)}`,
              href: `${basePath}/dicionario?q=${encodeURIComponent(d.word)}`,
            });
          }
        });
      }
    } catch {
      // ignore
    }

    flashcards.forEach((c) => {
      if (smartMatch(`${c.front} ${c.back}`)) {
        const sub = subjects.find((s) => s.id === c.subject_id);
        out.push({
          id: `fc-${c.id}`,
          type: 'Flashcard',
          title: c.front.slice(0, 90),
          subtitle: sub?.name || 'Flashcards',
          href: `${basePath}/flashcards`,
        });
      }
    });

    errors.forEach((er) => {
      if (smartMatch(`${er.question_text} ${er.golden_rule} ${er.explanation}`)) {
        const sub = subjects.find((s) => s.id === er.subject_id);
        out.push({
          id: `err-${er.id}`,
          type: 'Erro',
          title: (er.golden_rule || er.question_text || 'Questão errada').slice(0, 90),
          subtitle: `${sub?.name || ''} · ${er.error_cause}`,
          href: `${basePath}/erros`,
        });
      }
    });

    return out.slice(0, 20);
  }, [searchQuery, subjects, topics, highlights, flashcards, errors, basePath, profile?.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-muted-theme">Sincronizando seus estudos...</p>
        </div>
      </div>
    );
  }

  function handleSwitchProfileClick() {
    if (stopwatch.subjectId && (stopwatch.running || stopwatch.elapsedSeconds > 0)) {
      setShowSwitchGuard(true);
    } else {
      router.push('/?choose=1');
    }
  }

  const renderSidebar = (isMobile = false) => {
    const compact = !isMobile && collapsed;

    return (
      <div className="flex flex-col h-full sidebar-surface">
        <div className="p-3.5 border-b border-theme">
          <div
            title={`${profile?.name || 'Concurso'} — ${profile?.role_title || ''}`}
            className={`rounded-2xl p-2.5 bg-teal-600/8 border border-teal-500/20 flex items-start justify-between gap-2 ${
              compact ? 'justify-center' : ''
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl card-surface flex items-center justify-center text-xl shrink-0">
                {profile?.icon || '🎯'}
              </div>
              {!compact && (
                <div className="min-w-0">
                  <p className="font-bold text-sm leading-snug">{profile?.name || 'Concurso'}</p>
                  <p className="text-xs text-muted-theme leading-snug line-clamp-2 mt-0.5">
                    {profile?.role_title || 'Plano de Estudos'}
                  </p>
                </div>
              )}
            </div>
            {isMobile && (
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-xl subtle-surface shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className={`mt-2.5 flex items-center gap-2 ${compact ? 'flex-col' : ''}`}>
            <button
              onClick={handleSwitchProfileClick}
              title="{studyMode.switchProfileLabel}"
              className={`flex-1 flex items-center justify-center gap-2 text-xs font-bold py-2 px-3 rounded-xl subtle-surface hover:opacity-85 ${
                compact ? 'w-full px-2' : ''
              }`}
            >
              <ArrowLeftRight className="w-4 h-4 text-teal-600 shrink-0" />
              {!compact && <span>{studyMode.switchProfileLabel}</span>}
            </button>

            {!isMobile && (
              <button
                onClick={() => setCollapsed((v) => !v)}
                title={compact ? 'Expandir menu' : 'Recolher menu'}
                className="p-2 rounded-xl subtle-surface hover:opacity-85 text-muted-theme shrink-0"
              >
                {compact ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
          {NAV_GROUPS.map((group) => {
            const isGroupOpen = compact ? true : (openGroups[group.title] ?? false);
            const accent = GROUP_ACCENTS[group.title] || GROUP_ACCENTS.Estudar;
            const groupBadge = group.items.reduce((acc, it) => {
              if (it.badgeKey === 'reviews') return acc + dueReviewsCount;
              if (it.badgeKey === 'flashcards') return acc + dueFlashcardsCount;
              return acc;
            }, 0);

            return (
              <div
                key={group.title}
                className={
                  compact
                    ? 'space-y-1 pb-2 border-b border-theme/60 last:border-b-0'
                    : `rounded-2xl border ${accent.cardBorder} bg-[var(--bg-subtle)]/45 p-1.5 space-y-1`
                }
              >
                {!compact && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((prev) => ({ ...prev, [group.title]: !isGroupOpen }))
                    }
                    className={`w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between text-[10.5px] font-black uppercase tracking-widest ${accent.headerText} ${accent.headerBg} hover:opacity-90 transition`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${accent.dot}`} />
                      {group.title}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {!isGroupOpen && groupBadge > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--bg-card)] shadow-2xs">
                          {groupBadge}
                        </span>
                      )}
                      {isGroupOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 opacity-80" />
                      )}
                    </span>
                  </button>
                )}
                {isGroupOpen && (
                  <div className={compact ? 'space-y-1' : 'space-y-0.5 pt-0.5 pl-1'}>
                    {group.items
                      .filter((item) => {
                        if (item.href === '/simulados' && !studyMode.showSimulados) return false;
                        if (item.href === '/mapa' && !studyMode.showMapa) return false;
                        return true;
                      })
                      .map((item) => {
                        const fullHref = `${basePath}${item.href}`;
                        const isActive =
                          item.href === '' ? pathname === basePath : pathname.startsWith(fullHref);
                        const Icon = item.icon;
                        const badgeCount =
                          item.badgeKey === 'reviews'
                            ? dueReviewsCount
                            : item.badgeKey === 'flashcards'
                            ? dueFlashcardsCount
                            : 0;

                        return (
                          <Link
                            key={item.href}
                            href={fullHref}
                            title={
                              item.href === '/estudos'
                                ? studyMode.syllabusNavLabel
                                : item.href === '/simulados'
                                ? studyMode.simuladosNavLabel
                                : item.href === '/relatorios'
                                ? `Mentor ${aiName} AI`
                                : item.label
                            }
                            onClick={() => setMobileOpen(false)}
                            className={`group flex items-center ${
                              compact ? 'justify-center px-2' : 'justify-between px-3'
                            } gap-2.5 py-2 rounded-xl text-[13px] font-semibold transition ${
                              isActive ? 'sidebar-item-active shadow-xs' : 'sidebar-item'
                            }`}
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <Icon
                                className={`w-4 h-4 shrink-0 ${isActive ? '' : accent.iconText}`}
                              />
                              {!compact && (
                                <span className="truncate">
                                  {item.href === '/estudos'
                                    ? studyMode.syllabusNavLabel
                                    : item.href === '/simulados'
                                    ? studyMode.simuladosNavLabel
                                    : item.href === '/relatorios'
                                    ? `Mentor ${aiName} AI`
                                    : item.label}
                                </span>
                              )}
                            </span>
                            {!compact && badgeCount > 0 && (
                              <span
                                className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                  isActive
                                    ? 'bg-white/20 text-white'
                                    : 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                                }`}
                              >
                                {badgeCount}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {!compact && (
          <div className="p-3.5 border-t border-theme">
            <div className="flex items-center gap-2.5 text-xs">
              <Palette className="w-4 h-4 text-muted-theme shrink-0" />
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as ThemeId)}
                className="w-full subtle-surface border border-theme rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none cursor-pointer"
              >
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex">
      <aside
        className={`hidden lg:block shrink-0 sticky top-0 h-screen transition-all duration-200 ${
          collapsed ? 'w-20' : 'w-72'
        }`}
      >
        {renderSidebar(false)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[85vw] h-full animate-fade-in-up">
            {renderSidebar(true)}
          </div>
          <div
            className="flex-1 bg-black/45 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 card-surface border-b px-4 sm:px-7 py-3 flex items-center justify-between gap-3 rounded-none">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2.5 rounded-2xl subtle-surface"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowSearch(true)}
              className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl subtle-surface border border-theme text-xs text-muted-theme hover:opacity-85 min-w-[140px] sm:min-w-[240px]"
            >
              <Search className="w-4 h-4 shrink-0" />
              <span className="truncate">Buscar matéria, tópico, PDF, erro...</span>
              <kbd className="hidden md:inline ml-auto text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">
                Ctrl K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            {stopwatch.subjectId && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-500/12 border border-teal-500/30 text-xs">
                <span className="font-bold text-teal-800 dark:text-teal-300 hidden md:inline truncate max-w-[140px]">
                  {activeSubject?.name}
                </span>
                <span className="font-mono text-sm font-extrabold">
                  {formatDurationHMS(stopwatch.elapsedSeconds)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    stopwatch.running
                      ? pauseStopwatch()
                      : startStopwatch(stopwatch.subjectId!, stopwatch.topicId)
                  }
                  className="p-1.5 rounded-full bg-teal-600 hover:bg-teal-500 text-white"
                  title={stopwatch.running ? 'Pausar' : 'Retomar'}
                >
                  {stopwatch.running ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      stopwatch.elapsedSeconds > 15 &&
                      !window.confirm('Parar e descartar esta sessão sem salvar?')
                    ) {
                      return;
                    }
                    resetStopwatch();
                  }}
                  className="p-1.5 rounded-full bg-rose-500/15 hover:bg-rose-600 text-rose-600 hover:text-white transition"
                  title="Parar / desistir desta sessão"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              </div>
            )}

            <div
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold ${
                !isOnline
                  ? 'bg-rose-500/15 text-rose-700'
                  : syncing
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {!isOnline ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  <span className="hidden sm:inline">Sem conexão — tentando novamente</span>
                </>
              ) : syncing ? (
                <>
                  <Cloud className="w-4 h-4 animate-pulse" />
                  <span className="hidden sm:inline">Salvando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Salvo</span>
                </>
              )}
            </div>
          </div>
        </header>

        <main
          key={pathname}
          className="flex-1 p-5 sm:p-8 pb-24 lg:pb-8 max-w-7xl w-full mx-auto"
        >
          {children}
        </main>
      </div>

      {/* Barra Inferior Mobile */}
      <nav
        id="mobile-bottom-nav"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 card-surface border-t px-2 py-1.5 flex items-center justify-around rounded-none"
      >
        {[
          { href: '', label: 'Início', icon: Home },
          { href: '/ciclo', label: 'Ciclo', icon: RefreshCw },
          { href: '/revisoes', label: 'Revisões', icon: Clock, badge: dueReviewsCount },
          { href: '/estudos', label: 'Edital', icon: CheckSquare },
        ].map((tab) => {
          const full = `${basePath}${tab.href}`;
          const active = tab.href === '' ? pathname === basePath : pathname.startsWith(full);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={full}
              className={`relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] font-bold ${
                active ? 'text-teal-600' : 'text-muted-theme'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{tab.label}</span>
              {tab.badge ? (
                <span className="absolute top-0.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-teal-600 text-white text-[10px] flex items-center justify-center">
                  {tab.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
        <button
          onClick={() => setMobileOpen(true)}
          className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-muted-theme"
        >
          <Menu className="w-5 h-5" />
          <span>Mais</span>
        </button>
      </nav>

      {/* Modal Busca Global (Ctrl+K) */}
      {showSearch && (
        <div
          onClick={() => setShowSearch(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start justify-center p-4 pt-16 sm:pt-24"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card-surface w-full max-w-xl rounded-3xl overflow-hidden shadow-2xl animate-pop-in"
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-theme">
              <Search className="w-5 h-5 text-teal-600 shrink-0" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquisar em matérias, tópicos, PDFs, grifos, flashcards e erros..."
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
              <button
                onClick={() => setShowSearch(false)}
                className="p-1.5 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto p-3 space-y-1.5">
              {searchQuery.trim().length < 2 ? (
                <p className="text-xs text-muted-theme text-center py-8">
                  Digite pelo menos 2 letras para buscar em todo o seu concurso.
                </p>
              ) : searchResults.length === 0 ? (
                <p className="text-xs text-muted-theme text-center py-8">
                  Nenhum resultado encontrado para &ldquo;{searchQuery}&rdquo;.
                </p>
              ) : (
                searchResults.map((res) => (
                  <button
                    key={res.id}
                    onClick={() => {
                      setShowSearch(false);
                      setSearchQuery('');
                      router.push(res.href);
                    }}
                    className="w-full text-left rounded-2xl p-3 subtle-surface hover:opacity-85 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{res.title}</p>
                      <p className="text-xs text-muted-theme truncate">{res.subtitle}</p>
                    </div>
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full card-surface shrink-0 inline-flex items-center gap-1">
                      {res.type === 'PDF' && <FileText className="w-3 h-3 text-blue-600" />}
                      {res.type === 'Grifo' && <Highlighter className="w-3 h-3 text-amber-500" />}
                      {res.type === 'Dicionário' && <BookA className="w-3 h-3 text-teal-600" />}
                      {res.type}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showSwitchGuard && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl animate-pop-in">
            <h2 className="text-lg font-bold">Cronômetro ativo em andamento</h2>
            <p className="text-sm text-muted-theme leading-relaxed">
              Você está com <strong>{formatDurationHMS(stopwatch.elapsedSeconds)}</strong> marcados em{' '}
              <strong>{activeSubject?.name || 'uma matéria'}</strong>. O que deseja fazer antes de trocar de concurso?
            </p>
            <div className="space-y-2.5 pt-1">
              <button
                onClick={() => {
                  pauseStopwatch();
                  setShowSwitchGuard(false);
                  router.push('/?choose=1');
                }}
                className="w-full py-3 px-4 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold text-left"
              >
                ⏸️ Pausar cronômetro e trocar de concurso
              </button>
              <button
                onClick={() => {
                  setShowSwitchGuard(false);
                  router.push('/?choose=1');
                }}
                className="w-full py-3 px-4 rounded-2xl subtle-surface text-sm font-semibold text-left border border-theme"
              >
                ▶️ Continuar rodando e trocar de concurso
              </button>
              <button
                onClick={() => {
                  resetStopwatch();
                  setShowSwitchGuard(false);
                  router.push('/?choose=1');
                }}
                className="w-full py-3 px-4 rounded-2xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 text-sm font-semibold text-left"
              >
                🗑️ Cancelar (zerar) cronômetro e trocar
              </button>
              <button
                onClick={() => setShowSwitchGuard(false)}
                className="w-full py-3 px-4 rounded-2xl subtle-surface text-sm font-semibold"
              >
                Voltar e continuar aqui
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Botão flutuante ao selecionar palavra / botão direito -> Dicionário */}
      {selDictMenu && !quickDictOpen && (
        <div
          data-dict-pill="true"
          style={{
            position: 'fixed',
            left: `${selDictMenu.x}px`,
            top: `${selDictMenu.y}px`,
            transform: 'translate(-50%, -100%)',
            zIndex: 60,
          }}
          className="animate-pop-in"
        >
          <div className="rounded-2xl bg-slate-900 dark:bg-teal-600 text-white text-xs font-bold shadow-2xl border border-white/15 inline-flex items-center overflow-hidden">
            <button
              type="button"
              onClick={() => openQuickDictModal(selDictMenu.text)}
              className="px-3.5 py-2 inline-flex items-center gap-1.5 hover:bg-white/10 transition whitespace-nowrap"
            >
              <BookA className="w-3.5 h-3.5 text-teal-300 dark:text-white" />
              Adicionar &ldquo;{selDictMenu.text.slice(0, 22)}
              {selDictMenu.text.length > 22 ? '...' : ''}&rdquo; ao Dicionário
            </button>
            <button
              type="button"
              onClick={() => setSelDictMenu(null)}
              title="Fechar"
              className="px-2 py-2 border-l border-white/15 hover:bg-white/15 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Modal Rápido: Adicionar palavra selecionada ao Dicionário */}
      {quickDictOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div
            className="card-surface w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl border border-theme animate-pop-in"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-base flex items-center gap-2">
                <BookA className="w-5 h-5 text-teal-600" />
                Adicionar ao Dicionário
              </h2>
              <button
                type="button"
                onClick={() => setQuickDictOpen(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQuickDict} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-muted-theme mb-1">
                  Palavra / Termo *
                </label>
                <input
                  required
                  value={quickDictWord}
                  onChange={(e) => {
                    setQuickDictWord(e.target.value);
                    setQuickDictConfirmDup(false);
                  }}
                  className="w-full rounded-xl subtle-surface border border-theme px-3.5 py-2.5 text-sm font-bold"
                />
              </div>

              {quickDictMatches.length > 0 && (
                <DuplicateWarningBanner
                  title="Atenção: já existe palavra igual ou parecida no Dicionário"
                  items={quickDictMatches.map((m) => ({
                    id: m.item.id,
                    label: m.item.word,
                    detail: m.item.meaning?.slice(0, 70),
                    kind: m.kind,
                  }))}
                  pendingConfirm={quickDictConfirmDup}
                  onConfirmAnyway={() => void saveQuickDictConfirmed()}
                  onCancelConfirm={() => setQuickDictConfirmDup(false)}
                />
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-theme mb-1">
                  Matéria (opcional)
                </label>
                <select
                  value={quickDictSubjectId}
                  onChange={(e) => setQuickDictSubjectId(e.target.value)}
                  className="w-full rounded-xl subtle-surface border border-theme px-3.5 py-2 text-xs"
                >
                  <option value="">Geral (sem matéria)</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-xs font-semibold text-muted-theme">
                    Significado (deixe vazio p/ Gemini gerar)
                  </label>
                  <button
                    type="button"
                    disabled={quickDictAiBusy || !quickDictWord.trim()}
                    onClick={async () => {
                      const data = await generateQuickDictMeaning(quickDictWord);
                      if (data) {
                        setQuickDictMeaning(data.meaning);
                        if (data.example && !quickDictExample.trim()) {
                          setQuickDictExample(data.example);
                        }
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-45"
                  >
                    {quickDictAiBusy ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    Gerar com {aiName}
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={quickDictMeaning}
                  onChange={(e) => setQuickDictMeaning(e.target.value)}
                  placeholder="Digite o significado ou deixe em branco para o Gemini preencher automaticamente ao salvar..."
                  className="w-full rounded-xl subtle-surface border border-theme p-3 text-xs leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-theme mb-1">
                  Exemplo (opcional)
                </label>
                <input
                  value={quickDictExample}
                  onChange={(e) => setQuickDictExample(e.target.value)}
                  placeholder="Ex: Aplicação prática do termo..."
                  className="w-full rounded-xl subtle-surface border border-theme px-3.5 py-2 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setQuickDictOpen(false)}
                  className="px-4 py-2 rounded-xl subtle-surface text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={quickDictAiBusy || !quickDictWord.trim()}
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {quickDictAiBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <BookA className="w-3.5 h-3.5" />
                  )}
                  Salvar no Dicionário
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
