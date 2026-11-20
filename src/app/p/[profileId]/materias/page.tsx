'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
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
    addTopic,
    updateTopicPdf,
    updateTopicVideo,
    addHighlight,
    deleteHighlight,
  } = useProfile();

  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || '');
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [uploadingTopicId, setUploadingTopicId] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);

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
  const [hlColor, setHlColor] = useState('#fef08a');

  const currentSubjectId = selectedSubjectId || subjects[0]?.id || '';
  const currentSubject = subjects.find((s) => s.id === currentSubjectId);
  const currentTopics = topics.filter((t) => t.subject_id === currentSubjectId);
  const activeTopic = topics.find((t) => t.id === activeTopicId);
  const activeHighlights = highlights.filter((h) => h.topic_id === activeTopicId);

  async function handleAddTopic(e: React.FormEvent) {
    e.preventDefault();
    if (!currentSubjectId || !newTopicTitle.trim()) return;
    await addTopic(currentSubjectId, newTopicTitle);
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

  async function handleBatchAutoVideos() {
    if (!currentSubject) return;
    const missing = currentTopics.filter((t) => !t.video_url);
    if (missing.length === 0) return;
    setBatchLoading(true);
    try {
      for (const t of missing) {
        const res = await fetch('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subjectName: currentSubject.name, topicTitle: t.title }),
        });
        const json = await res.json();
        if (res.ok && json.ok && json.videos?.[0]?.url) {
          await updateTopicVideo(t.id, json.videos[0].url);
        }
      }
    } finally {
      setBatchLoading(false);
    }
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
      page_number: 1,
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
          disabled={batchLoading || currentTopics.every((t) => !!t.video_url)}
          className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 shrink-0"
        >
          {batchLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {batchLoading ? 'Preenchendo vídeos...' : 'Preencher Vídeos da Matéria'}
        </button>
      </div>

      {/* Subject pills */}
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

      {/* Add Topic */}
      <form onSubmit={handleAddTopic} className="flex gap-2">
        <input
          value={newTopicTitle}
          onChange={(e) => setNewTopicTitle(e.target.value)}
          placeholder="Adicionar novo tópico personalizado nesta matéria..."
          className="flex-1 rounded-xl card-surface px-4 py-2.5 text-sm focus:outline-none"
        />
        <button
          type="submit"
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Adicionar
        </button>
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
                  <input
                    value={hlNote}
                    onChange={(e) => setHlNote(e.target.value)}
                    placeholder="Observação rápida (opcional)"
                    className="w-full rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {['#fef08a', '#bbf7d0', '#bae6fd', '#fbcfe8'].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setHlColor(c)}
                          className={`w-6 h-6 rounded-full border-2 ${
                            hlColor === c ? 'border-slate-900 scale-110' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold"
                    >
                      Salvar Grifo
                    </button>
                  </div>
                </form>

                <div className="space-y-2 flex-1">
                  {activeHighlights.map((h) => (
                    <div
                      key={h.id}
                      className="rounded-xl p-3 text-xs text-slate-900 relative group"
                      style={{ backgroundColor: h.color }}
                    >
                      <button
                        onClick={() => deleteHighlight(h.id)}
                        className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 p-1 rounded bg-black/10 hover:bg-red-500 hover:text-white"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <p className="font-medium pr-5">{h.text}</p>
                      {h.note && <p className="mt-1 opacity-80">Obs: {h.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
