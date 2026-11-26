'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAiProviderName } from '@/lib/useAiProvider';
import { useProfile } from '@/components/ProfileProvider';
import { DictionaryText } from '@/components/DictionaryText';
import { ExplainForChildButton } from '@/components/ExplainForChildButton';
import { DuplicateWarningBanner } from '@/components/DuplicateWarningBanner';
import { findSimilarItems } from '@/lib/similarity';
import { useGlobal } from '@/components/GlobalProvider';
import { createClient } from '@/lib/supabase/client';
import { todayISO } from '@/lib/utils';
import type { ErrorEntry } from '@/lib/types';
import {
  Plus,
  Sparkles,
  Image as ImageIcon,
  Trash2,
  Pencil,
  Zap,
  Loader2,
  X,
  RotateCw,
  ZoomIn,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  ScanText,
  BookOpen,
  Globe2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const ERROR_CAUSES = [
  'Lacuna teórica',
  'Falta de atenção / leitura',
  'Pegadinha da banca',
  'Esquecimento / falta de revisão',
  'Erro de cálculo',
];

interface DigitizedOption {
  letter: string;
  text: string;
}

interface DigitizedQuestion {
  header?: string;
  statement: string;
  options: DigitizedOption[];
}

const Q_MARKER = '<!--SF_Q_JSON:';

function encodeDigitizedQuestion(q: DigitizedQuestion): string {
  return `${Q_MARKER}${JSON.stringify(q)}-->`;
}

function parseDigitizedQuestion(raw: string | null | undefined): DigitizedQuestion | null {
  if (!raw) return null;
  const idx = raw.indexOf(Q_MARKER);
  if (idx === -1) return null;
  const start = idx + Q_MARKER.length;
  const end = raw.indexOf('-->', start);
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end)) as DigitizedQuestion;
    if (parsed && parsed.statement && Array.isArray(parsed.options) && parsed.options.length > 0) {
      return parsed;
    }
  } catch {
    return null;
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
  const aiName = useAiProviderName();

  const { aiJobs, runAiJob, notify } = useGlobal();

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [filterSubject, setFilterSubject] = useState('');
  const [filterTopic, setFilterTopic] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  const [selectedByCard, setSelectedByCard] = useState<Record<string, string>>({});
  const [eliminatedByCard, setEliminatedByCard] = useState<Record<string, string[]>>({});
  const [submittedByCard, setSubmittedByCard] = useState<Record<string, boolean>>({});
  const [showPrevWrongByCard, setShowPrevWrongByCard] = useState<Record<string, boolean>>({});
  const [showOriginalImgByCard, setShowOriginalImgByCard] = useState<Record<string, boolean>>({});
  const [collapsedByCard, setCollapsedByCard] = useState<Record<string, boolean>>({});
  const [editingTopicEntryId, setEditingTopicEntryId] = useState<string | null>(null);
  const [editEntrySubjectId, setEditEntrySubjectId] = useState('');
  const [editEntryTopicId, setEditEntryTopicId] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [digitizedDraft, setDigitizedDraft] = useState<DigitizedQuestion | null>(null);
  const [digitizingUpload, setDigitizingUpload] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [errorCause, setErrorCause] = useState(ERROR_CAUSES[0]);
  const [explanation, setExplanation] = useState('');
  const [goldenRule, setGoldenRule] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDupError, setConfirmDupError] = useState(false);

  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTitle, setDrillTitle] = useState('');
  const [drillQueue, setDrillQueue] = useState<ErrorEntry[]>([]);
  const [drillIdx, setDrillIdx] = useState(0);
  const [drillPicked, setDrillPicked] = useState<string>('');
  const [drillAnswered, setDrillAnswered] = useState(false);
  const [drillShowPrevWrong, setDrillShowPrevWrong] = useState(false);
  const [drillHits, setDrillHits] = useState(0);
  const [drillMisses, setDrillMisses] = useState(0);
  const [drillFinished, setDrillFinished] = useState(false);

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

  async function autoDigitizeFile(file: File) {
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setDigitizingUpload(true);
    try {
      const base64 = await fileToBase64(file);
      const sub = subjects.find((s) => s.id === (subjectId || subjects[0]?.id));
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'digitize_error_question',
          imageBase64: base64,
          mimeType: file.type || 'image/png',
          subjectName: sub?.name || '',
        }),
      });
      const json = await res.json();
      if (res.ok && json.ok && json.data?.statement) {
        const dq: DigitizedQuestion = {
          header: json.data.header || '',
          statement: json.data.statement,
          options: Array.isArray(json.data.options) ? json.data.options : [],
        };
        if (dq.options.length > 0) {
          setDigitizedDraft(dq);
        } else {
          setQuestionText(dq.statement);
        }
        if (json.data.user_wrong_answer) {
          setUserAnswer(String(json.data.user_wrong_answer).trim().toUpperCase());
        }
        if (json.data.correct_answer) {
          setCorrectAnswer(String(json.data.correct_answer).trim().toUpperCase());
        }
        if (json.data.golden_rule) setGoldenRule(json.data.golden_rule);
        if (json.data.explanation) setExplanation(json.data.explanation);
        notify('Questão digitalizada automaticamente a partir da foto!', 'success');
      }
    } catch {
      // mantém imagem para salvar manualmente
    } finally {
      setDigitizingUpload(false);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) autoDigitizeFile(file);
      }
    }
  }

  const errorMatches = useMemo(() => {
    const candidate = digitizedDraft ? digitizedDraft.statement : questionText;
    if (!candidate.trim()) return [];
    return findSimilarItems(
      candidate,
      errors,
      (e) => {
        const parsed = parseDigitizedQuestion(e.question_text);
        return parsed ? parsed.statement : e.question_text;
      },
      'long',
      3
    );
  }, [digitizedDraft, questionText, errors]);

  async function saveErrorConfirmed() {
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

      const finalQuestionText = digitizedDraft
        ? encodeDigitizedQuestion(digitizedDraft)
        : questionText;

      await addErrorEntry({
        subject_id: sId,
        topic_id: topicId || null,
        question_text: finalQuestionText,
        image_path: imagePath,
        user_answer: userAnswer.trim().toUpperCase(),
        correct_answer: correctAnswer.trim().toUpperCase(),
        error_cause: errorCause,
        explanation,
        golden_rule: goldenRule,
        review_count: 0,
        last_reviewed_at: null,
        next_review_date: todayISO(),
      });

      setShowAdd(false);
      setQuestionText('');
      setDigitizedDraft(null);
      setUserAnswer('');
      setCorrectAnswer('');
      setExplanation('');
      setGoldenRule('');
      setImageFile(null);
      setPreviewUrl(null);
      setConfirmDupError(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar questão.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveError(e: React.FormEvent) {
    e.preventDefault();
    if (errorMatches.length > 0 && !confirmDupError) {
      setConfirmDupError(true);
      return;
    }
    await saveErrorConfirmed();
  }

  function digitizeExistingEntry(entry: ErrorEntry) {
    const sub = subjects.find((s) => s.id === entry.subject_id);
    const signedImg = entry.image_path ? signedUrls[entry.image_path] : undefined;
    if (!signedImg) return;

    runAiJob({
      id: `digitize_error:${entry.id}`,
      kind: 'explain_error',
      label: `Digitalizando questão de ${sub?.name || 'Matéria'}`,
      route: profile ? `/p/${profile.id}/erros` : undefined,
      successMsg: `Questão de ${sub?.name || 'Matéria'} digitalizada com alternativas!`,
      task: async () => {
        const imgRes = await fetch(signedImg);
        const mimeType = imgRes.headers.get('content-type') || 'image/png';
        const buf = await imgRes.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
        const imageBase64 = btoa(bin);

        const res = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'digitize_error_question',
            imageBase64,
            mimeType,
            subjectName: sub?.name || '',
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao digitalizar foto.');
        return json.data;
      },
      onDone: async (data) => {
        const dq: DigitizedQuestion = {
          header: data.header || '',
          statement: data.statement || entry.question_text || '',
          options: Array.isArray(data.options) ? data.options : [],
        };
        const patch: Partial<ErrorEntry> = {
          question_text: dq.options.length > 0 ? encodeDigitizedQuestion(dq) : dq.statement,
          user_answer: data.user_wrong_answer
            ? String(data.user_wrong_answer).trim().toUpperCase()
            : entry.user_answer,
          correct_answer: data.correct_answer
            ? String(data.correct_answer).trim().toUpperCase()
            : entry.correct_answer,
          golden_rule: data.golden_rule || entry.golden_rule,
          explanation: data.explanation || entry.explanation,
        };
        const supabase = createClient();
        await supabase.from('error_entries').update(patch).eq('id', entry.id);
      },
    });
  }

  function explainWithGemini(entry: ErrorEntry) {
    const sub = subjects.find((s) => s.id === entry.subject_id);
    const top = topics.find((t) => t.id === entry.topic_id);
    const signedImg = entry.image_path ? signedUrls[entry.image_path] : undefined;
    const dq = parseDigitizedQuestion(entry.question_text);
    const plainQ = dq
      ? `${dq.statement}\n${dq.options.map((o) => `${o.letter}) ${o.text}`).join('\n')}`
      : entry.question_text;

    runAiJob({
      id: `explain_error:${entry.id}`,
      kind: 'explain_error',
      label: `Explicando erro de ${sub?.name || 'Matéria'}`,
      route: profile ? `/p/${profile.id}/erros` : undefined,
      successMsg: `Explicação de ${sub?.name || 'Matéria'} salva no Caderno de Erros!`,
      task: async () => {
        let imageBase64: string | undefined;
        if (signedImg) {
          const imgRes = await fetch(signedImg);
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
            questionText: plainQ,
            userAnswer: entry.user_answer,
            correctAnswer: entry.correct_answer,
            imageBase64,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao explicar.');
        return {
          explanation: json.data.explanation || '',
          golden_rule: json.data.golden_rule || '',
        };
      },
      onDone: async (data) => {
        const supabase = createClient();
        await supabase
          .from('error_entries')
          .update({
            explanation: data.explanation,
            golden_rule: data.golden_rule,
          })
          .eq('id', entry.id);
      },
    });
  }

  function startDrill(pool: ErrorEntry[], title: string) {
    if (pool.length === 0) return;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    setDrillTitle(title);
    setDrillQueue(shuffled);
    setDrillIdx(0);
    setDrillPicked('');
    setDrillAnswered(false);
    setDrillShowPrevWrong(false);
    setDrillHits(0);
    setDrillMisses(0);
    setDrillFinished(false);
    setDrillOpen(true);
  }

  const visibleErrors = errors.filter((e) => {
    if (filterSubject && e.subject_id !== filterSubject) return false;
    if (filterTopic) {
      if (filterTopic === 'NONE') {
        if (e.topic_id) return false;
      } else if (e.topic_id !== filterTopic) {
        return false;
      }
    }
    const q = filterSearch.trim().toLowerCase();
    if (q) {
      const hay = `${e.question_text} ${e.explanation} ${e.golden_rule} ${e.error_cause}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const activeFilterSubjectObj = subjects.find((s) => s.id === filterSubject);

  const currentDrillItem = drillQueue[drillIdx];
  const currentDrillDQ = currentDrillItem
    ? parseDigitizedQuestion(currentDrillItem.question_text)
    : null;
  const currentDrillSub = currentDrillItem
    ? subjects.find((s) => s.id === currentDrillItem.subject_id)
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Caderno de Erros Inteligente</h1>
          <p className="text-sm text-muted-theme">
            Envie prints (Ctrl+V) para digitalizar automaticamente em questões interativas e refaça sem spoiler.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {filterSubject && visibleErrors.length > 0 && (
            <button
              type="button"
              onClick={() =>
                startDrill(visibleErrors, `Bateria: ${activeFilterSubjectObj?.name || 'Matéria'}`)
              }
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <BookOpen className="w-4 h-4" />
              Resolver Matéria ({visibleErrors.length})
            </button>
          )}
          {errors.length > 0 && (
            <button
              type="button"
              onClick={() => startDrill(errors, 'Bateria Geral — Todas as Matérias')}
              className="px-4 py-2.5 rounded-xl subtle-surface border border-theme hover:border-teal-500/50 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Globe2 className="w-4 h-4 text-teal-600" />
              Resolver Geral ({errors.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Novo Erro
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { setFilterSubject(''); setFilterTopic(''); }}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold ${
            !filterSubject ? 'bg-teal-600 text-white shadow-sm' : 'card-surface'
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
              onClick={() => { setFilterSubject(s.id); setFilterTopic(''); }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold ${
                filterSubject === s.id ? 'bg-teal-600 text-white shadow-sm' : 'card-surface'
              }`}
            >
              {s.name} ({cnt})
            </button>
          );
        })}
        {visibleErrors.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const next: Record<string, boolean> = {};
                visibleErrors.forEach((e) => (next[e.id] = true));
                setCollapsedByCard(next);
              }}
              className="px-3 py-1.5 rounded-xl subtle-surface text-xs font-semibold text-muted-theme hover:text-[var(--text-main)]"
            >
              Recolher todas
            </button>
            <button
              type="button"
              onClick={() => setCollapsedByCard({})}
              className="px-3 py-1.5 rounded-xl subtle-surface text-xs font-semibold text-muted-theme hover:text-[var(--text-main)]"
            >
              Expandir todas
            </button>
          </div>
        )}
      </div>

      {/* Filtros de Tópico e Busca no Caderno de Erros */}
      {errors.length > 0 && (
        <div className="card-surface rounded-2xl p-3 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
          <input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Buscar questão, assunto, regra de ouro ou causa..."
            className="flex-1 rounded-xl subtle-surface border border-theme px-3.5 py-2 text-xs"
          />
          <select
            value={filterTopic}
            onChange={(e) => setFilterTopic(e.target.value)}
            className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold sm:w-72"
          >
            <option value="">Todos os tópicos ({visibleErrors.length})</option>
            {topics
              .filter((t) => (!filterSubject ? true : t.subject_id === filterSubject))
              .filter((t) => errors.some((e) => e.topic_id === t.id && (!filterSubject || e.subject_id === filterSubject)))
              .map((t) => {
                const cnt = errors.filter(
                  (e) => e.topic_id === t.id && (!filterSubject || e.subject_id === filterSubject)
                ).length;
                return (
                  <option key={t.id} value={t.id}>
                    {t.title} ({cnt})
                  </option>
                );
              })}
            {errors.some((e) => !e.topic_id && (!filterSubject || e.subject_id === filterSubject)) && (
              <option value="NONE">Sem tópico específico</option>
            )}
          </select>
          {(filterTopic || filterSearch) && visibleErrors.length > 0 && (
            <button
              type="button"
              onClick={() => startDrill(visibleErrors, 'Caderno de Erros — Filtro atual')}
              className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shrink-0"
            >
              Resolver Filtradas ({visibleErrors.length})
            </button>
          )}
        </div>
      )}

      {visibleErrors.length === 0 ? (
        <div className="card-surface rounded-2xl p-10 text-center space-y-3">
          <p className="text-sm text-muted-theme">
            Nenhum erro cadastrado ainda. Clique em &ldquo;Novo Erro&rdquo; e cole o print da questão para digitalizá-la automaticamente!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleErrors.map((entry) => {
            const sub = subjects.find((s) => s.id === entry.subject_id);
            const topicObj = topics.find((t) => t.id === entry.topic_id);
            const isEditingTopic = editingTopicEntryId === entry.id;
            const imgUrl = entry.image_path ? signedUrls[entry.image_path] : null;
            const dq = parseDigitizedQuestion(entry.question_text);
            const picked = selectedByCard[entry.id] || '';
            const submitted = !!submittedByCard[entry.id];
            const showPrevWrong = !!showPrevWrongByCard[entry.id];
            const showOriginalImg = !!showOriginalImgByCard[entry.id];
            const isCollapsed = !!collapsedByCard[entry.id];
            const isDigitizing = aiJobs[`digitize_error:${entry.id}`]?.status === 'running';
            const isExplaining = aiJobs[`explain_error:${entry.id}`]?.status === 'running';
            const correctLetter = (entry.correct_answer || '').trim().toUpperCase();
            const wrongLetter = (entry.user_answer || '').trim().toUpperCase();

            const boardLabel = dq?.header ? dq.header.split('·')[0].trim() : '';

            return (
              <div key={entry.id} className="card-surface rounded-2xl p-4 sm:p-5 border border-theme space-y-3">
                <div className={`flex items-center justify-between gap-3 ${isCollapsed ? '' : 'border-b border-theme/60 pb-3'}`}>
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {boardLabel && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-slate-500/12 text-[var(--text-main)] shrink-0">
                        {boardLabel}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-theme min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: sub?.color || '#0d9488' }}
                      />
                      <span className="truncate max-w-[180px]">{sub?.name}</span>
                      {!isEditingTopic && (
                        <>
                          <span className="opacity-40">›</span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTopicEntryId(entry.id);
                              setEditEntrySubjectId(entry.subject_id);
                              setEditEntryTopicId(entry.topic_id || '');
                            }}
                            title="Clique para alterar a matéria/tópico"
                            className="inline-flex items-center gap-1 text-[var(--text-main)] hover:text-teal-500 transition truncate max-w-[240px]"
                          >
                            <span className="truncate">
                              {topicObj ? topicObj.title : 'Definir tópico'}
                            </span>
                            <Pencil className="w-2.5 h-2.5 opacity-50 shrink-0" />
                          </button>
                        </>
                      )}
                    </span>
                    {entry.error_cause && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full subtle-surface text-muted-theme font-medium">
                        {entry.error_cause}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {imgUrl && !dq && (
                      <button
                        type="button"
                        disabled={isDigitizing}
                        onClick={() => digitizeExistingEntry(entry)}
                        className="px-2.5 py-1.5 rounded-lg bg-teal-600/12 text-teal-700 dark:text-teal-300 hover:bg-teal-600 hover:text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        {isDigitizing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ScanText className="w-3.5 h-3.5" />
                        )}
                        {isDigitizing ? 'Digitalizando...' : 'Digitalizar'}
                      </button>
                    )}
                    {imgUrl && dq && (
                      <button
                        type="button"
                        onClick={() =>
                          setShowOriginalImgByCard((prev) => ({
                            ...prev,
                            [entry.id]: !showOriginalImg,
                          }))
                        }
                        className="px-2 py-1 rounded-lg subtle-surface text-[11px] font-semibold text-muted-theme hover:text-[var(--text-main)]"
                      >
                        {showOriginalImg ? 'Ocultar foto' : 'Foto'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedByCard((prev) => ({ ...prev, [entry.id]: !isCollapsed }))
                      }
                      title={isCollapsed ? 'Expandir questão' : 'Recolher questão'}
                      className="p-1.5 rounded-lg subtle-surface text-muted-theme hover:text-[var(--text-main)]"
                    >
                      {isCollapsed ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronUp className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteErrorEntry(entry.id)}
                      aria-label="Excluir erro"
                      className="p-1.5 rounded-lg hover:bg-rose-500/15 text-muted-theme hover:text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {isEditingTopic && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await updateErrorEntry(entry.id, {
                        subject_id: editEntrySubjectId || entry.subject_id,
                        topic_id: editEntryTopicId || null,
                      });
                      setEditingTopicEntryId(null);
                    }}
                    className="rounded-2xl subtle-surface border border-teal-500/35 p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                  >
                    <select
                      value={editEntrySubjectId}
                      onChange={(e) => {
                        setEditEntrySubjectId(e.target.value);
                        setEditEntryTopicId('');
                      }}
                      className="rounded-xl bg-[var(--bg-card)] border border-theme px-3 py-1.5 text-xs font-semibold sm:w-48"
                    >
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={editEntryTopicId}
                      onChange={(e) => setEditEntryTopicId(e.target.value)}
                      className="flex-1 rounded-xl bg-[var(--bg-card)] border border-theme px-3 py-1.5 text-xs"
                    >
                      <option value="">Sem tópico específico</option>
                      {topics
                        .filter((t) => t.subject_id === editEntrySubjectId)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingTopicEntryId(null)}
                        className="px-2.5 py-1.5 rounded-xl card-surface border border-theme text-xs font-semibold"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}

                {isCollapsed ? (
                  <p
                    onClick={() =>
                      setCollapsedByCard((prev) => ({ ...prev, [entry.id]: false }))
                    }
                    className="text-xs text-muted-theme truncate cursor-pointer hover:text-[var(--text-main)]"
                  >
                    {dq?.statement || entry.question_text || 'Questão em imagem (clique para expandir)'}
                  </p>
                ) : (
                <>
                {imgUrl && (!dq || showOriginalImg) && (
                  <div
                    onClick={() => setZoomUrl(imgUrl)}
                    className="relative cursor-zoom-in rounded-2xl overflow-hidden border border-theme bg-black/5"
                  >
                    <img
                      src={imgUrl}
                      alt="Print da questão"
                      className="w-full max-h-60 object-contain"
                    />
                    <span className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/60 text-white">
                      <ZoomIn className="w-3.5 h-3.5" />
                    </span>
                  </div>
                )}

                {dq ? (
                  <div className="space-y-4">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                      <DictionaryText text={dq.statement} />
                    </p>

                    <div className="space-y-2">
                      {dq.options.map((opt) => {
                        const letter = opt.letter.trim().toUpperCase();
                        const isSelected = picked === letter;
                        const isRight = submitted && correctLetter && letter === correctLetter;
                        const isWrongPick =
                          submitted && isSelected && correctLetter && letter !== correctLetter;
                        const isPrevWrongHighlight =
                          showPrevWrong && wrongLetter && letter === wrongLetter;

                        let rowClass =
                          'border-theme bg-[var(--bg-card)] hover:border-teal-500/60';
                        let badgeClass =
                          'subtle-surface text-[var(--text-main)] border border-theme';

                        if (isRight) {
                          rowClass = 'border-emerald-500 bg-emerald-500/10';
                          badgeClass = 'bg-emerald-600 text-white border-emerald-600';
                        } else if (isWrongPick) {
                          rowClass = 'border-rose-500 bg-rose-500/10';
                          badgeClass = 'bg-rose-600 text-white border-rose-600';
                        } else if (isSelected) {
                          rowClass = 'border-teal-600 bg-teal-600/8';
                          badgeClass = 'bg-teal-600 text-white border-teal-600';
                        }

                        const elimList = eliminatedByCard[entry.id] || [];
                        const isEliminated = !submitted && elimList.includes(letter);
                        return (
                          <div key={letter} className="flex items-stretch gap-1.5">
                            {!submitted && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEliminatedByCard((prev) => {
                                    const cur = prev[entry.id] || [];
                                    const has = cur.includes(letter);
                                    const next = has ? cur.filter((l) => l !== letter) : [...cur, letter];
                                    if (!has && isSelected) {
                                      setSelectedByCard((p) => {
                                        const c = { ...p };
                                        delete c[entry.id];
                                        return c;
                                      });
                                    }
                                    return { ...prev, [entry.id]: next };
                                  });
                                }}
                                title={isEliminated ? 'Restaurar alternativa' : 'Eliminar alternativa'}
                                className={`px-2.5 rounded-2xl border transition shrink-0 flex items-center justify-center ${
                                  isEliminated
                                    ? 'border-rose-500/50 bg-rose-500/15 text-rose-500'
                                    : 'border-theme subtle-surface text-muted-theme hover:text-rose-500 hover:border-rose-500/40'
                                }`}
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={submitted}
                              onClick={() => {
                                if (isEliminated) {
                                  setEliminatedByCard((prev) => ({
                                    ...prev,
                                    [entry.id]: (prev[entry.id] || []).filter((l) => l !== letter),
                                  }));
                                }
                                setSelectedByCard((prev) => ({ ...prev, [entry.id]: letter }));
                              }}
                              className={`flex-1 text-left rounded-2xl border p-3.5 flex items-start gap-3 transition ${rowClass} ${
                                isEliminated ? 'opacity-45' : ''
                              }`}
                            >
                              <span
                                className={`w-7 h-7 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5 ${badgeClass}`}
                              >
                                {letter}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm leading-relaxed ${isEliminated ? 'line-through' : ''}`}>
                                  <DictionaryText text={opt.text} />
                                </p>
                                {isPrevWrongHighlight && (
                                  <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600">
                                    Você marcou esta errado anteriormente
                                  </span>
                                )}
                              </div>
                              {isRight && (
                                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                              )}
                              {isWrongPick && (
                                <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {!submitted ? (
                          <button
                            type="button"
                            disabled={!picked}
                            onClick={() =>
                              setSubmittedByCard((prev) => ({ ...prev, [entry.id]: true }))
                            }
                            className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold disabled:opacity-40"
                          >
                            Responder
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setSubmittedByCard((prev) => ({ ...prev, [entry.id]: false }));
                              setSelectedByCard((prev) => ({ ...prev, [entry.id]: '' }));
                            }}
                            className="px-4 py-2 rounded-xl subtle-surface text-xs font-bold inline-flex items-center gap-1.5"
                          >
                            <RotateCw className="w-3.5 h-3.5" />
                            Refazer questão
                          </button>
                        )}

                        {wrongLetter && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowPrevWrongByCard((prev) => ({
                                ...prev,
                                [entry.id]: !showPrevWrong,
                              }))
                            }
                            className="px-3 py-2 rounded-xl subtle-surface text-xs font-semibold text-muted-theme hover:text-[var(--text-main)] inline-flex items-center gap-1.5"
                          >
                            {showPrevWrong ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                            {showPrevWrong
                              ? `Ocultar erro anterior (${wrongLetter})`
                              : 'Mostrar o que errei antes'}
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => explainWithGemini(entry)}
                        disabled={isExplaining}
                        className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                      >
                        {isExplaining ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        {isExplaining ? 'Analisando...' : `Explicar com ${aiName}`}
                      </button>
                    </div>

                  </div>
                ) : (
                  entry.question_text && (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      <DictionaryText text={entry.question_text} />
                    </p>
                  )
                )}

                {(!dq || submitted) && (
                  <div className="space-y-3 animate-fade-in-up">
                    {entry.golden_rule && (
                      <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-3.5 text-xs">
                        <strong className="text-amber-700 dark:text-amber-300">
                          Regra de Ouro:
                        </strong>{' '}
                        <DictionaryText text={entry.golden_rule} />
                      </div>
                    )}

                    {entry.explanation && (
                      <div className="rounded-2xl subtle-surface p-4 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-theme">
                            Explicação / Sugestão IA
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(entry.explanation);
                              notify('Explicação copiada!');
                            }}
                            className="text-[10px] font-bold text-teal-600 hover:underline"
                          >
                            Copiar
                          </button>
                        </div>
                        <p className="text-xs text-muted-theme leading-relaxed">
                          <DictionaryText text={entry.explanation} />
                        </p>
                        <div className="pt-2 flex flex-wrap gap-2">
                          <ExplainForChildButton
                            title={entry.golden_rule || 'Explicação do erro'}
                            content={`${entry.golden_rule ? `Regra de ouro: ${entry.golden_rule}\n\n` : ''}${entry.explanation}`}
                            context={sub?.name || ''}
                            compact
                          />
                          {(dq?.statement || entry.question_text) && (
                            <ExplainForChildButton
                              mode="statement"
                              content={dq?.statement || entry.question_text}
                              context={sub?.name || ''}
                              compact
                            />
                          )}
                        </div>
                      </div>
                    )}

                    {!dq && (
                      <div className="flex justify-end">
                        <button
                          onClick={() => explainWithGemini(entry)}
                          disabled={isExplaining}
                          className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                        >
                          {isExplaining ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                          {isExplaining ? 'Analisando...' : `Explicar com ${aiName}`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {zoomUrl && (
        <div
          onClick={() => setZoomUrl(null)}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img src={zoomUrl} alt="Zoom" className="max-w-full max-h-[90vh] rounded-2xl" />
        </div>
      )}

      {showAdd && (
        <div
          onPaste={handlePaste}
          className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="card-surface w-full max-w-xl rounded-3xl p-6 my-8 shadow-2xl animate-pop-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">Adicionar ao Caderno de Erros</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-xl subtle-surface">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveError} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-theme mb-1">
                    Matéria
                  </label>
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
                  <label className="block text-xs font-semibold text-muted-theme mb-1">
                    Causa do Erro
                  </label>
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

              <div>
                <label className="block text-xs font-semibold text-muted-theme mb-1">
                  Tópico (opcional — vincula ao Banco de Questões)
                </label>
                <select
                  value={topicId}
                  onChange={(e) => setTopicId(e.target.value)}
                  className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                >
                  <option value="">Sem tópico específico</option>
                  {topics
                    .filter((t) => t.subject_id === (subjectId || subjects[0]?.id || ''))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </div>

              <div className="rounded-2xl border border-dashed border-teal-500/45 p-4 text-center space-y-2">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="max-h-36 mx-auto rounded-xl"
                  />
                ) : (
                  <ImageIcon className="w-7 h-7 mx-auto text-teal-600 opacity-75" />
                )}
                {digitizingUpload ? (
                  <p className="text-xs font-bold text-violet-600 inline-flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gemini está digitalizando o enunciado e as alternativas da foto...
                  </p>
                ) : (
                  <p className="text-xs text-muted-theme">
                    Aperte <strong>Ctrl+V</strong> ou envie uma foto — o Gemini digitaliza a questão e as opções automaticamente!
                  </p>
                )}
                <label className="cursor-pointer inline-block px-3.5 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold">
                  Escolher Foto / Print
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) autoDigitizeFile(f);
                    }}
                  />
                </label>
              </div>

              {digitizedDraft ? (
                <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      Questão digitalizada ({digitizedDraft.options.length} alternativas)
                    </span>
                    <button
                      type="button"
                      onClick={() => setDigitizedDraft(null)}
                      className="text-muted-theme hover:underline"
                    >
                      Editar texto livre
                    </button>
                  </div>
                  <p className="line-clamp-3 font-medium">{digitizedDraft.statement}</p>
                </div>
              ) : (
                <textarea
                  rows={3}
                  value={questionText}
                  onChange={(e) => {
                    setQuestionText(e.target.value);
                    setConfirmDupError(false);
                  }}
                  placeholder="Texto da questão (ou cole uma foto acima para extrair automaticamente)..."
                  className="w-full rounded-xl subtle-surface border border-theme p-3 text-xs"
                />
              )}

              {errorMatches.length > 0 && (
                <DuplicateWarningBanner
                  title="Atenção: já existe questão igual ou parecida no Caderno de Erros"
                  items={errorMatches.map((m) => {
                    const p = parseDigitizedQuestion(m.item.question_text);
                    return {
                      id: m.item.id,
                      label: (p ? p.statement : m.item.question_text).slice(0, 80),
                      detail: m.item.golden_rule ? `Regra: ${m.item.golden_rule.slice(0, 50)}` : undefined,
                      kind: m.kind,
                    };
                  })}
                  pendingConfirm={confirmDupError}
                  onConfirmAnyway={() => void saveErrorConfirmed()}
                  onCancelConfirm={() => setConfirmDupError(false)}
                />
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-muted-theme mb-1">
                    Alternativa que errei
                  </label>
                  <input
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    placeholder="Ex: C"
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-theme mb-1">
                    Gabarito correto
                  </label>
                  <input
                    value={correctAnswer}
                    onChange={(e) => setCorrectAnswer(e.target.value)}
                    placeholder="Ex: E"
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <input
                value={goldenRule}
                onChange={(e) => setGoldenRule(e.target.value)}
                placeholder="Regra de Ouro (preenchida automaticamente ao digitalizar a foto)"
                className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
              />

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 rounded-xl subtle-surface text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || digitizingUpload}
                  className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : 'Salvar Questão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {drillOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="card-surface w-full max-w-2xl rounded-3xl p-6 my-8 space-y-5 shadow-2xl animate-pop-in">
            <div className="flex items-center justify-between gap-2 border-b border-theme pb-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-teal-600 truncate">{drillTitle}</p>
                {!drillFinished && currentDrillItem && (
                  <p className="text-xs text-muted-theme mt-0.5">
                    Questão {drillIdx + 1} de {drillQueue.length} ·{' '}
                    <span className="text-emerald-600 font-bold">{drillHits} acerto(s)</span> ·{' '}
                    <span className="text-rose-600 font-bold">{drillMisses} erro(s)</span>
                  </p>
                )}
              </div>
              <button
                onClick={() => setDrillOpen(false)}
                className="p-2 rounded-xl subtle-surface shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {drillFinished || !currentDrillItem ? (
              <div className="text-center py-8 space-y-4">
                <Zap className="w-10 h-10 mx-auto text-teal-600" />
                <h3 className="text-xl font-extrabold">Bateria finalizada!</h3>
                <p className="text-sm text-muted-theme">
                  Você acertou <strong className="text-emerald-600">{drillHits}</strong> de{' '}
                  <strong>{drillQueue.length}</strong> questões nesta rodada.
                </p>
                <button
                  onClick={() => setDrillOpen(false)}
                  className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
                >
                  Voltar ao Caderno de Erros
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {currentDrillSub && (
                    <span
                      className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: currentDrillSub.color }}
                    >
                      {currentDrillSub.name}
                    </span>
                  )}
                  {currentDrillDQ?.header && (
                    <span className="text-xs text-muted-theme font-semibold">
                      {currentDrillDQ.header}
                    </span>
                  )}
                </div>

                {currentDrillDQ ? (
                  <>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                      {currentDrillDQ.statement}
                    </p>
                    <div className="space-y-2">
                      {currentDrillDQ.options.map((opt) => {
                        const letter = opt.letter.trim().toUpperCase();
                        const rightLetter = (currentDrillItem.correct_answer || '')
                          .trim()
                          .toUpperCase();
                        const prevWrong = (currentDrillItem.user_answer || '').trim().toUpperCase();
                        const isSelected = drillPicked === letter;
                        const isRight = drillAnswered && rightLetter && letter === rightLetter;
                        const isWrong =
                          drillAnswered && isSelected && rightLetter && letter !== rightLetter;

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
                            disabled={drillAnswered}
                            onClick={() => setDrillPicked(letter)}
                            className={`w-full text-left rounded-2xl border p-3.5 flex items-start gap-3 transition ${cls}`}
                          >
                            <span
                              className={`w-7 h-7 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${bdg}`}
                            >
                              {letter}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm leading-relaxed"><DictionaryText text={opt.text} /></p>
                              {drillShowPrevWrong && prevWrong === letter && (
                                <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600">
                                  Resposta que você marcou errado antes
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    {currentDrillItem.image_path && signedUrls[currentDrillItem.image_path] && (
                      <img
                        src={signedUrls[currentDrillItem.image_path]}
                        alt="Questão"
                        className="w-full max-h-60 object-contain rounded-xl bg-black/5"
                      />
                    )}
                    {currentDrillItem.question_text && (
                      <p className="text-sm whitespace-pre-wrap">{currentDrillItem.question_text}</p>
                    )}
                  </>
                )}

                {drillAnswered && (
                  <div className="space-y-2.5 animate-fade-in-up">
                    {currentDrillItem.golden_rule && (
                      <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs">
                        <strong className="text-amber-700 dark:text-amber-300">
                          Regra de Ouro:
                        </strong>{' '}
                        {currentDrillItem.golden_rule}
                      </div>
                    )}
                    {currentDrillItem.explanation && (
                      <div className="rounded-xl subtle-surface p-3.5 text-xs text-muted-theme leading-relaxed">
                        {currentDrillItem.explanation}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-theme flex-wrap">
                  {currentDrillItem.user_answer ? (
                    <button
                      type="button"
                      onClick={() => setDrillShowPrevWrong((v) => !v)}
                      className="px-3 py-2 rounded-xl subtle-surface text-xs font-semibold text-muted-theme inline-flex items-center gap-1.5"
                    >
                      {drillShowPrevWrong ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                      {drillShowPrevWrong
                        ? `Erro anterior: ${currentDrillItem.user_answer}`
                        : 'Mostrar o que errei antes'}
                    </button>
                  ) : (
                    <span />
                  )}

                  {!drillAnswered ? (
                    <button
                      type="button"
                      disabled={Boolean(currentDrillDQ && !drillPicked)}
                      onClick={async () => {
                        const right = (currentDrillItem.correct_answer || '').trim().toUpperCase();
                        const hit = currentDrillDQ ? drillPicked === right : true;
                        if (hit) setDrillHits((h) => h + 1);
                        else setDrillMisses((m) => m + 1);
                        setDrillAnswered(true);
                        await updateErrorEntry(currentDrillItem.id, {
                          review_count: currentDrillItem.review_count + 1,
                          last_reviewed_at: new Date().toISOString(),
                        });
                      }}
                      className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold disabled:opacity-40"
                    >
                      {currentDrillDQ ? 'Responder' : 'Mostrar Gabarito'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (drillIdx + 1 >= drillQueue.length) {
                          setDrillFinished(true);
                        } else {
                          setDrillIdx((i) => i + 1);
                          setDrillPicked('');
                          setDrillAnswered(false);
                          setDrillShowPrevWrong(false);
                        }
                      }}
                      className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      {drillIdx + 1 >= drillQueue.length ? 'Finalizar Bateria' : 'Próxima Questão'}
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
