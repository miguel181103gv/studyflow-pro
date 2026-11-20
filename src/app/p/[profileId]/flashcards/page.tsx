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
  Globe2,
  FileText,
} from 'lucide-react';

function parseBulkFlashcards(raw: string): { front: string; back: string }[] {
  const results: { front: string; back: string }[] = [];
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return results;

  // Padrão 1: Frente: ... Verso: ... (ou Pergunta: ... Resposta: ... / P: ... R: ...)
  const regex =
    /(?:^|\n)\s*(?:[-*•]\s*)?(?:Frente|Pergunta|P|Q)\s*:\s*([\s\S]*?)(?:\n\s*(?:[-*•]\s*)?(?:Verso|Resposta|R|A)\s*:\s*([\s\S]*?))(?=\n\s*(?:\d+[.)]|(?:[-*•]\s*)?(?:Frente|Pergunta|P|Q)\s*:)|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const f = match[1].trim();
    const b = match[2].trim();
    if (f && b) results.push({ front: f, back: b });
  }

  // Fallback: linhas separadas por "|" ou ";"
  if (results.length === 0) {
    text.split('\n').forEach((line) => {
      const sep = line.includes('|') ? '|' : line.includes(';') ? ';' : null;
      if (sep) {
        const parts = line.split(sep);
        if (parts.length >= 2) {
          const f = parts[0].trim();
          const b = parts.slice(1).join(sep).trim();
          if (f && b) results.push({ front: f, back: b });
        }
      }
    });
  }

  return results;
}

