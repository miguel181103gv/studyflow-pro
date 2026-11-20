'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useProfile } from './ProfileProvider';
import { formatDurationHMS, todayISO } from '@/lib/utils';
import type { ThemeId } from '@/lib/types';
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
  Palette,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  FileText,
  Highlighter,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeKey?: 'reviews' | 'flashcards';
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Estudar',
    items: [
      { href: '', label: 'Início', icon: Home },
      { href: '/ciclo', label: 'Ciclo de Estudos', icon: RefreshCw },
      { href: '/agenda', label: 'Agenda & Notas', icon: CalendarDays },
      { href: '/estudos', label: 'Edital Verticalizado', icon: CheckSquare },
      { href: '/materias', label: 'Matérias & Vídeos', icon: BookOpen },
    ],
  },
  {
    title: 'Revisar',
    items: [
      { href: '/revisoes', label: 'Revisões (1/7/30d)', icon: Clock, badgeKey: 'reviews' },
      { href: '/flashcards', label: 'Flashcards', icon: Layers, badgeKey: 'flashcards' },
      { href: '/erros', label: 'Caderno de Erros', icon: AlertTriangle },
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

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showSwitchGuard, setShowSwitchGuard] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const basePath = `/p/${profileId}`;
  const activeSubject = subjects.find((s) => s.id === stopwatch.subjectId);
  const today = todayISO();
  const dueReviewsCount = reviews.filter((r) => !r.completed && r.due_date <= today).length;
  const dueFlashcardsCount = flashcards.filter((c) => c.due_date <= today).length;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];

    const out: {
      id: string;
      type: 'Matéria' | 'Tópico' | 'PDF' | 'Grifo' | 'Flashcard' | 'Erro';
      title: string;
      subtitle: string;
      href: string;
    }[] = [];

    subjects.forEach((s) => {
      if (s.name.toLowerCase().includes(q)) {
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
      if (t.title.toLowerCase().includes(q)) {
        out.push({
          id: `top-${t.id}`,
          type: 'Tópico',
          title: t.title,
          subtitle: sub?.name || 'Edital',
          href: `${basePath}/estudos`,
        });
      }
      if (t.pdf_name && t.pdf_name.toLowerCase().includes(q)) {
        out.push({
          id: `pdf-${t.id}`,
          type: 'PDF',
          title: t.pdf_name,
          subtitle: `${sub?.name || ''} · ${t.title}`,
          href: `${basePath}/materias`,
        });
      }
    });

    highlights.forEach((h) => {
      if (h.text.toLowerCase().includes(q) || h.note.toLowerCase().includes(q)) {
        const t = topics.find((tp) => tp.id === h.topic_id);
        out.push({
          id: `hl-${h.id}`,
          type: 'Grifo',
          title: h.text.slice(0, 90),
          subtitle: t?.title || 'Grifo salvo',
          href: `${basePath}/materias`,
        });
      }
    });

    flashcards.forEach((c) => {
      if (c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)) {
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
      if (
        er.question_text.toLowerCase().includes(q) ||
        er.golden_rule.toLowerCase().includes(q) ||
        er.explanation.toLowerCase().includes(q)
      ) {
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
  }, [searchQuery, subjects, topics, highlights, flashcards, errors, basePath]);

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
      router.push('/');
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
              title="Trocar de Concurso"
              className={`flex-1 flex items-center justify-center gap-2 text-xs font-bold py-2 px-3 rounded-xl subtle-surface hover:opacity-85 ${
                compact ? 'w-full px-2' : ''
              }`}
            >
              <ArrowLeftRight className="w-4 h-4 text-teal-600 shrink-0" />
              {!compact && <span>Trocar de Concurso</span>}
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

        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1">
              {!compact && (
                <p className="px-3 text-[11px] font-extrabold uppercase tracking-wider text-muted-theme">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => {
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
                    title={item.label}
                    onClick={() => setMobileOpen(false)}
                    className={`group flex items-center ${
                      compact ? 'justify-center px-2' : 'justify-between px-3.5'
                    } gap-3 py-2.5 rounded-2xl text-sm font-semibold ${
                      isActive ? 'sidebar-item-active' : 'sidebar-item'
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`w-[18px] h-[18px] shrink-0 transition-transform duration-200 ${
                          isActive ? 'scale-110' : 'group-hover:scale-110'
                        }`}
                      />
                      {!compact && <span className="truncate">{item.label}</span>}
                    </span>
                    {!compact && badgeCount > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold shrink-0 ${
                          isActive
                            ? 'bg-white/25 text-white'
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
          ))}
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
              </div>
            )}

            <div
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold ${
                syncing
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {syncing ? (
                <>
                  <Cloud className="w-4 h-4 animate-pulse" />
                  <span className="hidden sm:inline">Salvando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Sincronizado</span>
                </>
              )}
            </div>
          </div>
        </header>

        <main
          key={pathname}
          className="flex-1 p-5 sm:p-8 pb-24 lg:pb-8 max-w-7xl w-full mx-auto animate-fade-in-up"
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
                  router.push('/');
                }}
                className="w-full py-3 px-4 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold text-left"
              >
                ⏸️ Pausar cronômetro e trocar de concurso
              </button>
              <button
                onClick={() => {
                  setShowSwitchGuard(false);
                  router.push('/');
                }}
                className="w-full py-3 px-4 rounded-2xl subtle-surface text-sm font-semibold text-left border border-theme"
              >
                ▶️ Continuar rodando e trocar de concurso
              </button>
              <button
                onClick={() => {
                  resetStopwatch();
                  setShowSwitchGuard(false);
                  router.push('/');
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
    </div>
  );
}
