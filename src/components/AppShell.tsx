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
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '', label: 'Início', icon: Home },
  { href: '/ciclo', label: 'Ciclo de Estudos', icon: RefreshCw },
  { href: '/agenda', label: 'Agenda Semanal', icon: CalendarDays },
  { href: '/estudos', label: 'Progresso do Edital', icon: CheckSquare },
  { href: '/revisoes', label: 'Revisões (1/7/30d)', icon: Clock },
  { href: '/materias', label: 'Matérias e PDFs', icon: BookOpen },
  { href: '/erros', label: 'Caderno de Erros', icon: AlertTriangle },
  { href: '/evolucao', label: 'Minha Evolução', icon: TrendingUp },
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
  } = useProfile();
  const [mobileOpen, setMobileOpen] = useState(false);

  const basePath = `/p/${profileId}`;
  const activeSubject = subjects.find((s) => s.id === stopwatch.subjectId);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-theme">Sincronizando seus estudos...</p>
        </div>
      </div>
    );
  }

  const sidebarContent = (
    <div className="flex flex-col h-full text-slate-100" style={{ backgroundColor: 'var(--bg-sidebar)' }}>
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-2xl shrink-0">{profile?.icon || '🎯'}</span>
            <div className="min-w-0">
              <p className="font-bold text-sm truncate">{profile?.name || 'Concurso'}</p>
              <p className="text-[11px] text-slate-400 truncate">
                {profile?.role_title || 'Plano de Estudos'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={() => router.push('/')}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs py-1.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 transition"
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
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                isActive
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/10 space-y-2">
        <div className="flex items-center gap-2 px-2 text-xs text-slate-300">
          <Palette className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeId)}
            className="w-full bg-white/10 border border-white/15 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id} className="bg-slate-900 text-white">
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
          <div className="w-68 max-w-[80vw] h-full">{sidebarContent}</div>
          <div
            className="flex-1 bg-black/50 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 card-surface border-b px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-xl subtle-surface"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="text-xs text-muted-theme truncate">
                {profile?.icon} {profile?.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {stopwatch.subjectId && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-600/10 border border-blue-500/30 text-xs">
                <span className="font-semibold text-blue-600 dark:text-blue-400 hidden sm:inline truncate max-w-[120px]">
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
                  className="p-1 rounded-lg bg-blue-600 text-white"
                >
                  {stopwatch.running ? (
                    <Pause className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                </button>
              </div>
            )}

            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
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

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
