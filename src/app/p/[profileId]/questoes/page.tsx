'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAiProviderName } from '@/lib/useAiProvider';
import { useProfile } from '@/components/ProfileProvider';
import { CLOUD_SYNC_EVENT, pushQuestionsToCloud } from '@/lib/cloudSync';
import { useGlobal } from '@/components/GlobalProvider';
import { todayISO } from '@/lib/utils';
import { DictionaryText } from '@/components/DictionaryText';
import { ExplainForChildButton } from '@/components/ExplainForChildButton';
import { DuplicateWarningBanner } from '@/components/DuplicateWarningBanner';
import { compareLongTexts, findSimilarItems } from '@/lib/similarity';
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
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
  FileText,
  Upload,
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

type AddMode = 'ai' | 'text' | 'image';

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

interface ParsedLocalQuestion {
  header: string;
  statement: string;
  options: QuizOption[];
  correct_answer: string;
  explanation: string;
}

/**
 * Parser 100% local (0ms, sem gastar cota do Gemini) para transformar texto colado
 * de uma ou várias questões de concurso em formato de Quiz interativo.
 */
function parseLocalTextQuestions(rawText: string): ParsedLocalQuestion[] {
  const cleaned = rawText.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
  if (!cleaned) return [];

  const lines = cleaned.split('\n');
  const chunks: string[][] = [];
  let current: string[] = [];

  const isNewQuestionStart = (line: string, hasOptionsAlready: boolean) => {
    const t = line.trim();
    if (!t) return false;
    if (/^(?:Quest[ãa]o|Q)\s*\d+[\s.:)-]*/i.test(t)) return true;
    if (hasOptionsAlready && /^\d{1,3}[.)]\s+\S/.test(t)) return true;
    return false;
  };

  let seenOptInCurrent = false;
  let seenGabInCurrent = false;
  let prevWasBlank = false;
  const optStartRe = /^(?:\(([A-Ea-e])\)|([A-Ea-e])[).:\-–—])\s+(.+)$/;
  const gabLineRe = /^(?:Gabarito|Resposta|Resp\.?|Alternativa\s+correta)\s*[:\-–—]?\s*\(?([A-Ea-e]|Certo|Errado)\)?/i;
  const expLineRe = /^(?:Coment[áa]rio|Explica[çc][ãa]o|Justificativa|Resolu[çc][ãa]o)\s*[:\-–—]/i;

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      prevWasBlank = true;
      current.push(line);
      continue;
    }
    const isOpt = optStartRe.test(t);
    const isGab = gabLineRe.test(t);
    const isExp = expLineRe.test(t);
    const splitAfterBlank =
      prevWasBlank &&
      (seenGabInCurrent || seenOptInCurrent) &&
      !isOpt &&
      !isGab &&
      !isExp;

    if (current.length > 0 && (isNewQuestionStart(t, seenOptInCurrent) || splitAfterBlank)) {
      chunks.push(current);
      current = [line];
      seenOptInCurrent = isOpt;
      seenGabInCurrent = isGab;
      prevWasBlank = false;
      continue;
    }
    if (isOpt) seenOptInCurrent = true;
    if (isGab) seenGabInCurrent = true;
    prevWasBlank = false;
    current.push(line);
  }
  if (current.length > 0) chunks.push(current);

  const results: ParsedLocalQuestion[] = [];

  for (const chunk of chunks) {
    let header = '';
    const statementLines: string[] = [];
    const options: QuizOption[] = [];
    let correctAnswer = '';
    const explanationLines: string[] = [];
    let inExplanation = false;

    for (const rawLine of chunk) {
      const t = rawLine.trim();
      if (!t) continue;

      const gabMatch = t.match(
        /^(?:Gabarito|Resposta|Resp\.?|Alternativa\s+correta)\s*[:\-–—]?\s*\(?([A-Ea-e]|Certo|Errado)\)?(?:[\s.,;\-–—]+(.*))?$/i
      );
      if (gabMatch) {
        const val = gabMatch[1].trim().toUpperCase();
        correctAnswer = val === 'CERTO' ? 'C' : val === 'ERRADO' ? 'E' : val;
        if (gabMatch[2]?.trim()) explanationLines.push(gabMatch[2].trim());
        inExplanation = true;
        continue;
      }

      const expMatch = t.match(/^(?:Coment[áa]rio|Explica[çc][ãa]o|Justificativa|Resolu[çc][ãa]o)\s*[:\-–—]\s*(.*)$/i);
      if (expMatch) {
        if (expMatch[1]?.trim()) explanationLines.push(expMatch[1].trim());
        inExplanation = true;
        continue;
      }

      if (inExplanation) {
        explanationLines.push(t);
        continue;
      }

      if (
        statementLines.length === 0 &&
        options.length === 0 &&
        !header &&
        (/^(?:Quest[ãa]o|Q)\s*\d+/i.test(t) ||
          (/\b(19|20)\d{2}\b/.test(t) && t.length <= 95 && !t.endsWith('.')))
      ) {
        header = t;
        continue;
      }

      const optMatch = t.match(optStartRe);
      if (optMatch) {
        const letter = (optMatch[1] || optMatch[2] || '').toUpperCase();
        const text = (optMatch[3] || '').trim();
        if (letter && text) {
          options.push({ letter, text });
          continue;
        }
      }

      if (options.length > 0) {
        options[options.length - 1].text = `${options[options.length - 1].text} ${t}`.trim();
      } else {
        statementLines.push(t.replace(/^\d{1,3}[.)]\s+/, ''));
      }
    }

    const statement = statementLines.join(' ').trim();
    if (!statement && options.length === 0) continue;

    let finalOptions = options;
    if (finalOptions.length === 0) {
      finalOptions = [
        { letter: 'C', text: 'Certo' },
        { letter: 'E', text: 'Errado' },
      ];
    }

    results.push({
      header,
      statement: statement || header || 'Enunciado da questão',
      options: finalOptions,
      correct_answer: correctAnswer,
      explanation: explanationLines.join(' ').trim(),
    });
  }

  return results;
}

function parseJsonQuestionsPayload(raw: unknown): ParsedLocalQuestion[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const candidate = obj.questions || obj.questoes || obj.items || obj.data || obj.perguntas;
    if (Array.isArray(candidate)) list = candidate;
  }

  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const out: ParsedLocalQuestion[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    const statement = String(
      q.statement || q.enunciado || q.pergunta || q.question || q.texto || q.text || ''
    ).trim();
    if (!statement) continue;

    const header = String(q.header || q.cabecalho || q.banca || q.titulo || q.title || '').trim();
    const explanation = String(
      q.explanation || q.comentario || q.explicacao || q.justificativa || q.resolucao || ''
    ).trim();

    const rawOpts = q.options || q.alternativas || q.opcoes || q.choices;
    const options: QuizOption[] = [];

    if (Array.isArray(rawOpts)) {
      rawOpts.forEach((opt, idx) => {
        if (typeof opt === 'string') {
          const clean = opt.trim().replace(/^\(?[A-Fa-f]\)?[).:\-–—]\s+/, '');
          if (clean) options.push({ letter: letters[idx] || String(idx + 1), text: clean });
        } else if (opt && typeof opt === 'object') {
          const o = opt as Record<string, unknown>;
          const letter = String(o.letter || o.letra || o.id || letters[idx] || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
          const text = String(o.text || o.texto || o.label || o.value || '').trim();
          if (text) options.push({ letter: letter || letters[idx] || String(idx + 1), text });
        }
      });
    } else if (rawOpts && typeof rawOpts === 'object') {
      Object.entries(rawOpts as Record<string, unknown>).forEach(([k, v]) => {
        const text = String(v || '').trim();
        if (text) options.push({ letter: k.trim().toUpperCase(), text });
      });
    }

    // Suporta também chaves planas no JSON (ex: a, b, c, d, e ou alternativa_a..e ou opcao_a..e)
    if (options.length === 0) {
      for (const l of ['A', 'B', 'C', 'D', 'E']) {
        const lower = l.toLowerCase();
        const val =
          q[lower] ??
          q[l] ??
          q[`alternativa_${lower}`] ??
          q[`alternativa_${l}`] ??
          q[`opcao_${lower}`] ??
          q[`option_${lower}`];
        if (typeof val === 'string' && val.trim()) {
          options.push({ letter: l, text: val.trim() });
        }
      }
    }

    // Se ainda não vieram opções separadas, tenta extrair alternativas coladas dentro do próprio enunciado
    let finalStatement = statement;
    if (options.length === 0 && /(?:^|\n)\s*(?:\([A-Ea-e]\)|[A-Ea-e][).:\-–—])\s+/.test(statement)) {
      const embedded = parseLocalTextQuestions(statement);
      if (embedded.length > 0 && embedded[0].options.length > 0) {
        finalStatement = embedded[0].statement;
        options.push(...embedded[0].options);
      }
    }

    const finalOptions =
      options.length > 0
        ? options
        : [
            { letter: 'C', text: 'Certo' },
            { letter: 'E', text: 'Errado' },
          ];

    const rawAns =
      q.correct_answer ??
      q.gabarito ??
      q.gabarito_correto ??
      q.gabarito_oficial ??
      q.resposta_correta ??
      q.alternativa_correta ??
      q.correctAnswer ??
      q.correctOption ??
      q.right_answer ??
      q.resposta ??
      q.answer ??
      q.correta ??
      q.correct ??
      '';
    let correctAnswer = '';
    if (typeof rawAns === 'number' && finalOptions[rawAns]) {
      correctAnswer = finalOptions[rawAns].letter;
    } else {
      const s = String(rawAns).trim().toUpperCase();
      if (s === 'CERTO' || s === 'TRUE' || s === 'VERDADEIRO') correctAnswer = 'C';
      else if (s === 'ERRADO' || s === 'FALSE' || s === 'FALSO') correctAnswer = 'E';
      else {
        const m = s.match(/(?:ALTERNATIVA|LETRA|OP[ÇC][ÃA]O|GABARITO|RESPOSTA)?\s*[:\-]?\s*\(?([A-F])\)?(?:\b|[).:\-])/);
        correctAnswer = m ? m[1] : s;
      }
    }

    out.push({
      header,
      statement: finalStatement,
      options: finalOptions,
      correct_answer: correctAnswer,
      explanation,
    });
  }

  return out;
}

