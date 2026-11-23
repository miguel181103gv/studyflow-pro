'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { useGlobal } from '@/components/GlobalProvider';
import { createClient } from '@/lib/supabase/client';
import { getYouTubeEmbedUrl, getYouTubeSearchUrl } from '@/lib/utils';
import {
  Plus,
  Upload,
  FileText,
  Highlighter,
  Trash2,
  Loader2,
  ExternalLink,
  X,
  Youtube,
  Save,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

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
  const found = HIGHLIGHT_PRIORITIES.find((p) => p.bg.toLowerCase() === (color || '').toLowerCase());
  if (found) return found;
  // Compatibilidade com grifos antigos
  if (color === '#bbf7d0') return HIGHLIGHT_PRIORITIES[0];
  if (color === '#fef08a') return HIGHLIGHT_PRIORITIES[1];
  if (color === '#fbcfe8') return HIGHLIGHT_PRIORITIES[2];
  return { label: 'Nota', bg: color || '#fef3c7', border: '#d97706', text: '#0f172a', dot: '#d97706' };
}

function parseTopicList(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const lines = normalized.includes('\n')
    ? normalized.split('\n')
    : normalized.includes(';')
    ? normalized.split(';')
    : [normalized];

  return lines
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•–—]\s+/, '')
        .replace(/^\d+(?:\.\d+)*\s*[.)-]?\s+/, '')
        .replace(/;+$/, '')
        .trim()
    )
    .filter((item) => item.length > 0);
}

interface FoundVideo {
  videoId: string;
  url: string;
  embedUrl: string;
}

