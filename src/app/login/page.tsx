'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, CheckCircle2, Cloud, Smartphone, ShieldCheck, BookOpen } from 'lucide-react';

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-page)] text-[var(--text-main)]">
      <div className="w-full max-w-md card-surface rounded-3xl p-8 space-y-6 animate-pop-in">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center shadow-md shadow-teal-600/20">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">StudyFlow</h1>
            <p className="text-xs font-medium text-muted-theme">
              Sua rotina de estudos organizada na nuvem
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-theme leading-relaxed">
          Uma plataforma adaptada ao seu objetivo —{' '}
          <strong className="text-[var(--text-main)]">
            Concursos, Faculdade, Escola, Certificações ou Estudo livre
          </strong>
          . Entre com o Google e continue de onde parou no PC ou no celular.
        </p>

        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2.5">
            <Cloud className="w-4 h-4 text-teal-600 shrink-0" />
            <span>Sincronização automática em tempo real na nuvem</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-4 h-4 text-teal-600 shrink-0" />
            <span>Vários perfis na mesma conta (ex: concurso + faculdade)</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-violet-600 shrink-0" />
            <span>Ciclo de estudos, flashcards, revisões e Gemini AI</span>
          </div>
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Interface adaptada para cada objetivo de estudo</span>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/12 border border-rose-500/30 text-rose-600 text-xs">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white font-semibold text-sm transition disabled:opacity-60 shadow-md"
        >
          <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 24 24">
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
          </span>
          {loading ? 'Conectando...' : 'Entrar com Google'}
        </button>

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-theme">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Autenticação segura via Supabase Auth</span>
        </div>
      </div>
    </div>
  );
}
