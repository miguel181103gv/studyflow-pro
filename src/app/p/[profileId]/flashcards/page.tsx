'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { formatDateBR, todayISO } from '@/lib/utils';
import {
  Layers,
  Plus,
  Sparkles,
  Loader2,
  Trash2,
  Zap,
  RotateCw,
  X,
} from 'lucide-react';

export default function FlashcardsPage() {
  const {
    profile,
    subjects,
    topics,
    flashcards,
    addFlashcards,
    reviewFlashcard,
    deleteFlashcard,
  } = useProfile();

  const today = todayISO();
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || '');
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');

  // Form criar card manual
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);

  // Gerar com Gemini
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Modo Estudo Espaçado (SM-2)
  const [studying, setStudying] = useState(false);
  const [studyQueueIds, setStudyQueueIds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);

  const currentSubjectId = selectedSubjectId || subjects[0]?.id || '';
  const currentSubject = subjects.find((s) => s.id === currentSubjectId);
  const subjectTopics = topics.filter((t) => t.subject_id === currentSubjectId);
  const currentTopic = subjectTopics.find((t) => t.id === selectedTopicId);

  const deckCards = flashcards.filter(
    (c) =>
      c.subject_id === currentSubjectId &&
      (!selectedTopicId || c.topic_id === selectedTopicId)
  );
  const dueCards = deckCards.filter((c) => c.due_date <= today);

  async function handleAddCard(e: React.FormEvent) {
    e.preventDefault();
    if (!currentSubjectId || !front.trim() || !back.trim()) return;
    setSaving(true);
    await addFlashcards([
      {
        subject_id: currentSubjectId,
        topic_id: selectedTopicId || null,
        front,
        back,
      },
    ]);
    setFront('');
    setBack('');
    setSaving(false);
  }

  async function handleGenerateWithGemini() {
    if (!currentSubject) return;
    setGenerating(true);
    setAiError(null);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_flashcards',
          profileName: profile?.name || 'Concurso Público',
          subjectName: currentSubject.name,
          topicTitle: currentTopic?.title || `Principais pontos de ${currentSubject.name}`,
          count: 5,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao gerar flashcards.');
      const generated: { front: string; back: string }[] = json.data?.flashcards || [];
      if (generated.length > 0) {
        await addFlashcards(
          generated.map((g) => ({
            subject_id: currentSubject.id,
            topic_id: selectedTopicId || null,
            front: g.front,
            back: g.back,
          }))
        );
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erro ao gerar flashcards.');
    } finally {
      setGenerating(false);
    }
  }

  function startStudySession(onlyDue = true) {
    const pool = onlyDue && dueCards.length > 0 ? dueCards : deckCards;
    if (pool.length === 0) return;
    setStudyQueueIds(pool.map((c) => c.id));
    setRevealed(false);
    setStudying(true);
  }

  const activeStudyCard =
    studyQueueIds.length > 0
      ? flashcards.find((c) => c.id === studyQueueIds[0])
      : undefined;

  async function handleRate(quality: 1 | 2 | 3 | 4) {
    if (!activeStudyCard) return;
    await reviewFlashcard(activeStudyCard, quality);
    setRevealed(false);
    if (quality === 1) {
      // Errei: volta pro final da fila desta sessão para fixar!
      setStudyQueueIds((prev) => [...prev.slice(1), prev[0]]);
    } else {
      setStudyQueueIds((prev) => prev.slice(1));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="w-6 h-6 text-blue-600" />
            Flashcards & Revisão Espaçada
          </h1>
          <p className="text-sm text-muted-theme">
            Baralhos organizados em Matérias → Tópicos → Flashcards, com algoritmo SM-2 e geração por IA.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {dueCards.length > 0 && (
            <button
              onClick={() => startStudySession(true)}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
            >
              <Zap className="w-4 h-4" />
              Revisar Hoje ({dueCards.length})
            </button>
          )}
          {deckCards.length > 0 && (
            <button
              onClick={() => startStudySession(false)}
              className="px-4 py-2.5 rounded-xl card-surface text-xs font-semibold inline-flex items-center gap-1.5"
            >
              Estudar Baralho ({deckCards.length})
            </button>
          )}
        </div>
      </div>

      {/* Nível 1: Baralhos por Matéria */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-muted-theme uppercase tracking-wider">
          1. Escolha a Matéria
        </p>
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => {
            const sDue = flashcards.filter(
              (c) => c.subject_id === s.id && c.due_date <= today
            ).length;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedSubjectId(s.id);
                  setSelectedTopicId('');
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition inline-flex items-center gap-2 ${
                  currentSubjectId === s.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'card-surface hover:opacity-85'
                }`}
              >
                <span>{s.name}</span>
                {sDue > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      currentSubjectId === s.id
                        ? 'bg-white/25 text-white'
                        : 'bg-emerald-500/20 text-emerald-600'
                    }`}
                  >
                    {sDue}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Nível 2: Sub-baralho por Tópico */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-muted-theme uppercase tracking-wider">
          2. Escolha o Tópico
        </p>
        <select
          value={selectedTopicId}
          onChange={(e) => setSelectedTopicId(e.target.value)}
          className="w-full sm:max-w-xl rounded-xl card-surface px-4 py-2.5 text-sm"
        >
          <option value="">Todos os tópicos de {currentSubject?.name}</option>
          {subjectTopics.map((t) => {
            const cnt = flashcards.filter((c) => c.topic_id === t.id).length;
            return (
              <option key={t.id} value={t.id}>
                {t.title} ({cnt} cards)
              </option>
            );
          })}
        </select>
      </div>

      {/* Nível 3: Criar Flashcard Manual OU Gerar com Gemini */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleAddCard}
          className="lg:col-span-2 card-surface rounded-2xl p-5 shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-bold text-sm">Novo Flashcard neste Baralho</h2>
            <button
              type="button"
              onClick={handleGenerateWithGemini}
              disabled={generating || !currentSubject}
              className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {generating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {generating ? 'Gerando 5 cards...' : 'Gerar 5 com Gemini'}
            </button>
          </div>

          {aiError && (
            <div className="p-3 rounded-xl bg-red-500/15 text-red-500 text-xs">{aiError}</div>
          )}

          <input
            required
            value={front}
            onChange={(e) => setFront(e.target.value)}
            placeholder="Pergunta (Frente do card)..."
            className="w-full rounded-xl subtle-surface border border-theme px-3.5 py-2.5 text-sm"
          />
          <textarea
            required
            rows={2}
            value={back}
            onChange={(e) => setBack(e.target.value)}
            placeholder="Resposta (Verso do card)..."
            className="w-full rounded-xl subtle-surface border border-theme p-3.5 text-sm"
          />
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            {saving ? 'Salvando...' : 'Adicionar Flashcard'}
          </button>
        </form>

        <div className="card-surface rounded-2xl p-5 shadow-sm flex flex-col justify-between space-y-3">
          <div>
            <h2 className="font-bold text-sm mb-2">Resumo do Baralho</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-theme">Total de cards:</span>
                <span className="font-bold">{deckCards.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-theme">Para revisar hoje:</span>
                <span className="font-bold text-emerald-600">{dueCards.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-theme">Em dia:</span>
                <span className="font-bold">{deckCards.length - dueCards.length}</span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-theme">
            O algoritmo SM-2 ajusta o intervalo automaticamente: Errei (1d), Difícil, Bom (1d → 6d → ...) ou Fácil.
          </p>
        </div>
      </div>

      {/* Lista de Flashcards do Baralho */}
      <div className="space-y-2.5">
        <h2 className="font-bold text-sm">Cards neste Baralho ({deckCards.length})</h2>
        {deckCards.length === 0 ? (
          <div className="card-surface rounded-2xl p-8 text-center text-sm text-muted-theme">
            Nenhum flashcard aqui ainda. Adicione acima ou clique em &ldquo;Gerar 5 com Gemini&rdquo;!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {deckCards.map((card) => {
              const t = topics.find((tp) => tp.id === card.topic_id);
              const isDue = card.due_date <= today;
              return (
                <div key={card.id} className="card-surface rounded-2xl p-4 space-y-2 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isDue
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : 'subtle-surface text-muted-theme'
                        }`}
                      >
                        {isDue ? 'Revisar hoje' : `Próx: ${formatDateBR(card.due_date)}`}
                      </span>
                      {t && (
                        <span className="text-[10px] text-muted-theme truncate max-w-[200px]">
                          {t.title}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => deleteFlashcard(card.id)}
                      className="p-1 rounded-lg hover:bg-red-500/15 text-muted-theme hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-sm font-semibold">{card.front}</p>
                  <p className="text-xs text-muted-theme border-t border-theme pt-2">
                    {card.back}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Estudo SM-2 */}
      {studying && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-xl rounded-3xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-600">
                {activeStudyCard
                  ? `Restam ${studyQueueIds.length} card(s)`
                  : 'Sessão Concluída!'}
              </span>
              <button
                onClick={() => setStudying(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeStudyCard ? (
              <>
                <div className="subtle-surface rounded-2xl p-6 min-h-[140px] flex flex-col justify-center text-center space-y-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-theme font-bold">
                    Pergunta
                  </p>
                  <p className="text-base sm:text-lg font-bold">{activeStudyCard.front}</p>
                </div>

                {revealed ? (
                  <>
                    <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-5 text-center space-y-2">
                      <p className="text-[11px] uppercase tracking-wider text-emerald-600 font-bold">
                        Resposta
                      </p>
                      <p className="text-sm leading-relaxed">{activeStudyCard.back}</p>
                    </div>

                    <div className="grid grid-cols-4 gap-2 pt-1">
                      <button
                        onClick={() => handleRate(1)}
                        className="py-2.5 px-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
                      >
                        Errei
                        <span className="block text-[10px] font-normal opacity-80">Agora</span>
                      </button>
                      <button
                        onClick={() => handleRate(2)}
                        className="py-2.5 px-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
                      >
                        Difícil
                        <span className="block text-[10px] font-normal opacity-80">Curto</span>
                      </button>
                      <button
                        onClick={() => handleRate(3)}
                        className="py-2.5 px-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
                      >
                        Bom
                        <span className="block text-[10px] font-normal opacity-80">Padrão</span>
                      </button>
                      <button
                        onClick={() => handleRate(4)}
                        className="py-2.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                      >
                        Fácil
                        <span className="block text-[10px] font-normal opacity-80">Longo</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => setRevealed(true)}
                    className="w-full py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
                  >
                    <RotateCw className="w-4 h-4" />
                    Mostrar Resposta
                  </button>
                )}
              </>
            ) : (
              <div className="text-center py-8 space-y-3">
                <p className="text-xl font-bold">Parabéns! Baralho finalizado 🎉</p>
                <p className="text-xs text-muted-theme">
                  Todas as próximas datas de revisão foram agendadas automaticamente na nuvem.
                </p>
                <button
                  onClick={() => setStudying(false)}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-semibold"
                >
                  Voltar ao Baralho
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
