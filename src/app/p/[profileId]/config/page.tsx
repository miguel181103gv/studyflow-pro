'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import type { ThemeId } from '@/lib/types';
import { Check, CheckCircle2 } from 'lucide-react';

const THEMES: { id: ThemeId; name: string; desc: string }[] = [
  { id: 'clean', name: 'Claro Clean', desc: 'Visual moderno e leve para estudo diurno' },
  { id: 'sepia', name: 'Sépia Papel', desc: 'Confortável para leituras longas' },
  { id: 'obsidian', name: 'Escuro Obsidian', desc: 'Ideal para estudar à noite' },
  { id: 'navy', name: 'Azul Noturno', desc: 'Foco profundo com contraste suave' },
];

export default function ConfigPage() {
  const { profile, theme, setTheme, updateProfile, userEmail } = useProfile();

  const [dailyGoal, setDailyGoal] = useState(String(profile?.daily_hours_goal || 4));
  const [targetAcc, setTargetAcc] = useState(String(profile?.target_accuracy || 80));
  const [examDate, setExamDate] = useState(profile?.exam_date || '');
  const [salaryBase, setSalaryBase] = useState(profile?.salary_base || '');
  const [vale, setVale] = useState(profile?.vale_alimentacao || '');
  const [savedMsg, setSavedMsg] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await updateProfile({
      daily_hours_goal: Number(dailyGoal) || 4,
      target_accuracy: Number(targetAcc) || 80,
      exam_date: examDate || null,
      salary_base: salaryBase,
      vale_alimentacao: vale,
    });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-theme">
          Personalize sua meta, tema visual e dados da prova. Tudo salva automaticamente na nuvem.
        </p>
      </div>

      {/* Status da Conta */}
      <div className="card-surface rounded-2xl p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
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

      {/* Temas */}
      <div className="card-surface rounded-2xl p-5 space-y-3">
        <h2 className="font-bold text-sm">Aparência / Tema</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`text-left rounded-2xl p-4 border transition flex items-center justify-between ${
                theme === t.id
                  ? 'border-blue-600 bg-blue-600/10'
                  : 'border-theme subtle-surface hover:opacity-85'
              }`}
            >
              <div>
                <p className="text-sm font-bold">{t.name}</p>
                <p className="text-xs text-muted-theme">{t.desc}</p>
              </div>
              {theme === t.id && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      {/* Metas e Raio-X */}
      <form onSubmit={handleSave} className="card-surface rounded-2xl p-5 space-y-4">
        <h2 className="font-bold text-sm">Metas & Raio-X do Concurso</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-muted-theme mb-1">Meta Diária (horas)</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="16"
              value={dailyGoal}
              onChange={(e) => setDailyGoal(e.target.value)}
              className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-theme mb-1">Meta de Acertos (%)</label>
            <input
              type="number"
              min="40"
              max="100"
              value={targetAcc}
              onChange={(e) => setTargetAcc(e.target.value)}
              className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-theme mb-1">Data da Prova</label>
            <input
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-theme mb-1">Salário Base (Raio-X)</label>
            <input
              value={salaryBase}
              onChange={(e) => setSalaryBase(e.target.value)}
              className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-theme mb-1">Vale / Auxílio (Raio-X)</label>
            <input
              value={vale}
              onChange={(e) => setVale(e.target.value)}
              className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
          >
            Salvar Alterações
          </button>
          {savedMsg && <span className="text-xs text-emerald-600 font-medium">Salvo na nuvem!</span>}
        </div>
      </form>
    </div>
  );
}
