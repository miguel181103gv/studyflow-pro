'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAiProviderName } from '@/lib/useAiProvider';
import { useGlobal } from '@/components/GlobalProvider';
import { useProfile } from '@/components/ProfileProvider';
import { createClient } from '@/lib/supabase/client';
import { formatDateBR, todayISO } from '@/lib/utils';
import { DictionaryText } from '@/components/DictionaryText';
import { DuplicateWarningBanner } from '@/components/DuplicateWarningBanner';
import { compareLongTexts, findSimilarItems } from '@/lib/similarity';
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
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Check,
  BookOpen,
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

type SelectedDeck =
  | null
  | { type: 'course' }
  | { type: 'subject'; subjectId: string }
  | { type: 'topic'; subjectId: string; topicId: string };

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
  const aiName = useAiProviderName();

  const { aiJobs, runAiJob, notify } = useGlobal();
  const today = todayISO();

  // Passo 1: Seleção limpa de baralho (Curso todo | Matéria | Tópico)
  const [selectedDeck, setSelectedDeck] = useState<SelectedDeck>(null);
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});

  // Criar matéria / tópico discretamente na tela inicial
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [addingTopicForSubject, setAddingTopicForSubject] = useState<string | null>(null);
  const [newTopicName, setNewTopicName] = useState('');

  // Passo 2: Painel de criação (só abre ao clicar em "+ Adicionar")
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [createTab, setCreateTab] = useState<CreateTab>('manual');
  const [targetSubjectId, setTargetSubjectId] = useState('');
  const [targetTopicId, setTargetTopicId] = useState('');

  // Form Manual
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDupManual, setConfirmDupManual] = useState(false);
  const [completingManual, setCompletingManual] = useState(false);

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

  // Modo Estudo SM-2
  const [studying, setStudying] = useState(false);
  const [studyQueueIds, setStudyQueueIds] = useState<string[]>([]);
  const [studyHistoryIds, setStudyHistoryIds] = useState<string[]>([]);
  const [studyTotalCount, setStudyTotalCount] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // Mantém destino de criação alinhado ao baralho escolhido
  useEffect(() => {
    if (!selectedDeck) {
      setShowCreatePanel(false);
      return;
    }
    if (selectedDeck.type === 'topic') {
      setTargetSubjectId(selectedDeck.subjectId);
      setTargetTopicId(selectedDeck.topicId);
    } else if (selectedDeck.type === 'subject') {
      setTargetSubjectId(selectedDeck.subjectId);
      setTargetTopicId('');
    } else {
      setTargetSubjectId(subjects[0]?.id || '');
      setTargetTopicId('');
    }
  }, [selectedDeck, subjects]);

  const allDueCount = flashcards.filter((c) => c.due_date <= today).length;

  // Dados do baralho ativo (Passo 2)
  const activeSubject =
    selectedDeck && selectedDeck.type !== 'course'
      ? subjects.find((s) => s.id === selectedDeck.subjectId)
      : undefined;
  const activeTopic =
    selectedDeck && selectedDeck.type === 'topic'
      ? topics.find((t) => t.id === selectedDeck.topicId)
      : undefined;

  const deckCards = !selectedDeck
    ? []
    : selectedDeck.type === 'course'
    ? flashcards
    : selectedDeck.type === 'subject'
    ? flashcards.filter((c) => c.subject_id === selectedDeck.subjectId)
    : flashcards.filter(
        (c) => c.subject_id === selectedDeck.subjectId && c.topic_id === selectedDeck.topicId
      );

  const deckDueCards = deckCards.filter((c) => c.due_date <= today);

  const deckTitle = !selectedDeck
    ? ''
    : selectedDeck.type === 'course'
    ? `${profile?.name || 'Concurso'} (Curso completo)`
    : selectedDeck.type === 'subject'
    ? activeSubject?.name || 'Matéria'
    : activeTopic?.title || 'Tópico';

  const deckSubtitle = !selectedDeck
    ? ''
    : selectedDeck.type === 'course'
    ? 'Todas as matérias e tópicos juntos'
    : selectedDeck.type === 'subject'
    ? 'Todos os tópicos desta matéria'
    : activeSubject?.name || '';

  const parsedBulk = useMemo(() => parseBulkFlashcards(bulkText), [bulkText]);

  const manualCardMatches = useMemo(() => {
    if (!front.trim()) return [];
    return findSimilarItems(front, flashcards, (c) => c.front, 'long', 3);
  }, [front, flashcards]);

  const bulkCardDuplicates = useMemo(() => {
    const dupIdx = new Set<number>();
    const matches: { front: string; existing: string; kind: 'exact' | 'similar' }[] = [];
    parsedBulk.forEach((item, idx) => {
      const m = findSimilarItems(item.front, flashcards, (c) => c.front, 'long', 1);
      if (m.length > 0) {
        dupIdx.add(idx);
        matches.push({ front: item.front, existing: m[0].item.front, kind: m[0].kind });
      } else {
        for (let j = 0; j < idx; j++) {
          const selfM = compareLongTexts(item.front, parsedBulk[j].front);
          if (selfM) {
            dupIdx.add(idx);
            matches.push({ front: item.front, existing: parsedBulk[j].front, kind: selfM.kind });
            break;
          }
        }
      }
    });
    return { dupIdx, matches };
  }, [parsedBulk, flashcards]);

  const effectiveSubjectId = targetSubjectId || subjects[0]?.id || '';
  const effectiveSubject = subjects.find((s) => s.id === effectiveSubjectId);
  const effectiveSubjectTopics = topics.filter((t) => t.subject_id === effectiveSubjectId);
  const effectiveTopic = effectiveSubjectTopics.find((t) => t.id === targetTopicId);

  function toggleExpandSubject(subjectId: string) {
    setExpandedSubjects((prev) => ({ ...prev, [subjectId]: !prev[subjectId] }));
  }

  async function handleAddSubject(e: React.FormEvent) {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    await addSubject(newSubjectName.trim());
    setNewSubjectName('');
    setShowNewSubject(false);
  }

  async function handleAddTopic(e: React.FormEvent, subjectId: string) {
    e.preventDefault();
    if (!newTopicName.trim()) return;
    await addTopic(subjectId, newTopicName.trim());
    setNewTopicName('');
    setAddingTopicForSubject(null);
  }

  async function fetchCompleteFlashcard(
    targetFront: string,
    targetBack = ''
  ): Promise<{ corrected_front: string; corrected_back: string } | null> {
    if (!targetFront.trim()) return null;
    setCompletingManual(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete_flashcard',
          front: targetFront.trim(),
          back: targetBack.trim(),
          subjectName: effectiveSubject?.name || '',
          topicTitle: effectiveTopic?.title || '',
          profileName: profile?.name || '',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data?.corrected_back) {
        throw new Error(json.error || 'Não foi possível completar com a IA.');
      }
      return {
        corrected_front: String(json.data.corrected_front || targetFront).trim(),
        corrected_back: String(json.data.corrected_back).trim(),
      };
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao consultar a IA.', 'error');
      return null;
    } finally {
      setCompletingManual(false);
    }
  }

  async function handleCompleteManualClick() {
    if (!front.trim()) return;
    const data = await fetchCompleteFlashcard(front, back);
    if (data) {
      setFront(data.corrected_front);
      setBack(data.corrected_back);
      notify(`Pergunta corrigida e verso preenchido com ${aiName}!`, 'success');
    }
  }

  async function saveManualCardConfirmed() {
    if (!effectiveSubjectId || !front.trim()) return;
    setSaving(true);
    let finalFront = front.trim();
    let finalBack = back.trim();

    if (!finalBack) {
      const data = await fetchCompleteFlashcard(finalFront, '');
      if (!data) {
        setSaving(false);
        return;
      }
      finalFront = data.corrected_front;
      finalBack = data.corrected_back;
    }

    await addFlashcards([
      {
        subject_id: effectiveSubjectId,
        topic_id: targetTopicId || null,
        front: finalFront,
        back: finalBack,
      },
    ]);
    setFront('');
    setBack('');
    setConfirmDupManual(false);
    setSaving(false);
    notify('Flashcard salvo!', 'success');
  }

  async function handleAddCard(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveSubjectId || !front.trim()) return;
    if (manualCardMatches.length > 0 && !confirmDupManual) {
      setConfirmDupManual(true);
      return;
    }
    await saveManualCardConfirmed();
  }

  async function handleBulkImport(skipDuplicates = false) {
    if (!effectiveSubjectId || parsedBulk.length === 0) return;
    const list = skipDuplicates
      ? parsedBulk.filter((_, idx) => !bulkCardDuplicates.dupIdx.has(idx))
      : parsedBulk;
    if (list.length === 0) return;
    setImportingBulk(true);
    await addFlashcards(
      list.map((c) => ({
        subject_id: effectiveSubjectId,
        topic_id: targetTopicId || null,
        front: c.front,
        back: c.back,
      }))
    );
    setBulkText('');
    setImportingBulk(false);
  }

  function handleGenerateWithGemini() {
    if (!effectiveSubject || !profile || !userId) return;
    const subjectIdSnap = effectiveSubject.id;
    const subjectNameSnap = effectiveSubject.name;
    const topicIdSnap = targetTopicId || null;
    const profileIdSnap = profile.id;
    const profileNameSnap = profile.name || 'Concurso Público';
    const userIdSnap = userId;
    const countSnap = genCount;
    const topicPrompt =
      customTheme.trim() ||
      effectiveTopic?.title ||
      `Principais pontos cobrados em prova de ${subjectNameSnap}`;

    runAiJob({
      id: flashcardJobId,
      kind: 'flashcards',
      label: `Gerando ${countSnap} flashcards de ${subjectNameSnap}`,
      route: `/p/${profileIdSnap}/flashcards`,
      successMsg: `${countSnap} flashcards de ${subjectNameSnap} salvos!`,
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

  function startStudySession(cardsPool: typeof flashcards) {
    if (cardsPool.length === 0) return;
    const shuffled = [...cardsPool].sort(() => Math.random() - 0.5);
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
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* ============================================================
          TELA 1: ESCOLHER BARALHO (CURSO TODO · MATÉRIA · TÓPICO)
          ============================================================ */}
      {!selectedDeck ? (
        <div className="space-y-5 animate-fade-in-up">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <Layers className="w-6 h-6 text-teal-600" />
                Flashcards
              </h1>
              <p className="text-sm text-muted-theme mt-0.5">
                Escolha o curso todo, uma matéria ou um tópico para estudar ou adicionar cards.
              </p>
            </div>
          </div>

          {/* Opção 1: Curso completo */}
          <button
            type="button"
            onClick={() => setSelectedDeck({ type: 'course' })}
            className="w-full text-left card-surface rounded-2xl p-5 hover:border-teal-500/50 flex items-center justify-between gap-4 group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-teal-600/12 text-teal-600 flex items-center justify-center shrink-0">
                <Globe2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-base truncate">
                  {profile?.name || 'Concurso'} — Curso todo
                </p>
                <p className="text-xs text-muted-theme mt-0.5">
                  {plural(flashcards.length, 'card', 'cards')} no total
                  {allDueCount > 0 && (
                    <span className="text-emerald-600 font-semibold">
                      {' '}
                      · {plural(allDueCount, 'pendente hoje', 'pendentes hoje')}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-theme group-hover:text-teal-600 shrink-0" />
          </button>

          {/* Opção 2 e 3: Matérias e subopções de Tópicos */}
          <div className="card-surface rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-theme flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-theme">
                Por Matéria e Tópico
              </span>
              <button
                type="button"
                onClick={() => setShowNewSubject((v) => !v)}
                className="text-xs font-semibold text-teal-600 hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {showNewSubject ? 'Cancelar' : 'Nova matéria'}
              </button>
            </div>

            {showNewSubject && (
              <form
                onSubmit={handleAddSubject}
                className="px-5 py-3 border-b border-theme subtle-surface flex gap-2 animate-fade-in-up"
              >
                <input
                  autoFocus
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="Nome da nova matéria (ex: Redação)..."
                  className={inputClass}
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold shrink-0 inline-flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  Salvar
                </button>
              </form>
            )}

            <div className="divide-y divide-[var(--border-main)]">
              {subjects.map((sub) => {
                const subCards = flashcards.filter((c) => c.subject_id === sub.id);
                const subDue = subCards.filter((c) => c.due_date <= today).length;
                const subTopics = topics.filter((t) => t.subject_id === sub.id);
                const isOpen = !!expandedSubjects[sub.id];

                return (
                  <div key={sub.id}>
                    <div className="px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[var(--bg-subtle)]/60 transition-colors">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => toggleExpandSubject(sub.id)}
                          aria-label={isOpen ? 'Recolher tópicos' : 'Expandir tópicos'}
                          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-theme shrink-0"
                        >
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setSelectedDeck({ type: 'subject', subjectId: sub.id })}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: sub.color }}
                          />
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{sub.name}</p>
                            <p className="text-xs text-muted-theme">
                              {plural(subCards.length, 'card', 'cards')}
                              {subDue > 0 && (
                                <span className="text-emerald-600 font-semibold">
                                  {' '}
                                  · {plural(subDue, 'pendente', 'pendentes')}
                                </span>
                              )}
                              {subTopics.length > 0 && ` · ${plural(subTopics.length, 'tópico', 'tópicos')}`}
                            </p>
                          </div>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedDeck({ type: 'subject', subjectId: sub.id })}
                        className="px-3 py-1.5 rounded-xl subtle-surface hover:bg-teal-600 hover:text-white text-xs font-semibold shrink-0"
                      >
                        Abrir
                      </button>
                    </div>

                    {/* Subopções de tópicos */}
                    {isOpen && (
                      <div className="bg-[var(--bg-subtle)]/40 border-t border-theme pl-11 pr-4 py-2 space-y-1 animate-fade-in-up">
                        {subTopics.map((tp) => {
                          const tpCards = flashcards.filter((c) => c.topic_id === tp.id);
                          const tpDue = tpCards.filter((c) => c.due_date <= today).length;
                          return (
                            <button
                              key={tp.id}
                              type="button"
                              onClick={() =>
                                setSelectedDeck({
                                  type: 'topic',
                                  subjectId: sub.id,
                                  topicId: tp.id,
                                })
                              }
                              className="w-full text-left px-3 py-2 rounded-xl hover:bg-[var(--bg-card)] flex items-center justify-between gap-3 transition-colors"
                            >
                              <span className="text-xs font-medium truncate">{tp.title}</span>
                              <span className="text-[11px] text-muted-theme shrink-0">
                                {plural(tpCards.length, 'card', 'cards')}
                                {tpDue > 0 && (
                                  <span className="text-emerald-600 font-semibold">
                                    {' '}
                                    · {tpDue} hoje
                                  </span>
                                )}
                              </span>
                            </button>
                          );
                        })}

                        {addingTopicForSubject === sub.id ? (
                          <form
                            onSubmit={(e) => handleAddTopic(e, sub.id)}
                            className="flex gap-2 py-1.5"
                          >
                            <input
                              autoFocus
                              value={newTopicName}
                              onChange={(e) => setNewTopicName(e.target.value)}
                              placeholder="Nome do novo tópico..."
                              className="flex-1 rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs"
                            />
                            <button
                              type="submit"
                              className="px-3 py-1.5 rounded-xl bg-teal-600 text-white text-xs font-semibold"
                            >
                              Salvar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAddingTopicForSubject(null);
                                setNewTopicName('');
                              }}
                              className="px-2.5 py-1.5 rounded-xl card-surface text-xs"
                            >
                              Cancelar
                            </button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setAddingTopicForSubject(sub.id)}
                            className="px-3 py-1.5 text-xs font-semibold text-teal-600 hover:underline inline-flex items-center gap-1"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Novo tópico em {sub.name}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* ============================================================
           TELA 2: DENTRO DO BARALHO ESCOLHIDO (ESTUDAR + ADICIONAR + CARDS)
           ============================================================ */
        <div className="space-y-5 animate-fade-in-up">
          {/* Voltar + Título do baralho escolhido */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setSelectedDeck(null)}
              className="text-xs font-semibold text-muted-theme hover:text-teal-600 inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar para todos os baralhos
            </button>

            <div className="card-surface rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                {deckSubtitle && (
                  <p className="text-xs font-semibold text-teal-600 mb-0.5">{deckSubtitle}</p>
                )}
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
                  {deckTitle}
                </h1>
                <p className="text-xs text-muted-theme mt-1">
                  {plural(deckCards.length, 'card', 'cards')} ·{' '}
                  <strong className="text-emerald-600">
                    {plural(deckDueCards.length, 'revisão pendente', 'revisões pendentes')} hoje
                  </strong>
                </p>
              </div>

              {/* Ações principais limpas: Estudar e Adicionar */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {deckDueCards.length > 0 && (
                  <button
                    type="button"
                    onClick={() => startStudySession(deckDueCards)}
                    className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
                  >
                    <Zap className="w-4 h-4" />
                    Revisar pendentes ({deckDueCards.length})
                  </button>
                )}
                {deckCards.length > 0 && (
                  <button
                    type="button"
                    onClick={() => startStudySession(deckCards)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                      deckDueCards.length === 0
                        ? 'bg-teal-600 hover:bg-teal-500 text-white shadow-sm'
                        : 'subtle-surface hover:opacity-85'
                    }`}
                  >
                    <BookOpen className="w-4 h-4" />
                    Estudar todos ({deckCards.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowCreatePanel((v) => !v)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                    showCreatePanel
                      ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                      : 'card-surface border border-theme hover:border-teal-500/50'
                  }`}
                >
                  {showCreatePanel ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {showCreatePanel ? 'Fechar' : 'Adicionar flashcards'}
                </button>
              </div>
            </div>
          </div>

          {/* Painel de criação (só aparece quando o aluno clica em "Adicionar flashcards") */}
          {showCreatePanel && (
            <div className="card-surface rounded-2xl p-5 space-y-4 animate-fade-in-up">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="font-bold text-sm">Adicionar Flashcards</h2>
                <div className="inline-flex p-1 rounded-xl subtle-surface gap-1 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setCreateTab('manual')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                      createTab === 'manual'
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-muted-theme hover:text-[var(--text-main)]'
                    }`}
                  >
                    <PenLine className="w-3.5 h-3.5" />
                    Manual
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateTab('ai')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                      createTab === 'ai'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-muted-theme hover:text-[var(--text-main)]'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Gerar com IA
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateTab('bulk')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                      createTab === 'bulk'
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-muted-theme hover:text-[var(--text-main)]'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Importar lista
                  </button>
                </div>
              </div>

              {/* Se o aluno abriu "Curso todo", permite escolher em qual matéria salvar */}
              {selectedDeck.type === 'course' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Matéria de destino</label>
                    <select
                      value={effectiveSubjectId}
                      onChange={(e) => {
                        setTargetSubjectId(e.target.value);
                        setTargetTopicId('');
                      }}
                      className={inputClass}
                    >
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Tópico (opcional)</label>
                    <select
                      value={targetTopicId}
                      onChange={(e) => setTargetTopicId(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Geral da matéria</option>
                      {effectiveSubjectTopics.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {createTab === 'manual' && (
                <form onSubmit={handleAddCard} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Frente (Pergunta)</label>
                    <input
                      required
                      value={front}
                      onChange={(e) => {
                        setFront(e.target.value);
                        setConfirmDupManual(false);
                      }}
                      placeholder="Digite a pergunta..."
                      className={inputClass}
                    />
                  </div>
                  {manualCardMatches.length > 0 && (
                    <DuplicateWarningBanner
                      title="Atenção: já existe flashcard igual ou parecido"
                      items={manualCardMatches.map((m) => ({
                        id: m.item.id,
                        label: m.item.front.slice(0, 80),
                        detail: m.item.back.slice(0, 60),
                        kind: m.kind,
                      }))}
                      pendingConfirm={confirmDupManual}
                      onConfirmAnyway={() => void saveManualCardConfirmed()}
                      onCancelConfirm={() => setConfirmDupManual(false)}
                    />
                  )}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className="block text-xs font-semibold">
                        Verso{' '}
                        <span className="font-normal text-muted-theme">
                          (opcional — deixe vazio p/ {aiName} corrigir a pergunta e completar)
                        </span>
                      </label>
                      <button
                        type="button"
                        disabled={completingManual || !front.trim()}
                        onClick={() => void handleCompleteManualClick()}
                        className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-45 shrink-0"
                      >
                        {completingManual ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        {completingManual ? 'Completando...' : `Corrigir & Completar c/ ${aiName}`}
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={back}
                      onChange={(e) => setBack(e.target.value)}
                      placeholder="Digite a resposta ou deixe em branco para a IA corrigir sua pergunta e preencher automaticamente..."
                      className={inputClass}
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={saving || completingManual}
                      className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                    >
                      <Plus className="w-4 h-4" />
                      {saving || completingManual
                        ? 'Salvando...'
                        : !back.trim() && front.trim()
                        ? `Corrigir, Completar c/ ${aiName} e Salvar`
                        : 'Salvar Flashcard'}
                    </button>
                  </div>
                </form>
              )}

              {createTab === 'ai' && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-theme">
                    Digite um tema ou deixe vazio para gerar sobre{' '}
                    <strong>{effectiveTopic?.title || effectiveSubject?.name}</strong>. Continua rodando mesmo se você trocar de tela.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      value={customTheme}
                      onChange={(e) => setCustomTheme(e.target.value)}
                      placeholder="Tema opcional (ex: Súmulas TST, Crase)..."
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
                      disabled={generating || !effectiveSubject}
                      className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60 shrink-0"
                    >
                      {generating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      {generating ? 'Gerando...' : `Gerar com ${aiName}`}
                    </button>
                  </div>
                  {aiError && (
                    <div className="p-3 rounded-xl bg-rose-500/15 text-rose-600 text-xs">
                      {aiError}
                    </div>
                  )}
                </div>
              )}

              {createTab === 'bulk' && (
                <div className="space-y-3">
                  <textarea
                    rows={5}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={
                      'Cole aqui sua lista:\n1.\n- Frente: Pergunta...\n- Verso: Resposta...'
                    }
                    className={`${inputClass} font-mono text-xs`}
                  />
                  {bulkCardDuplicates.matches.length > 0 && (
                    <DuplicateWarningBanner
                      title={`${bulkCardDuplicates.matches.length} flashcard(s) da lista já existem ou são parecidos`}
                      items={bulkCardDuplicates.matches.slice(0, 4).map((m, i) => ({
                        id: `bc-${i}`,
                        label: m.front.slice(0, 70),
                        detail: `parecido com "${m.existing.slice(0, 60)}"`,
                        kind: m.kind,
                      }))}
                    />
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted-theme">
                      {parsedBulk.length > 0
                        ? `${plural(parsedBulk.length, 'card identificado', 'cards identificados')} automaticamente`
                        : 'Use "Frente:" / "Verso:" ou separe por "|"'}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {bulkCardDuplicates.matches.length > 0 && parsedBulk.length > bulkCardDuplicates.dupIdx.size && (
                        <button
                          type="button"
                          disabled={importingBulk}
                          onClick={() => void handleBulkImport(true)}
                          className="px-3 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-50"
                        >
                          Ignorar parecidos ({parsedBulk.length - bulkCardDuplicates.dupIdx.size} novos)
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={parsedBulk.length === 0 || importingBulk}
                        onClick={() => void handleBulkImport(false)}
                        className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {importingBulk
                          ? 'Importando...'
                          : `Importar ${plural(parsedBulk.length, 'card', 'cards')}`}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Lista de Cards do baralho escolhido */}
          {deckCards.length === 0 ? (
            <div className="card-surface rounded-2xl p-10 text-center space-y-3">
              <p className="text-sm text-muted-theme">Nenhum flashcard neste baralho ainda.</p>
              {!showCreatePanel && (
                <button
                  type="button"
                  onClick={() => setShowCreatePanel(true)}
                  className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar primeiro flashcard
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {deckCards.map((card) => {
                const s = subjects.find((sb) => sb.id === card.subject_id);
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
                        {selectedDeck.type === 'course' && s && (
                          <span className="text-[10px] font-semibold text-muted-theme">
                            {s.name}
                          </span>
                        )}
                        {selectedDeck.type !== 'topic' && t && (
                          <span className="text-[10px] text-muted-theme truncate max-w-[180px]">
                            · {t.title}
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
                    <p className="text-sm font-semibold"><DictionaryText text={card.front} /></p>
                    <p className="text-xs text-muted-theme border-t border-theme pt-2">
                      <DictionaryText text={card.back} />
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
                  <p className="text-base sm:text-lg font-bold"><DictionaryText text={activeStudyCard.front} /></p>
                </div>

                {revealed ? (
                  <>
                    <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-5 text-center space-y-2 animate-fade-in-up">
                      <p className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-bold">
                        Resposta
                      </p>
                      <p className="text-sm leading-relaxed"><DictionaryText text={activeStudyCard.back} /></p>
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
