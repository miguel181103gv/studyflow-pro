'use client';

import { useEffect, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { useGlobal } from '@/components/GlobalProvider';
import {
  ListChecks,
  Plus,
  Sparkles,
  Loader2,
  Trash2,
  X,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
  FileText,
  AlertTriangle,
  Globe2,
  BookOpen,
  Zap,
  Eye,
  EyeOff,
} from 'lucide-react';

interface QuizOption {
  letter: string;
  text: string;
}

interface BankQuestion {
  id: string;
  subject_id: string;
  topic_id: string | null;
  header?: string;
  statement: string;
  options: QuizOption[];
  correct_answer: string;
  explanation?: string;
  prev_wrong_answer?: string;
  created_at: string;
}

type SelectedScope =
  | null
  | { type: 'all' }
  | { type: 'errors_all' }
  | { type: 'subject'; subjectId: string }
  | { type: 'topic'; subjectId: string; topicId: string };

type AddMode = 'text' | 'image';

const Q_MARKER = '<!--SF_Q_JSON:';

function parseErrorToBankQuestion(
  entry: {
    id: string;
    subject_id: string;
    topic_id: string | null;
    question_text: string;
    user_answer: string;
    correct_answer: string;
    explanation: string;
    golden_rule: string;
    created_at: string;
  }
): BankQuestion | null {
  const raw = entry.question_text || '';
  const idx = raw.indexOf(Q_MARKER);
  if (idx !== -1) {
    const start = idx + Q_MARKER.length;
    const end = raw.indexOf('-->', start);
    if (end !== -1) {
      try {
        const parsed = JSON.parse(raw.slice(start, end)) as {
          header?: string;
          statement: string;
          options: QuizOption[];
        };
        if (parsed.statement && Array.isArray(parsed.options) && parsed.options.length > 0) {
          return {
            id: `err-${entry.id}`,
            subject_id: entry.subject_id,
            topic_id: entry.topic_id,
            header: parsed.header,
            statement: parsed.statement,
            options: parsed.options,
            correct_answer: (entry.correct_answer || '').trim().toUpperCase(),
            explanation: [
              entry.golden_rule ? `Regra de Ouro: ${entry.golden_rule}` : '',
              entry.explanation || '',
            ]
              .filter(Boolean)
              .join('\n\n'),
            prev_wrong_answer: (entry.user_answer || '').trim().toUpperCase(),
            created_at: entry.created_at,
          };
        }
      } catch {
        // fallback below
      }
    }
  }
  return null;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function plural(n: number, s: string, p: string) {
  return `${n} ${n === 1 ? s : p}`;
}

export default function QuestoesPage() {
  const { profile, subjects, topics, errors } = useProfile();
  const { notify } = useGlobal();

  const storageKey = `sf_question_bank_${profile?.id || 'default'}`;
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [selectedScope, setSelectedScope] = useState<SelectedScope>(null);
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});

  // Adicionar questões (Texto ou Imagem -> Quiz)
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('text');
  const [rawTextInput, setRawTextInput] = useState('');
  const [converting, setConverting] = useState(false);
  const [targetSubjectId, setTargetSubjectId] = useState('');
  const [targetTopicId, setTargetTopicId] = useState('');

  // Modal Quiz Interativo
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizTitle, setQuizTitle] = useState('');
  const [quizQueue, setQuizQueue] = useState<BankQuestion[]>([]);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizPicked, setQuizPicked] = useState('');
  const [quizAnswered, setQuizAnswered] = useState(false);
  const [quizShowPrevWrong, setQuizShowPrevWrong] = useState(false);
  const [quizHits, setQuizHits] = useState(0);
  const [quizMisses, setQuizMisses] = useState(0);
  const [quizDone, setQuizDone] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setQuestions(parsed);
      }
    } catch {
      // ignore
    }
  }, [storageKey]);

  function saveBank(next: BankQuestion[]) {
    setQuestions(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!selectedScope) {
      setShowAddPanel(false);
      return;
    }
    if (selectedScope.type === 'topic') {
      setTargetSubjectId(selectedScope.subjectId);
      setTargetTopicId(selectedScope.topicId);
    } else if (selectedScope.type === 'subject') {
      setTargetSubjectId(selectedScope.subjectId);
      setTargetTopicId('');
    } else {
      setTargetSubjectId(subjects[0]?.id || '');
      setTargetTopicId('');
    }
  }, [selectedScope, subjects]);

  const digitizedErrorQuestions: BankQuestion[] = errors
    .map(parseErrorToBankQuestion)
    .filter(Boolean) as BankQuestion[];

  const activeSubject =
    selectedScope && (selectedScope.type === 'subject' || selectedScope.type === 'topic')
      ? subjects.find((s) => s.id === selectedScope.subjectId)
      : undefined;
  const activeTopic =
    selectedScope && selectedScope.type === 'topic'
      ? topics.find((t) => t.id === selectedScope.topicId)
      : undefined;

  const scopeQuestions = !selectedScope
    ? []
    : selectedScope.type === 'all'
    ? questions
    : selectedScope.type === 'errors_all'
    ? digitizedErrorQuestions
    : selectedScope.type === 'subject'
    ? questions.filter((q) => q.subject_id === selectedScope.subjectId)
    : questions.filter(
        (q) => q.subject_id === selectedScope.subjectId && q.topic_id === selectedScope.topicId
      );

  const effectiveSubjectId = targetSubjectId || subjects[0]?.id || '';
  const effectiveSubject = subjects.find((s) => s.id === effectiveSubjectId);
  const effectiveTopics = topics.filter((t) => t.subject_id === effectiveSubjectId);
  const effectiveTopic = effectiveTopics.find((t) => t.id === targetTopicId);

  async function handleConvertTextToQuiz(e: React.FormEvent) {
    e.preventDefault();
    if (!rawTextInput.trim() || !effectiveSubjectId) return;
    setConverting(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'digitize_text_questions',
          rawText: rawTextInput,
          subjectName: effectiveSubject?.name || '',
          topicTitle: effectiveTopic?.title || '',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao transformar em quiz.');
      const list = Array.isArray(json.data?.questions) ? json.data.questions : [];
      if (list.length === 0) throw new Error('Nenhuma questão encontrada no texto enviado.');

      const created: BankQuestion[] = list.map(
        (q: {
          header?: string;
          statement: string;
          options?: QuizOption[];
          correct_answer?: string;
          explanation?: string;
        }, i: number) => ({
          id: `q-${Date.now()}-${i}`,
          subject_id: effectiveSubjectId,
          topic_id: targetTopicId || null,
          header: q.header || '',
          statement: q.statement,
          options: Array.isArray(q.options) ? q.options : [],
          correct_answer: String(q.correct_answer || '').trim().toUpperCase(),
          explanation: q.explanation || '',
          created_at: new Date().toISOString(),
        })
      );

      saveBank([...created, ...questions]);
      setRawTextInput('');
      setShowAddPanel(false);
      notify(`${plural(created.length, 'questão transformada', 'questões transformadas')} em quiz!`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao converter texto.', 'error');
    } finally {
      setConverting(false);
    }
  }

  async function handleConvertImageToQuiz(file: File) {
    if (!effectiveSubjectId) return;
    setConverting(true);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'digitize_error_question',
          imageBase64: base64,
          mimeType: file.type || 'image/png',
          subjectName: effectiveSubject?.name || '',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data?.statement) {
        throw new Error(json.error || 'Não foi possível digitalizar a foto.');
      }

      const created: BankQuestion = {
        id: `q-${Date.now()}`,
        subject_id: effectiveSubjectId,
        topic_id: targetTopicId || null,
        header: json.data.header || '',
        statement: json.data.statement,
        options: Array.isArray(json.data.options) ? json.data.options : [],
        correct_answer: String(json.data.correct_answer || '').trim().toUpperCase(),
        explanation: [
          json.data.golden_rule ? `Regra de Ouro: ${json.data.golden_rule}` : '',
          json.data.explanation || '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        prev_wrong_answer: json.data.user_wrong_answer
          ? String(json.data.user_wrong_answer).trim().toUpperCase()
          : undefined,
        created_at: new Date().toISOString(),
      };

      saveBank([created, ...questions]);
      setShowAddPanel(false);
      notify('Foto transformada em questão interativa!', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao digitalizar imagem.', 'error');
    } finally {
      setConverting(false);
    }
  }

  function handlePasteImage(e: React.ClipboardEvent) {
    if (addMode !== 'image') return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) handleConvertImageToQuiz(file);
      }
    }
  }

  function startQuiz(pool: BankQuestion[], title: string) {
    if (pool.length === 0) return;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    setQuizTitle(title);
    setQuizQueue(shuffled);
    setQuizIdx(0);
    setQuizPicked('');
    setQuizAnswered(false);
    setQuizShowPrevWrong(false);
    setQuizHits(0);
    setQuizMisses(0);
    setQuizDone(false);
    setQuizOpen(true);
  }

  const currentQ = quizQueue[quizIdx];
  const currentQSub = currentQ ? subjects.find((s) => s.id === currentQ.subject_id) : undefined;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {!selectedScope ? (
        /* TELA 1: ESCOLHER ESCOPO (TÓPICO · MATÉRIA · TODAS · CADERNO DE ERROS) */
        <div className="space-y-5 animate-fade-in-up">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ListChecks className="w-6 h-6 text-teal-600" />
              Banco de Questões (Quiz)
            </h1>
            <p className="text-sm text-muted-theme mt-0.5">
              Adicione questões em texto ou imagem para cada tópico e resolva em modo quiz por tópico, matéria ou caderno de erros.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedScope({ type: 'all' })}
              className="text-left card-surface rounded-2xl p-5 hover:border-teal-500/50 flex items-center justify-between gap-3 group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-teal-600/12 text-teal-600 flex items-center justify-center shrink-0">
                  <Globe2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">Todas as Questões</p>
                  <p className="text-xs text-muted-theme mt-0.5">
                    {plural(questions.length, 'questão salva', 'questões salvas')}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-theme group-hover:text-teal-600 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() =>
                digitizedErrorQuestions.length > 0
                  ? startQuiz(digitizedErrorQuestions, 'Questões Gerais — Caderno de Erros')
                  : notify(
                      'Digitalize fotos no Caderno de Erros para resolver em modo quiz aqui!',
                      'info'
                    )
              }
              className="text-left card-surface rounded-2xl p-5 hover:border-amber-500/50 flex items-center justify-between gap-3 group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">Caderno de Erros (Geral)</p>
                  <p className="text-xs text-muted-theme mt-0.5">
                    {plural(
                      digitizedErrorQuestions.length,
                      'questão pronta para resolver',
                      'questões prontas para resolver'
                    )}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-theme group-hover:text-amber-500 shrink-0" />
            </button>
          </div>

          <div className="card-surface rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-theme">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-theme">
                Por Matéria e Tópico
              </span>
            </div>

            <div className="divide-y divide-[var(--border-main)]">
              {subjects.map((sub) => {
                const subQs = questions.filter((q) => q.subject_id === sub.id);
                const subTopics = topics.filter((t) => t.subject_id === sub.id);
                const isOpen = !!expandedSubjects[sub.id];

                return (
                  <div key={sub.id}>
                    <div className="px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[var(--bg-subtle)]/60">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSubjects((prev) => ({ ...prev, [sub.id]: !isOpen }))
                          }
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
                          onClick={() => setSelectedScope({ type: 'subject', subjectId: sub.id })}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: sub.color }}
                          />
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{sub.name}</p>
                            <p className="text-xs text-muted-theme">
                              {plural(subQs.length, 'questão', 'questões')} ·{' '}
                              {plural(subTopics.length, 'tópico', 'tópicos')}
                            </p>
                          </div>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedScope({ type: 'subject', subjectId: sub.id })}
                        className="px-3 py-1.5 rounded-xl subtle-surface hover:bg-teal-600 hover:text-white text-xs font-semibold shrink-0"
                      >
                        Abrir
                      </button>
                    </div>

                    {isOpen && (
                      <div className="bg-[var(--bg-subtle)]/40 border-t border-theme pl-11 pr-4 py-2 space-y-1 animate-fade-in-up">
                        {subTopics.map((tp) => {
                          const tpQs = questions.filter((q) => q.topic_id === tp.id);
                          return (
                            <button
                              key={tp.id}
                              type="button"
                              onClick={() =>
                                setSelectedScope({
                                  type: 'topic',
                                  subjectId: sub.id,
                                  topicId: tp.id,
                                })
                              }
                              className="w-full text-left px-3 py-2 rounded-xl hover:bg-[var(--bg-card)] flex items-center justify-between gap-3"
                            >
                              <span className="text-xs font-medium truncate">{tp.title}</span>
                              <span className="text-[11px] text-muted-theme shrink-0">
                                {plural(tpQs.length, 'questão', 'questões')}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* TELA 2: DENTRO DO TÓPICO / MATÉRIA ESCOLHIDA */
        <div className="space-y-5 animate-fade-in-up">
          <button
            type="button"
            onClick={() => setSelectedScope(null)}
            className="text-xs font-semibold text-muted-theme hover:text-teal-600 inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para todas as matérias
          </button>

          <div className="card-surface rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              {selectedScope.type === 'topic' && activeSubject && (
                <p className="text-xs font-semibold text-teal-600 mb-0.5">{activeSubject.name}</p>
              )}
              <h1 className="text-xl font-bold truncate">
                {selectedScope.type === 'all'
                  ? 'Todas as Questões'
                  : selectedScope.type === 'subject'
                  ? activeSubject?.name
                  : activeTopic?.title}
              </h1>
              <p className="text-xs text-muted-theme mt-1">
                {plural(scopeQuestions.length, 'questão disponível', 'questões disponíveis')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {scopeQuestions.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    startQuiz(
                      scopeQuestions,
                      selectedScope.type === 'topic'
                        ? `Quiz: ${activeTopic?.title}`
                        : selectedScope.type === 'subject'
                        ? `Quiz: ${activeSubject?.name}`
                        : 'Quiz Geral'
                    )
                  }
                  className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
                >
                  <BookOpen className="w-4 h-4" />
                  Resolver Quiz ({scopeQuestions.length})
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAddPanel((v) => !v)}
                className="px-4 py-2.5 rounded-xl subtle-surface border border-theme hover:border-teal-500/50 text-xs font-bold inline-flex items-center gap-1.5"
              >
                {showAddPanel ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {showAddPanel ? 'Fechar' : 'Adicionar questões'}
              </button>
            </div>
          </div>

          {showAddPanel && (
            <div
              onPaste={handlePasteImage}
              className="card-surface rounded-2xl p-5 space-y-4 animate-fade-in-up"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="font-bold text-sm flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-violet-600" />
                  Transformar Texto ou Imagem em Quiz
                </h2>
                <div className="inline-flex p-1 rounded-xl subtle-surface gap-1">
                  <button
                    type="button"
                    onClick={() => setAddMode('text')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                      addMode === 'text' ? 'bg-teal-600 text-white' : 'text-muted-theme'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Enviar Texto
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddMode('image')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                      addMode === 'image' ? 'bg-teal-600 text-white' : 'text-muted-theme'
                    }`}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    Enviar Foto / Print
                  </button>
                </div>
              </div>

              {selectedScope.type === 'all' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    value={effectiveSubjectId}
                    onChange={(e) => {
                      setTargetSubjectId(e.target.value);
                      setTargetTopicId('');
                    }}
                    className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  >
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={targetTopicId}
                    onChange={(e) => setTargetTopicId(e.target.value)}
                    className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  >
                    <option value="">Tópico (opcional)</option>
                    {effectiveTopics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {addMode === 'text' ? (
                <form onSubmit={handleConvertTextToQuiz} className="space-y-3">
                  <textarea
                    rows={6}
                    required
                    value={rawTextInput}
                    onChange={(e) => setRawTextInput(e.target.value)}
                    placeholder="Cole aqui uma ou várias questões em texto (com ou sem gabarito) — o Gemini separa o enunciado, cria as alternativas clicáveis e comenta o gabarito!"
                    className="w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 p-3 text-xs"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={converting || !rawTextInput.trim()}
                      className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {converting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      {converting ? 'Transformando em Quiz...' : 'Transformar em Quiz'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="rounded-2xl border border-dashed border-teal-500/45 p-6 text-center space-y-3">
                  {converting ? (
                    <div className="flex flex-col items-center gap-2 text-violet-600">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <p className="text-xs font-bold">
                        Digitalizando a foto e montando o quiz...
                      </p>
                    </div>
                  ) : (
                    <>
                      <ImageIcon className="w-8 h-8 mx-auto text-teal-600 opacity-75" />
                      <p className="text-xs text-muted-theme">
                        Aperte <strong>Ctrl+V</strong> para colar o print de uma questão ou escolha a imagem abaixo:
                      </p>
                      <label className="cursor-pointer inline-block px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold">
                        Escolher Imagem
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleConvertImageToQuiz(f);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {scopeQuestions.length === 0 ? (
            <div className="card-surface rounded-2xl p-10 text-center space-y-3">
              <p className="text-sm text-muted-theme">
                Nenhuma questão adicionada aqui ainda. Envie um texto ou print para criar seu quiz!
              </p>
              {!showAddPanel && (
                <button
                  type="button"
                  onClick={() => setShowAddPanel(true)}
                  className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar primeira questão
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {scopeQuestions.map((q, i) => (
                <div key={q.id} className="card-surface rounded-2xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full subtle-surface">
                        #{i + 1}
                      </span>
                      {q.header && (
                        <span className="text-[11px] text-muted-theme font-medium">{q.header}</span>
                      )}
                      <span className="text-[11px] text-muted-theme">
                        · {q.options.length} alternativas
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => saveBank(questions.filter((x) => x.id !== q.id))}
                      className="p-1 rounded-lg hover:bg-rose-500/15 text-muted-theme hover:text-rose-600"
                      title="Excluir questão"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-sm font-medium line-clamp-3">{q.statement}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL QUIZ INTERATIVO */}
      {quizOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-2xl rounded-3xl p-6 my-8 space-y-5 shadow-2xl animate-pop-in">
            <div className="flex items-center justify-between gap-2 border-b border-theme pb-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-teal-600 truncate">{quizTitle}</p>
                {!quizDone && currentQ && (
                  <p className="text-xs text-muted-theme mt-0.5">
                    Questão {quizIdx + 1} de {quizQueue.length} ·{' '}
                    <span className="text-emerald-600 font-bold">{quizHits} acerto(s)</span> ·{' '}
                    <span className="text-rose-600 font-bold">{quizMisses} erro(s)</span>
                  </p>
                )}
              </div>
              <button
                onClick={() => setQuizOpen(false)}
                className="p-2 rounded-xl subtle-surface shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {quizDone || !currentQ ? (
              <div className="text-center py-8 space-y-4">
                <Zap className="w-10 h-10 mx-auto text-teal-600" />
                <h3 className="text-xl font-extrabold">Quiz concluído!</h3>
                <p className="text-sm text-muted-theme">
                  Você acertou <strong className="text-emerald-600">{quizHits}</strong> de{' '}
                  <strong>{quizQueue.length}</strong> questões.
                </p>
                <button
                  onClick={() => setQuizOpen(false)}
                  className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
                >
                  Fechar Quiz
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {currentQSub && (
                    <span
                      className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: currentQSub.color }}
                    >
                      {currentQSub.name}
                    </span>
                  )}
                  {currentQ.header && (
                    <span className="text-xs text-muted-theme font-semibold">
                      {currentQ.header}
                    </span>
                  )}
                </div>

                <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                  {currentQ.statement}
                </p>

                <div className="space-y-2">
                  {currentQ.options.map((opt) => {
                    const letter = opt.letter.trim().toUpperCase();
                    const isSelected = quizPicked === letter;
                    const isRight =
                      quizAnswered && currentQ.correct_answer && letter === currentQ.correct_answer;
                    const isWrong =
                      quizAnswered &&
                      isSelected &&
                      currentQ.correct_answer &&
                      letter !== currentQ.correct_answer;

                    let cls = 'border-theme bg-[var(--bg-card)] hover:border-teal-500/60';
                    let bdg = 'subtle-surface border border-theme';
                    if (isRight) {
                      cls = 'border-emerald-500 bg-emerald-500/10';
                      bdg = 'bg-emerald-600 text-white border-emerald-600';
                    } else if (isWrong) {
                      cls = 'border-rose-500 bg-rose-500/10';
                      bdg = 'bg-rose-600 text-white border-rose-600';
                    } else if (isSelected) {
                      cls = 'border-teal-600 bg-teal-600/8';
                      bdg = 'bg-teal-600 text-white border-teal-600';
                    }

                    return (
                      <button
                        key={letter}
                        type="button"
                        disabled={quizAnswered}
                        onClick={() => setQuizPicked(letter)}
                        className={`w-full text-left rounded-2xl border p-3.5 flex items-start gap-3 transition ${cls}`}
                      >
                        <span
                          className={`w-7 h-7 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${bdg}`}
                        >
                          {letter}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-relaxed">{opt.text}</p>
                          {quizShowPrevWrong && currentQ.prev_wrong_answer === letter && (
                            <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600">
                              Alternativa que você marcou errado antes
                            </span>
                          )}
                        </div>
                        {isRight && (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                        )}
                        {isWrong && (
                          <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {quizAnswered && currentQ.explanation && (
                  <div className="rounded-2xl subtle-surface p-4 text-xs text-muted-theme leading-relaxed whitespace-pre-wrap animate-fade-in-up">
                    {currentQ.explanation}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-theme flex-wrap">
                  {currentQ.prev_wrong_answer ? (
                    <button
                      type="button"
                      onClick={() => setQuizShowPrevWrong((v) => !v)}
                      className="px-3 py-2 rounded-xl subtle-surface text-xs font-semibold text-muted-theme inline-flex items-center gap-1.5"
                    >
                      {quizShowPrevWrong ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                      {quizShowPrevWrong
                        ? `Erro anterior: ${currentQ.prev_wrong_answer}`
                        : 'Mostrar o que errei antes'}
                    </button>
                  ) : (
                    <span />
                  )}

                  {!quizAnswered ? (
                    <button
                      type="button"
                      disabled={!quizPicked}
                      onClick={() => {
                        const hit = quizPicked === currentQ.correct_answer;
                        if (hit) setQuizHits((h) => h + 1);
                        else setQuizMisses((m) => m + 1);
                        setQuizAnswered(true);
                      }}
                      className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold disabled:opacity-40"
                    >
                      Responder
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (quizIdx + 1 >= quizQueue.length) {
                          setQuizDone(true);
                        } else {
                          setQuizIdx((i) => i + 1);
                          setQuizPicked('');
                          setQuizAnswered(false);
                          setQuizShowPrevWrong(false);
                        }
                      }}
                      className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      {quizIdx + 1 >= quizQueue.length ? 'Finalizar Quiz' : 'Próxima Questão'}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
