'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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
      <div className="w-full max-w-sm card-surface rounded-3xl p-8 sm:p-10 text-center space-y-7 animate-pop-in">
        <div className="space-y-3">
          <img
            src="/logo-studyflow.png"
            alt="StudyFlow"
            className="h-12 sm:h-14 mx-auto object-contain"
          />
          <p className="text-sm text-muted-theme leading-relaxed">
            Organize seus estudos em um só lugar, sincronizado no PC e no celular.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/12 border border-rose-500/30 text-rose-600 text-xs text-left">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white font-semibold text-sm transition disabled:opacity-60 shadow-sm"
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
          {loading ? 'Conectando...' : 'Continuar com Google'}
        </button>

        <p className="text-[11px] text-muted-theme">
          Concursos · Faculdade · Escola · Certificações · Estudo livre
        </p>
      </div>
    </div>
  );
}
