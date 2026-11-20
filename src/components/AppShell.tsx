'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useProfile } from './ProfileProvider';
import { formatDurationHMS } from '@/lib/utils';
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
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '', label: 'Início', icon: Home },
  { href: '/ciclo', label: 'Ciclo de Estudos', icon: RefreshCw },
  { href: '/agenda', label: 'Agenda & Notas', icon: CalendarDays },
  { href: '/estudos', label: 'Edital Verticalizado', icon: CheckSquare },
  { href: '/revisoes', label: 'Revisões (1/7/30d)', icon: Clock },
  { href: '/materias', label: 'Matérias, PDFs & Vídeos', icon: BookOpen },
  { href: '/flashcards', label: 'Flashcards', icon: Layers },
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
    pauseStopwatch,
    startStopwatch,
    resetStopwatch,
  } = useProfile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSwitchGuard, setShowSwitchGuard] = useState(false);

  const basePath = `/p/${profileId}`;
  const activeSubject = subjects.find((s) => s.id === stopwatch.subjectId);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-theme">Sincronizando seus estudos...</p>
        </div>
      </div>
    );
  }

  const sidebarContent = (
    <div className="flex flex-col h-full sidebar-surface">
      <div className="p-4 border-b border-theme">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl subtle-surface flex items-center justify-center text-xl shrink-0">
              {profile?.icon || '🎯'}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm truncate">{profile?.name || 'Concurso'}</p>
              <p className="text-[11px] text-muted-theme truncate">
                {profile?.role_title || 'Plano de Estudos'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-xl subtle-surface"
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
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-xl subtle-surface hover:opacity-85 transition"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          Trocar de Concurso
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const fullHref = `${basePath}${item.href}`;
          const isActive =
            item.href === '' ? pathname === basePath : pathname.startsWith(fullHref);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={fullHref}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition ${
                isActive ? 'sidebar-item-active' : 'sidebar-item'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-theme">
        <div className="flex items-center gap-2 px-2 text-xs">
          <Palette className="w-3.5 h-3.5 text-muted-theme shrink-0" />
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeId)}
            className="w-full subtle-surface border border-theme rounded-xl px-2.5 py-1.5 text-xs font-medium focus:outline-none"
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
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-68 max-w-[82vw] h-full">{sidebarContent}</div>
          <div
            className="flex-1 bg-black/45 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 card-surface border-b px-4 sm:px-6 py-3 flex items-center justify-between gap-3 rounded-none">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-xl subtle-surface"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-sm font-semibold truncate">
                {profile?.icon} {profile?.name}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {stopwatch.subjectId && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/25 text-xs">
                <span className="font-semibold text-teal-700 dark:text-teal-300 hidden sm:inline truncate max-w-[120px]">
                  {activeSubject?.name}
                </span>
                <span className="font-mono font-bold">
                  {formatDurationHMS(stopwatch.elapsedSeconds)}
                </span>
                <button
                  onClick={() =>
                    stopwatch.running
                      ? pauseStopwatch()
                      : startStopwatch(stopwatch.subjectId!, stopwatch.topicId)
                  }
                  className="p-1 rounded-full bg-teal-600 text-white"
                >
                  {stopwatch.running ? (
                    <Pause className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                </button>
              </div>
            )}

            <Link
              href={`${basePath}/ciclo`}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold shadow-sm transition"
            >
              + Adicionar Estudo
            </Link>

            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold ${
                syncing
                  ? 'bg-amber-500/15 text-amber-600'
                  : 'bg-emerald-500/15 text-emerald-600'
              }`}
            >
              {syncing ? (
                <>
                  <Cloud className="w-3.5 h-3.5 animate-pulse" />
                  <span className="hidden sm:inline">Salvando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sincronizado</span>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-7 max-w-7xl w-full mx-auto">{children}</main>
      </div>

      {showSwitchGuard && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl">
            <h2 className="text-lg font-bold">Cronômetro ativo em andamento</h2>
            <p className="text-xs text-muted-theme leading-relaxed">
              Você está com <strong>{formatDurationHMS(stopwatch.elapsedSeconds)}</strong> marcados em{' '}
              <strong>{activeSubject?.name || 'uma matéria'}</strong>. O que deseja fazer antes de trocar de concurso?
            </p>
            <div className="space-y-2 pt-1">
              <button
                onClick={() => {
                  pauseStopwatch();
                  setShowSwitchGuard(false);
                  router.push('/');
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold text-left"
              >
                ⏸️ Pausar cronômetro e trocar de concurso
              </button>
              <button
                onClick={() => {
                  setShowSwitchGuard(false);
                  router.push('/');
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold text-left"
              >
                ▶️ Continuar rodando e trocar de concurso
              </button>
              <button
                onClick={() => {
                  resetStopwatch();
                  setShowSwitchGuard(false);
                  router.push('/');
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 text-xs font-semibold text-left"
              >
                🗑️ Cancelar (zerar) cronômetro e trocar
              </button>
              <button
                onClick={() => setShowSwitchGuard(false)}
                className="w-full py-2.5 px-4 rounded-xl subtle-surface text-xs font-semibold"
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