export default function FlashcardsPage() {
  const {
    profile,
    subjects,
    topics,
    flashcards,
    addSubject,
    addTopic,
    addFlashcards,
    reviewFlashcard,
    deleteFlashcard,
  } = useProfile();

  const today = todayISO();
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || '');
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');

  // Criar nova matéria ou tópico direto aqui
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newTopicName, setNewTopicName] = useState('');

  // Form criar card manual
  const [front, setFront] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [importingBulk, setImportingBulk] = useState(false);
  const [showBulkBox, setShowBulkBox] = useState(false);
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);

  // Gerar com Gemini (tema livre + quantidade)
  const [customTheme, setCustomTheme] = useState('');
  const [genCount, setGenCount] = useState<5 | 10 | 15>(5);
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

  const allDueCards = flashcards.filter((c) => c.due_date <= today);

  async function handleAddSubject(e: React.FormEvent) {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    const created = await addSubject(newSubjectName);
    if (created) {
      setSelectedSubjectId(created.id);
      setSelectedTopicId('');
    }
    setNewSubjectName('');
  }

  async function handleAddTopic(e: React.FormEvent) {
    e.preventDefault();
    if (!currentSubjectId || !newTopicName.trim()) return;
    await addTopic(currentSubjectId, newTopicName);
    setNewTopicName('');
  }

  const parsedBulk = parseBulkFlashcards(bulkText);

  async function handleBulkImport() {
    if (!currentSubjectId || parsedBulk.length === 0) return;
    setImportingBulk(true);
    await addFlashcards(
      parsedBulk.map((c) => ({
        subject_id: currentSubjectId,
        topic_id: selectedTopicId || null,
        front: c.front,
        back: c.back,
      }))
    );
    setBulkText('');
    setShowBulkBox(false);
    setImportingBulk(false);
  }

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
    const topicPrompt =
      customTheme.trim() ||
      currentTopic?.title ||
      `Principais pontos cobrados em prova de ${currentSubject.name}`;

    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_flashcards',
          profileName: profile?.name || 'Concurso Público',
          subjectName: currentSubject.name,
          topicTitle: topicPrompt,
          count: genCount,
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

  function startStudySession(cardsPool: typeof flashcards) {
    if (cardsPool.length === 0) return;
    // Embaralha levemente quando mistura todas as matérias
    const shuffled = [...cardsPool].sort(() => Math.random() - 0.5);
    setStudyQueueIds(shuffled.map((c) => c.id));
    setRevealed(false);
    setStudying(true);
  }

  const activeStudyCard =
    studyQueueIds.length > 0
      ? flashcards.find((c) => c.id === studyQueueIds[0])
      : undefined;
  const activeStudySubject = activeStudyCard
    ? subjects.find((s) => s.id === activeStudyCard.subject_id)
    : undefined;

  async function handleRate(quality: 1 | 2 | 3 | 4) {
    if (!activeStudyCard) return;
    await reviewFlashcard(activeStudyCard, quality);
    setRevealed(false);
    if (quality === 1) {
      setStudyQueueIds((prev) => [...prev.slice(1), prev[0]]);
    } else {
      setStudyQueueIds((prev) => prev.slice(1));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="w-6 h-6 text-blue-600" />
            Flashcards & Revisão Espaçada
          </h1>
          <p className="text-sm text-muted-theme">
            Crie matérias, tópicos e temas livres ou estude o baralho inteiro com todas as matérias juntas.
          </p>
        </div>

        {/* Botões Globais: Estudar Todas as Matérias */}
        <div className="flex flex-wrap items-center gap-2">
          {allDueCards.length > 0 && (
            <button
              onClick={() => startStudySession(allDueCards)}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
            >
              <Zap className="w-4 h-4" />
              Revisar Tudo Hoje ({allDueCards.length})
            </button>
          )}
          {flashcards.length > 0 && (
            <button
              onClick={() => startStudySession(flashcards)}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
            >
              <Globe2 className="w-4 h-4" />
              Estudar Baralho Inteiro ({flashcards.length})
            </button>
          )}
        </div>
      </div>

      {/* Nível 1: Baralhos por Matéria + Nova Matéria */}
      <div className="space-y-2.5">
        <p className="text-xs font-bold text-muted-theme uppercase tracking-wider">
          1. Escolha ou Crie a Matéria
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

        <form onSubmit={handleAddSubject} className="flex gap-2 max-w-md">
          <input
            value={newSubjectName}
            onChange={(e) => setNewSubjectName(e.target.value)}
            placeholder="Adicionar nova matéria (ex: Redação, Atualidades)..."
            className="flex-1 rounded-xl card-surface px-3 py-2 text-xs"
          />
          <button
            type="submit"
            className="px-3 py-2 rounded-xl subtle-surface text-xs font-semibold inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Matéria
          </button>
        </form>
      </div>

      {/* Nível 2: Sub-baralho por Tópico + Novo Tópico */}
      <div className="space-y-2.5">
        <p className="text-xs font-bold text-muted-theme uppercase tracking-wider">
          2. Escolha ou Crie um Tópico (opcional)
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={selectedTopicId}
            onChange={(e) => setSelectedTopicId(e.target.value)}
            className="flex-1 rounded-xl card-surface px-4 py-2.5 text-sm"
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
          <form onSubmit={handleAddTopic} className="flex gap-2 sm:w-80">
            <input
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              placeholder="Novo tópico/tema nesta matéria..."
              className="flex-1 rounded-xl card-surface px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="px-3 py-2 rounded-xl subtle-surface text-xs font-semibold inline-flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Tópico
            </button>
          </form>
        </div>
      </div>

      {/* Nível 3: Criar Flashcard Manual OU Gerar com Gemini (Tema Livre) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleAddCard}
          className="lg:col-span-2 card-surface rounded-2xl p-5 shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-bold text-sm">Criar Flashcard ou Gerar com Gemini</h2>
            <div className="flex items-center gap-2">
              {dueCards.length > 0 && (
                <button
                  type="button"
                  onClick={() => startStudySession(dueCards)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                >
                  Revisar Matéria ({dueCards.length})
                </button>
              )}
              {deckCards.length > 0 && (
                <button
                  type="button"
                  onClick={() => startStudySession(deckCards)}
                  className="px-3 py-1.5 rounded-xl subtle-surface text-xs font-semibold"
                >
                  Estudar Matéria ({deckCards.length})
                </button>
              )}
            </div>
          </div>

          {/* Gerador Gemini com tema livre */}
          <div className="subtle-surface rounded-xl p-3 space-y-2">
            <p className="text-[11px] font-bold text-violet-600 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              Gerar Flashcards com IA (pode digitar qualquer tema livre abaixo)
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={customTheme}
                onChange={(e) => setCustomTheme(e.target.value)}
                placeholder="Tema livre (ex: Súmulas TST, Crase, Prazos Lei 8.112) ou deixe vazio para usar o tópico"
                className="flex-1 rounded-xl card-surface px-3 py-2 text-xs"
              />
              <select
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value) as 5 | 10 | 15)}
                className="rounded-xl card-surface px-2.5 py-2 text-xs font-semibold"
              >
                <option value={5}>5 cards</option>
                <option value={10}>10 cards</option>
                <option value={15}>15 cards</option>
              </select>
              <button
                type="button"
                onClick={handleGenerateWithGemini}
                disabled={generating || !currentSubject}
                className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60 shrink-0"
              >
                {generating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {generating ? 'Gerando...' : 'Gerar'}
              </button>
            </div>
          </div>

          {/* Importar lista de texto em lote */}
          <div className="subtle-surface rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-teal-700 dark:text-teal-300 flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                Colar Texto com Vários Flashcards (Frente / Verso)
              </p>
              <button
                type="button"
                onClick={() => setShowBulkBox((v) => !v)}
                className="px-3 py-1 rounded-xl card-surface text-xs font-bold"
              >
                {showBulkBox ? 'Fechar' : 'Colar Lista'}
              </button>
            </div>
            {showBulkBox && (
              <div className="space-y-2.5 pt-1">
                <textarea
                  rows={5}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={"Cole aqui sua lista, por exemplo:\n1.\n- Frente: O que é norma de eficácia plena?\n- Verso: Produz todos os seus efeitos desde a entrada em vigor."}
                  className="w-full rounded-xl card-surface p-3 text-xs font-mono"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-theme">
                    {parsedBulk.length > 0
                      ? `${parsedBulk.length} flashcard(s) identificado(s) automaticamente!`
                      : 'Use "Frente:" / "Verso:" ou "Pergunta:" / "Resposta:"'}
                  </span>
                  <button
                    type="button"
                    disabled={parsedBulk.length === 0 || importingBulk}
                    onClick={handleBulkImport}
                    className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold disabled:opacity-50"
                  >
                    {importingBulk
                      ? 'Importando...'
                      : `Importar ${parsedBulk.length} Card(s)`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {aiError && (
            <div className="p-3 rounded-xl bg-red-500/15 text-red-500 text-xs">{aiError}</div>
          )}

          <input
            required
            value={front}
            onChange={(e) => setFront(e.target.value)}
            placeholder="Pergunta manual (Frente do card)..."
            className="w-full rounded-xl subtle-surface border border-theme px-3.5 py-2.5 text-sm"
          />
          <textarea
            required
            rows={2}
            value={back}
            onChange={(e) => setBack(e.target.value)}
            placeholder="Resposta manual (Verso do card)..."
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
            <h2 className="font-bold text-sm mb-2">Resumo</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-theme">Nesta matéria/tópico:</span>
                <span className="font-bold">{deckCards.length} cards</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-theme">Para revisar hoje (aqui):</span>
                <span className="font-bold text-emerald-600">{dueCards.length}</span>
              </div>
              <div className="border-t border-theme my-2 pt-2 flex justify-between">
                <span className="text-muted-theme">Baralho inteiro (todas):</span>
                <span className="font-bold text-indigo-600">{flashcards.length} cards</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-theme">Total para revisar hoje:</span>
                <span className="font-bold text-emerald-600">{allDueCards.length}</span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-theme">
            O algoritmo SM-2 agenda automaticamente cada card de acordo com sua facilidade em lembrar.
          </p>
        </div>
      </div>

      {/* Lista de Flashcards */}
      <div className="space-y-2.5">
        <h2 className="font-bold text-sm">Cards neste Baralho ({deckCards.length})</h2>
        {deckCards.length === 0 ? (
          <div className="card-surface rounded-2xl p-8 text-center text-sm text-muted-theme">
            Nenhum flashcard aqui ainda. Crie um acima ou peça para o Gemini gerar sobre qualquer tema!
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
              <div className="flex items-center gap-2">
                {activeStudySubject && (
                  <span
                    className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: activeStudySubject.color }}
                  >
                    {activeStudySubject.name}
                  </span>
                )}
                <span className="text-xs font-bold text-blue-600">
                  {activeStudyCard
                    ? `Restam ${studyQueueIds.length} card(s)`
                    : 'Sessão Concluída!'}
                </span>
              </div>
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