export default function MateriasPage() {
  const {
    userId,
    profile,
    subjects,
    topics,
    highlights,
    addSubject,
    addTopic,
    addTopicsBatch,
    updateTopicPdf,
    updateTopicVideo,
    addHighlight,
    deleteHighlight,
  } = useProfile();

  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || '');
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [uploadingTopicId, setUploadingTopicId] = useState<string | null>(null);
  const { videoJob, startBatchVideoJob } = useGlobal();

  // Viewer + Grifos + YouTube
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [viewerTab, setViewerTab] = useState<'pdf' | 'video'>('pdf');
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);
  const [videoInput, setVideoInput] = useState('');
  const [autoSearchingVideo, setAutoSearchingVideo] = useState(false);
  const [foundVideos, setFoundVideos] = useState<FoundVideo[]>([]);
  const [videoIdx, setVideoIdx] = useState(0);
  const [hlText, setHlText] = useState('');
  const [hlNote, setHlNote] = useState('');
  const [hlPage, setHlPage] = useState('1');
  const [hlColor, setHlColor] = useState('#fef3c7');

  const currentSubjectId = selectedSubjectId || subjects[0]?.id || '';
  const currentSubject = subjects.find((s) => s.id === currentSubjectId);
  const currentTopics = topics.filter((t) => t.subject_id === currentSubjectId);
  const activeTopic = topics.find((t) => t.id === activeTopicId);
  const activeHighlights = highlights.filter((h) => h.topic_id === activeTopicId);

  const parsedTopicsToAdd = parseTopicList(newTopicTitle);

  async function handleAddTopic(e: React.FormEvent) {
    e.preventDefault();
    if (!currentSubjectId || parsedTopicsToAdd.length === 0) return;

    if (parsedTopicsToAdd.length === 1) {
      const single = parsedTopicsToAdd[0];
      const duplicate = currentTopics.some(
        (t) => t.title.trim().toLowerCase() === single.toLowerCase()
      );
      if (
        duplicate &&
        !confirm('Já existe um tópico com nome igual nesta matéria. Deseja adicionar mesmo assim?')
      ) {
        return;
      }
      await addTopic(currentSubjectId, single);
    } else {
      await addTopicsBatch(currentSubjectId, parsedTopicsToAdd);
    }
    setNewTopicTitle('');
  }

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
      await updateTopicPdf(topicId, path, file.name);
      await openTopicViewer(topicId, path, 'pdf');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao enviar PDF.');
    } finally {
      setUploadingTopicId(null);
    }
  }

  async function autoFetchTopicVideo(topicId: string, subjectName: string, topicTitle: string) {
    setAutoSearchingVideo(true);
    try {
      const res = await fetch('/api/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectName, topicTitle }),
      });
      const json = await res.json();
      if (res.ok && json.ok && Array.isArray(json.videos) && json.videos.length > 0) {
        setFoundVideos(json.videos);
        setVideoIdx(0);
        const firstUrl = json.videos[0].url;
        setVideoInput(firstUrl);
        await updateTopicVideo(topicId, firstUrl);
      }
    } catch {
      // Silencioso
    } finally {
      setAutoSearchingVideo(false);
    }
  }

  function handleBatchAutoVideos() {
    if (!currentSubject) return;
    const missing = currentTopics.filter((t) => !t.video_url);
    if (missing.length === 0) return;
    startBatchVideoJob(
      profile?.name || currentSubject.name,
      missing.map((t) => ({
        topicId: t.id,
        subjectName: currentSubject.name,
        topicTitle: t.title,
      })),
      (topicId, url) => {
        updateTopicVideo(topicId, url);
      }
    );
  }

  async function openTopicViewer(
    topicId: string,
    pdfPath: string | null,
    preferredTab: 'pdf' | 'video' = 'pdf'
  ) {
    const t = topics.find((tp) => tp.id === topicId);
    setActiveTopicId(topicId);
    setVideoInput(t?.video_url || '');
    setFoundVideos([]);
    setVideoIdx(0);
    setViewerTab(preferredTab);
    setSignedPdfUrl(null);

    if (pdfPath) {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from('study-assets')
        .createSignedUrl(pdfPath, 3600);
      if (data?.signedUrl) setSignedPdfUrl(data.signedUrl);
    }

    if (preferredTab === 'video' && t && !t.video_url && currentSubject) {
      await autoFetchTopicVideo(t.id, currentSubject.name, t.title);
    }
  }

  async function cycleNextVideo() {
    if (!activeTopic || !currentSubject) return;
    if (foundVideos.length > 1) {
      const next = (videoIdx + 1) % foundVideos.length;
      setVideoIdx(next);
      const nextUrl = foundVideos[next].url;
      setVideoInput(nextUrl);
      await updateTopicVideo(activeTopic.id, nextUrl);
    } else {
      await autoFetchTopicVideo(activeTopic.id, currentSubject.name, activeTopic.title);
    }
  }

  async function handleSaveVideo(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTopicId) return;
    await updateTopicVideo(activeTopicId, videoInput.trim() || null);
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

  const embedUrl = getYouTubeEmbedUrl(activeTopic?.video_url || videoInput);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Matérias, PDFs, Vídeos e Grifos</h1>
          <p className="text-sm text-muted-theme">
            O app busca automaticamente uma videoaula do YouTube para cada tópico, além de guardar seus PDFs e grifos.
          </p>
        </div>

        <button
          onClick={handleBatchAutoVideos}
          disabled={videoJob.running || currentTopics.every((t) => !!t.video_url)}
          className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 shrink-0"
        >
          {videoJob.running ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {videoJob.running ? 'Preenchendo em 2º plano...' : 'Preencher Vídeos da Matéria'}
        </button>
      </div>

      {/* Subject pills + Nova Matéria */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap gap-2">
        {subjects.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedSubjectId(s.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              currentSubjectId === s.id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'card-surface hover:opacity-80'
            }`}
          >
            {s.name}
          </button>
        ))}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newSubjectName.trim()) return;
            const created = await addSubject(newSubjectName);
            if (created) setSelectedSubjectId(created.id);
            setNewSubjectName('');
          }}
          className="flex gap-2 max-w-md"
        >
          <input
            value={newSubjectName}
            onChange={(e) => setNewSubjectName(e.target.value)}
            placeholder="Nome de nova matéria..."
            className="flex-1 rounded-xl card-surface px-3 py-2 text-xs focus:outline-none"
          />
          <button
            type="submit"
            className="px-3 py-2 rounded-xl subtle-surface text-xs font-semibold inline-flex items-center gap-1 hover:opacity-80"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Matéria
          </button>
        </form>
      </div>

      {/* Add Topic (suporta 1 tópico ou colar uma lista inteira que vira vários checklists) */}
      <form onSubmit={handleAddTopic} className="space-y-2.5">
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start">
          <textarea
            rows={parsedTopicsToAdd.length > 1 ? Math.min(6, parsedTopicsToAdd.length + 1) : 1}
            value={newTopicTitle}
            onChange={(e) => setNewTopicTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && parsedTopicsToAdd.length <= 1) {
                e.preventDefault();
                handleAddTopic(e);
              }
            }}
            placeholder="Adicionar tópico ou colar uma lista (um por linha ou separado por ;)..."
            className="flex-1 rounded-xl card-surface px-4 py-2.5 text-sm resize-y"
          />
          <button
            type="submit"
            disabled={parsedTopicsToAdd.length === 0}
            className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            <Plus className="w-4 h-4" />
            {parsedTopicsToAdd.length > 1
              ? `Adicionar ${parsedTopicsToAdd.length} tópicos`
              : 'Adicionar'}
          </button>
        </div>

        {parsedTopicsToAdd.length > 1 && (
          <div className="card-surface rounded-2xl p-4 space-y-2.5 animate-fade-in-up border border-teal-500/35">
            <p className="text-xs font-bold text-teal-700 dark:text-teal-300">
              Lista detectada: serão criados {parsedTopicsToAdd.length} itens de checklist em {currentSubject?.name}:
            </p>
            <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
              {parsedTopicsToAdd.map((item, idx) => (
                <div
                  key={idx}
                  className="subtle-surface rounded-xl px-3 py-1.5 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-4 h-4 rounded border border-slate-400/60 shrink-0 inline-block" />
                    <span className="truncate">{item}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const remaining = parsedTopicsToAdd.filter((_, i) => i !== idx);
                      setNewTopicTitle(remaining.join('\n'));
                    }}
                    className="text-muted-theme hover:text-rose-600 shrink-0"
                    title="Remover da lista"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </form>

      {/* Topics List */}
      <div className="space-y-2.5">
        {currentTopics.map((t) => {
          const hlCount = highlights.filter((h) => h.topic_id === t.id).length;
          return (
            <div
              key={t.id}
              className="card-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.title}</p>
                <p className="text-[11px] text-muted-theme mt-0.5">
                  {t.pdf_name ? `📄 ${t.pdf_name}` : 'Sem PDF'} •{' '}
                  {t.video_url ? '▶️ Aula pronta' : '▶️ Busca automática ao abrir'} • {hlCount} grifos
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <button
                  onClick={() => openTopicViewer(t.id, t.pdf_path, 'video')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition ${
                    t.video_url
                      ? 'bg-red-600 text-white hover:bg-red-500'
                      : 'subtle-surface hover:opacity-80'
                  }`}
                >
                  <Youtube className="w-3.5 h-3.5" />
                  {t.video_url ? 'Ver Aula' : 'Vídeo Auto'}
                </button>

                <label className="cursor-pointer px-3 py-1.5 rounded-xl subtle-surface text-xs font-medium inline-flex items-center gap-1.5 hover:opacity-80">
                  {uploadingTopicId === t.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {t.pdf_path ? 'Trocar PDF' : 'Anexar PDF'}
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handlePdfUpload(t.id, f);
                    }}
                  />
                </label>

                <button
                  onClick={() => openTopicViewer(t.id, t.pdf_path, 'pdf')}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Highlighter className="w-3.5 h-3.5" />
                  Abrir & Grifos
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Built-in PDF + YouTube Viewer + Grifos Modal */}
      {activeTopic && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-2 sm:p-4">
          <div className="card-surface w-full max-w-6xl h-[90vh] rounded-3xl overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-theme flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h2 className="font-bold text-sm truncate">{activeTopic.title}</h2>
                <p className="text-[11px] text-muted-theme">
                  {currentSubject?.name} • {activeTopic.pdf_name || 'Estudo integrado'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-xl subtle-surface p-1">
                  <button
                    onClick={() => setViewerTab('pdf')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      viewerTab === 'pdf' ? 'bg-blue-600 text-white' : ''
                    }`}
                  >
                    📄 PDF
                  </button>
                  <button
                    onClick={() => {
                      setViewerTab('video');
                      if (!activeTopic.video_url && currentSubject) {
                        autoFetchTopicVideo(activeTopic.id, currentSubject.name, activeTopic.title);
                      }
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      viewerTab === 'video' ? 'bg-red-600 text-white' : ''
                    }`}
                  >
                    ▶️ YouTube
                  </button>
                </div>

                {signedPdfUrl && viewerTab === 'pdf' && (
                  <a
                    href={signedPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-xl subtle-surface text-xs font-medium inline-flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Nova aba
                  </a>
                )}
                <button
                  onClick={() => setActiveTopicId(null)}
                  className="p-2 rounded-xl subtle-surface"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 overflow-hidden">
              {/* Left 2 cols: PDF or YouTube Player */}
              <div className="lg:col-span-2 bg-slate-950 flex flex-col overflow-hidden">
                {viewerTab === 'pdf' ? (
                  signedPdfUrl ? (
                    <iframe
                      src={signedPdfUrl}
                      className="w-full h-full border-0"
                      title="Visualizador de PDF"
                    />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                      <FileText className="w-10 h-10 mb-2 opacity-50" />
                      <p className="text-sm">Nenhum PDF anexado a este tópico.</p>
                      <p className="text-xs mt-1">
                        Troque para <strong>▶️ YouTube</strong> ali em cima para assistir à aula automática!
                      </p>
                    </div>
                  )
                ) : (
                  <div className="flex-1 flex flex-col p-4 gap-3 text-white overflow-y-auto">
                    <form onSubmit={handleSaveVideo} className="flex flex-col sm:flex-row gap-2">
                      <input
                        value={videoInput}
                        onChange={(e) => setVideoInput(e.target.value)}
                        placeholder="Link do YouTube (preenchido automaticamente ou cole outro)"
                        className="flex-1 rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-xs text-white"
                      />
                      <button
                        type="submit"
                        className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={cycleNextVideo}
                        disabled={autoSearchingVideo}
                        className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                        title="Trocar para outro vídeo sobre este tópico"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${autoSearchingVideo ? 'animate-spin' : ''}`}
                        />
                        Outro Vídeo
                      </button>
                      <a
                        href={getYouTubeSearchUrl(currentSubject?.name || '', activeTopic.title)}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        YouTube
                      </a>
                    </form>

                    {autoSearchingVideo ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-300 gap-2">
                        <Loader2 className="w-8 h-8 animate-spin text-red-500" />
                        <p className="text-xs">
                          Buscando automaticamente uma aula sobre &ldquo;{activeTopic.title}&rdquo;...
                        </p>
                      </div>
                    ) : embedUrl ? (
                      <div className="flex-1 min-h-[280px] rounded-2xl overflow-hidden bg-black">
                        <iframe
                          src={embedUrl}
                          className="w-full h-full border-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          title="Aula YouTube"
                        />
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center p-8">
                        <Youtube className="w-12 h-12 text-red-500 mb-2 opacity-80" />
                        <p className="text-sm text-white font-medium">
                          Clique em &ldquo;Outro Vídeo&rdquo; para buscar automaticamente ou cole um link acima.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Grifos Panel */}
              <div className="border-l border-theme p-4 flex flex-col overflow-y-auto">
                <h3 className="font-bold text-sm mb-3">Meus Grifos ({activeHighlights.length})</h3>
                <form onSubmit={handleSaveHighlight} className="space-y-2.5 mb-4">
                  <textarea
                    rows={3}
                    value={hlText}
                    onChange={(e) => setHlText(e.target.value)}
                    placeholder="Cole ou digite o trecho importante..."
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
                              selected ? 'ring-2 ring-offset-1 ring-slate-700 dark:ring-slate-300' : 'opacity-80 hover:opacity-100'
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
