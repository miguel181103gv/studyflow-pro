'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, CheckCircle2, Cloud, Smartphone, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleLogin() {
    try {
      setLoading(true);
      setError(null);
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (authError) throw authError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao conectar com o Google.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white">
      <div className="w-full max-w-md rounded-3xl bg-white/10 backdrop-blur-xl border border-white/15 p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-2xl shadow-lg shadow-blue-600/30">
            🎯
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">StudyFlow Pro</h1>
            <p className="text-sm text-blue-200/80">Sua aprovação organizada na nuvem</p>
          </div>
        </div>

        <p className="text-sm text-slate-200 leading-relaxed mb-6">
          Entre uma única vez com sua conta Google. Tudo o que você estudar no PC aparece
          automaticamente no iPhone em tempo real — sem chaves, sem botões de backup.
        </p>

        <div className="space-y-3 mb-7 text-sm text-slate-200">
          <div className="flex items-center gap-2.5">
            <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Sincronização automática a cada clique</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-4 h-4 text-sky-400 shrink-0" />
            <span>Mesmo progresso no Windows e no iPhone</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Mentor Gemini AI, Quiz e Leitor de Editais</span>
          </div>
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-violet-400 shrink-0" />
            <span>Editais TRT-MG e Área Bancária já pré-carregados</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-400/40 text-red-200 text-xs">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-2xl bg-white text-slate-900 font-semibold text-sm hover:bg-slate-100 active:scale-[0.99] transition disabled:opacity-60 shadow-lg"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
            />
          </svg>
          {loading ? 'Conectando...' : 'Entrar com Google'}
        </button>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Autenticação segura via Supabase Auth</span>
        </div>
      </div>
    </div>
  );
}
