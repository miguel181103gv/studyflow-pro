'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useProfile } from '@/components/ProfileProvider';
import { formatDateBR } from '@/lib/utils';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Play,
  Sparkles,
  BookOpen,
  Video,
  CheckSquare,
  Layers,
  Clock,
} from 'lucide-react';

const DAYS = [
  { id: 1, label: 'Seg' },
  { id: 2, label: 'Ter' },
  { id: 3, label: 'Qua' },
  { id: 4, label: 'Qui' },
  { id: 5, label: 'Sex' },
  { id: 6, label: 'Sáb' },
  { id: 0, label: 'Dom' },
];

const METHODS = [
  { id: 'PDF + Questões', label: 'Leitura / PDF + Questões', icon: BookOpen },
  { id: 'Videoaula', label: 'Videoaulas', icon: Video },
  { id: 'Questões', label: 'Foco em Questões', icon: CheckSquare },
  { id: 'Flashcards', label: 'Flashcards & Revisão Ativa', icon: Layers },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { profile, subjects, updateProfile, updateSubject, startStopwatch } = useProfile();

  const [step, setStep] = useState(1);
  const totalSteps = 6;

  const [goalType, setGoalType] = useState<'specific' | 'exploring'>('specific');
  const [examDate, setExamDate] = useState(profile?.exam_date || '');
  const [dailyHours, setDailyHours] = useState(profile?.daily_hours_goal || 4);
  const [studyDays, setStudyDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [preferredMethods, setPreferredMethods] = useState<string[]>(['PDF + Questões']);
  const [saving, setSaving] = useState(false);

  const basePath = `/p/${profile?.id}`;

  function toggleDay(d: number) {
    setStudyDays((prev) =>
      prev.includes(d) ? (prev.length > 1 ? prev.filter((x) => x !== d) : prev) : [...prev, d]
    );
  }

  function toggleMethod(m: string) {
    setPreferredMethods((prev) =>
      prev.includes(m) ? (prev.length > 1 ? prev.filter((x) => x !== m) : prev) : [...prev, m]
    );
  }

  async function savePreferences() {
    if (!profile) return;
    setSaving(true);
    await updateProfile({
      daily_hours_goal: dailyHours,
      exam_date: examDate || null,
    });
    try {
      const key = `sf_agenda_prefs_${profile.id}`;
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(
        key,
        JSON.stringify({
          ...existing,
          studyDays,
          preferredMethods,
          onboardingDone: true,
        })
      );
    } catch {
      // ignore
    }
    setSaving(false);
  }

  async function handleStartFirstStudy() {
    await savePreferences();
    if (subjects[0]) {
      startStopwatch(subjects[0].id);
    }
    router.push(`${basePath}/ciclo`);
  }

  async function handleSaveAndLater() {
    await savePreferences();
    router.push(basePath);
  }

  const weeklyHours = studyDays.length * dailyHours;

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-2">
      {/* Progresso do Onboarding */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-bold text-muted-theme">
          <span>
            Configuração Inicial · Passo {step} de {totalSteps}
          </span>
          <button
            onClick={() => router.push(basePath)}
            className="hover:underline text-muted-theme"
          >
            Pular por enquanto
          </button>
        </div>
        <div className="w-full h-2 rounded-full subtle-surface overflow-hidden">
          <div
            className="h-full bg-teal-600 rounded-full transition-all duration-300"
            style={{ width: `${Math.round((step / totalSteps) * 100)}%` }}
          />
        </div>
      </div>

      {/* Cartão da Etapa Atual */}
      <div className="card-surface rounded-3xl p-6 sm:p-8 space-y-6 animate-fade-in-up">
        {/* Passo 1: Boas-vindas e Objetivo */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="w-12 h-12 rounded-2xl bg-teal-500/15 text-teal-600 flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold">Bem-vindo ao seu plano de estudos</h1>
              <p className="text-sm text-muted-theme mt-2 leading-relaxed">
                O StudyFlow organiza seu ciclo de matérias, agenda revisões automáticas (1, 7 e 30 dias) e mostra exatamente o que estudar agora. Vamos deixar sua primeira sessão pronta em menos de 1 minuto.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setGoalType('specific')}
                className={`text-left p-4 rounded-2xl border transition ${
                  goalType === 'specific'
                    ? 'border-teal-600 bg-teal-600/10'
                    : 'border-theme subtle-surface'
                }`}
              >
                <p className="font-bold text-sm">Tenho um concurso definido</p>
                <p className="text-xs text-muted-theme mt-1">
                  Quero seguir um edital específico e acompanhar a contagem até a prova.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setGoalType('exploring')}
                className={`text-left p-4 rounded-2xl border transition ${
                  goalType === 'exploring'
                    ? 'border-teal-600 bg-teal-600/10'
                    : 'border-theme subtle-surface'
                }`}
              >
                <p className="font-bold text-sm">Ainda estou explorando</p>
                <p className="text-xs text-muted-theme mt-1">
                  Quero construir base nas matérias principais sem pressão de data.
                </p>
              </button>
            </div>
          </div>
        )}

        {/* Passo 2: Confirmar Concurso, Cargo e Dados */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-extrabold">Confirme seu concurso e cargo</h1>
              <p className="text-sm text-muted-theme mt-1">
                Revise as informações carregadas antes de usá-las como base do seu planejamento. Você pode editar tudo depois.
              </p>
            </div>

            <div className="subtle-surface rounded-2xl p-4 space-y-2.5 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-theme">Concurso:</span>
                <strong>
                  {profile?.icon} {profile?.name}
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-theme">Cargo:</span>
                <strong className="text-right">{profile?.role_title || 'A definir'}</strong>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-theme">Matérias carregadas:</span>
                <strong>{subjects.length} disciplinas</strong>
              </div>
              {profile?.salary_base && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-theme">Remuneração base:</span>
                  <strong>{profile.salary_base}</strong>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-muted-theme mb-1.5">
                Data prevista da prova (opcional)
              </label>
              <input
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="w-full rounded-2xl subtle-surface border border-theme px-4 py-2.5 text-sm"
              />
            </div>

            <Link
              href="/"
              className="inline-block text-xs font-bold text-teal-700 dark:text-teal-300 hover:underline"
            >
              Quer trocar de perfil, buscar no PCI ou importar outro PDF? Voltar para Perfis →
            </Link>
          </div>
        )}

        {/* Passo 3: Disponibilidade */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-extrabold">Qual é sua disponibilidade real?</h1>
              <p className="text-sm text-muted-theme mt-1">
                Comece com uma meta sustentável. Você pode ajustar seus dias e horas a qualquer momento.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold text-muted-theme">Dias da semana</p>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => {
                  const active = studyDays.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleDay(d.id)}
                      className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition ${
                        active ? 'bg-teal-600 text-white' : 'subtle-surface text-muted-theme'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold text-muted-theme">Horas líquidas por dia</p>
              <div className="flex flex-wrap gap-2">
                {[2, 3, 4, 5, 6].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setDailyHours(h)}
                    className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition ${
                      dailyHours === h
                        ? 'bg-teal-600 text-white'
                        : 'subtle-surface text-muted-theme'
                    }`}
                  >
                    {h}h / dia
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-theme pt-1">
                Total planejado: <strong>{weeklyHours} horas por semana</strong> ({studyDays.length}{' '}
                dias).
              </p>
            </div>
          </div>
        )}

        {/* Passo 4: Como prefere estudar */}
        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-extrabold">Como você prefere estudar?</h1>
              <p className="text-sm text-muted-theme mt-1">
                Selecione os métodos que você mais usa (pode marcar mais de um).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = preferredMethods.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMethod(m.id)}
                    className={`p-4 rounded-2xl border text-left flex items-center justify-between gap-3 transition ${
                      active
                        ? 'border-teal-600 bg-teal-600/10'
                        : 'border-theme subtle-surface'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-teal-600 shrink-0" />
                      <span className="text-sm font-bold">{m.label}</span>
                    </span>
                    {active && <Check className="w-4 h-4 text-teal-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Passo 5: Revisar o Plano Sugerido */}
        {step === 5 && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-extrabold">Revise o plano sugerido</h1>
              <p className="text-sm text-muted-theme mt-1">
                As primeiras matérias do ciclo têm maior peso no edital. Ao concluir cada tópico, revisões de <strong>1, 7 e 30 dias</strong> são agendadas automaticamente.
              </p>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {subjects.map((s, idx) => (
                <div
                  key={s.id}
                  className="subtle-surface rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-6 h-6 rounded-lg text-white font-bold flex items-center justify-center shrink-0"
                      style={{ backgroundColor: s.color }}
                    >
                      {idx + 1}
                    </span>
                    <span className="font-bold truncate">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        updateSubject(s.id, {
                          cycle_hours: Math.max(0, s.cycle_hours - 1),
                        })
                      }
                      className="w-7 h-7 rounded-lg card-surface font-bold"
                    >
                      −
                    </button>
                    <span className="font-bold w-14 text-center">
                      {s.cycle_hours}h{String(s.cycle_minutes).padStart(2, '0')}m
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateSubject(s.id, {
                          cycle_hours: Math.min(10, s.cycle_hours + 1),
                        })
                      }
                      className="w-7 h-7 rounded-lg card-surface font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Passo 6: Começar a Primeira Sessão */}
        {step === 6 && (
          <div className="space-y-5 text-center py-2">
            <div className="w-14 h-14 rounded-3xl bg-teal-600 text-white flex items-center justify-center mx-auto shadow-md">
              <Clock className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold">Tudo pronto para começar!</h1>
              <p className="text-sm text-muted-theme mt-2 max-w-md mx-auto">
                Sua primeira sessão sugerida é <strong>{subjects[0]?.name}</strong> (meta de{' '}
                {dailyHours}h/dia
                {examDate ? ` · prova em ${formatDateBR(examDate)}` : ''}). Quando terminar, clique em{' '}
                <strong>Finalizar & Salvar</strong> para registrar tempo e questões.
              </p>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={handleStartFirstStudy}
              className="px-7 py-4 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-base font-extrabold inline-flex items-center gap-2 shadow-lg"
            >
              <Play className="w-5 h-5 fill-current" />
              Iniciar meu primeiro estudo
            </button>
          </div>
        )}

        {/* Rodapé de Navegação */}
        <div className="pt-4 border-t border-theme flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="px-4 py-2.5 rounded-2xl subtle-surface text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-35"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveAndLater}
              className="px-4 py-2.5 rounded-2xl subtle-surface text-xs font-bold"
            >
              Salvar e continuar depois
            </button>

            {step < totalSteps && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(totalSteps, s + 1))}
                className="px-5 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                Continuar
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
