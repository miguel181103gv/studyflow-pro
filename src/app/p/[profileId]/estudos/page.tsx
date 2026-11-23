'use client';

import { useEffect, useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { useGlobal } from '@/components/GlobalProvider';
import { createClient } from '@/lib/supabase/client';
import { getStudyMode } from '@/lib/studyModes';
import { calcAccuracy, getYouTubeEmbedUrl, getYouTubeSearchUrl } from '@/lib/utils';
import type { Topic } from '@/lib/types';
import {
  Check,
  Star,
  ChevronDown,
  ChevronRight,
  Youtube,
  CheckCircle2,
  Trophy,
  X,
  Search,
  SmilePlus,
  Plus,
  Pencil,
  Trash2,
  Upload,
  Highlighter,
  Sparkles,
  Loader2,
  Save,
  RefreshCw,
  FileText,
  AlignLeft,
  PanelRightClose,
  PanelRightOpen,
  CornerDownRight,
  CheckSquare,
  AlertTriangle,
} from 'lucide-react';

type Difficulty = 'facil' | 'medio' | 'dificil';

interface FormattedNote {
  title: string;
  summary?: string;
  sections: { heading: string; points: string[]; callout?: string }[];
}

interface TopicNoteRecord {
  rawText: string;
  formatted?: FormattedNote | null;
}

interface FoundVideo {
  videoId: string;
  url: string;
  embedUrl: string;
}

const HIGHLIGHT_PRIORITIES = [
  {
    label: 'Baixa',
    bg: '#dcfce7',
    border: '#16a34a',
    text: '#14532d',
    dot: '#16a34a',
  },
  {
    label: 'Média',
    bg: '#fef3c7',
    border: '#d97706',
    text: '#78350f',
    dot: '#d97706',
  },
  {
    label: 'Alta',
    bg: '#fee2e2',
    border: '#dc2626',
    text: '#7f1d1d',
    dot: '#dc2626',
  },
] as const;

function getHighlightStyle(color: string) {
  const found = HIGHLIGHT_PRIORITIES.find(
    (p) => p.bg.toLowerCase() === (color || '').toLowerCase()
  );
  if (found) return found;
  if (color === '#bbf7d0') return HIGHLIGHT_PRIORITIES[0];
  if (color === '#fef08a') return HIGHLIGHT_PRIORITIES[1];
  if (color === '#fbcfe8') return HIGHLIGHT_PRIORITIES[2];
  return {
    label: 'Nota',
    bg: color || '#fef3c7',
    border: '#d97706',
    text: '#0f172a',
    dot: '#d97706',
  };
}

function isSubtopicTitle(title: string): boolean {
  return title.trim().startsWith('↳');
}

function cleanSubtopicDisplay(title: string): string {
  return title.trim().replace(/^↳\s*/, '');
}

interface TopicPdfItem {
  path: string;
  name: string;
}

function parseTopicPdfs(
  pdfPath: string | null | undefined,
  pdfName: string | null | undefined
): TopicPdfItem[] {
  if (!pdfPath) return [];
  const trimmed = pdfPath.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr
          .filter((x) => x && typeof x.path === 'string' && x.path.trim())
          .map((x) => ({ path: String(x.path), name: String(x.name || 'PDF') }));
      }
    } catch {
      // fallback para caminho único legado
    }
  }
  return [{ path: trimmed, name: pdfName || 'Material.pdf' }];
}

function serializeTopicPdfs(pdfs: TopicPdfItem[]): {
  pdfPath: string | null;
  pdfName: string | null;
} {
  if (pdfs.length === 0) return { pdfPath: null, pdfName: null };
  if (pdfs.length === 1) return { pdfPath: pdfs[0].path, pdfName: pdfs[0].name };
  return {
    pdfPath: JSON.stringify(pdfs),
    pdfName: `${pdfs[0].name} (+${pdfs.length - 1})`,
  };
}

const PDF_JUNK_PATTERNS = [
  /^p[áa]gina\s+\d+\s+de\s+\d+$/i,
  /^conte[úu]do\s*quest[õo]es$/i,
  /^(pdfs?|lei\s*seca|videoaulas?|revis[ãa]o|quest[õo]es|conte[úu]do)$/i,
  /^24\s*h\s*7\s*dias/i,
  /clique\s*aqui/i,
  /^prova\s+discursiva\s*\(/i,
];

function parseTopicList(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const lines = normalized.includes('\n')
    ? normalized.split('\n')
    : normalized.includes(';')
    ? normalized.split(';')
    : [normalized];

  return lines
    .map((line) => {
      const isIndentedSub = /^(\s{2,}|\t)/.test(line) || /^\s*(↳|>)/.test(line);
      const cleaned = line
        .trim()
        .replace(/^(↳|>)\s*/, '')
        .replace(/^[-*•–—]\s+/, '')
        .replace(/^\d+(?:\.\d+)*\s*[.)-]\s+/, '')
        .replace(/;+$/, '')
        .trim();
      if (!cleaned) return '';
      if (PDF_JUNK_PATTERNS.some((rx) => rx.test(cleaned))) return '';
      return isIndentedSub ? `↳ ${cleaned}` : cleaned;
    })
    .filter((item) => item.length > 0);
}