export default function QuestoesPage() {
  const { profile, subjects, topics, errors, addErrorEntry, updateErrorEntry, deleteErrorEntry, addStudyLog, adjustQuestionStatOnDelete } = useProfile();
  const aiName = useAiProviderName();
  const { notify, aiJobs, runAiJob, updateAiJobProgress } = useGlobal();

  const storageKey = `sf_question_bank_${profile?.id || 'default'}`;
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [selectedScope, setSelectedScope] = useState<SelectedScope>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const subParam = searchParams.get('subject');
    const topicParam = searchParams.get('topic');
    if (subParam) {
      setExpandedSubjects((prev) => ({ ...prev, [subParam]: true }));
      setSelectedScope(
        topicParam
          ? { type: 'topic', subjectId: subParam, topicId: topicParam }
          : { type: 'subject', subjectId: subParam }
      );
    }
  }, [searchParams]);
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  const [expandedTopicGroups, setExpandedTopicGroups] = useState<Record<string, boolean>>({});
  const [collapsedQ, setCollapsedQ] = useState<Record<string, boolean>>({});
  const solvedStorageKey = `sf_solved_questions_${profile?.id || 'default'}`;
  const [solvedMap, setSolvedMap] = useState<Record<string, { hit: boolean; answeredAt: string }>>({});
  const [solvedFilter, setSolvedFilter] = useState<'all' | 'unsolved' | 'solved'>('unsolved');
  const [scopeSearch, setScopeSearch] = useState('');
  const [scopeTopicFilter, setScopeTopicFilter] = useState('');
  const [quizSessionResults, setQuizSessionResults] = useState<{ subject_id: string; topic_id: string | null; hit: boolean }[]>([]);
  const [quizLoggedToStats, setQuizLoggedToStats] = useState(false);

  // Adicionar questões (Gerar com IA por Tópico, Texto ou Imagem -> Quiz)
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('text');
  const [manualAnswers, setManualAnswers] = useState<Record<number, string>>({});
  const [aiCount, setAiCount] = useState(5);
  const [aiStyle, setAiStyle] = useState<'Múltipla escolha (A-E)' | 'Certo ou Errado'>('Múltipla escolha (A-E)');
  const BOARD_OPTIONS = ['FCC', 'FGV', 'Cebraspe (Cespe)', 'Cesgranrio', 'Vunesp', 'Outra...'] as const;
  const [aiBoard, setAiBoard] = useState('FCC');
  const [customAiBoard, setCustomAiBoard] = useState('');

  useEffect(() => {
    const txt = `${profile?.name || ''} ${profile?.extras || ''} ${profile?.status_text || ''}`;
    if (/fgv/i.test(txt)) setAiBoard('FGV');
    else if (/cebraspe|cespe/i.test(txt)) setAiBoard('Cebraspe (Cespe)');
    else if (/cesgranrio|caixa|banco do brasil/i.test(txt)) setAiBoard('Cesgranrio');
    else if (/vunesp/i.test(txt)) setAiBoard('Vunesp');
    else setAiBoard('FCC');
  }, [profile?.id, profile?.name, profile?.extras, profile?.status_text]);
  const [rawTextInput, setRawTextInput] = useState('');
  const [converting, setConverting] = useState(false);
  const aiGenJobId = `questoes:${profile?.id || 'default'}`;
  const aiGenJob = aiJobs[aiGenJobId];
  const aiGenerating = aiGenJob?.status === 'running';
  const [targetSubjectId, setTargetSubjectId] = useState('');
  const [targetTopicId, setTargetTopicId] = useState('');

  // Modal Quiz Interativo
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizTitle, setQuizTitle] = useState('');
  const [quizQueue, setQuizQueue] = useState<BankQuestion[]>([]);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizPicked, setQuizPicked] = useState('');
  const [quizEliminated, setQuizEliminated] = useState<string[]>([]);
  const [quizAnswered, setQuizAnswered] = useState(false);
  const [quizShowPrevWrong, setQuizShowPrevWrong] = useState(false);
  const [quizHits, setQuizHits] = useState(0);
  const [quizMisses, setQuizMisses] = useState(0);
  const [quizRedos, setQuizRedos] = useState(0);
  const [quizDone, setQuizDone] = useState(false);

  // Registro manual de questões feitas fora do app
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualSubjectId, setManualSubjectId] = useState('');
  const [manualTopicId, setManualTopicId] = useState('');
  const [manualDate, setManualDate] = useState(() => todayISO());
  const [manualTotal, setManualTotal] = useState('10');
  const [manualCorrect, setManualCorrect] = useState('8');
  const [manualMinutes, setManualMinutes] = useState('0');
  const [manualNote, setManualNote] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  function openManualLogModal() {
    const defaultSub =
      selectedScope?.type === 'topic'
        ? selectedScope.subjectId
        : selectedScope?.type === 'subject'
        ? selectedScope.subjectId
        : subjects[0]?.id || '';
    const defaultTop = selectedScope?.type === 'topic' ? selectedScope.topicId : '';
    setManualSubjectId(defaultSub);
    setManualTopicId(defaultTop);
    setManualDate(todayISO());
    setManualTotal('10');
    setManualCorrect('8');
    setManualMinutes('0');
    setManualNote('');
    setShowManualModal(true);
  }

  async function handleSaveManualQuestions(e: React.FormEvent) {
    e.preventDefault();
    if (!manualSubjectId) {
      notify('Escolha a matéria.', 'error');
      return;
    }
    const total = Math.max(1, parseInt(manualTotal, 10) || 0);
    const correct = Math.min(total, Math.max(0, parseInt(manualCorrect, 10) || 0));
    const minutes = Math.max(0, parseInt(manualMinutes, 10) || 0);
    setSavingManual(true);
    try {
      await addStudyLog({
        subject_id: manualSubjectId,
        topic_id: manualTopicId || null,
        duration_seconds: minutes * 60,
        study_date: manualDate || todayISO(),
        period: 'Manual',
        method: 'Questões de Fora',
        stop_point: '',
        questions_total: total,
        questions_correct: correct,
        notes: manualNote.trim() || 'Questões registradas manualmente (fora do app)',
      });
      setShowManualModal(false);
      notify(`${total} questões (${correct} acertos) registradas nas estatísticas!`, 'success');
    } finally {
      setSavingManual(false);
    }
  }

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

  useEffect(() => {
    const reloadBank = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setQuestions(parsed);
        }
      } catch {
        // ignore
      }
    };
    const onCloudSync = (e: Event) => {
      const scope = (e as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === 'questions') {
        reloadBank();
        try {
          const rawS = localStorage.getItem(solvedStorageKey);
          if (rawS) {
            const pS = JSON.parse(rawS);
            if (pS && typeof pS === 'object') setSolvedMap(pS);
          }
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('sf-question-bank-updated', reloadBank);
    window.addEventListener(CLOUD_SYNC_EVENT, onCloudSync);
    return () => {
      window.removeEventListener('sf-question-bank-updated', reloadBank);
      window.removeEventListener(CLOUD_SYNC_EVENT, onCloudSync);
    };
  }, [storageKey, solvedStorageKey]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(solvedStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setSolvedMap(parsed);
      } else {
        setSolvedMap({});
      }
    } catch {
      setSolvedMap({});
    }
  }, [solvedStorageKey]);

  function markQuestionSolved(questionId: string, hit: boolean) {
    setSolvedMap((prev) => {
      const next = {
        ...prev,
        [questionId]: { hit, answeredAt: new Date().toISOString() },
      };
      try {
        localStorage.setItem(solvedStorageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      if (profile?.user_id && profile?.id) pushQuestionsToCloud(profile.user_id, profile.id);
      return next;
    });
  }

  function saveBank(next: BankQuestion[], deletedIds: string[] = []) {
    setQuestions(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
    if (profile?.user_id && profile?.id) {
      pushQuestionsToCloud(profile.user_id, profile.id, deletedIds);
    }
  }

  async function handleDeleteQuestion(q: BankQuestion) {
    if (q.id.startsWith('err-')) {
      const errId = q.id.slice(4);
      await deleteErrorEntry(errId);
    }
    saveBank(questions.filter((x) => x.id !== q.id), [q.id]);
    const wasSolved = solvedMap[q.id];
    if (wasSolved) {
      const nextSolved = { ...solvedMap };
      delete nextSolved[q.id];
      setSolvedMap(nextSolved);
      try {
        localStorage.setItem(solvedStorageKey, JSON.stringify(nextSolved));
      } catch {
        // ignore
      }
      await adjustQuestionStatOnDelete(q.subject_id, q.topic_id, wasSolved.hit);
      notify('Questão excluída e retirada das estatísticas!', 'info');
    } else {
      notify('Questão excluída do banco.', 'info');
    }
  }

  useEffect(() => {
    setScopeSearch('');
    setScopeTopicFilter('');
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

  // Mescla questões do Caderno de Erros sem duplicar as que já existem no Banco de Questões
  const normStmtKey = (txt: string) =>
    (txt || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 120);
  const bankStmtSet = new Set(questions.map((q) => normStmtKey(q.statement)).filter(Boolean));
  const uniqueErrorQuestions = digitizedErrorQuestions.filter((eq) => {
    const k = normStmtKey(eq.statement);
    return !k || !bankStmtSet.has(k);
  });
  const allQuestions: BankQuestion[] = [...questions, ...uniqueErrorQuestions];

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
    ? allQuestions
    : selectedScope.type === 'errors_all'
    ? digitizedErrorQuestions
    : selectedScope.type === 'subject'
    ? allQuestions.filter((q) => q.subject_id === selectedScope.subjectId)
    : allQuestions.filter(
        (q) => q.subject_id === selectedScope.subjectId && q.topic_id === selectedScope.topicId
      );

  const getSolvedInfo = (q: BankQuestion) =>
    solvedMap[q.id] || (q.id.startsWith('err-') ? { hit: false, answeredAt: q.created_at || '' } : null);

  const visibleScopeQuestions = scopeQuestions
    .filter((q) => {
      const sInfo = getSolvedInfo(q);
      if (solvedFilter === 'unsolved' && sInfo) return false;
      if (solvedFilter === 'solved' && !sInfo) return false;
      if (scopeTopicFilter) {
        if (scopeTopicFilter === 'NONE') {
          if (q.topic_id) return false;
        } else if (q.topic_id !== scopeTopicFilter) {
          return false;
        }
      }
      const sq = scopeSearch.trim().toLowerCase();
      if (sq) {
        const hay = `${q.statement} ${q.header || ''} ${q.explanation || ''}`.toLowerCase();
        if (!hay.includes(sq)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aSolved = getSolvedInfo(a) ? 1 : 0;
      const bSolved = getSolvedInfo(b) ? 1 : 0;
      return aSolved - bSolved;
    });
  const scopeSolvedCount = scopeQuestions.filter((q) => Boolean(getSolvedInfo(q))).length;

  const effectiveSubjectId = targetSubjectId || subjects[0]?.id || '';
  const effectiveSubject = subjects.find((s) => s.id === effectiveSubjectId);
  const effectiveTopics = topics.filter((t) => t.subject_id === effectiveSubjectId);
  const effectiveTopic = effectiveTopics.find((t) => t.id === targetTopicId);

  function handleGenerateTopicQuestions(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveSubjectId || !profile?.id) return;

    const subjectIdSnap = effectiveSubjectId;
    const subjectNameSnap = effectiveSubject?.name || '';
    const topicIdSnap = targetTopicId || null;
    const topicTitleSnap = effectiveTopic?.title || '';
    const countSnap = aiCount;
    const styleSnap = aiStyle;
    const boardSnap = (aiBoard === 'Outra...' ? customAiBoard : aiBoard).trim() || 'FCC';
    const bankKeySnap = storageKey;
    const labelTarget = topicTitleSnap || subjectNameSnap || 'Matéria';

    setShowAddPanel(false);

    const fetchBatch = async (qty: number, boardExamples = ''): Promise<BankQuestion[]> => {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_topic_questions',
          subjectName: subjectNameSnap,
          topicTitle: topicTitleSnap,
          count: qty,
          style: styleSnap,
          board: boardSnap,
          profileName: profile?.name || '',
          boardExamples,
        }),
      });
      const rawResp = await res.text();
      let json: { ok?: boolean; error?: string; data?: { questions?: unknown[] } } = {};
      try {
        json = JSON.parse(rawResp);
      } catch {
        throw new Error('Tempo esgotado neste lote.');
      }
      if (!res.ok || !json.ok || !Array.isArray(json.data?.questions)) {
        throw new Error(json.error || 'Erro ao gerar questões com IA.');
      }
      const nowTs = Date.now();
      return json.data.questions
        .map((rawQ: unknown, i: number) => {
          const q = rawQ as {
            header?: string;
            statement: string;
            options?: QuizOption[];
            correct_answer?: string;
            explanation?: string;
          };
          if (!q?.statement) return null;
          return {
            id: `q-ai-${nowTs}-${Math.random().toString(36).slice(2, 6)}-${i}`,
            subject_id: subjectIdSnap,
            topic_id: topicIdSnap,
            header: q.header || `${boardSnap || 'Questão IA'} · ${subjectNameSnap}`,
            statement: q.statement || '',
            options: Array.isArray(q.options) ? q.options : [],
            correct_answer: (q.correct_answer || '').trim().toUpperCase(),
            explanation: q.explanation || '',
            created_at: new Date().toISOString(),
          } as BankQuestion;
        })
        .filter((x): x is BankQuestion => Boolean(x));
    };

    runAiJob({
      id: aiGenJobId,
      kind: 'quiz',
      label: `Gerando ${countSnap} questões de ${labelTarget}`,
      route: `/p/${profile.id}/questoes`,
      successMsg: `${plural(countSnap, 'questão gerada', 'questões geradas')} para ${labelTarget}!`,
      task: async () => {
        let boardExamples = '';
        if (boardSnap) {
          try {
            updateAiJobProgress(aiGenJobId, 4, `Pesquisando estilo da banca ${boardSnap}...`);
            const stRes = await fetch('/api/gemini', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'fetch_board_style',
                board: boardSnap,
                profileName: profile?.name || '',
                subjectName: subjectNameSnap,
              }),
            });
            const stJson = await stRes.json();
            if (stRes.ok && stJson.ok && stJson.data?.examples) {
              boardExamples = String(stJson.data.examples);
            }
          } catch {
            // ignore
          }
        }
        const collected: BankQuestion[] = [];
        try {
          const batchSizes: number[] = [];
          let rem = countSnap;
          while (rem > 0) {
            const q = Math.min(2, rem);
            batchSizes.push(q);
            rem -= q;
          }

          let cursor = 0;
          const workerCount = Math.min(3, batchSizes.length);
          const workers = Array.from({ length: workerCount }, async () => {
            while (cursor < batchSizes.length) {
              const idx = cursor++;
              const batchQty = batchSizes[idx];
              try {
                const items = await fetchBatch(batchQty, boardExamples);
                collected.push(...items);
              } catch {
                if (batchQty > 1) {
                  for (let k = 0; k < batchQty; k++) {
                    const single = await fetchBatch(1, boardExamples);
                    collected.push(...single);
                  }
                } else {
                  throw new Error('Tempo esgotado no servidor. Tente novamente.');
                }
              }
              const pct = Math.min(100, Math.round((collected.length / countSnap) * 100));
              updateAiJobProgress(
                aiGenJobId,
                pct,
                `${labelTarget}: ${collected.length}/${countSnap} questões (${pct}%)`
              );
            }
          });
          await Promise.all(workers);
        } finally {
          if (collected.length > 0) {
            try {
              const rawExisting = localStorage.getItem(bankKeySnap);
              const prevArr = rawExisting ? JSON.parse(rawExisting) : [];
              const nextArr = [...collected, ...(Array.isArray(prevArr) ? prevArr : [])];
              localStorage.setItem(bankKeySnap, JSON.stringify(nextArr));
              if (profile?.user_id && profile?.id) pushQuestionsToCloud(profile.user_id, profile.id);
              window.dispatchEvent(new CustomEvent('sf-question-bank-updated'));
            } catch {
              // ignore
            }
          }
        }

        if (collected.length === 0) {
          throw new Error('Nenhuma questão foi gerada.');
        }
      },
    });
  }

  const parsedPreviewQuestions = useMemo(
    () => (rawTextInput.trim() ? parseLocalTextQuestions(rawTextInput) : []),
    [rawTextInput]
  );

  const textImportDuplicates = useMemo(() => {
    const dupIdx = new Set<number>();
    const matches: { statement: string; existing: string; kind: 'exact' | 'similar' }[] = [];
    parsedPreviewQuestions.forEach((pq, idx) => {
      const m = findSimilarItems(pq.statement, questions, (q) => q.statement, 'long', 1);
      if (m.length > 0) {
        dupIdx.add(idx);
        matches.push({ statement: pq.statement, existing: m[0].item.statement, kind: m[0].kind });
      } else {
        for (let j = 0; j < idx; j++) {
          const selfM = compareLongTexts(pq.statement, parsedPreviewQuestions[j].statement);
          if (selfM) {
            dupIdx.add(idx);
            matches.push({
              statement: pq.statement,
              existing: parsedPreviewQuestions[j].statement,
              kind: selfM.kind,
            });
            break;
          }
        }
      }
    });
    return { dupIdx, matches };
  }, [parsedPreviewQuestions, questions]);

  function saveTextQuestions(skipDuplicates: boolean) {
    if (!rawTextInput.trim() || !effectiveSubjectId) return;
    const list = parseLocalTextQuestions(rawTextInput);
    if (list.length === 0) {
      notify('Não consegui identificar o enunciado e as alternativas. Confira o formato do texto.', 'error');
      return;
    }

    const filtered = skipDuplicates
      ? list.map((q, i) => ({ q, i })).filter(({ i }) => !textImportDuplicates.dupIdx.has(i))
      : list.map((q, i) => ({ q, i }));

    if (filtered.length === 0) {
      notify('Todas as questões coladas já existem ou são parecidas no seu banco.', 'info');
      return;
    }

    const created: BankQuestion[] = filtered.map(({ q, i }, idx) => ({
      id: `q-${Date.now()}-${idx}`,
      subject_id: effectiveSubjectId,
      topic_id: targetTopicId || null,
      header: q.header || '',
      statement: q.statement,
      options: q.options,
      correct_answer: (manualAnswers[i] || q.correct_answer || '').trim().toUpperCase(),
      explanation: q.explanation || '',
      created_at: new Date().toISOString(),
    }));

    saveBank([...created, ...questions]);
    setRawTextInput('');
    setManualAnswers({});
    setShowAddPanel(false);
    notify(
      `${plural(created.length, 'questão adicionada', 'questões adicionadas')} ao quiz na hora!`,
      'success'
    );
  }

  function handleConvertTextToQuiz(e: React.FormEvent) {
    e.preventDefault();
    saveTextQuestions(false);
  }

  async function handleImportJsonQuestions(file: File) {
    if (!effectiveSubjectId) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = parseJsonQuestionsPayload(parsed);
      if (list.length === 0) {
        notify('Nenhuma questão válida encontrada nesse arquivo JSON.', 'error');
        return;
      }
      const nonDupList = list.filter(
        (q) => findSimilarItems(q.statement, questions, (ex) => ex.statement, 'long', 1).length === 0
      );
      const dupCount = list.length - nonDupList.length;
      let finalList = list;
      if (dupCount > 0) {
        const keepAll = window.confirm(
          `Atenção: ${dupCount} questão(ões) do arquivo JSON já existem ou são parecidas no seu banco.\n\nClique em OK para importar TODAS mesmo assim, ou Cancelar para importar apenas as ${nonDupList.length} novas.`
        );
        if (!keepAll) finalList = nonDupList;
      }
      if (finalList.length === 0) {
        notify('Todas as questões do JSON já existiam no banco.', 'info');
        return;
      }
      const created: BankQuestion[] = finalList.map((q, i) => ({
        id: `q-json-${Date.now()}-${i}`,
        subject_id: effectiveSubjectId,
        topic_id: targetTopicId || null,
        header: q.header || '',
        statement: q.statement,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        created_at: new Date().toISOString(),
      }));
      saveBank([...created, ...questions]);
      setShowAddPanel(false);
      notify(
        `${plural(created.length, 'questão importada', 'questões importadas')} do arquivo JSON!`,
        'success'
      );
    } catch {
      notify('Arquivo JSON inválido. Verifique se o formato está correto.', 'error');
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

      const sim = findSimilarItems(created.statement, questions, (ex) => ex.statement, 'long', 1);
      if (sim.length > 0) {
        const proceed = window.confirm(
          `Atenção: já existe questão parecida ou igual no seu banco:\n"${sim[0].item.statement.slice(0, 110)}..."\n\nDeseja salvar esta questão mesmo assim?`
        );
        if (!proceed) {
          notify('Importação cancelada para evitar duplicidade.', 'info');
          return;
        }
      }
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
    setQuizEliminated([]);
    setQuizAnswered(false);
    setQuizShowPrevWrong(false);
    setQuizHits(0);
    setQuizMisses(0);
    setQuizRedos(0);
    setQuizSessionResults([]);
    setQuizLoggedToStats(false);
    setQuizDone(false);
    setQuizOpen(true);
  }

  async function flushQuizResultsToStats(results: { subject_id: string; topic_id: string | null; hit: boolean }[]) {
    if (quizLoggedToStats || results.length === 0) return;
    setQuizLoggedToStats(true);
    const grouped = new Map<string, { subject_id: string; topic_id: string | null; total: number; correct: number }>();
    for (const r of results) {
      const key = `${r.subject_id}__${r.topic_id || ''}`;
      const cur = grouped.get(key) || { subject_id: r.subject_id, topic_id: r.topic_id, total: 0, correct: 0 };
      cur.total += 1;
      if (r.hit) cur.correct += 1;
      grouped.set(key, cur);
    }
    const today = todayISO();
    for (const g of Array.from(grouped.values())) {
      await addStudyLog({
        subject_id: g.subject_id,
        topic_id: g.topic_id,
        duration_seconds: 0,
        study_date: today,
        period: 'Quiz',
        method: 'Banco de Questões (Quiz)',
        questions_total: g.total,
        questions_correct: g.correct,
        stop_point: '',
        notes: quizTitle,
      });
    }
    notify('Desempenho salvo em Evolução & Mapa de Acertos!', 'success');
  }

  const currentQ = quizQueue[quizIdx];

  useEffect(() => {
    try {
      const qSub =
        currentQ?.subject_id ||
        (selectedScope?.type === 'topic' || selectedScope?.type === 'subject'
          ? selectedScope.subjectId
          : '');
      const qTop =
        currentQ?.topic_id ||
        (selectedScope?.type === 'topic' ? selectedScope.topicId : '');
      if (qSub) sessionStorage.setItem('sf_active_subject_id', qSub);
      if (qTop) sessionStorage.setItem('sf_active_topic_id', qTop);
    } catch {
      // ignore
    }
  }, [currentQ?.subject_id, currentQ?.topic_id, selectedScope]);
  const currentQSub = currentQ ? subjects.find((s) => s.id === currentQ.subject_id) : undefined;
  const currentQTopic = currentQ?.topic_id ? topics.find((t) => t.id === currentQ.topic_id) : undefined;
  const currentQCorrect = (currentQ?.correct_answer || '').trim().toUpperCase();

  async function handleSendQuizMissToErrors(q: BankQuestion, pickedLetter: string, correctLetter: string) {
    try {
      if (q.id.startsWith('err-')) {
        const realErrId = q.id.replace(/^err-/, '');
        const existing = errors.find((e) => e.id === realErrId);
        if (existing) {
          await updateErrorEntry(existing.id, {
            user_answer: pickedLetter,
            review_count: (existing.review_count || 0) + 1,
            last_reviewed_at: new Date().toISOString(),
          });
        }
        return;
      }

      // Evita duplicar se já existir no Caderno de Erros com o mesmo enunciado
      const normStmt = q.statement.trim().slice(0, 80).toLowerCase();
      const dup = errors.find((e) => (e.question_text || '').toLowerCase().includes(normStmt));
      if (dup) {
        await updateErrorEntry(dup.id, {
          user_answer: pickedLetter,
          correct_answer: correctLetter || dup.correct_answer,
          topic_id: q.topic_id || dup.topic_id,
          review_count: (dup.review_count || 0) + 1,
          last_reviewed_at: new Date().toISOString(),
        });
        notify('Erro atualizado no Caderno de Erros com sua nova marcação!', 'info');
        return;
      }

      const payloadJson = JSON.stringify({
        header: q.header || '',
        statement: q.statement,
        options: q.options,
      });
      const encodedQuestion = `${Q_MARKER}${payloadJson}-->
${q.statement}`;

      await addErrorEntry({
        subject_id: q.subject_id,
        topic_id: q.topic_id || null,
        question_text: encodedQuestion,
        image_path: null,
        user_answer: pickedLetter,
        correct_answer: correctLetter,
        error_cause: 'Erro no Quiz',
        explanation: q.explanation || '',
        golden_rule: '',
        review_count: 0,
        last_reviewed_at: null,
        next_review_date: todayISO(),
      });
      notify(`Questão enviada para o Caderno de Erros (você marcou ${pickedLetter})!`, 'info');
    } catch {
      // silencioso
    }
  }

  function handleSetMissingAnswerInQuiz(letter: string) {
    if (!currentQ) return;
    const clean = letter.trim().toUpperCase();
    setQuizQueue((prev) =>
      prev.map((item) => (item.id === currentQ.id ? { ...item, correct_answer: clean } : item))
    );
    if (!currentQ.id.startsWith('err-')) {
      saveBank(
        questions.map((item) =>
          item.id === currentQ.id ? { ...item, correct_answer: clean } : item
        )
      );
    }
    if (quizPicked) {
      const alreadySolved = Boolean(getSolvedInfo(currentQ));
      const hit = quizPicked === clean;
      markQuestionSolved(currentQ.id, hit);
      if (alreadySolved) {
        setQuizRedos((r) => r + 1);
      } else {
        setQuizSessionResults((prev) => [
          ...prev,
          { subject_id: currentQ.subject_id, topic_id: currentQ.topic_id, hit },
        ]);
        if (hit) {
          setQuizHits((h) => h + 1);
        } else {
          setQuizMisses((m) => m + 1);
          void handleSendQuizMissToErrors({ ...currentQ, correct_answer: clean }, quizPicked, clean);
        }
      }
    }
    notify(`Gabarito "${clean}" salvo nesta questão!`, 'success');
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {!selectedScope ? (
        /* TELA 1: ESCOLHER ESCOPO (TÓPICO · MATÉRIA · TODAS · CADERNO DE ERROS) */
        <div className="space-y-5 animate-fade-in-up">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <ListChecks className="w-6 h-6 text-teal-600" />
                Banco de Questões (Quiz)
              </h1>
              <p className="text-sm text-muted-theme mt-0.5">
                Crie ou importe questões por tópico e resolva em modo quiz do tópico, da matéria toda ou de tudo junto.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {allQuestions.length > 0 && (
                <button
                  type="button"
                  onClick={() => startQuiz(allQuestions, 'Quiz Geral — Tudo Junto')}
                  className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
                >
                  <Zap className="w-4 h-4" />
                  Resolver Tudo ({allQuestions.length})
                </button>
              )}
              {subjects.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedScope({ type: 'all' });
                    setTargetSubjectId(subjects[0]?.id || '');
                    setTargetTopicId('');
                    setAddMode('ai');
                    setShowAddPanel(true);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
                >
                  <Sparkles className="w-4 h-4" />
                  Criar Questões por Tópico
                </button>
              )}
              {subjects.length > 0 && (
                <button
                  type="button"
                  onClick={openManualLogModal}
                  className="px-4 py-2.5 rounded-xl subtle-surface border border-theme hover:border-teal-500/50 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4 text-teal-600" />
                  Registrar Questões de Fora
                </button>
              )}
            </div>
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
                    {plural(allQuestions.length, 'questão no plano inteiro', 'questões no plano inteiro')}
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
                const subQs = allQuestions.filter((q) => q.subject_id === sub.id);
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
                      <div className="flex items-center gap-1.5 shrink-0">
                        {subQs.length > 0 && (
                          <button
                            type="button"
                            onClick={() => startQuiz(subQs, `Quiz: ${sub.name} (Matéria Toda)`)}
                            className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1"
                          >
                            <Zap className="w-3.5 h-3.5" />
                            Resolver ({subQs.length})
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedScope({ type: 'subject', subjectId: sub.id })}
                          className="px-3 py-1.5 rounded-xl subtle-surface hover:bg-teal-600 hover:text-white text-xs font-semibold"
                        >
                          Abrir
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="bg-[var(--bg-subtle)]/40 border-t border-theme pl-6 sm:pl-10 pr-4 py-2 space-y-1 animate-fade-in-up">
                        {(() => {
                          const groups: { parent: typeof subTopics[number]; children: typeof subTopics }[] = [];
                          for (const tp of subTopics) {
                            const isSub = /^\s*↳/.test(tp.title);
                            if (isSub && groups.length > 0) {
                              groups[groups.length - 1].children.push(tp);
                            } else {
                              groups.push({ parent: tp, children: [] });
                            }
                          }
                          return groups.map(({ parent: tp, children }) => {
                            const childIds = new Set([tp.id, ...children.map((c) => c.id)]);
                            const groupQs = allQuestions.filter((q) => q.topic_id && childIds.has(q.topic_id));
                            const tpQs = allQuestions.filter((q) => q.topic_id === tp.id);
                            const hasChildren = children.length > 0;
                            const isGroupOpen = !!expandedTopicGroups[tp.id];

                            return (
                              <div key={tp.id} className="space-y-0.5">
                                <div className="w-full px-2.5 py-2 rounded-xl hover:bg-[var(--bg-card)] flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                    {hasChildren ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedTopicGroups((prev) => ({
                                            ...prev,
                                            [tp.id]: !isGroupOpen,
                                          }))
                                        }
                                        className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-theme shrink-0"
                                        title={isGroupOpen ? 'Recolher subtópicos' : 'Expandir subtópicos'}
                                      >
                                        {isGroupOpen ? (
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        ) : (
                                          <ChevronRight className="w-3.5 h-3.5" />
                                        )}
                                      </button>
                                    ) : (
                                      <span className="w-5 shrink-0" />
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (hasChildren && tpQs.length === 0) {
                                          setExpandedTopicGroups((prev) => ({
                                            ...prev,
                                            [tp.id]: !isGroupOpen,
                                          }));
                                        } else {
                                          setSelectedScope({
                                            type: 'topic',
                                            subjectId: sub.id,
                                            topicId: tp.id,
                                          });
                                        }
                                      }}
                                      className="text-left min-w-0 flex-1 flex items-center justify-between gap-2"
                                    >
                                      <span className="text-xs font-semibold truncate">
                                        {tp.title}
                                        {hasChildren && (
                                          <span className="ml-1.5 text-[10px] font-bold text-muted-theme">
                                            ({children.length} sub)
                                          </span>
                                        )}
                                      </span>
                                      <span className="text-[11px] text-muted-theme shrink-0">
                                        {plural(hasChildren ? groupQs.length : tpQs.length, 'questão', 'questões')}
                                      </span>
                                    </button>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    {(hasChildren ? groupQs.length : tpQs.length) > 0 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          startQuiz(
                                            hasChildren ? groupQs : tpQs,
                                            `Quiz: ${tp.title}`
                                          )
                                        }
                                        className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-bold"
                                      >
                                        Resolver
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedScope({
                                          type: 'topic',
                                          subjectId: sub.id,
                                          topicId: tp.id,
                                        });
                                        setTargetSubjectId(sub.id);
                                        setTargetTopicId(tp.id);
                                        setAddMode('ai');
                                        setShowAddPanel(true);
                                      }}
                                      className="px-2.5 py-1 rounded-lg bg-violet-600/15 hover:bg-violet-600 text-violet-700 dark:text-violet-300 hover:text-white text-[11px] font-bold inline-flex items-center gap-1 transition"
                                    >
                                      <Sparkles className="w-3 h-3" />
                                      Criar
                                    </button>
                                  </div>
                                </div>

                                {hasChildren && isGroupOpen && (
                                  <div className="pl-7 space-y-0.5 border-l border-theme/60 ml-3">
                                    {children.map((ch) => {
                                      const chQs = allQuestions.filter((q) => q.topic_id === ch.id);
                                      return (
                                        <div
                                          key={ch.id}
                                          className="w-full px-2.5 py-1.5 rounded-xl hover:bg-[var(--bg-card)] flex items-center justify-between gap-2"
                                        >
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setSelectedScope({
                                                type: 'topic',
                                                subjectId: sub.id,
                                                topicId: ch.id,
                                              })
                                            }
                                            className="text-left min-w-0 flex-1 flex items-center justify-between gap-2"
                                          >
                                            <span className="text-xs text-muted-theme truncate">
                                              {ch.title}
                                            </span>
                                            <span className="text-[11px] text-muted-theme shrink-0">
                                              {plural(chQs.length, 'questão', 'questões')}
                                            </span>
                                          </button>
                                          <div className="flex items-center gap-1 shrink-0">
                                            {chQs.length > 0 && (
                                              <button
                                                type="button"
                                                onClick={() => startQuiz(chQs, `Quiz: ${ch.title}`)}
                                                className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-bold"
                                              >
                                                Resolver
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setSelectedScope({
                                                  type: 'topic',
                                                  subjectId: sub.id,
                                                  topicId: ch.id,
                                                });
                                                setTargetSubjectId(sub.id);
                                                setTargetTopicId(ch.id);
                                                setAddMode('ai');
                                                setShowAddPanel(true);
                                              }}
                                              className="px-2.5 py-1 rounded-lg bg-violet-600/15 hover:bg-violet-600 text-violet-700 dark:text-violet-300 hover:text-white text-[11px] font-bold inline-flex items-center gap-1 transition"
                                            >
                                              <Sparkles className="w-3 h-3" />
                                              Criar
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
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
              {visibleScopeQuestions.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    startQuiz(
                      visibleScopeQuestions,
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
                  {solvedFilter === 'solved' ? 'Refazer Quiz' : 'Resolver Quiz'} ({visibleScopeQuestions.length})
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
              {subjects.length > 0 && (
                <button
                  type="button"
                  onClick={openManualLogModal}
                  className="px-4 py-2.5 rounded-xl subtle-surface border border-theme hover:border-teal-500/50 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4 text-teal-600" />
                  Registrar de Fora
                </button>
              )}
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
                  Criar ou Importar Questões para o Quiz
                </h2>
                <div className="inline-flex p-1 rounded-xl subtle-surface gap-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setAddMode('ai')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                      addMode === 'ai' ? 'bg-violet-600 text-white' : 'text-muted-theme'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Criar por Tópico (IA)
                  </button>
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
                  <label
                    title="Importar perguntas de um arquivo .json para a matéria/tópico selecionado"
                    className="cursor-pointer px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 text-muted-theme hover:text-teal-600 hover:bg-[var(--bg-card)] transition"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    .json
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleImportJsonQuestions(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-muted-theme mb-1">
                    Matéria
                  </label>
                  <select
                    value={effectiveSubjectId}
                    onChange={(e) => {
                      setTargetSubjectId(e.target.value);
                      setTargetTopicId('');
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
                  <label className="block text-[11px] font-semibold text-muted-theme mb-1">
                    Tópico da Matéria
                  </label>
                  <select
                    value={targetTopicId}
                    onChange={(e) => setTargetTopicId(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  >
                    <option value="">Geral da matéria (sem tópico específico)</option>
                    {effectiveTopics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {addMode === 'ai' ? (
                <form onSubmit={handleGenerateTopicQuestions} className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-muted-theme mb-1">
                        Quantidade de questões
                      </label>
                      <select
                        value={aiCount}
                        onChange={(e) => setAiCount(Number(e.target.value))}
                        className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold"
                      >
                        <option value={3}>3 questões</option>
                        <option value={5}>5 questões</option>
                        <option value={8}>8 questões</option>
                        <option value={10}>10 questões</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-muted-theme mb-1">
                        Estilo
                      </label>
                      <select
                        value={aiStyle}
                        onChange={(e) =>
                          setAiStyle(
                            e.target.value as 'Múltipla escolha (A-E)' | 'Certo ou Errado'
                          )
                        }
                        className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold"
                      >
                        <option value="Múltipla escolha (A-E)">Múltipla escolha (A–E)</option>
                        <option value="Certo ou Errado">Certo ou Errado</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-muted-theme mb-1">
                        Banca (padrão do edital)
                      </label>
                      <select
                        value={aiBoard}
                        onChange={(e) => setAiBoard(e.target.value)}
                        className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold"
                      >
                        {BOARD_OPTIONS.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                      {aiBoard === 'Outra...' && (
                        <input
                          value={customAiBoard}
                          onChange={(e) => setCustomAiBoard(e.target.value)}
                          placeholder="Digite o nome da banca..."
                          className="w-full mt-1.5 rounded-xl subtle-surface border border-theme px-3 py-1.5 text-xs"
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-[11px] text-muted-theme">
                      As questões geradas ficam salvas no tópico escolhido e entram também nos quizzes da matéria inteira e de tudo junto.
                    </p>
                    <button
                      type="submit"
                      disabled={aiGenerating || !effectiveSubjectId}
                      className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0"
                    >
                      {aiGenerating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      {converting
                        ? 'Gerando em segundo plano...'
                        : `Gerar ${aiCount} Questões com ${aiName}`}
                    </button>
                  </div>
                </form>
              ) : addMode === 'text' ? (
                <form onSubmit={handleConvertTextToQuiz} className="space-y-3">
                  <textarea
                    rows={6}
                    required
                    value={rawTextInput}
                    onChange={(e) => {
                      setRawTextInput(e.target.value);
                      setManualAnswers({});
                    }}
                    placeholder={'Cole aqui uma ou várias questões em texto (100% instantâneo, sem usar Gemini!):\n\nEnunciado da questão...\nA) Primeira alternativa\nB) Segunda alternativa\nC) Terceira alternativa\nD) Quarta alternativa\nGabarito: B (opcional)'}
                    className="w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 p-3 text-xs leading-relaxed"
                  />

                  {parsedPreviewQuestions.length > 0 && (
                    <div className="rounded-2xl border border-teal-500/30 bg-teal-500/[0.04] p-3.5 space-y-2.5 max-h-60 overflow-y-auto">
                      <p className="text-[11px] font-extrabold text-teal-700 dark:text-teal-300">
                        Prévia instantânea: {plural(parsedPreviewQuestions.length, 'questão identificada', 'questões identificadas')}
                      </p>
                      {parsedPreviewQuestions.map((pq, idx) => {
                        const chosenAns = (manualAnswers[idx] ?? pq.correct_answer ?? '').toUpperCase();
                        return (
                          <div key={idx} className="rounded-xl card-surface border border-theme p-3 space-y-2 text-xs">
                            <p className="font-semibold leading-snug line-clamp-2">
                              {idx + 1}. {pq.statement}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] font-bold text-muted-theme">
                                Gabarito:
                              </span>
                              {pq.options.map((opt) => (
                                <button
                                  key={opt.letter}
                                  type="button"
                                  onClick={() =>
                                    setManualAnswers((prev) => ({ ...prev, [idx]: opt.letter }))
                                  }
                                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition ${
                                    chosenAns === opt.letter
                                      ? 'bg-emerald-600 border-emerald-600 text-white'
                                      : 'subtle-surface border-theme hover:border-teal-500'
                                  }`}
                                >
                                  {opt.letter}
                                </button>
                              ))}
                              <span className="text-[10px] text-muted-theme ml-auto">
                                {pq.options.length} opções
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {textImportDuplicates.matches.length > 0 && (
                    <DuplicateWarningBanner
                      title={`Atenção: ${textImportDuplicates.matches.length} questão(ões) colada(s) parecem repetidas ou iguais`}
                      items={textImportDuplicates.matches.slice(0, 4).map((m, i) => ({
                        id: `qt-${i}`,
                        label: m.statement.slice(0, 75),
                        detail: `já existe: "${m.existing.slice(0, 60)}"`,
                        kind: m.kind,
                      }))}
                    />
                  )}

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-[11px] text-muted-theme">
                      Formatação 100% local e instantânea — não usa cota do Gemini.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {textImportDuplicates.matches.length > 0 &&
                        parsedPreviewQuestions.length > textImportDuplicates.dupIdx.size && (
                          <button
                            type="button"
                            onClick={() => saveTextQuestions(true)}
                            className="px-3 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold"
                          >
                            Ignorar parecidas ({parsedPreviewQuestions.length - textImportDuplicates.dupIdx.size} novas)
                          </button>
                        )}
                      <button
                        type="submit"
                        disabled={parsedPreviewQuestions.length === 0}
                        className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Salvar {parsedPreviewQuestions.length > 0 ? parsedPreviewQuestions.length : ''} no Quiz (Instantâneo)
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="rounded-2xl border border-dashed border-teal-500/45 p-6 text-center space-y-3">
                  {aiGenerating ? (
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
              <div className="card-surface rounded-2xl p-3 flex flex-col sm:flex-row gap-2.5">
                <input
                  value={scopeSearch}
                  onChange={(e) => setScopeSearch(e.target.value)}
                  placeholder="Buscar por palavra no enunciado, banca ou comentário..."
                  className="flex-1 rounded-xl subtle-surface border border-theme px-3.5 py-2 text-xs"
                />
                {selectedScope && selectedScope.type !== 'topic' && (
                  <select
                    value={scopeTopicFilter}
                    onChange={(e) => setScopeTopicFilter(e.target.value)}
                    className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold sm:w-64"
                  >
                    <option value="">Todos os tópicos</option>
                    {topics
                      .filter((t) =>
                        selectedScope.type === 'subject'
                          ? t.subject_id === selectedScope.subjectId
                          : true
                      )
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    <option value="NONE">Geral da matéria (sem tópico)</option>
                  </select>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(
                    [
                      { id: 'unsolved', label: `Não resolvidas (${scopeQuestions.length - scopeSolvedCount})` },
                      { id: 'solved', label: `Já resolvidas (${scopeSolvedCount})` },
                      { id: 'all', label: `Todas (${scopeQuestions.length})` },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSolvedFilter(f.id)}
                      className={`px-3 py-1 rounded-xl text-[11px] font-bold transition ${
                        solvedFilter === f.id
                          ? 'bg-teal-600 text-white'
                          : 'subtle-surface text-muted-theme hover:text-[var(--text-main)]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    scopeQuestions.forEach((q) => (next[q.id] = true));
                    setCollapsedQ(next);
                  }}
                  className="px-3 py-1 rounded-xl subtle-surface text-[11px] font-semibold text-muted-theme hover:text-[var(--text-main)]"
                >
                  Recolher todas
                </button>
                <button
                  type="button"
                  onClick={() => setCollapsedQ({})}
                  className="px-3 py-1 rounded-xl subtle-surface text-[11px] font-semibold text-muted-theme hover:text-[var(--text-main)]"
                >
                  Expandir todas
                </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleScopeQuestions.map((q, i) => {
                  const qSub = subjects.find((s) => s.id === q.subject_id);
                  const qTopic = q.topic_id ? topics.find((t) => t.id === q.topic_id) : undefined;
                  const solvedInfo = getSolvedInfo(q);
                  const boardLabel = q.header ? q.header.split('·')[0].trim() : '';

                  return (
                    <div
                      key={q.id}
                      className={`card-surface rounded-2xl p-4 flex flex-col justify-between gap-3 border transition hover:border-teal-500/45 ${
                        solvedInfo ? 'border-theme/60 opacity-85' : 'border-theme'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                            <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded-md subtle-surface text-muted-theme">
                              #{i + 1}
                            </span>
                            {boardLabel && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-500/12 text-[var(--text-main)]">
                                {boardLabel}
                              </span>
                            )}
                            {q.id.startsWith('err-') && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
                                Erros
                              </span>
                            )}
                            {solvedInfo && (
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                  solvedInfo.hit
                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                }`}
                              >
                                {solvedInfo.hit ? '✓ Acertou' : '✕ Errou'}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleDeleteQuestion(q)}
                            className="p-1 rounded-lg hover:bg-rose-500/15 text-muted-theme hover:text-rose-600 shrink-0"
                            title={q.id.startsWith('err-') ? 'Excluir do Caderno de Erros' : 'Excluir questão'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {qSub && (
                          <p className="text-[11px] text-muted-theme truncate flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: qSub.color || '#0d9488' }}
                            />
                            <span className="truncate">{qSub.name}</span>
                            {qTopic && (
                              <>
                                <span className="opacity-40">›</span>
                                <span className="truncate text-[var(--text-main)] font-medium">
                                  {qTopic.title}
                                </span>
                              </>
                            )}
                          </p>
                        )}

                        <p className="text-[13px] leading-snug line-clamp-3 text-[var(--text-main)]">
                          {q.statement}
                        </p>
                      </div>

                      <div className="pt-2.5 border-t border-theme/50 flex items-center justify-between gap-2 mt-auto">
                        <span className="text-[11px] text-muted-theme">
                          {q.options.length} alt.
                        </span>
                        <button
                          type="button"
                          onClick={() => startQuiz([q], `Questão #${i + 1}`)}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                            solvedInfo
                              ? 'subtle-surface border border-theme hover:border-teal-500/50 text-[var(--text-main)]'
                              : 'bg-teal-600 hover:bg-teal-500 text-white shadow-xs'
                          }`}
                        >
                          {solvedInfo ? 'Refazer' : 'Resolver'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
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
                    {quizRedos > 0 ? ` · ${quizRedos} refeita(s)` : ''}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  if (quizSessionResults.length > 0 && !quizLoggedToStats) {
                    void flushQuizResultsToStats(quizSessionResults);
                  }
                  setQuizOpen(false);
                }}
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
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-teal-500/12 border border-teal-500/25 text-teal-700 dark:text-teal-300">
                    {currentQTopic ? currentQTopic.title : 'Geral da matéria'}
                  </span>
                  {currentQ.header && (
                    <span className="text-xs text-muted-theme font-semibold">
                      {currentQ.header}
                    </span>
                  )}
                </div>

                <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                  <DictionaryText text={currentQ.statement} />
                </p>

                <div className="space-y-2">
                  {currentQ.options.map((opt) => {
                    const letter = opt.letter.trim().toUpperCase();
                    const isSelected = quizPicked === letter;
                    const isRight =
                      quizAnswered && Boolean(currentQCorrect) && letter === currentQCorrect;
                    const isWrong =
                      quizAnswered &&
                      isSelected &&
                      Boolean(currentQCorrect) &&
                      letter !== currentQCorrect;

                    let cls = 'border-theme bg-[var(--bg-card)] hover:border-teal-500/60';
                    let bdg = 'subtle-surface border border-theme';
                    if (isRight) {
                      cls = 'border-2 border-emerald-500 bg-emerald-500/15 shadow-xs';
                      bdg = 'bg-emerald-600 text-white border-emerald-600';
                    } else if (isWrong) {
                      cls = 'border-2 border-rose-500 bg-rose-500/15 shadow-xs';
                      bdg = 'bg-rose-600 text-white border-rose-600';
                    } else if (isSelected) {
                      cls = 'border-2 border-teal-600 bg-teal-600/10';
                      bdg = 'bg-teal-600 text-white border-teal-600';
                    }

                    const isEliminated = !quizAnswered && quizEliminated.includes(letter);
                    return (
                      <div key={letter} className="flex items-stretch gap-1.5">
                        {!quizAnswered && (
                          <button
                            type="button"
                            onClick={() => {
                              setQuizEliminated((prev) => {
                                const has = prev.includes(letter);
                                const next = has ? prev.filter((l) => l !== letter) : [...prev, letter];
                                if (!has && quizPicked === letter) setQuizPicked('');
                                return next;
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
                          disabled={quizAnswered}
                          onClick={() => {
                            if (isEliminated) {
                              setQuizEliminated((prev) => prev.filter((l) => l !== letter));
                            }
                            setQuizPicked(letter);
                          }}
                          className={`flex-1 text-left rounded-2xl border p-3.5 flex items-start gap-3 transition ${cls} ${
                            isEliminated ? 'opacity-45' : ''
                          }`}
                        >
                          <span
                            className={`w-7 h-7 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${bdg}`}
                          >
                            {letter}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm leading-relaxed ${isEliminated ? 'line-through' : ''}`}>
                              <DictionaryText text={opt.text} />
                            </p>
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
                      </div>
                    );
                  })}
                </div>

                {quizAnswered && (
                  currentQCorrect ? (
                    quizPicked === currentQCorrect ? (
                      <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-500/15 px-4 py-3 flex items-center gap-2.5 text-emerald-800 dark:text-emerald-200 animate-fade-in-up">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <div className="text-xs">
                          <p className="font-extrabold text-sm">Você acertou!</p>
                          <p>Gabarito confirmado: alternativa <strong>{currentQCorrect}</strong>.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border-2 border-rose-500 bg-rose-500/15 px-4 py-3 flex items-center gap-2.5 text-rose-800 dark:text-rose-200 animate-fade-in-up">
                        <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                        <div className="text-xs">
                          <p className="font-extrabold text-sm">Você errou esta questão</p>
                          <p>
                            Você marcou <strong>{quizPicked}</strong> · Gabarito correto:{' '}
                            <strong>{currentQCorrect}</strong>. Enviada automaticamente para o{' '}
                            <strong>Caderno de Erros</strong>!
                          </p>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 space-y-2 text-xs text-amber-900 dark:text-amber-200 animate-fade-in-up">
                      <p className="font-bold">
                        Esta questão estava sem gabarito cadastrado — clique na alternativa correta para salvar e corrigir agora:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {currentQ.options.map((opt) => (
                          <button
                            key={opt.letter}
                            type="button"
                            onClick={() => handleSetMissingAnswerInQuiz(opt.letter)}
                            className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-emerald-600 hover:text-white font-bold transition"
                          >
                            Gabarito {opt.letter}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                )}

                {quizAnswered && (
                  <div className="rounded-2xl subtle-surface p-4 space-y-2.5 text-xs text-muted-theme leading-relaxed whitespace-pre-wrap animate-fade-in-up">
                    {currentQ.explanation && <DictionaryText text={currentQ.explanation} />}
                    <div className="flex flex-wrap gap-2">
                      <ExplainForChildButton
                        mode="statement"
                        content={currentQ.statement}
                        context={`${currentQSub?.name || ''} ${currentQ.header || ''}`.trim()}
                        compact
                      />
                      {currentQ.explanation && (
                        <ExplainForChildButton
                          title={currentQTopic?.title || currentQSub?.name || 'Questão'}
                          content={`Enunciado: ${currentQ.statement}\n\nExplicação: ${currentQ.explanation}`}
                          context={currentQSub?.name || ''}
                          compact
                        />
                      )}
                    </div>
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
                        setQuizAnswered(true);
                        if (!currentQCorrect) return;
                        const alreadySolved = Boolean(getSolvedInfo(currentQ));
                        const hit = quizPicked === currentQCorrect;
                        markQuestionSolved(currentQ.id, hit);
                        if (alreadySolved) {
                          setQuizRedos((r) => r + 1);
                          if (quizIdx + 1 >= quizQueue.length && quizSessionResults.length > 0) {
                            void flushQuizResultsToStats(quizSessionResults);
                          }
                        } else {
                          const nextRes = [
                            ...quizSessionResults,
                            { subject_id: currentQ.subject_id, topic_id: currentQ.topic_id, hit },
                          ];
                          setQuizSessionResults(nextRes);
                          if (quizIdx + 1 >= quizQueue.length) {
                            void flushQuizResultsToStats(nextRes);
                          }
                          if (hit) {
                            setQuizHits((h) => h + 1);
                          } else {
                            setQuizMisses((m) => m + 1);
                            void handleSendQuizMissToErrors(currentQ, quizPicked, currentQCorrect);
                          }
                        }
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
                          void flushQuizResultsToStats(quizSessionResults);
                          setQuizDone(true);
                        } else {
                          setQuizIdx((i) => i + 1);
                          setQuizPicked('');
                          setQuizEliminated([]);
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

      {showManualModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowManualModal(false)}
        >
          <form
            onSubmit={handleSaveManualQuestions}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md card-surface rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 animate-fade-in-up"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-base flex items-center gap-2">
                  <ListChecks className="w-5 h-5 text-teal-600" />
                  Registrar Questões de Fora
                </h2>
                <p className="text-xs text-muted-theme mt-0.5">
                  Fez questões em PDF, QConcursos ou TEC? Registre aqui para contar na sua evolução.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="p-2 rounded-xl subtle-surface hover:opacity-80"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-muted-theme mb-1">
                  Matéria *
                </label>
                <select
                  value={manualSubjectId}
                  onChange={(e) => {
                    setManualSubjectId(e.target.value);
                    setManualTopicId('');
                  }}
                  required
                  className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold"
                >
                  <option value="">Selecione...</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-muted-theme mb-1">
                  Tópico (opcional)
                </label>
                <select
                  value={manualTopicId}
                  onChange={(e) => setManualTopicId(e.target.value)}
                  className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                >
                  <option value="">Geral da matéria</option>
                  {topics
                    .filter((t) => t.subject_id === manualSubjectId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-muted-theme mb-1">
                    Feitas *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    required
                    value={manualTotal}
                    onChange={(e) => {
                      const v = e.target.value;
                      setManualTotal(v);
                      const nTot = parseInt(v, 10) || 0;
                      const nCor = parseInt(manualCorrect, 10) || 0;
                      if (nCor > nTot) setManualCorrect(String(Math.max(0, nTot)));
                    }}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-muted-theme mb-1">
                    Acertos *
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(1, parseInt(manualTotal, 10) || 1)}
                    required
                    value={manualCorrect}
                    onChange={(e) => setManualCorrect(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-muted-theme mb-1">
                    Tempo (min)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={manualMinutes}
                    onChange={(e) => setManualMinutes(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {(() => {
                const tot = Math.max(1, parseInt(manualTotal, 10) || 0);
                const cor = Math.min(tot, Math.max(0, parseInt(manualCorrect, 10) || 0));
                const pct = Math.round((cor / tot) * 100);
                return (
                  <div className="rounded-xl subtle-surface px-3 py-2 flex items-center justify-between text-xs">
                    <span className="text-muted-theme">
                      Erros: <strong className="text-rose-500">{tot - cor}</strong>
                    </span>
                    <span className="font-bold text-teal-600 dark:text-teal-400">
                      Aproveitamento: {pct}%
                    </span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-muted-theme mb-1">
                    Data
                  </label>
                  <input
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-muted-theme mb-1">
                    Origem / Nota (opcional)
                  </label>
                  <input
                    type="text"
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    placeholder="Ex: QConcursos / PDF"
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-theme">
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="px-4 py-2 rounded-xl subtle-surface text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingManual}
                className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {savingManual && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Salvar registro
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}