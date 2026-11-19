'use client';

import { useEffect, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { createClient } from '@/lib/supabase/client';
import { todayISO } from '@/lib/utils';
import type { ErrorEntry } from '@/lib/types';
import {
  Plus,
  Sparkles,
  Image as ImageIcon,
  Trash2,
  Zap,
  Loader2,
  X,
  RotateCw,
  ZoomIn,
} from 'lucide-react';

const ERROR_CAUSES = [
  'Lacuna teórica',
  'Falta de atenção / leitura',
  'Pegadinha da banca',
  'Esquecimento / falta de revisão',
  'Erro de cálculo',
];

export default function CadernoErrosPage() {
  const {
    userId,
    profile,
    subjects,
    topics,
    errors,
    addErrorEntry,
    updateErrorEntry,
    deleteErrorEntry,
  } = useProfile();

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [filterSubject, setFilterSubject] = useState('');
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  // Add error form
  const [showAdd, setShowAdd] = useState(false);
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [userAnswer, setUserAnswer] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [errorCause, setErrorCause] = useState(ERROR_CAUSES[0]);
  const [explanation, setExplanation] = useState('');
  const [goldenRule, setGoldenRule] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);

  // Flashcard Active Review Mode
  const [flashcardMode, setFlashcardMode] = useState(false);
  const [fcIndex, setFcIndex] = useState(0);
  const [fcRevealed, setFcRevealed] = useState(false);

  useEffect(() => {
    async function loadImages() {
      const supabase = createClient();
      const paths = errors.map((e) => e.image_path).filter(Boolean) as string[];
      const missing = paths.filter((p) => !signedUrls[p]);
      if (missing.length === 0) return;

      const entries: Record<string, string> = {};
      await Promise.all(
        missing.map(async (p) => {
          const { data } = await supabase.storage.from('study-assets').createSignedUrl(p, 3600);
          if (data?.signedUrl) entries[p] = data.signedUrl;
        })
      );
      setSignedUrls((prev) => ({ ...prev, ...entries }));
    }
    loadImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors]);

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          setImageFile(file);
          setPreviewUrl(URL.createObjectURL(file));
        }
      }
    }
  }

  async function handleSaveError(e: React.FormEvent) {
    e.preventDefault();
    const sId = subjectId || subjects[0]?.id;
    if (!sId || !userId || !profile) return;
    setSaving(true);
    try {
      let imagePath: string | null = null;
      if (imageFile) {
        const supabase = createClient();
        const ext = imageFile.name.split('.').pop() || 'png';
        imagePath = `${userId}/${profile.id}/errors/${Date.now()}.${ext}`;
        const { error } = await supabase.storage
          .from('study-assets')
          .upload(imagePath, imageFile, { upsert: true });
        if (error) throw error;
      }

      await addErrorEntry({
        subject_id: sId,
        topic_id: topicId || null,
        question_text: questionText,
        image_path: imagePath,
        user_answer: userAnswer,
        correct_answer: correctAnswer,
        error_cause: errorCause,
        explanation,
        golden_rule: goldenRule,
        review_count: 0,
        last_reviewed_at: null,
        next_review_date: todayISO(),
      });

      setShowAdd(false);
      setQuestionText('');
      setUserAnswer('');
      setCorrectAnswer('');
      setExplanation('');
      setGoldenRule('');
      setImageFile(null);
      setPreviewUrl(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar questão.');
    } finally {
      setSaving(false);
    }
  }

  async function explainWithGemini(entry: ErrorEntry) {
    setAiLoadingId(entry.id);
    try {
      const sub = subjects.find((s) => s.id === entry.subject_id);
      const top = topics.find((t) => t.id === entry.topic_id);

      let imageBase64: string | undefined;
      if (entry.image_path && signedUrls[entry.image_path]) {
        const imgRes = await fetch(signedUrls[entry.image_path]);
        const buf = await imgRes.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
        imageBase64 = btoa(bin);
      }

      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'explain_error',
          subjectName: sub?.name || 'Matéria',
          topicTitle: top?.title || '',
          questionText: entry.question_text,
          userAnswer: entry.user_answer,
          correctAnswer: entry.correct_answer,
          imageBase64,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao explicar.');

      await updateErrorEntry(entry.id, {
        explanation: json.data.explanation || '',
        golden_rule: json.data.golden_rule || '',
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao consultar Gemini.');
    } finally {
      setAiLoadingId(null);
    }
  }

  const visibleErrors = filterSubject
    ? errors.filter((e) => e.subject_id === filterSubject)
    : errors;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Caderno de Erros Inteligente</h1>
          <p className="text-sm text-muted-theme">
            Cole prints (Ctrl+V), peça explicação ao Gemini AI e revise em modo Flashcards.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {visibleErrors.length > 0 && (
            <button
              onClick={() => {
                setFcIndex(0);
                setFcRevealed(false);
                setFlashcardMode(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Zap className="w-4 h-4" />
              Revisão Ativa ({visibleErrors.length})
            </button>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Novo Erro
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilterSubject('')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
            !filterSubject ? 'bg-blue-600 text-white' : 'card-surface'
          }`}
        >
          Todas ({errors.length})
        </button>
        {subjects.map((s) => {
          const cnt = errors.filter((e) => e.subject_id === s.id).length;
          if (cnt === 0) return null;
          return (
            <button
              key={s.id}
              onClick={() => setFilterSubject(s.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                filterSubject === s.id ? 'bg-blue-600 text-white' : 'card-surface'
              }`}
            >
              {s.name} ({cnt})
            </button>
          );
        })}
      </div>

      {visibleErrors.length === 0 ? (
        <div className="card-surface rounded-2xl p-8 text-center text-sm text-muted-theme">
          Nenhum erro cadastrado ainda. Clique em &ldquo;Novo Erro&rdquo; e cole o print da questão!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleErrors.map((entry) => {
            const sub = subjects.find((s) => s.id === entry.subject_id);
            const imgUrl = entry.image_path ? signedUrls[entry.image_path] : null;

            return (
              <div key={entry.id} className="card-surface rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: sub?.color || '#2563eb' }}
                    >
                      {sub?.name}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full subtle-surface">
                      {entry.error_cause}
                    </span>
                  </div>
                  <button
                    onClick={() => deleteErrorEntry(entry.id)}
                    className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-theme hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {imgUrl && (
                  <div
                    onClick={() => setZoomUrl(imgUrl)}
                    className="relative cursor-zoom-in rounded-xl overflow-hidden border border-theme bg-black/5"
                  >
                    <img
                      src={imgUrl}
                      alt="Print da questão"
                      className="w-full max-h-52 object-contain"
                    />
                    <span className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/60 text-white">
                      <ZoomIn className="w-3.5 h-3.5" />
                    </span>
                  </div>
                )}

                {entry.question_text && (
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">
                    {entry.question_text}
                  </p>
                )}

                {(entry.user_answer || entry.correct_answer) && (
                  <div className="flex gap-3 text-xs">
                    {entry.user_answer && (
                      <span className="px-2.5 py-1 rounded-lg bg-red-500/10 text-red-500">
                        Marquei: <strong>{entry.user_answer}</strong>
                      </span>
                    )}
                    {entry.correct_answer && (
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600">
                        Gabarito: <strong>{entry.correct_answer}</strong>
                      </span>
                    )}
                  </div>
                )}

                {entry.golden_rule && (
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs">
                    <strong className="text-amber-600">Regra de Ouro:</strong> {entry.golden_rule}
                  </div>
                )}

                {entry.explanation && (
                  <p className="text-xs text-muted-theme leading-relaxed">{entry.explanation}</p>
                )}

                <div className="pt-1 flex justify-end">
                  <button
                    onClick={() => explainWithGemini(entry)}
                    disabled={aiLoadingId === entry.id}
                    className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {aiLoadingId === entry.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    Explicar com Gemini
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Zoom Modal */}
      {zoomUrl && (
        <div
          onClick={() => setZoomUrl(null)}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img src={zoomUrl} alt="Zoom" className="max-w-full max-h-[90vh] rounded-2xl" />
        </div>
      )}

      {/* Add Error Modal */}
      {showAdd && (
        <div
          onPaste={handlePaste}
          className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="card-surface w-full max-w-lg rounded-3xl p-6 my-8 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">Adicionar ao Caderno de Erros</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-xl subtle-surface">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveError} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Matéria</label>
                  <select
                    value={subjectId || subjects[0]?.id || ''}
                    onChange={(e) => {
                      setSubjectId(e.target.value);
                      setTopicId('');
                    }}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  >
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-theme mb-1">Causa do Erro</label>
                  <select
                    value={errorCause}
                    onChange={(e) => setErrorCause(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  >
                    {ERROR_CAUSES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-blue-500/40 p-4 text-center">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="max-h-40 mx-auto rounded-xl mb-2"
                  />
                ) : (
                  <ImageIcon className="w-7 h-7 mx-auto mb-1 text-blue-500 opacity-70" />
                )}
                <p className="text-xs text-muted-theme mb-2">
                  Aperte <strong>Ctrl+V</strong> para colar o print ou selecione abaixo:
                </p>
                <label className="cursor-pointer inline-block px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold">
                  Escolher Imagem
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setImageFile(f);
                        setPreviewUrl(URL.createObjectURL(f));
                      }
                    }}
                  />
                </label>
              </div>

              <textarea
                rows={3}
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                placeholder="Texto da questão (opcional se anexou print)..."
                className="w-full rounded-xl subtle-surface border border-theme p-3 text-xs"
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  placeholder="O que eu marquei (ex: B)"
                  className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                />
                <input
                  value={correctAnswer}
                  onChange={(e) => setCorrectAnswer(e.target.value)}
                  placeholder="Gabarito (ex: D)"
                  className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                />
              </div>

              <input
                value={goldenRule}
                onChange={(e) => setGoldenRule(e.target.value)}
                placeholder="Regra de Ouro (pode deixar em branco e pedir ao Gemini depois)"
                className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
              />

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 rounded-xl subtle-surface text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold"
                >
                  {saving ? 'Salvando...' : 'Salvar Erro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Flashcards Modal */}
      {flashcardMode && visibleErrors[fcIndex] && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-xl rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-500">
                Flashcard {fcIndex + 1} de {visibleErrors.length}
              </span>
              <button
                onClick={() => setFlashcardMode(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {visibleErrors[fcIndex].image_path &&
              signedUrls[visibleErrors[fcIndex].image_path!] && (
                <img
                  src={signedUrls[visibleErrors[fcIndex].image_path!]}
                  alt="Questão"
                  className="w-full max-h-60 object-contain rounded-xl bg-black/10"
                />
              )}

            {visibleErrors[fcIndex].question_text && (
              <p className="text-sm">{visibleErrors[fcIndex].question_text}</p>
            )}

            {fcRevealed ? (
              <div className="subtle-surface rounded-2xl p-4 space-y-2 text-xs">
                <p>
                  <strong>Gabarito:</strong> {visibleErrors[fcIndex].correct_answer || '—'}
                </p>
                {visibleErrors[fcIndex].golden_rule && (
                  <p className="text-amber-600 font-semibold">
                    Regra de Ouro: {visibleErrors[fcIndex].golden_rule}
                  </p>
                )}
                {visibleErrors[fcIndex].explanation && (
                  <p className="text-muted-theme">{visibleErrors[fcIndex].explanation}</p>
                )}
              </div>
            ) : (
              <button
                onClick={() => setFcRevealed(true)}
                className="w-full py-3 rounded-xl bg-blue-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2"
              >
                <RotateCw className="w-4 h-4" />
                Mostrar Resposta e Regra de Ouro
              </button>
            )}

            <div className="flex justify-between pt-2">
              <button
                onClick={() => {
                  setFcRevealed(false);
                  setFcIndex((prev) => (prev - 1 + visibleErrors.length) % visibleErrors.length);
                }}
                className="px-4 py-2 rounded-xl subtle-surface text-xs font-semibold"
              >
                Anterior
              </button>
              <button
                onClick={async () => {
                  await updateErrorEntry(visibleErrors[fcIndex].id, {
                    review_count: visibleErrors[fcIndex].review_count + 1,
                    last_reviewed_at: new Date().toISOString(),
                  });
                  setFcRevealed(false);
                  setFcIndex((prev) => (prev + 1) % visibleErrors.length);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
              >
                Dominei · Próxima
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