export default function ProgressoEditalPage() {
  const {
    userId,
    profile,
    subjects,
    topics,
    highlights,
    studyLogs,
    reviews,
    theme,
    addSubject,
    updateSubject,
    addTopic,
    addTopicsBatch,
    updateTopicTitle,
    migrateAndDeleteTopics,
    deleteSubjectsBatch,
    flashcards,
    errors,
    toggleTopicStudied,
    toggleSubjectStudied,
    toggleTopicPriority,
    updateTopicPdf,
    updateTopicVideo,
    addHighlight,
    deleteHighlight,
  } = useProfile();

  const { notify, videoJob, startBatchVideoJob } = useGlobal();
  const studyMode = getStudyMode(profile);
  const isDark = theme === 'obsidian' || theme === 'navy';

  const [openSubjects, setOpenSubjects] = useState<Record<string, boolean>>({});
  const [editalSearch, setEditalSearch] = useState('');
  const [difficultyMap, setDifficultyMap] = useState<Record<string, Difficulty>>({});
  const [pendingDifficultyTopic, setPendingDifficultyTopic] = useState<Topic | null>(null);

  // Adicionar / Editar / Remover Matéria e Tópicos
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [editSubjectName, setEditSubjectName] = useState('');

  const [addingTopicForSub, setAddingTopicForSub] = useState<string | null>(null);
  const [newTopicText, setNewTopicText] = useState('');
  const [cleaningTopicsAi, setCleaningTopicsAi] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editTopicTitle, setEditTopicTitle] = useState('');
  const [addingSubForTopicId, setAddingSubForTopicId] = useState<string | null>(null);
  const [newSubtopicTitle, setNewSubtopicTitle] = useState('');

  // Modo Seleção Múltipla (apagar várias matérias ou tópicos de uma vez) + Modal de Migração
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{
    subjectIds: string[];
    topicIds: string[];
    assetsSummary: string[];
  } | null>(null);
  const [migrateTargetTopicId, setMigrateTargetTopicId] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);

  // Upload PDF + Modal de Vídeo / PDF / Grifos
  const [uploadingTopicId, setUploadingTopicId] = useState<string | null>(null);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [viewerTab, setViewerTab] = useState<'pdf' | 'video' | 'texto'>('video');
  const [showHighlightsPane, setShowHighlightsPane] = useState(true);
  const [topicNotesMap, setTopicNotesMap] = useState<Record<string, TopicNoteRecord>>({});
  const [editingNoteMode, setEditingNoteMode] = useState(false);
  const [formattingNote, setFormattingNote] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);
  const [activePdfIdx, setActivePdfIdx] = useState(0);
  const [loadingPdfUrl, setLoadingPdfUrl] = useState(false);
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  const [videoInput, setVideoInput] = useState('');
  const [autoSearchingVideo, setAutoSearchingVideo] = useState(false);
  const [foundVideos, setFoundVideos] = useState<FoundVideo[]>([]);
  const [videoIdx, setVideoIdx] = useState(0);
  const [hlText, setHlText] = useState('');
  const [hlNote, setHlNote] = useState('');
  const [hlPage, setHlPage] = useState('1');
  const [hlColor, setHlColor] = useState('#fef3c7');

  const notesStorageKey = `sf_topic_notes_${profile?.id || 'default'}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(notesStorageKey);
      if (raw) setTopicNotesMap(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, [notesStorageKey]);

  function saveTopicNote(topicId: string, record: TopicNoteRecord) {
    const next = { ...topicNotesMap, [topicId]: record };
    setTopicNotesMap(next);
    try {
      localStorage.setItem(notesStorageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  async function handleFormatNoteWithGemini() {
    if (!activeTopicId) return;
    const current = topicNotesMap[activeTopicId];
    if (!current?.rawText?.trim()) return;
    setFormattingNote(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'format_study_notes',
          rawText: current.rawText,
          subjectName: activeTopicSub?.name || '',
          topicTitle: activeTopic?.title || '',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data?.sections) {
        throw new Error(json.error || 'Não foi possível formatar o texto.');
      }
      saveTopicNote(activeTopicId, {
        rawText: current.rawText,
        formatted: json.data as FormattedNote,
      });
      setEditingNoteMode(false);
      notify('Texto formatado e organizado pelo Gemini!', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao formatar texto.', 'error');
    } finally {
      setFormattingNote(false);
    }
  }

  function inspectAndRequestDelete(subjectIds: string[], topicIds: string[]) {
    const subSet = new Set(subjectIds);
    const affectedTopicIds = Array.from(
      new Set([
        ...topicIds,
        ...topics.filter((t) => subSet.has(t.subject_id)).map((t) => t.id),
      ])
    );
    const affectedTopicSet = new Set(affectedTopicIds);
    const affectedTopics = topics.filter((t) => affectedTopicSet.has(t.id));

    const pdfCount = affectedTopics.filter((t) => Boolean(t.pdf_path)).length;
    const videoCount = affectedTopics.filter((t) => Boolean(t.video_url)).length;
    const hlCount = highlights.filter((h) => affectedTopicSet.has(h.topic_id)).length;
    const noteCount = affectedTopicIds.filter((id) => Boolean(topicNotesMap[id]?.rawText?.trim())).length;
    const fcCount = flashcards.filter(
      (c) => (c.topic_id && affectedTopicSet.has(c.topic_id)) || subSet.has(c.subject_id)
    ).length;
    const errCount = errors.filter(
      (e) => (e.topic_id && affectedTopicSet.has(e.topic_id)) || subSet.has(e.subject_id)
    ).length;

    const summary: string[] = [];
    if (pdfCount > 0) summary.push(`${pdfCount} PDF(s)`);
    if (videoCount > 0) summary.push(`${videoCount} videoaula(s)`);
    if (hlCount > 0) summary.push(`${hlCount} grifo(s)`);
    if (noteCount > 0) summary.push(`${noteCount} texto(s)/resumo(s)`);
    if (fcCount > 0) summary.push(`${fcCount} flashcard(s)`);
    if (errCount > 0) summary.push(`${errCount} erro(s)`);

    // Se tem qualquer conteúdo salvo, abre modal perguntando se quer migrar!
    if (summary.length > 0) {
      const remainingTopics = topics.filter(
        (t) => !affectedTopicSet.has(t.id) && !subSet.has(t.subject_id)
      );
      setMigrateTargetTopicId(remainingTopics[0]?.id || '');
      setPendingDelete({
        subjectIds,
        topicIds: affectedTopicIds,
        assetsSummary: summary,
      });
      return;
    }

    // Sem conteúdo salvo: confirmação simples
    const label =
      subjectIds.length > 0 && topicIds.length > 0
        ? `${subjectIds.length} matéria(s) e ${topicIds.length} tópico(s)`
        : subjectIds.length > 0
        ? `${subjectIds.length} matéria(s)`
        : `${topicIds.length} tópico(s)`;
    if (!confirm(`Excluir ${label}?`)) return;
    executeDelete(subjectIds, affectedTopicIds, null);
  }

  async function executeDelete(
    subjectIds: string[],
    topicIds: string[],
    targetTopicId: string | null
  ) {
    setDeletingBusy(true);
    try {
      // Migrar textos locais (topicNotesMap) se houver destino
      if (targetTopicId && topicIds.length > 0) {
        const mergedTexts = topicIds
          .map((id) => topicNotesMap[id]?.rawText?.trim())
          .filter(Boolean);
        if (mergedTexts.length > 0) {
          const existingTarget = topicNotesMap[targetTopicId] || { rawText: '', formatted: null };
          const combined = [existingTarget.rawText?.trim(), ...mergedTexts]
            .filter(Boolean)
            .join('\n\n---\n\n');
          saveTopicNote(targetTopicId, {
            rawText: combined,
            formatted: existingTarget.formatted || null,
          });
        }
      }

      if (topicIds.length > 0) {
        await migrateAndDeleteTopics(topicIds, targetTopicId);
      }
      if (subjectIds.length > 0) {
        await deleteSubjectsBatch(subjectIds);
      }

      setPendingDelete(null);
      setSelectedSubjectIds([]);
      setSelectedTopicIds([]);
      setSelectMode(false);
    } finally {
      setDeletingBusy(false);
    }
  }

  const diffStorageKey = `sf_topic_difficulty_${profile?.id || 'default'}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(diffStorageKey);
      if (raw) setDifficultyMap(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, [diffStorageKey]);

  function saveDifficulty(topicId: string, diff: Difficulty) {
    const next = { ...difficultyMap, [topicId]: diff };
    setDifficultyMap(next);
    try {
      localStorage.setItem(diffStorageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
    setPendingDifficultyTopic(null);
  }

  async function handleTopicCheck(topic: Topic) {
    const willBeStudied = !topic.studied;
    await toggleTopicStudied(topic);
    if (willBeStudied) {
      setPendingDifficultyTopic(topic);
    }
  }

  const totalTopics = topics.length;
  const totalDone = topics.filter((t) => t.studied).length;
  const overallPct = totalTopics > 0 ? Math.round((totalDone / totalTopics) * 100) : 0;

  function toggleExpandAll(expand: boolean) {
    const next: Record<string, boolean> = {};
    subjects.forEach((s) => {
      next[s.id] = expand;
    });
    setOpenSubjects(next);
  }

  function getTopicStage(topicId: string, studied: boolean) {
    if (!studied) {
      return { level: 0, label: 'Pendente', rev1: false, rev7: false, rev30: false, rev90: false };
    }
    const tRevs = reviews.filter((r) => r.topic_id === topicId);
    const rev1 = tRevs.some((r) => r.interval_days === 1 && r.completed);
    const rev7 = tRevs.some((r) => r.interval_days === 7 && r.completed);
    const rev30 = tRevs.some((r) => r.interval_days === 30 && r.completed);
    const rev90 = tRevs.some((r) => r.interval_days === 90 && r.completed);
    const completedCount = [rev1, rev7, rev30, rev90].filter(Boolean).length;

    if (completedCount >= 4) {
      return { level: 4, label: 'Dominado (4/4 revisões)', rev1, rev7, rev30, rev90 };
    }
    if (completedCount === 3) {
      return { level: 3, label: 'Revisado 3x (falta 90d)', rev1, rev7, rev30, rev90 };
    }
    if (completedCount === 2) {
      return { level: 2, label: 'Revisado 2x', rev1, rev7, rev30, rev90 };
    }
    if (completedCount === 1) {
      return { level: 2, label: 'Revisado 1x', rev1, rev7, rev30, rev90 };
    }
    return { level: 1, label: 'Estudado (aguardando revisões)', rev1, rev7, rev30, rev90 };
  }

  function getStageColors(level: number) {
    if (level === 0) {
      return {
        bg: isDark ? 'rgba(255,255,255,0.03)' : '#f8fafc',
        border: isDark ? '#25324a' : '#e2e8f0',
        titleColor: isDark ? '#f1f5f9' : '#0f172a',
        badgeBg: isDark ? '#1e293b' : '#e2e8f0',
        badgeText: isDark ? '#94a3b8' : '#475569',
        checkBg: isDark ? '#1e293b' : '#ffffff',
        checkBorder: isDark ? '#475569' : '#cbd5e1',
      };
    }
    if (level === 1) {
      return {
        bg: isDark ? 'rgba(59,130,246,0.14)' : '#eff6ff',
        border: isDark ? 'rgba(96,165,250,0.4)' : '#bfdbfe',
        titleColor: isDark ? '#dbeafe' : '#1e3a8a',
        badgeBg: isDark ? 'rgba(59,130,246,0.3)' : '#dbeafe',
        badgeText: isDark ? '#93c5fd' : '#1d4ed8',
        checkBg: '#2563eb',
        checkBorder: '#2563eb',
      };
    }
    if (level === 2) {
      return {
        bg: isDark ? 'rgba(99,102,241,0.15)' : '#eef2ff',
        border: isDark ? 'rgba(129,140,248,0.45)' : '#c7d2fe',
        titleColor: isDark ? '#e0e7ff' : '#312e81',
        badgeBg: isDark ? 'rgba(99,102,241,0.35)' : '#e0e7ff',
        badgeText: isDark ? '#a5b4fc' : '#4338ca',
        checkBg: '#4f46e5',
        checkBorder: '#4f46e5',
      };
    }
    if (level === 3) {
      return {
        bg: isDark ? 'rgba(20,184,166,0.15)' : '#f0fdfa',
        border: isDark ? 'rgba(45,212,191,0.45)' : '#99f6e4',
        titleColor: isDark ? '#ccfbf1' : '#134e4a',
        badgeBg: isDark ? 'rgba(20,184,166,0.32)' : '#ccfbf1',
        badgeText: isDark ? '#5eead4' : '#0f766e',
        checkBg: '#0d9488',
        checkBorder: '#0d9488',
      };
    }
    return {
      bg: isDark ? 'rgba(16,185,129,0.18)' : '#ecfdf5',
      border: isDark ? 'rgba(52,211,153,0.55)' : '#6ee7b7',
      titleColor: isDark ? '#d1fae5' : '#064e3b',
      badgeBg: isDark ? 'rgba(16,185,129,0.35)' : '#a7f3d0',
      badgeText: isDark ? '#6ee7b7' : '#047857',
      checkBg: '#059669',
      checkBorder: '#059669',
    };
  }

  async function loadSignedPdfUrl(path: string | null) {
    if (!path) {
      setSignedPdfUrl(null);
      return;
    }
    setLoadingPdfUrl(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.storage.from('study-assets').createSignedUrl(path, 3600);
      setSignedPdfUrl(data?.signedUrl || null);
    } catch {
      setSignedPdfUrl(null);
    } finally {
      setLoadingPdfUrl(false);
    }
  }

  // PDF & YouTube handlers (suporte a múltiplos PDFs por tópico)
  async function handlePdfUpload(topicId: string, file: File) {
    if (!userId || !profile) return;
    setUploadingTopicId(topicId);
    try {
      const supabase = createClient();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${userId}/${profile.id}/pdfs/${topicId}-${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from('study-assets').upload(path, file, {
        upsert: true,
      });
      if (error) throw error;
      const existingTopic = topics.find((t) => t.id === topicId);
      const currentPdfs = parseTopicPdfs(existingTopic?.pdf_path, existingTopic?.pdf_name);
      const nextPdfs = [...currentPdfs, { path, name: file.name }];
      const { pdfPath, pdfName } = serializeTopicPdfs(nextPdfs);
      await updateTopicPdf(topicId, pdfPath, pdfName);
      notify(
        nextPdfs.length > 1
          ? `PDF adicionado (${nextPdfs.length} PDFs neste tópico)!`
          : 'PDF anexado com sucesso!',
        'success'
      );
      await openTopicViewer(topicId, pdfPath, 'pdf', nextPdfs.length - 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao enviar PDF.');
    } finally {
      setUploadingTopicId(null);
    }
  }

  async function handleRemovePdf(topicId: string, removeIdx: number) {
    const existingTopic = topics.find((t) => t.id === topicId);
    const currentPdfs = parseTopicPdfs(existingTopic?.pdf_path, existingTopic?.pdf_name);
    const target = currentPdfs[removeIdx];
    if (!target) return;
    if (!window.confirm(`Remover o PDF "${target.name}" deste tópico?`)) return;
    const nextPdfs = currentPdfs.filter((_, idx) => idx !== removeIdx);
    const { pdfPath, pdfName } = serializeTopicPdfs(nextPdfs);
    await updateTopicPdf(topicId, pdfPath, pdfName);
    if (nextPdfs.length === 0) {
      setActivePdfIdx(0);
      setSignedPdfUrl(null);
    } else {
      const nextIdx = Math.min(removeIdx, nextPdfs.length - 1);
      setActivePdfIdx(nextIdx);
      await loadSignedPdfUrl(nextPdfs[nextIdx].path);
    }
    notify('PDF removido do tópico.', 'info');
  }

  async function handleSwitchPdf(idx: number, path: string) {
    setActivePdfIdx(idx);
    await loadSignedPdfUrl(path);
  }

  async function autoFetchVideoForTopic(
    topicId: string,
    subjectName: string,
    topicTitle: string,
    saveToCloud = true
  ) {
    setAutoSearchingVideo(true);
    try {
      const res = await fetch('/api/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectName, topicTitle }),
      });
      const json = await res.json();
      if (res.ok && json.ok && json.videos?.length > 0) {
        setFoundVideos(json.videos);
        setVideoIdx(0);
        setVideoInput(json.videos[0].url);
        if (saveToCloud) {
          await updateTopicVideo(topicId, json.videos[0].url);
        }
      }
    } catch {
      // fallback manual
    } finally {
      setAutoSearchingVideo(false);
    }
  }

  async function openTopicViewer(
    topicId: string,
    pdfPath: string | null,
    initialTab: 'pdf' | 'video' | 'texto' = 'video',
    targetPdfIdx = 0
  ) {
    setActiveTopicId(topicId);
    setViewerTab(initialTab);
    setSignedPdfUrl(null);
    setFoundVideos([]);
    setVideoIdx(0);

    const t = topics.find((item) => item.id === topicId);
    const sub = subjects.find((s) => s.id === t?.subject_id);
    setVideoInput(t?.video_url || '');

    const pdfList = parseTopicPdfs(pdfPath, t?.pdf_name);
    const safeIdx = Math.min(targetPdfIdx, Math.max(0, pdfList.length - 1));
    setActivePdfIdx(safeIdx);
    if (pdfList[safeIdx]?.path) {
      await loadSignedPdfUrl(pdfList[safeIdx].path);
    }

    if (initialTab === 'video' && !t?.video_url && t && sub) {
      autoFetchVideoForTopic(topicId, sub.name, t.title, true);
    }
  }

  async function handleNextVideoOption() {
    if (!activeTopicId) return;
    const activeT = topics.find((t) => t.id === activeTopicId);
    const activeSub = subjects.find((s) => s.id === activeT?.subject_id);
    if (foundVideos.length > 1) {
      const next = (videoIdx + 1) % foundVideos.length;
      setVideoIdx(next);
      setVideoInput(foundVideos[next].url);
      await updateTopicVideo(activeTopicId, foundVideos[next].url);
    } else if (activeT && activeSub) {
      await autoFetchVideoForTopic(activeTopicId, activeSub.name, activeT.title, true);
    }
  }

  function handleBatchAutoVideos(subjectId: string, subjectName: string) {
    const missing = topics.filter((t) => t.subject_id === subjectId && !t.video_url);
    if (missing.length === 0) return;
    startBatchVideoJob(
      `${profile?.name || 'Plano'} · ${subjectName}`,
      missing.map((t) => ({
        topicId: t.id,
        subjectName,
        topicTitle: t.title,
      })),
      (topicId, url) => {
        updateTopicVideo(topicId, url);
      }
    );
  }

  const totalMissingVideos = topics.filter((t) => !t.video_url).length;

  function handleBatchAutoVideosAll() {
    const subNameMap = new Map(subjects.map((s) => [s.id, s.name]));
    const missing = topics.filter((t) => !t.video_url && subNameMap.has(t.subject_id));
    if (missing.length === 0) {
      notify('Todos os tópicos já possuem videoaula cadastrada!', 'info');
      return;
    }
    startBatchVideoJob(
      `${profile?.name || 'Plano'} · Todas as matérias`,
      missing.map((t) => ({
        topicId: t.id,
        subjectName: subNameMap.get(t.subject_id) || '',
        topicTitle: t.title,
      })),
      (topicId, url) => {
        updateTopicVideo(topicId, url);
      }
    );
  }

  async function handleSaveVideo(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTopicId) return;
    await updateTopicVideo(activeTopicId, videoInput.trim() || null);
    notify('Link da videoaula salvo!', 'success');
  }

  async function handleSaveHighlight(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTopicId || !hlText.trim()) return;
    await addHighlight({
      topic_id: activeTopicId,
      text: hlText.trim(),
      note: hlNote.trim(),
      color: hlColor,
      page_number: Math.max(1, Number(hlPage) || 1),
    });
    setHlText('');
    setHlNote('');
  }

  const activeTopic = topics.find((t) => t.id === activeTopicId);
  const activeTopicSub = subjects.find((s) => s.id === activeTopic?.subject_id);
  const activeHighlights = highlights.filter((h) => h.topic_id === activeTopicId);
  const embedUrl = getYouTubeEmbedUrl(activeTopic?.video_url || videoInput);

  async function handleCleanTopicsWithGemini(subjectName: string) {
    if (!newTopicText.trim()) return;
    setCleaningTopicsAi(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clean_topic_list',
          rawText: newTopicText,
          subjectName,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !Array.isArray(json.data?.topics)) {
        throw new Error(json.error || 'Não foi possível organizar a lista.');
      }
      const cleanedList = (json.data.topics as string[]).map((t) => String(t).trim()).filter(Boolean);
      if (cleanedList.length > 0) {
        setNewTopicText(cleanedList.join('\n'));
        notify(`Gemini limpou e organizou ${cleanedList.length} tópicos! Confira e clique em Criar.`, 'success');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao organizar lista com Gemini.', 'error');
    } finally {
      setCleaningTopicsAi(false);
    }
  }

  const parsedNewTopics = parseTopicList(newTopicText);

  return (
    <div className="space-y-6">
      {/* Cabeçalho — Visual idêntico ao Edital Verticalizado + Nova Matéria */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            {studyMode.syllabusPageTitle}
          </h1>
          <p className="text-sm text-muted-theme mt-1">{studyMode.syllabusPageSubtitle}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {(totalMissingVideos > 0 || videoJob.running) && (
            <button
              type="button"
              disabled={videoJob.running}
              onClick={handleBatchAutoVideosAll}
              className="px-3.5 py-2 rounded-2xl bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition"
              title="Busca automaticamente videoaulas no YouTube para todos os tópicos sem vídeo"
            >
              {videoJob.running ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Youtube className="w-4 h-4" />
              )}
              {videoJob.running
                ? `Buscando vídeos (${videoJob.done}/${videoJob.total})...`
                : `Buscar vídeos de todas (${totalMissingVideos})`}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSelectMode((v) => !v);
              setSelectedSubjectIds([]);
              setSelectedTopicIds([]);
            }}
            className={`px-3.5 py-2 rounded-2xl text-xs font-bold inline-flex items-center gap-1.5 border transition ${
              selectMode
                ? 'bg-rose-600 border-rose-600 text-white shadow-sm'
                : 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20'
            }`}
          >
            <CheckSquare className="w-4 h-4" />
            {selectMode ? 'Cancelar seleção' : 'Selecionar p/ excluir'}
          </button>
          <button
            type="button"
            onClick={() => setShowNewSubject((v) => !v)}
            className="px-4 py-2 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nova matéria
          </button>
          <button
            onClick={() => toggleExpandAll(true)}
            className="px-4 py-2 rounded-2xl card-surface text-xs font-bold hover:opacity-85"
          >
            Expandir todas
          </button>
          <button
            onClick={() => toggleExpandAll(false)}
            className="px-4 py-2 rounded-2xl card-surface text-xs font-bold hover:opacity-85"
          >
            Recolher todas
          </button>
        </div>
      </div>

      {/* Formulário recolhível: Adicionar Nova Matéria */}
      {showNewSubject && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newSubjectName.trim()) return;
            const created = await addSubject(newSubjectName.trim());
            if (created) {
              setOpenSubjects((prev) => ({ ...prev, [created.id]: true }));
            }
            setNewSubjectName('');
            setShowNewSubject(false);
          }}
          className="card-surface rounded-2xl p-4 flex flex-col sm:flex-row gap-2.5 animate-fade-in-up"
        >
          <input
            autoFocus
            value={newSubjectName}
            onChange={(e) => setNewSubjectName(e.target.value)}
            placeholder="Nome da nova matéria ou disciplina..."
            className="flex-1 rounded-xl subtle-surface border border-theme px-4 py-2.5 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Salvar matéria
            </button>
            <button
              type="button"
              onClick={() => setShowNewSubject(false)}
              className="px-3.5 py-2.5 rounded-xl subtle-surface text-xs font-semibold"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Resumo Geral + Legenda de Cores */}
      <div className="card-surface rounded-3xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-theme">
              PROGRESSO GERAL ({studyMode.syllabusShort.toUpperCase()})
            </p>
            <p className="text-lg font-extrabold mt-0.5">
              {totalDone} de {totalTopics} tópicos concluídos em {subjects.length} disciplinas
            </p>
          </div>
          <span className="text-3xl font-extrabold text-teal-600">{overallPct}%</span>
        </div>

        <div className="w-full h-3 rounded-full subtle-surface overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 via-teal-500 to-emerald-500 transition-all duration-500"
            style={{ width: `${overallPct}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-semibold">
          <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200">
            1. Estudado
          </span>
          <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200">
            2. Rev. 1d
          </span>
          <span className="px-3 py-1 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200">
            3. Rev. 7d
          </span>
          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
            4. Dominado (30/90d)
          </span>
        </div>
      </div>

      {/* Barra de Exclusão Múltipla (fixa no topo ao rolar) */}
      {selectMode && (
        <div className="sticky top-3 z-20 card-surface rounded-2xl p-4 border-2 border-rose-500/50 bg-rose-500/10 backdrop-blur-md shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs font-bold">
            Modo seleção ativo: marque as matérias ou tópicos que deseja apagar (
            <span className="text-rose-600 dark:text-rose-400">
              {selectedSubjectIds.length} matéria(s) · {selectedTopicIds.length} tópico(s)
            </span>
            )
          </p>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => {
                if (selectedSubjectIds.length === subjects.length) {
                  setSelectedSubjectIds([]);
                } else {
                  setSelectedSubjectIds(subjects.map((s) => s.id));
                }
              }}
              className="px-3 py-2 rounded-xl subtle-surface border border-theme text-xs font-bold hover:opacity-85"
            >
              {selectedSubjectIds.length === subjects.length
                ? 'Desmarcar matérias'
                : 'Selecionar todas as matérias'}
            </button>
            <button
              type="button"
              disabled={selectedSubjectIds.length === 0 && selectedTopicIds.length === 0}
              onClick={() => inspectAndRequestDelete(selectedSubjectIds, selectedTopicIds)}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir selecionados
            </button>
          </div>
        </div>
      )}

      {/* Busca rápida dentro do Edital */}
      <div className="card-surface rounded-2xl px-4 py-2.5 flex items-center gap-2.5">
        <Search className="w-4 h-4 text-muted-theme shrink-0" />
        <input
          value={editalSearch}
          onChange={(e) => setEditalSearch(e.target.value)}
          placeholder="Buscar tópico ou matéria..."
          className="flex-1 bg-transparent text-sm focus:outline-none"
        />
        {editalSearch && (
          <button
            onClick={() => setEditalSearch('')}
            className="text-xs font-bold text-muted-theme hover:underline"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Lista de Disciplinas (Visual Edital Verticalizado + PDFs, Vídeos, Grifos, Editar e Remover) */}
      <div className="space-y-3.5">
        {subjects.map((sub) => {
          const q = editalSearch.trim().toLowerCase();
          const allSubTopics = topics.filter((t) => t.subject_id === sub.id);
          const subTopics = q
            ? allSubTopics.filter(
                (t) => t.title.toLowerCase().includes(q) || sub.name.toLowerCase().includes(q)
              )
            : allSubTopics;
          if (q && subTopics.length === 0) return null;
          const done = subTopics.filter((t) => t.studied).length;
          const pct = subTopics.length > 0 ? Math.round((done / subTopics.length) * 100) : 0;
          const isCompletedSubject = subTopics.length > 0 && done === subTopics.length;
          const isOpen = editalSearch.trim().length > 0 ? true : (openSubjects[sub.id] ?? false);

          const subLogs = studyLogs.filter((l) => l.subject_id === sub.id);
          const subQ = subLogs.reduce((a, b) => a + b.questions_total, 0);
          const subC = subLogs.reduce((a, b) => a + b.questions_correct, 0);
          const subAcc = calcAccuracy(subC, subQ);
          const hasMissingVideos = allSubTopics.some((t) => !t.video_url);

          return (
            <div
              key={sub.id}
              className={`rounded-3xl overflow-hidden transition-all card-surface ${
                selectMode && selectedSubjectIds.includes(sub.id) ? 'ring-2 ring-rose-500' : ''
              }`}
              style={
                isCompletedSubject
                  ? {
                      borderColor: isDark ? '#34d399' : '#6ee7b7',
                      backgroundColor: isDark ? 'rgba(16,185,129,0.1)' : '#f0fdf4',
                    }
                  : undefined
              }
            >
              <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  {/* Checkbox para selecionar p/ excluir (no selectMode) OU marcar matéria inteira estudada */}
                  {selectMode ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSubjectIds((prev) =>
                          prev.includes(sub.id)
                            ? prev.filter((id) => id !== sub.id)
                            : [...prev, sub.id]
                        );
                      }}
                      title="Selecionar matéria para excluir"
                      className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 shrink-0 transition ${
                        selectedSubjectIds.includes(sub.id)
                          ? 'bg-rose-600 border-rose-600 text-white'
                          : 'bg-white dark:bg-slate-800 border-rose-400'
                      }`}
                    >
                      {selectedSubjectIds.includes(sub.id) && <Check className="w-4 h-4 stroke-[3]" />}
                    </button>
                  ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSubjectStudied(sub.id, !isCompletedSubject);
                    }}
                    title={
                      isCompletedSubject
                        ? 'Desmarcar todos os tópicos desta matéria'
                        : 'Marcar todos os tópicos desta matéria como estudados'
                    }
                    className="w-6 h-6 rounded-lg flex items-center justify-center border-2 shrink-0 transition"
                    style={{
                      backgroundColor: isCompletedSubject
                        ? '#059669'
                        : isDark
                        ? '#1e293b'
                        : '#ffffff',
                      borderColor: isCompletedSubject
                        ? '#059669'
                        : isDark
                        ? '#475569'
                        : '#cbd5e1',
                      color: '#ffffff',
                    }}
                  >
                    {isCompletedSubject && <Check className="w-4 h-4 stroke-[3]" />}
                  </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setOpenSubjects((prev) => ({ ...prev, [sub.id]: !isOpen }))}
                    className="flex items-center gap-3.5 min-w-0 flex-1 text-left"
                  >
                    <div
                      className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 font-bold"
                      style={{
                        backgroundColor: isCompletedSubject
                          ? 'rgba(16,185,129,0.2)'
                          : `${sub.color}20`,
                        color: isCompletedSubject ? '#059669' : sub.color,
                      }}
                    >
                      {isCompletedSubject ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : isOpen ? (
                        <ChevronDown className="w-5 h-5" />
                      ) : (
                        <ChevronRight className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-base truncate">{sub.name}</p>
                        {isCompletedSubject && (
                          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-600 text-white">
                            Concluída
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-theme">
                        {sub.category} · {done}/{subTopics.length} tópicos
                      </p>
                    </div>
                  </button>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  {subQ > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-theme font-medium">{subQ} q</span>
                      <span
                        className={`font-bold px-2.5 py-1 rounded-full text-xs ${
                          subAcc >= 80
                            ? 'bg-emerald-500/15 text-emerald-700'
                            : subAcc >= 60
                            ? 'bg-amber-500/15 text-amber-700'
                            : 'bg-rose-500/15 text-rose-700'
                        }`}
                      >
                        {subAcc}%
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <div className="w-28 h-2.5 rounded-full subtle-surface overflow-hidden hidden sm:block">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: isCompletedSubject ? '#059669' : sub.color,
                        }}
                      />
                    </div>
                    <span className="text-sm font-extrabold w-11 text-right">{pct}%</span>
                  </div>
                </div>
              </div>

              {isOpen && (
                <div className="px-6 pb-6 space-y-3 border-t border-theme pt-4 animate-fade-in-up">
                  {/* Barra compacta de ações da matéria (Adicionar tópico/lista · Vídeos · Editar · Remover) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                    {editingSubjectId === sub.id ? (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!editSubjectName.trim()) return;
                          await updateSubject(sub.id, { name: editSubjectName.trim() });
                          setEditingSubjectId(null);
                        }}
                        className="flex items-center gap-2 flex-1"
                      >
                        <input
                          autoFocus
                          value={editSubjectName}
                          onChange={(e) => setEditSubjectName(e.target.value)}
                          className="flex-1 rounded-xl subtle-surface border border-theme px-3 py-1.5 text-xs font-semibold"
                        />
                        <button
                          type="submit"
                          className="px-3 py-1.5 rounded-xl bg-teal-600 text-white text-xs font-bold inline-flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSubjectId(null)}
                          className="px-3 py-1.5 rounded-xl subtle-surface text-xs font-semibold"
                        >
                          Cancelar
                        </button>
                      </form>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (addingTopicForSub === sub.id) {
                                setAddingTopicForSub(null);
                                setNewTopicText('');
                              } else {
                                setAddingTopicForSub(sub.id);
                                setNewTopicText('');
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl bg-teal-600/12 text-teal-700 dark:text-teal-300 hover:bg-teal-600 hover:text-white text-xs font-bold inline-flex items-center gap-1 transition"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Adicionar tópico / lista
                          </button>
                          {hasMissingVideos && (
                            <button
                              type="button"
                              disabled={videoJob.running}
                              onClick={() => handleBatchAutoVideos(sub.id, sub.name)}
                              className="px-3 py-1.5 rounded-xl subtle-surface hover:bg-red-600 hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition"
                            >
                              {videoJob.running ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="w-3.5 h-3.5 text-red-500" />
                              )}
                              Preencher vídeos
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditSubjectName(sub.name);
                              setEditingSubjectId(sub.id);
                            }}
                            className="px-2.5 py-1.5 rounded-xl subtle-surface hover:opacity-85 text-xs font-semibold inline-flex items-center gap-1 text-muted-theme hover:text-[var(--text-main)]"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => inspectAndRequestDelete([sub.id], [])}
                            className="px-2.5 py-1.5 rounded-xl subtle-surface hover:bg-rose-500/15 text-xs font-semibold inline-flex items-center gap-1 text-muted-theme hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remover
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Caixa inteligente: Adicionar 1 tópico ou colar uma lista que vira vários checklists */}
                  {addingTopicForSub === sub.id && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (parsedNewTopics.length === 0) return;
                        if (parsedNewTopics.length === 1) {
                          await addTopic(sub.id, parsedNewTopics[0]);
                        } else {
                          await addTopicsBatch(sub.id, parsedNewTopics);
                        }
                        setNewTopicText('');
                        setAddingTopicForSub(null);
                      }}
                      className="subtle-surface rounded-2xl p-3.5 space-y-2.5 animate-fade-in-up"
                    >
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start">
                        <textarea
                          autoFocus
                          rows={parsedNewTopics.length > 1 ? Math.min(6, parsedNewTopics.length + 1) : 1}
                          value={newTopicText}
                          onChange={(e) => setNewTopicText(e.target.value)}
                          placeholder="Digite um tópico, cole uma lista do edital ou use > para subtópicos (ex: > Justas causas)..."
                          className="flex-1 rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3.5 py-2 text-xs resize-y"
                        />
                        <button
                          type="submit"
                          disabled={parsedNewTopics.length === 0}
                          className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold disabled:opacity-50 shrink-0"
                        >
                          {parsedNewTopics.length > 1
                            ? `Criar ${parsedNewTopics.length} checklists`
                            : 'Salvar tópico'}
                        </button>
                      </div>

                      {parsedNewTopics.length > 1 && (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                          <p className="text-[11px] font-bold text-teal-700 dark:text-teal-300">
                            Lista identificada ({parsedNewTopics.length} tópicos):
                          </p>
                          {parsedNewTopics.map((item, idx) => (
                            <div
                              key={idx}
                              className={`card-surface rounded-xl px-3 py-1.5 flex items-center justify-between gap-2 text-xs ${
                                isSubtopicTitle(item) ? 'ml-5 border-l-2 border-l-teal-500' : ''
                              }`}
                            >
                              <span className="truncate">{item}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setNewTopicText(
                                    parsedNewTopics.filter((_, i) => i !== idx).join('\n')
                                  )
                                }
                                className="text-muted-theme hover:text-rose-600 shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </form>
                  )}

                  {/* Lista de Tópicos (com recolhimento de subtópicos) */}
                  {(() => {
                    const subCounts: Record<string, number> = {};
                    const parentOf: Record<string, string> = {};
                    let currentParentId: string | null = null;
                    for (const item of subTopics) {
                      if (isSubtopicTitle(item.title)) {
                        if (currentParentId) {
                          parentOf[item.id] = currentParentId;
                          subCounts[currentParentId] = (subCounts[currentParentId] || 0) + 1;
                        }
                      } else {
                        currentParentId = item.id;
                      }
                    }

                    return subTopics.map((topic) => {
                      const isSub = isSubtopicTitle(topic.title);
                      const parentId = parentOf[topic.id];
                      if (isSub && parentId && !expandedParents[parentId]) {
                        return null;
                      }
                      const mySubCount = !isSub ? subCounts[topic.id] || 0 : 0;
                      const mySubsExpanded = Boolean(expandedParents[topic.id]);
                      const stage = getTopicStage(topic.id, topic.studied);
                      const sc = getStageColors(stage.level);
                      const diff = difficultyMap[topic.id];
                      const hlCount = highlights.filter((h) => h.topic_id === topic.id).length;
                      const topicPdfs = parseTopicPdfs(topic.pdf_path, topic.pdf_name);

                      return (
                      <div key={topic.id} className={isSub ? 'ml-5 sm:ml-9 relative' : ''}>
                        {isSub && (
                          <span className="absolute -left-3.5 top-5 w-2.5 h-2.5 border-l-2 border-b-2 border-teal-500/50 rounded-bl-sm" />
                        )}
                      <div
                        className={`rounded-2xl ${isSub ? 'p-3 sm:p-3.5' : 'p-4'} flex flex-col sm:flex-row sm:items-center justify-between gap-3 border transition-all`}
                        style={{
                          backgroundColor: sc.bg,
                          borderColor: sc.border,
                        }}
                      >
                        <div className="flex items-start gap-3.5 flex-1 min-w-0">
                          {selectMode ? (
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedTopicIds((prev) =>
                                  prev.includes(topic.id)
                                    ? prev.filter((id) => id !== topic.id)
                                    : [...prev, topic.id]
                                )
                              }
                              className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center border-2 shrink-0 transition ${
                                selectedTopicIds.includes(topic.id)
                                  ? 'bg-rose-600 border-rose-600 text-white'
                                  : 'bg-white dark:bg-slate-800 border-rose-400'
                              }`}
                            >
                              {selectedTopicIds.includes(topic.id) && (
                                <Check className="w-4 h-4 stroke-[3]" />
                              )}
                            </button>
                          ) : (
                          <button
                            type="button"
                            onClick={() => handleTopicCheck(topic)}
                            className="mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center border-2 shrink-0 transition"
                            style={{
                              backgroundColor: sc.checkBg,
                              borderColor: sc.checkBorder,
                              color: '#ffffff',
                            }}
                          >
                            {topic.studied && <Check className="w-4 h-4 stroke-[3]" />}
                          </button>
                          )}

                          <div className="min-w-0 flex-1 space-y-1.5">
                            {editingTopicId === topic.id ? (
                              <form
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  if (!editTopicTitle.trim()) return;
                                  await updateTopicTitle(topic.id, editTopicTitle);
                                  setEditingTopicId(null);
                                }}
                                className="flex items-center gap-2"
                              >
                                <input
                                  autoFocus
                                  value={editTopicTitle}
                                  onChange={(e) => setEditTopicTitle(e.target.value)}
                                  className="flex-1 rounded-xl bg-[var(--bg-card)] border border-theme px-3 py-1.5 text-xs font-semibold"
                                />
                                <button
                                  type="submit"
                                  className="px-2.5 py-1.5 rounded-xl bg-teal-600 text-white text-xs font-bold shrink-0"
                                >
                                  Salvar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingTopicId(null)}
                                  className="p-1.5 rounded-xl subtle-surface shrink-0"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </form>
                            ) : (
                              <div className="flex items-start gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => handleTopicCheck(topic)}
                                  className="text-left text-sm font-semibold leading-snug"
                                  style={{ color: sc.titleColor }}
                                >
                                  {isSub ? cleanSubtopicDisplay(topic.title) : topic.title}
                                </button>
                                {mySubCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedParents((prev) => ({
                                        ...prev,
                                        [topic.id]: !prev[topic.id],
                                      }));
                                    }}
                                    title={mySubsExpanded ? 'Recolher subtópicos' : 'Ver subtópicos deste tema'}
                                    className={`px-3 py-1 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 border transition shrink-0 shadow-xs ${
                                      mySubsExpanded
                                        ? 'bg-teal-600 border-teal-600 text-white hover:bg-teal-500'
                                        : 'bg-teal-500/15 border-teal-500/40 text-teal-700 dark:text-teal-300 hover:bg-teal-500/25'
                                    }`}
                                  >
                                    {mySubsExpanded ? (
                                      <ChevronDown className="w-4 h-4" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4" />
                                    )}
                                    {mySubsExpanded
                                      ? `Recolher (${mySubCount})`
                                      : `Ver ${mySubCount} ${mySubCount === 1 ? 'subtópico' : 'subtópicos'}`}
                                  </button>
                                )}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                                style={{ backgroundColor: sc.badgeBg, color: sc.badgeText }}
                              >
                                {stage.level === 4 && <Trophy className="w-3 h-3" />}
                                {stage.label}
                              </span>

                              {diff && (
                                <span
                                  className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                                    diff === 'dificil'
                                      ? 'bg-rose-500/15 text-rose-700'
                                      : diff === 'medio'
                                      ? 'bg-amber-500/15 text-amber-800'
                                      : 'bg-emerald-500/15 text-emerald-700'
                                  }`}
                                >
                                  {diff === 'dificil'
                                    ? '🔥 Difícil'
                                    : diff === 'medio'
                                    ? '🤔 Médio'
                                    : '😊 Fácil'}
                                </span>
                              )}

                              {topic.pdf_name && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-muted-theme inline-flex items-center gap-1 max-w-[160px] truncate">
                                  <FileText className="w-3 h-3 shrink-0" />
                                  {topic.pdf_name}
                                </span>
                              )}

                              {topicNotesMap[topic.id]?.rawText?.trim() && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-800 dark:text-teal-300 inline-flex items-center gap-1">
                                  <AlignLeft className="w-3 h-3" />
                                  Texto
                                </span>
                              )}
                              {hlCount > 0 && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300">
                                  {hlCount} {hlCount === 1 ? 'grifo' : 'grifos'}
                                </span>
                              )}

                              {topic.studied && (
                                <div className="flex items-center gap-1 text-[10px] font-bold">
                                  <span
                                    className={`px-2 py-0.5 rounded-full ${
                                      stage.rev1
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-black/5 text-muted-theme'
                                    }`}
                                  >
                                    {stage.rev1 ? '✓ 1d' : '1d'}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full ${
                                      stage.rev7
                                        ? 'bg-teal-600 text-white'
                                        : 'bg-black/5 text-muted-theme'
                                    }`}
                                  >
                                    {stage.rev7 ? '✓ 7d' : '7d'}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full ${
                                      stage.rev30
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-black/5 text-muted-theme'
                                    }`}
                                  >
                                    {stage.rev30 ? '✓ 30d' : '30d'}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full ${
                                      stage.rev90
                                        ? 'bg-emerald-700 text-white'
                                        : 'bg-black/5 text-muted-theme'
                                    }`}
                                  >
                                    {stage.rev90 ? '✓ 90d' : '90d'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Ações integradas do tópico: Vídeo, PDF, Grifos, Copiar, Prioridade, Editar, Remover */}
                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center flex-wrap">
                          <button
                            type="button"
                            onClick={() => openTopicViewer(topic.id, topic.pdf_path, 'video')}
                            title={topic.video_url ? 'Assistir videoaula salva' : 'Buscar e assistir videoaula'}
                            className={`p-2 rounded-xl transition ${
                              topic.video_url
                                ? 'bg-red-600 text-white hover:bg-red-500'
                                : 'card-surface text-muted-theme hover:text-red-500'
                            }`}
                          >
                            <Youtube className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setEditingNoteMode(!topicNotesMap[topic.id]?.formatted);
                              openTopicViewer(topic.id, topic.pdf_path, 'texto');
                            }}
                            title="Texto / Resumo formatado com Gemini"
                            className={`p-2 rounded-xl transition ${
                              topicNotesMap[topic.id]?.rawText?.trim()
                                ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                                : 'card-surface text-muted-theme hover:text-indigo-600'
                            }`}
                          >
                            <AlignLeft className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => openTopicViewer(topic.id, topic.pdf_path, 'pdf')}
                            title={
                              topicPdfs.length > 1
                                ? `Abrir ${topicPdfs.length} PDFs e Grifos do tópico`
                                : 'Abrir PDF e Grifos do tópico'
                            }
                            className={`relative p-2 rounded-xl transition ${
                              topicPdfs.length > 0 || hlCount > 0
                                ? 'bg-teal-600 text-white hover:bg-teal-500'
                                : 'card-surface text-muted-theme hover:text-teal-600'
                            }`}
                          >
                            <Highlighter className="w-4 h-4" />
                            {topicPdfs.length > 1 && (
                              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-400 text-slate-900 text-[9px] font-extrabold flex items-center justify-center shadow">
                                {topicPdfs.length}
                              </span>
                            )}
                          </button>

                          <label
                            title={
                              topicPdfs.length > 0
                                ? 'Adicionar mais um PDF neste tópico'
                                : 'Anexar PDF neste tópico'
                            }
                            className="cursor-pointer p-2 rounded-xl card-surface text-muted-theme hover:text-teal-600 transition"
                          >
                            {uploadingTopicId === topic.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Upload className="w-4 h-4" />
                            )}
                            <input
                              type="file"
                              accept="application/pdf"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handlePdfUpload(topic.id, f);
                                e.target.value = '';
                              }}
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() => toggleTopicPriority(topic)}
                            title="Marcar prioridade"
                            className={`p-2 rounded-xl transition ${
                              topic.is_priority
                                ? 'bg-amber-500 text-white'
                                : 'card-surface text-muted-theme hover:text-amber-500'
                            }`}
                          >
                            <Star
                              className="w-4 h-4"
                              fill={topic.is_priority ? 'currentColor' : 'none'}
                            />
                          </button>

                          <button
                            type="button"
                            onClick={() => setPendingDifficultyTopic(topic)}
                            title={
                              diff === 'facil'
                                ? 'Dificuldade: Fácil (clique para alterar)'
                                : diff === 'medio'
                                ? 'Dificuldade: Médio (clique para alterar)'
                                : diff === 'dificil'
                                ? 'Dificuldade: Difícil (clique para alterar)'
                                : 'Avaliar dificuldade deste tópico'
                            }
                            className={`p-2 rounded-xl transition inline-flex items-center justify-center min-w-[34px] h-[34px] ${
                              diff === 'facil'
                                ? 'bg-emerald-500/15 border border-emerald-500/40 text-base leading-none'
                                : diff === 'medio'
                                ? 'bg-amber-500/15 border border-amber-500/40 text-base leading-none'
                                : diff === 'dificil'
                                ? 'bg-rose-500/15 border border-rose-500/40 text-base leading-none'
                                : 'card-surface text-muted-theme hover:text-amber-500'
                            }`}
                          >
                            {diff === 'facil' ? (
                              <span role="img" aria-label="Fácil">😊</span>
                            ) : diff === 'medio' ? (
                              <span role="img" aria-label="Médio">🤔</span>
                            ) : diff === 'dificil' ? (
                              <span role="img" aria-label="Difícil">😰</span>
                            ) : (
                              <SmilePlus className="w-4 h-4" />
                            )}
                          </button>

                          {!isSub && (
                            <button
                              type="button"
                              onClick={() => {
                                setAddingSubForTopicId(
                                  addingSubForTopicId === topic.id ? null : topic.id
                                );
                                setNewSubtopicTitle('');
                              }}
                              title="Adicionar subtópico abaixo deste tema"
                              className="p-2 rounded-xl card-surface text-muted-theme hover:text-teal-600 transition"
                            >
                              <CornerDownRight className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setEditingTopicId(topic.id);
                              setEditTopicTitle(topic.title);
                            }}
                            title="Editar tópico"
                            className="p-2 rounded-xl card-surface text-muted-theme hover:text-[var(--text-main)] transition"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => inspectAndRequestDelete([], [topic.id])}
                            title="Remover tópico"
                            className="p-2 rounded-xl card-surface text-muted-theme hover:text-rose-600 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {addingSubForTopicId === topic.id && (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!newSubtopicTitle.trim()) return;
                            await addTopic(sub.id, `↳ ${newSubtopicTitle.trim()}`);
                            setNewSubtopicTitle('');
                            setAddingSubForTopicId(null);
                          }}
                          className="ml-6 sm:ml-10 mt-2 flex gap-2 animate-fade-in-up"
                        >
                          <input
                            autoFocus
                            value={newSubtopicTitle}
                            onChange={(e) => setNewSubtopicTitle(e.target.value)}
                            placeholder={`Novo subtópico de "${topic.title.slice(0, 35)}"...`}
                            className="flex-1 rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs"
                          />
                          <button
                            type="submit"
                            className="px-3 py-1.5 rounded-xl bg-teal-600 text-white text-xs font-bold shrink-0"
                          >
                            Salvar subtópico
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingSubForTopicId(null)}
                            className="px-2.5 py-1.5 rounded-xl subtle-surface text-xs"
                          >
                            Cancelar
                          </button>
                        </form>
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

      {/* Modal: Esse tópico foi Fácil, Médio ou Difícil? */}
      {pendingDifficultyTopic && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-extrabold">Como foi estudar este tópico?</h2>
                <p className="text-xs text-muted-theme mt-1 line-clamp-2">
                  {pendingDifficultyTopic.title}
                </p>
              </div>
              <button
                onClick={() => setPendingDifficultyTopic(null)}
                className="p-1.5 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-theme">
              Tópicos marcados como <strong>Médio</strong> ou <strong>Difícil</strong> entram automaticamente na aba <strong>Prioridades</strong> em ordem de dificuldade.
            </p>

            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <button
                onClick={() => saveDifficulty(pendingDifficultyTopic.id, 'facil')}
                className="py-3.5 px-3 rounded-2xl bg-emerald-500/15 hover:bg-emerald-600 hover:text-white text-emerald-800 dark:text-emerald-200 font-bold text-sm transition"
              >
                😊 Fácil
              </button>
              <button
                onClick={() => saveDifficulty(pendingDifficultyTopic.id, 'medio')}
                className="py-3.5 px-3 rounded-2xl bg-amber-500/15 hover:bg-amber-500 hover:text-slate-950 text-amber-800 dark:text-amber-200 font-bold text-sm transition"
              >
                🤔 Médio
              </button>
              <button
                onClick={() => saveDifficulty(pendingDifficultyTopic.id, 'dificil')}
                className="py-3.5 px-3 rounded-2xl bg-rose-500/15 hover:bg-rose-600 hover:text-white text-rose-800 dark:text-rose-200 font-bold text-sm transition"
              >
                🔥 Difícil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Integrado: Videoaula YouTube + Leitor PDF + Grifos por Prioridade */}
      {activeTopic && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="card-surface w-full max-w-[96vw] h-[94vh] rounded-3xl overflow-hidden flex flex-col shadow-2xl animate-pop-in">
            <div className="px-5 py-3.5 border-b border-theme flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-teal-600">{activeTopicSub?.name}</p>
                <p className="font-bold text-sm truncate">{activeTopic.title}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setViewerTab('video')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                    viewerTab === 'video' ? 'bg-red-600 text-white' : 'subtle-surface'
                  }`}
                >
                  <Youtube className="w-3.5 h-3.5" />
                  Videoaula
                </button>
                <button
                  type="button"
                  onClick={() => setViewerTab('pdf')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                    viewerTab === 'pdf' ? 'bg-teal-600 text-white' : 'subtle-surface'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setViewerTab('texto')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                    viewerTab === 'texto' ? 'bg-indigo-600 text-white' : 'subtle-surface'
                  }`}
                >
                  <AlignLeft className="w-3.5 h-3.5" />
                  Texto / Resumo
                </button>
                <button
                  type="button"
                  onClick={() => setShowHighlightsPane((v) => !v)}
                  title={showHighlightsPane ? 'Ocultar barra de grifos para ampliar leitura' : 'Mostrar barra de grifos'}
                  className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl subtle-surface text-xs font-semibold text-muted-theme hover:text-[var(--text-main)]"
                >
                  {showHighlightsPane ? (
                    <>
                      <PanelRightClose className="w-3.5 h-3.5" />
                      Ampliar tela
                    </>
                  ) : (
                    <>
                      <PanelRightOpen className="w-3.5 h-3.5" />
                      Grifos ({activeHighlights.length})
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTopicId(null)}
                  className="p-2 rounded-xl subtle-surface"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className={`flex-1 grid grid-cols-1 overflow-hidden ${showHighlightsPane ? 'lg:grid-cols-4' : 'lg:grid-cols-1'}`}>
              {/* Esquerda: Player YouTube OU Visualizador PDF */}
              <div className={`${showHighlightsPane ? 'lg:col-span-3' : 'lg:col-span-1'} ${viewerTab === 'texto' ? 'bg-[var(--bg-page)]' : 'bg-slate-950/90'} flex flex-col overflow-hidden`}>
                {viewerTab === 'video' ? (
                  <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
                    <form onSubmit={handleSaveVideo} className="flex flex-wrap gap-2">
                      <input
                        value={videoInput}
                        onChange={(e) => setVideoInput(e.target.value)}
                        placeholder="Cole o link do YouTube ou use a busca automática..."
                        className="flex-1 min-w-[200px] rounded-xl bg-white/10 text-white border border-white/15 px-3 py-2 text-xs"
                      />
                      <button
                        type="submit"
                        className="px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={handleNextVideoOption}
                        disabled={autoSearchingVideo}
                        className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${autoSearchingVideo ? 'animate-spin' : ''}`}
                        />
                        Outra aula
                      </button>
                      <a
                        href={getYouTubeSearchUrl(activeTopicSub?.name || '', activeTopic.title)}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Youtube className="w-3.5 h-3.5" />
                        YouTube
                      </a>
                    </form>

                    {autoSearchingVideo ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-white gap-2">
                        <Loader2 className="w-7 h-7 animate-spin text-red-400" />
                        <p className="text-xs text-slate-300">
                          Buscando melhor videoaula no YouTube...
                        </p>
                      </div>
                    ) : embedUrl ? (
                      <iframe
                        src={embedUrl}
                        title={activeTopic.title}
                        className="w-full flex-1 min-h-[300px] rounded-2xl border border-white/10"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-300 text-xs gap-2 p-6 text-center">
                        <Youtube className="w-9 h-9 text-red-400 opacity-80" />
                        <p>Nenhuma videoaula carregada ainda. Clique em &ldquo;Outra aula&rdquo; ou cole um link acima.</p>
                      </div>
                    )}
                  </div>
                ) : viewerTab === 'texto' ? (
                  <div className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-5">
                    {(() => {
                      const rec = topicNotesMap[activeTopic.id] || { rawText: '', formatted: null };
                      const showFormatted = Boolean(rec.formatted) && !editingNoteMode;
                      return (
                        <div className="max-w-3xl mx-auto space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-theme">
                              Material em Texto do Tópico
                            </p>
                            <div className="flex items-center gap-2 flex-wrap">
                              {rec.formatted && (
                                <button
                                  type="button"
                                  onClick={() => setEditingNoteMode((v) => !v)}
                                  className="px-3 py-1.5 rounded-xl card-surface border border-theme text-xs font-semibold"
                                >
                                  {editingNoteMode ? 'Ver formatado' : 'Editar texto'}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={formattingNote || !rec.rawText.trim()}
                                onClick={handleFormatNoteWithGemini}
                                className="px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                              >
                                {formattingNote ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Sparkles className="w-3.5 h-3.5" />
                                )}
                                {formattingNote ? 'Formatando...' : 'Formatar com Gemini'}
                              </button>
                            </div>
                          </div>

                          {showFormatted && rec.formatted ? (
                            <div className="space-y-4 animate-fade-in-up">
                              <div className="card-surface rounded-2xl p-6 space-y-2 border-l-4 border-l-teal-600">
                                <h3 className="text-lg font-extrabold">{rec.formatted.title}</h3>
                                {rec.formatted.summary && (
                                  <p className="text-sm text-muted-theme leading-relaxed">
                                    {rec.formatted.summary}
                                  </p>
                                )}
                              </div>

                              {rec.formatted.sections.map((sec, idx) => (
                                <div key={idx} className="card-surface rounded-2xl p-5 space-y-3">
                                  <h4 className="font-bold text-base flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-lg bg-teal-600/15 text-teal-700 dark:text-teal-300 text-xs font-extrabold flex items-center justify-center shrink-0">
                                      {idx + 1}
                                    </span>
                                    {sec.heading}
                                  </h4>
                                  <ul className="space-y-1.5 pl-1">
                                    {sec.points.map((pt, pIdx) => (
                                      <li key={pIdx} className="text-sm leading-relaxed flex items-start gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-teal-600 mt-2 shrink-0" />
                                        <span>{pt}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  {sec.callout && (
                                    <div className="rounded-xl bg-amber-500/12 border border-amber-500/30 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 font-medium">
                                      <strong>Atenção:</strong> {sec.callout}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-2.5">
                              <textarea
                                rows={14}
                                value={rec.rawText}
                                onChange={(e) =>
                                  saveTopicNote(activeTopic.id, {
                                    ...rec,
                                    rawText: e.target.value,
                                  })
                                }
                                placeholder="Cole aqui suas anotações, resumo, letra de lei ou texto da aula — depois clique em 'Formatar com Gemini' para deixar tudo organizado e separadinho por tópicos!"
                                className="w-full rounded-2xl card-surface border border-slate-300 dark:border-slate-600 p-4 text-sm leading-relaxed"
                              />
                              <p className="text-[11px] text-muted-theme">
                                Salvo automaticamente conforme você digita. Clique em <strong>Formatar com Gemini</strong> para transformar em um resumo estruturado.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  (() => {
                    const activePdfs = parseTopicPdfs(activeTopic.pdf_path, activeTopic.pdf_name);
                    const safePdfIdx = Math.min(activePdfIdx, Math.max(0, activePdfs.length - 1));
                    const currentPdf = activePdfs[safePdfIdx];

                    return (
                      <div className="flex-1 flex flex-col min-h-0">
                        {activePdfs.length > 0 && (
                          <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-700/70 flex items-center gap-1.5 overflow-x-auto shrink-0">
                            {activePdfs.map((pdf, idx) => {
                              const isCurrent = idx === safePdfIdx;
                              return (
                                <div
                                  key={`${pdf.path}_${idx}`}
                                  className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold shrink-0 transition ${
                                    isCurrent
                                      ? 'bg-teal-600 text-white shadow-sm'
                                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => void handleSwitchPdf(idx, pdf.path)}
                                    className="inline-flex items-center gap-1.5 max-w-[180px]"
                                    title={pdf.name}
                                  >
                                    <FileText className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">{pdf.name}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemovePdf(activeTopic.id, idx)}
                                    title="Remover este PDF"
                                    className="ml-0.5 p-0.5 rounded hover:bg-black/25 opacity-75 hover:opacity-100"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              );
                            })}

                            <label className="cursor-pointer ml-auto px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-teal-600 text-slate-200 hover:text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0 transition">
                              {uploadingTopicId === activeTopic.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Plus className="w-3.5 h-3.5" />
                              )}
                              Adicionar PDF
                              <input
                                type="file"
                                accept="application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handlePdfUpload(activeTopic.id, f);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          </div>
                        )}

                        {loadingPdfUrl ? (
                          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 text-xs gap-2 p-6">
                            <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
                            <p>Carregando PDF...</p>
                          </div>
                        ) : signedPdfUrl ? (
                          <iframe
                            src={signedPdfUrl}
                            title={currentPdf?.name || activeTopic.pdf_name || 'PDF'}
                            className="w-full h-full flex-1"
                          />
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 text-xs gap-3 p-6 text-center">
                            <FileText className="w-9 h-9 text-teal-400 opacity-80" />
                            <p>Nenhum PDF anexado neste tópico ainda.</p>
                            <label className="cursor-pointer px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold inline-flex items-center gap-1.5">
                              <Upload className="w-4 h-4" />
                              Anexar PDF agora
                              <input
                                type="file"
                                accept="application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handlePdfUpload(activeTopic.id, f);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>

              {/* Direita: Grifos por Hierarquia de Prioridade (recolhível para ampliar leitura do PDF) */}
              {showHighlightsPane && (
              <div className="border-t lg:border-t-0 lg:border-l border-theme p-4 flex flex-col gap-3 overflow-y-auto">
                <h3 className="font-bold text-sm flex items-center gap-1.5">
                  <Highlighter className="w-4 h-4 text-amber-500" />
                  Grifos & Anotações ({activeHighlights.length})
                </h3>

                <form onSubmit={handleSaveHighlight} className="space-y-2">
                  <textarea
                    rows={2}
                    required
                    value={hlText}
                    onChange={(e) => setHlText(e.target.value)}
                    placeholder="Cole um trecho importante ou escreva seu resumo..."
                    className="w-full rounded-xl subtle-surface border border-theme p-2.5 text-xs"
                  />
                  <div className="flex gap-2">
                    <input
                      value={hlNote}
                      onChange={(e) => setHlNote(e.target.value)}
                      placeholder="Observação rápida (opcional)"
                      className="flex-1 rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                    />
                    <input
                      type="number"
                      min={1}
                      value={hlPage}
                      onChange={(e) => setHlPage(e.target.value)}
                      placeholder="Pág."
                      title="Página do PDF"
                      className="w-16 rounded-xl subtle-surface border border-theme px-2 py-2 text-xs text-center"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      {HIGHLIGHT_PRIORITIES.map((prio) => {
                        const selected = hlColor === prio.bg;
                        return (
                          <button
                            key={prio.bg}
                            type="button"
                            onClick={() => setHlColor(prio.bg)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5 border transition ${
                              selected
                                ? 'ring-2 ring-offset-1 ring-slate-700 dark:ring-slate-300'
                                : 'opacity-80 hover:opacity-100'
                            }`}
                            style={{
                              backgroundColor: prio.bg,
                              borderColor: prio.border,
                              color: prio.text,
                            }}
                          >
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: prio.dot }}
                            />
                            {prio.label}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold"
                    >
                      Salvar Grifo
                    </button>
                  </div>
                </form>

                <div className="space-y-2 flex-1">
                  {activeHighlights.map((h) => {
                    const st = getHighlightStyle(h.color);
                    return (
                      <div
                        key={h.id}
                        className="rounded-xl p-3 text-xs relative group border-l-4"
                        style={{
                          backgroundColor: st.bg,
                          borderLeftColor: st.border,
                          color: st.text,
                        }}
                      >
                        <button
                          onClick={() => deleteHighlight(h.id)}
                          aria-label="Excluir grifo"
                          className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 p-1 rounded bg-black/10 hover:bg-rose-600 hover:text-white transition"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                        <span
                          className="inline-block text-[10px] font-extrabold uppercase tracking-wider mb-1 px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: 'rgba(255,255,255,0.6)', color: st.text }}
                        >
                          Prioridade {st.label}
                        </span>
                        <p className="font-semibold pr-5 leading-relaxed">{h.text}</p>
                        <p className="mt-1 text-[10px] font-bold opacity-80">
                          Pág. {h.page_number || 1}
                          {h.note ? ` · ${h.note}` : ''}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Modal de Proteção & Migração de Materiais (Grifos, PDFs, Vídeos, Textos, Flashcards) */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-lg rounded-3xl p-6 space-y-4 shadow-2xl animate-pop-in">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-extrabold text-base">
                    Existem conteúdos salvos aqui!
                  </h2>
                  <p className="text-xs text-muted-theme mt-0.5">
                    Encontramos: <strong>{pendingDelete.assetsSummary.join(' · ')}</strong>.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="p-1.5 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const delSubSet = new Set(pendingDelete.subjectIds);
              const delTopSet = new Set(pendingDelete.topicIds);
              const candidateTopics = topics.filter(
                (t) => !delTopSet.has(t.id) && !delSubSet.has(t.subject_id)
              );
              return candidateTopics.length > 0 ? (
                <div className="subtle-surface rounded-2xl p-4 space-y-2.5">
                  <label className="block text-xs font-bold">
                    Deseja migrar esses materiais para outro tópico antes de apagar?
                  </label>
                  <select
                    value={migrateTargetTopicId}
                    onChange={(e) => setMigrateTargetTopicId(e.target.value)}
                    className="w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2 text-xs"
                  >
                    {candidateTopics.map((t) => {
                      const s = subjects.find((sb) => sb.id === t.subject_id);
                      return (
                        <option key={t.id} value={t.id}>
                          {s?.name} › {cleanSubtopicDisplay(t.title)}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    disabled={deletingBusy || !migrateTargetTopicId}
                    onClick={() =>
                      executeDelete(
                        pendingDelete.subjectIds,
                        pendingDelete.topicIds,
                        migrateTargetTopicId
                      )
                    }
                    className="w-full py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold disabled:opacity-50"
                  >
                    {deletingBusy ? 'Migrando e excluindo...' : 'Migrar materiais e excluir'}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-theme">
                  Não há outro tópico disponível para migração.
                </p>
              );
            })()}

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-theme">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 rounded-xl subtle-surface text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingBusy}
                onClick={() =>
                  executeDelete(pendingDelete.subjectIds, pendingDelete.topicIds, null)
                }
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-50"
              >
                Excluir tudo sem migrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
