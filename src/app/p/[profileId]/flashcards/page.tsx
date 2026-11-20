'use client';

import { useEffect, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { useGlobal } from '@/components/GlobalProvider';
import { createClient } from '@/lib/supabase/client';
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
  PenLine,
  BookOpen,
  FolderOpen,
  Check,
} from 'lucide-react';

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function parseBulkFlashcards(raw: string): { front: string; back: string }[] {
  const results: { front: string; back: string }[] = [];
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return results;

  const regex =
    /(?:^|\n)\s*(?:[-*•]\s*)?(?:Frente|Pergunta|P|Q)\s*:\s*([\s\S]*?)(?:\n\s*(?:[-*•]\s*)?(?:Verso|Resposta|R|A)\s*:\s*([\s\S]*?))(?=\n\s*(?:\d+[.)]|(?:[-*•]\s*)?(?:Frente|Pergunta|P|Q)\s*:)|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const f = match[1].trim();
    const b = match[2].trim();
    if (f && b) results.push({ front: f, back: b });
  }

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

type CreateTab = 'manual' | 'ai' | 'bulk';

export default function FlashcardsPage() {
  const {
    userId,
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

  const { aiJobs, runAiJob } = useGlobal();

  const today = todayISO();
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || '');
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');

  // Ações secundárias recolhíveis para criar matéria / tópico
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [showNewTopic, setShowNewTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');

  // Aba única de criação: Manual (padrão) | Gerar com IA | Importar lista
  const [createTab, setCreateTab] = useState<CreateTab>('manual');

  // Form Manual
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);

  // Form Importar Lista
  const [bulkText, setBulkText] = useState('');
  const [importingBulk, setImportingBulk] = useState(false);

  // Form Gerar com IA (em segundo plano via GlobalProvider)
  const [customTheme, setCustomTheme] = useState('');
  const [genCount, setGenCount] = useState<5 | 10 | 15>(5);
  const flashcardJobId = `flashcards:${profile?.id || 'default'}`;
  const flashcardJob = aiJobs[flashcardJobId];
  const generating = flashcardJob?.status === 'running';
  const aiError = flashcardJob?.status === 'error' ? flashcardJob.error || null : null;

  // Modo Estudo Espaçado (SM-2)
  const [studying, setStudying] = useState(false);
  const [studyScopeLabel, setStudyScopeLabel] = useState('');
  const [studyQueueIds, setStudyQueueIds] = useState<string[]>([]);
  const [studyHistoryIds, setStudyHistoryIds] = useState<string[]>([]);
  const [studyTotalCount, setStudyTotalCount] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const currentSubjectId = selectedSubjectId || subjects[0]?.id || '';
  const currentSubject = subjects.find((s) => s.id === currentSubjectId);
  const subjectTopics = topics.filter((t) => t.subject_id === currentSubjectId);
  const currentTopic = subjectTopics.find((t) => t.id === selectedTopicId);

  // Contagens por escopo (sem ambiguidade)
  const subjectCards = flashcards.filter((c) => c.subject_id === currentSubjectId);
  const subjectDueCards = subjectCards.filter((c) => c.due_date <= today);

  const topicCards = selectedTopicId
    ? subjectCards.filter((c) => c.topic_id === selectedTopicId)
    : subjectCards;
  const topicDueCards = topicCards.filter((c) => c.due_date <= today);

  const allDueCards = flashcards.filter((c) => c.due_date <= today);

  const parsedBulk = parseBulkFlashcards(bulkText);

  async function handleAddSubject(e: React.FormEvent) {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    const created = await addSubject(newSubjectName.trim());
    if (created) {
      setSelectedSubjectId(created.id);
      setSelectedTopicId('');
    }
    setNewSubjectName('');
    setShowNewSubject(false);
  }

  async function handleAddTopic(e: React.FormEvent) {
    e.preventDefault();
    if (!currentSubjectId || !newTopicName.trim()) return;
    await addTopic(currentSubjectId, newTopicName.trim());
    setNewTopicName('');
    setShowNewTopic(false);
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
    setImportingBulk(false);
  }

  function handleGenerateWithGemini() {
    if (!currentSubject || !profile || !userId) return;
    const subjectIdSnap = currentSubject.id;
    const subjectNameSnap = currentSubject.name;
    const topicIdSnap = selectedTopicId || null;
    const profileIdSnap = profile.id;
    const profileNameSnap = profile.name || 'Concurso Público';
    const userIdSnap = userId;
    const countSnap = genCount;
    const topicPrompt =
      customTheme.trim() ||
      currentTopic?.title ||
      `Principais pontos cobrados em prova de ${subjectNameSnap}`;

    runAiJob({
      id: flashcardJobId,
      kind: 'flashcards',
      label: `Gerando ${countSnap} flashcards de ${subjectNameSnap}`,
      route: `/p/${profileIdSnap}/flashcards`,
      successMsg: `${countSnap} flashcards de ${subjectNameSnap} salvos no baralho!`,
      task: async () => {
        const res = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generate_flashcards',
            profileName: profileNameSnap,
            subjectName: subjectNameSnap,
            topicTitle: topicPrompt,
            count: countSnap,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao gerar flashcards.');
        return (json.data?.flashcards || []) as { front: string; back: string }[];
      },
      onDone: async (generated) => {
        if (generated.length === 0) return;
        const supabase = createClient();
        const due = todayISO();
        await supabase.from('flashcards').insert(
          generated.map((g) => ({
            user_id: userIdSnap,
            profile_id: profileIdSnap,
            subject_id: subjectIdSnap,
            topic_id: topicIdSnap,
            front: g.front.trim(),
            back: g.back.trim(),
            ease_factor: 2.5,
            interval_days: 0,
            repetitions: 0,
            due_date: due,
          }))
        );
      },
    });
  }

  function startStudySession(cardsPool: typeof flashcards, scopeLabel: string) {
    if (cardsPool.length === 0) return;
    const shuffled = [...cardsPool].sort(() => Math.random() - 0.5);
    setStudyScopeLabel(scopeLabel);
    setStudyQueueIds(shuffled.map((c) => c.id));
    setStudyHistoryIds([]);
    setStudyTotalCount(shuffled.length);
    setRevealed(false);
    setStudying(true);
  }

  const activeStudyCard =
    studyQueueIds.length > 0 ? flashcards.find((c) => c.id === studyQueueIds[0]) : undefined;
  const activeStudySubject = activeStudyCard
    ? subjects.find((s) => s.id === activeStudyCard.subject_id)
    : undefined;

  async function handleRate(quality: 1 | 2 | 3 | 4) {
    if (!activeStudyCard) return;
    await reviewFlashcard(activeStudyCard, quality);
    setRevealed(false);
    setStudyHistoryIds((prev) => [...prev, activeStudyCard.id]);
    if (quality === 1) {
      setStudyQueueIds((prev) => [...prev.slice(1), prev[0]]);
    } else {
      setStudyQueueIds((prev) => prev.slice(1));
    }
  }

  function handlePrevCard() {
    if (studyHistoryIds.length === 0) return;
    const lastId = studyHistoryIds[studyHistoryIds.length - 1];
    setStudyHistoryIds((prev) => prev.slice(0, -1));
    setStudyQueueIds((prev) => [lastId, ...prev.filter((id) => id !== lastId)]);
    setRevealed(true);
  }

  useEffect(() => {
    if (!studying || !activeStudyCard) return;
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault();
        setRevealed((v) => !v);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        handleRate(Number(e.key) as 1 | 2 | 3 | 4);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studying, activeStudyCard, revealed]);

  const inputClass =
    'w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3.5 py-2.5 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500';

  return (
    <div className="space-y-6">
      {/* Cabeçalho limpo */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Layers className="w-6 h-6 text-teal-600" />
          Flashcards & Revisão Espaçada
        </h1>
        <p className="text-sm text-muted-theme mt-0.5">
          Escolha a matéria e o tópico, crie seus cards e estude por tópico, por matéria ou no baralho completo.
        </p>
      </div>

      {/* 1. ESCOLHA ONDE OS CARDS FICAM (MATÉRIA + TÓPICO + RESUMO COMPACTO) */}
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Seletor de Matéria */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="fc-subject" className="text-xs font-bold uppercase tracking-wider text-muted-theme">
                1. Matéria
              </label>
              <button
                type="button"
                onClick={() => setShowNewSubject((v) => !v)}
                className="text-xs font-semibold text-teal-600 hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {showNewSubject ? 'Cancelar' : 'Nova matéria'}
              </button>
            </div>
            <select
              id="fc-subject"
              value={currentSubjectId}
              onChange={(e) => {
                setSelectedSubjectId(e.target.value);
                setSelectedTopicId('');
              }}
              className={inputClass}
            >
              {subjects.map((s) => {
                const cnt = flashcards.filter((c) => c.subject_id === s.id).length;
                return (
                  <option key={s.id} value={s.id}>
                    {s.name} ({plural(cnt, 'card', 'cards')})
                  </option>
                );
              })}
            </select>

            {showNewSubject && (
              <form onSubmit={handleAddSubject} className="flex gap-2 pt-1 animate-fade-in-up">
                <input
                  autoFocus
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="Nome da nova matéria (ex: Redação)..."
                  className={inputClass}
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold shrink-0 inline-flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  Salvar
                </button>
              </form>
            )}
          </div>

          {/* Seletor de Tópico */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="fc-topic" className="text-xs font-bold uppercase tracking-wider text-muted-theme">
                2. Tópico
              </label>
              <button
                type="button"
                onClick={() => setShowNewTopic((v) => !v)}
                className="text-xs font-semibold text-teal-600 hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {showNewTopic ? 'Cancelar' : 'Novo tópico'}
              </button>
            </div>
            <select
              id="fc-topic"
              value={selectedTopicId}
              onChange={(e) => setSelectedTopicId(e.target.value)}
              className={inputClass}
            >
              <option value="">Todos os tópicos de {currentSubject?.name || 'matéria'}</option>
              {subjectTopics.map((t) => {
                const cnt = flashcards.filter((c) => c.topic_id === t.id).length;
                return (
                  <option key={t.id} value={t.id}>
                    {t.title} ({plural(cnt, 'card', 'cards')})
                  </option>
                );
              })}
            </select>

            {showNewTopic && (
              <form onSubmit={handleAddTopic} className="flex gap-2 pt-1 animate-fade-in-up">
                <input
                  autoFocus
                  value={newTopicName}
                  onChange={(e) => setNewTopicName(e.target.value)}
                  placeholder="Nome do novo tópico..."
                  className={inputClass}
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold shrink-0 inline-flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  Salvar
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Linha de resumo compacta e sem ambiguidade */}
        <div className="pt-3 border-t border-theme flex flex-wrap items-center justify-between gap-2 text-xs text-muted-theme">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {currentTopic ? (
              <>
                <span>
                  <strong className="text-[var(--text-main)]">
                    {plural(topicCards.length, 'card', 'cards')}
                  </strong>{' '}
                  neste tópico
                </span>
                <span>·</span>
                <span>
                  <strong className="text-emerald-600">
                    {plural(topicDueCards.length, 'revisão pendente', 'revisões pendentes')}
                  </strong>{' '}
                  neste tópico
                </span>
                <span>·</span>
              </>
            ) : (
              <>
                <span>
                  <strong className="text-[var(--text-main)]">
                    {plural(subjectCards.length, 'card', 'cards')}
                  </strong>{' '}
                  nesta matéria
                </span>
                <span>·</span>
                <span>
                  <strong className="text-emerald-600">
                    {plural(subjectDueCards.length, 'revisão pendente', 'revisões pendentes')}
                  </strong>{' '}
                  nesta matéria
                </span>
                <span>·</span>
              </>
            )}
            <span>
              <strong className="text-[var(--text-main)]">
                {plural(flashcards.length, 'card', 'cards')}
              </strong>{' '}
              no baralho completo
            </span>
          </div>

          <span className="text-[11px] font-medium">
            Novos cards salvos em:{' '}
            <strong className="text-teal-700 dark:text-teal-300">
              {currentSubject?.name || 'Matéria'}
              {currentTopic ? ` › ${currentTopic.title}` : ' (geral)'}
            </strong>
          </span>
        </div>
      </div>

      {/* 2. FAIXA DEDICADA PARA ESTUDAR (ESCOPO EXPLÍCITO: TÓPICO · MATÉRIA · GERAL) */}
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-teal-600" />
            Estudar Flashcards
          </h2>
          <span className="text-[11px] text-muted-theme">
            O algoritmo SM-2 agenda automaticamente a próxima revisão conforme você responde.
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Nível A: Tópico selecionado */}
          <div className="subtle-surface rounded-xl p-3.5 flex flex-col justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-theme flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-teal-600" />
                {currentTopic ? 'Este Tópico' : 'Tópico'}
              </p>
              <p className="text-xs font-semibold mt-1 truncate">
                {currentTopic ? currentTopic.title : 'Selecione um tópico acima'}
              </p>
              <p className="text-[11px] text-muted-theme mt-0.5">
                {currentTopic
                  ? `${plural(topicCards.length, 'card', 'cards')} · ${plural(topicDueCards.length, 'pendente', 'pendentes')} hoje`
                  : 'Filtre por tópico para estudar isoladamente.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {currentTopic && topicDueCards.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    startStudySession(topicDueCards, `Pendentes · ${currentTopic.title}`)
                  }
                  className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Revisar pendentes ({topicDueCards.length})
                </button>
              )}
              <button
                type="button"
                disabled={!currentTopic || topicCards.length === 0}
                onClick={() =>
                  currentTopic &&
                  startStudySession(topicCards, `Tópico · ${currentTopic.title}`)
                }
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-45 ${
                  currentTopic && topicDueCards.length === 0 && topicCards.length > 0
                    ? 'bg-teal-600 hover:bg-teal-500 text-white'
                    : 'card-surface hover:opacity-85'
                }`}
              >
                Estudar tópico ({currentTopic ? topicCards.length : 0})
              </button>
            </div>
          </div>

          {/* Nível B: Matéria selecionada */}
          <div className="subtle-surface rounded-xl p-3.5 flex flex-col justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-theme flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-teal-600" />
                Esta Matéria
              </p>
              <p className="text-xs font-semibold mt-1 truncate">
                {currentSubject?.name || 'Matéria'}
              </p>
              <p className="text-[11px] text-muted-theme mt-0.5">
                {plural(subjectCards.length, 'card', 'cards')} ·{' '}
                {plural(subjectDueCards.length, 'pendente', 'pendentes')} hoje
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {subjectDueCards.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    startStudySession(
                      subjectDueCards,
                      `Pendentes · ${currentSubject?.name || 'Matéria'}`
                    )
                  }
                  className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Revisar matéria ({subjectDueCards.length})
                </button>
              )}
              <button
                type="button"
                disabled={subjectCards.length === 0}
                onClick={() =>
                  startStudySession(
                    subjectCards,
                    `Matéria completa · ${currentSubject?.name || 'Matéria'}`
                  )
                }
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-45 ${
                  subjectDueCards.length === 0 && subjectCards.length > 0
                    ? 'bg-teal-600 hover:bg-teal-500 text-white'
                    : 'card-surface hover:opacity-85'
                }`}
              >
                Todos da matéria ({subjectCards.length})
              </button>
            </div>
          </div>

          {/* Nível C: Baralho Completo (todas as matérias) */}
          <div className="subtle-surface rounded-xl p-3.5 flex flex-col justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-theme flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5 text-teal-600" />
                Baralho Completo (Geral)
              </p>
              <p className="text-xs font-semibold mt-1">Todas as matérias juntas</p>
              <p className="text-[11px] text-muted-theme mt-0.5">
                {plural(flashcards.length, 'card', 'cards')} ·{' '}
                {plural(allDueCards.length, 'pendente', 'pendentes')} hoje
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allDueCards.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    startStudySession(allDueCards, 'Pendentes · Todas as matérias')
                  }
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Revisar tudo hoje ({allDueCards.length})
                </button>
              )}
              <button
                type="button"
                disabled={flashcards.length === 0}
                onClick={() =>
                  startStudySession(flashcards, 'Baralho completo · Todas as matérias')
                }
                className="px-3 py-1.5 rounded-xl card-surface hover:opacity-85 text-xs font-semibold disabled:opacity-45"
              >
                Baralho completo ({flashcards.length})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. CRIAR FLASHCARD — UMA ÚNICA FORMA VISÍVEL POR VEZ */}
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-sm">Criar Flashcard</h2>
            <p className="text-xs text-muted-theme">
              Será associado a{' '}
              <strong className="text-[var(--text-main)]">
                {currentSubject?.name || 'Matéria'}
                {currentTopic ? ` › ${currentTopic.title}` : ' (todos os tópicos)'}
              </strong>
            </p>
          </div>

          {/* Seletor segmentado das 3 formas de criação */}
          <div className="inline-flex p-1 rounded-xl subtle-surface gap-1 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setCreateTab('manual')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                createTab === 'manual' ? 'bg-teal-600 text-white shadow-sm' : 'text-muted-theme hover:text-[var(--text-main)]'
              }`}
            >
              <PenLine className="w-3.5 h-3.5" />
              Manual
            </button>
            <button
              type="button"
              onClick={() => setCreateTab('ai')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                createTab === 'ai' ? 'bg-violet-600 text-white shadow-sm' : 'text-muted-theme hover:text-[var(--text-main)]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Gerar com IA
            </button>
            <button
              type="button"
              onClick={() => setCreateTab('bulk')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                createTab === 'bulk' ? 'bg-teal-600 text-white shadow-sm' : 'text-muted-theme hover:text-[var(--text-main)]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Importar lista
            </button>
          </div>
        </div>

        {/* Aba 1: Manual (padrão) */}
        {createTab === 'manual' && (
          <form onSubmit={handleAddCard} className="space-y-3 animate-fade-in-up">
            <div>
              <label className="block text-xs font-semibold mb-1">Frente (Pergunta)</label>
              <input
                required
                value={front}
                onChange={(e) => setFront(e.target.value)}
                placeholder="Ex: Qual é a aplicabilidade das normas de eficácia plena?"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Verso (Resposta)</label>
              <textarea
                required
                rows={3}
                value={back}
                onChange={(e) => setBack(e.target.value)}
                placeholder="Ex: Direta, imediata e integral."
                className={inputClass}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <Plus className="w-4 h-4" />
                {saving ? 'Salvando...' : 'Adicionar Flashcard'}
              </button>
            </div>
          </form>
        )}

        {/* Aba 2: Gerar com IA (Gemini em segundo plano) */}
        {createTab === 'ai' && (
          <div className="space-y-3 animate-fade-in-up">
            <p className="text-xs text-muted-theme">
              Digite um tema específico ou deixe em branco para o Gemini gerar cards sobre{' '}
              <strong>{currentTopic?.title || currentSubject?.name}</strong>. Você pode trocar de tela enquanto ele trabalha.
            </p>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                value={customTheme}
                onChange={(e) => setCustomTheme(e.target.value)}
                placeholder="Tema livre (ex: Súmulas TST, Crase, Prazos Lei 8.112)..."
                className={`flex-1 ${inputClass}`}
              />
              <select
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value) as 5 | 10 | 15)}
                className="rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2.5 text-xs font-semibold"
              >
                <option value={5}>5 cards</option>
                <option value={10}>10 cards</option>
                <option value={15}>15 cards</option>
              </select>
              <button
                type="button"
                onClick={handleGenerateWithGemini}
                disabled={generating || !currentSubject}
                className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60 shrink-0"
              >
                {generating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {generating ? 'Gerando com Gemini...' : 'Gerar com Gemini'}
              </button>
            </div>
            {aiError && (
              <div className="p-3 rounded-xl bg-rose-500/15 text-rose-600 text-xs">{aiError}</div>
            )}
          </div>
        )}

        {/* Aba 3: Importar Lista em Lote */}
        {createTab === 'bulk' && (
          <div className="space-y-3 animate-fade-in-up">
            <textarea
              rows={6}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={
                'Cole aqui sua lista, por exemplo:\n1.\n- Frente: O que é norma de eficácia plena?\n- Verso: Produz todos os seus efeitos desde a entrada em vigor.'
              }
              className={`${inputClass} font-mono text-xs`}
            />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-theme">
                {parsedBulk.length > 0
                  ? `${plural(parsedBulk.length, 'flashcard identificado', 'flashcards identificados')} automaticamente`
                  : 'Use "Frente:" / "Verso:", "Pergunta:" / "Resposta:" ou separe por "|"'}
              </span>
              <button
                type="button"
                disabled={parsedBulk.length === 0 || importingBulk}
                onClick={handleBulkImport}
                className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                {importingBulk
                  ? 'Importando...'
                  : `Importar ${plural(parsedBulk.length, 'card', 'cards')}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. LISTA DE FLASHCARDS DO ESCOPO ATUAL */}
      <div className="space-y-3">
        <h2 className="font-bold text-sm">
          {currentTopic
            ? `Cards em "${currentTopic.title}" (${plural(topicCards.length, 'card', 'cards')})`
            : `Cards em ${currentSubject?.name || 'Matéria'} (${plural(topicCards.length, 'card', 'cards')})`}
        </h2>

        {topicCards.length === 0 ? (
          <div className="card-surface rounded-2xl p-8 text-center text-sm text-muted-theme">
            Nenhum flashcard neste filtro ainda. Crie o primeiro acima no modo Manual, com IA ou colando uma lista.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {topicCards.map((card) => {
              const t = topics.find((tp) => tp.id === card.topic_id);
              const isDue = card.due_date <= today;
              return (
                <div key={card.id} className="card-surface rounded-2xl p-4 space-y-2 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isDue
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'subtle-surface text-muted-theme'
                        }`}
                      >
                        {isDue ? 'Revisar hoje' : `Próx: ${formatDateBR(card.due_date)}`}
                      </span>
                      {t && (
                        <span className="text-[10px] text-muted-theme truncate max-w-[220px]">
                          {t.title}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => deleteFlashcard(card.id)}
                      aria-label="Excluir flashcard"
                      className="p-1 rounded-lg hover:bg-rose-500/15 text-muted-theme hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-sm font-semibold">{card.front}</p>
                  <p className="text-xs text-muted-theme border-t border-theme pt-2">{card.back}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Estudo SM-2 */}
      {studying && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-xl rounded-3xl p-6 space-y-5 shadow-2xl animate-pop-in">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                {activeStudySubject && (
                  <span
                    className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: activeStudySubject.color }}
                  >
                    {activeStudySubject.name}
                  </span>
                )}
                <span className="text-xs font-bold text-teal-600">
                  {activeStudyCard
                    ? `${Math.min(studyTotalCount, studyTotalCount - studyQueueIds.length + 1)} de ${studyTotalCount}`
                    : 'Sessão Concluída!'}
                </span>
                {studyScopeLabel && (
                  <span className="text-[11px] text-muted-theme truncate max-w-[200px]">
                    · {studyScopeLabel}
                  </span>
                )}
                {studyHistoryIds.length > 0 && activeStudyCard && (
                  <button
                    onClick={handlePrevCard}
                    className="text-xs font-bold px-2.5 py-1 rounded-xl subtle-surface hover:opacity-80"
                  >
                    ← Anterior
                  </button>
                )}
              </div>
              <button
                onClick={() => setStudying(false)}
                aria-label="Fechar sessão"
                className="p-2 rounded-xl subtle-surface shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeStudyCard ? (
              <>
                <div
                  onClick={() => setRevealed((v) => !v)}
                  className="cursor-pointer subtle-surface rounded-2xl p-6 min-h-[150px] flex flex-col justify-center text-center space-y-3 hover:opacity-95"
                  title="Toque no card ou aperte Espaço para revelar"
                >
                  <p className="text-[11px] uppercase tracking-wider text-muted-theme font-bold">
                    Pergunta (toque ou aperte Espaço)
                  </p>
                  <p className="text-base sm:text-lg font-bold">{activeStudyCard.front}</p>
                </div>

                {revealed ? (
                  <>
                    <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-5 text-center space-y-2 animate-fade-in-up">
                      <p className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-bold">
                        Resposta
                      </p>
                      <p className="text-sm leading-relaxed">{activeStudyCard.back}</p>
                    </div>

                    <div className="grid grid-cols-4 gap-2 pt-1">
                      <button
                        onClick={() => handleRate(1)}
                        className="py-2.5 px-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
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
                        className="py-2.5 px-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
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
                    className="w-full py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
                  >
                    <RotateCw className="w-4 h-4" />
                    Mostrar Resposta
                  </button>
                )}
              </>
            ) : (
              <div className="text-center py-8 space-y-3">
                <p className="text-xl font-bold">Parabéns! Sessão finalizada</p>
                <p className="text-xs text-muted-theme">
                  Todas as próximas datas de revisão foram agendadas automaticamente na nuvem.
                </p>
                <button
                  onClick={() => setStudying(false)}
                  className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold"
                >
                  Voltar aos Flashcards
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
