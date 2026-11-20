'use client';

import React, { useState } from 'react';
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
  Plus,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '', label: 'Início', icon: Home },
  { href: '/ciclo', label: 'Ciclo de Estudos', icon: RefreshCw },
  { href: '/agenda', label: 'Agenda & Notas', icon: CalendarDays },
  { href: '/estudos', label: 'Edital Verticalizado', icon: CheckSquare },
  { href: '/revisoes', label: 'Revisões (1/7/30d)', icon: Clock, badgeKey: 'reviews' as const },
  { href: '/materias', label: 'Matérias & Vídeos', icon: BookOpen },
  { href: '/flashcards', label: 'Flashcards', icon: Layers, badgeKey: 'flashcards' as const },
  { href: '/erros', label: 'Caderno de Erros', icon: AlertTriangle },
  { href: '/evolucao', label: 'Resultados & Evolução', icon: TrendingUp },
  { href: '/relatorios', label: 'Mentor Gemini AI', icon: FileBarChart2 },
  { href: '/mapa', label: 'Mapa de Acertos', icon: Grid3X3 },
  { href: '/simulados', label: 'Simulados', icon: ClipboardCheck },
  { href: '/prioridades', label: 'Prioridades', icon: Star },
  { href: '/config', label: 'Configurações', icon: Settings },
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
    reviews,
    flashcards,
    pauseStopwatch,
    startStopwatch,
    resetStopwatch,
  } = useProfile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSwitchGuard, setShowSwitchGuard] = useState(false);

  const basePath = `/p/${profileId}`;
  const activeSubject = subjects.find((s) => s.id === stopwatch.subjectId);
  const today = todayISO();
  const dueReviewsCount = reviews.filter((r) => !r.completed && r.due_date <= today).length;
  const dueFlashcardsCount = flashcards.filter((c) => c.due_date <= today).length;

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

  const sidebarContent = (
    <div className="flex flex-col h-full sidebar-surface">
      {/* Cabeçalho do Perfil na Sidebar */}
      <div className="p-4 border-b border-theme">
        <div className="rounded-2xl p-3 bg-gradient-to-br from-teal-600/12 to-indigo-600/10 border border-teal-500/20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl card-surface flex items-center justify-center text-2xl shrink-0 shadow-xs">
              {profile?.icon || '🎯'}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm truncate">{profile?.name || 'Concurso'}</p>
              <p className="text-xs text-muted-theme truncate">
                {profile?.role_title || 'Plano de Estudos'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-2 rounded-xl subtle-surface"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={() => {
            if (stopwatch.subjectId && (stopwatch.running || stopwatch.elapsedSeconds > 0)) {
              setShowSwitchGuard(true);
            } else {
              router.push('/');
            }
          }}
          className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-bold py-2.5 px-3.5 rounded-2xl subtle-surface hover:opacity-85"
        >
          <ArrowLeftRight className="w-4 h-4 text-teal-600" />
          Trocar de Concurso
        </button>
      </div>

      {/* Menu animado com badges ao vivo */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {NAV_ITEMS.map((item) => {
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
              onClick={() => setMobileOpen(false)}
              className={`group flex items-center justify-between gap-3 px-4 py-3 rounded-2xl text-sm font-semibold ${
                isActive ? 'sidebar-item-active' : 'sidebar-item'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-[18px] h-[18px] shrink-0 transition-transform duration-200 ${
                    isActive ? 'scale-110' : 'group-hover:scale-110'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {badgeCount > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${
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
      </nav>

      {/* Seletor de Tema */}
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
    </div>
  );

  return (
    <div className="min-h-screen flex">
      <aside className="hidden lg:block w-72 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[84vw] h-full animate-fade-in-up">{sidebarContent}</div>
          <div
            className="flex-1 bg-black/45 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 card-surface border-b px-4 sm:px-7 py-3.5 flex items-center justify-between gap-3 rounded-none">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2.5 rounded-2xl subtle-surface"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-base font-bold truncate">
                {profile?.icon} {profile?.name}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {stopwatch.subjectId && (
              <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-teal-500/12 border border-teal-500/30 text-xs">
                <span className="font-bold text-teal-800 dark:text-teal-300 hidden sm:inline truncate max-w-[140px]">
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
                >
                  {stopwatch.running ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}

            <Link
              href={`${basePath}/ciclo`}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Adicionar Estudo
            </Link>

            <div
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold ${
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

        <main key={pathname} className="flex-1 p-5 sm:p-8 max-w-7xl w-full mx-auto animate-fade-in-up">
          {children}
        </main>
      </div>

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
                className="w-full py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold text-left"
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
