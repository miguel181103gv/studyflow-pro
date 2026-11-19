'use client';

import { useState } from 'react';
import { useProfile } from '@/components/ProfileProvider';
import { createClient } from '@/lib/supabase/client';
import {
  Plus,
  Upload,
  FileText,
  Highlighter,
  Trash2,
  Loader2,
  ExternalLink,
  X,
} from 'lucide-react';

export default function MateriasPage() {
  const {
    userId,
    profile,
    subjects,
    topics,
    highlights,
    addTopic,
    updateTopicPdf,
    addHighlight,
    deleteHighlight,
  } = useProfile();

  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || '');
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [uploadingTopicId, setUploadingTopicId] = useState<string | null>(null);

  // Viewer + Grifos
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);
  const [hlText, setHlText] = useState('');
  const [hlNote, setHlNote] = useState('');
  const [hlColor, setHlColor] = useState('#fef08a');

  const currentSubjectId = selectedSubjectId || subjects[0]?.id || '';
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
      await openTopicViewer(topicId, path);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao enviar PDF.');
    } finally {
      setUploadingTopicId(null);
    }
  }

  async function openTopicViewer(topicId: string, pdfPath: string | null) {
    setActiveTopicId(topicId);
    setSignedPdfUrl(null);
    if (pdfPath) {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from('study-assets')
        .createSignedUrl(pdfPath, 3600);
      if (data?.signedUrl) setSignedPdfUrl(data.signedUrl);
    }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Matérias, PDFs e Grifos</h1>
        <p className="text-sm text-muted-theme">
          Anexe seus PDFs na nuvem (acessíveis no PC e no iPhone) e salve seus grifos por tópico.
        </p>
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
                  {t.pdf_name ? `📄 ${t.pdf_name}` : 'Sem PDF anexado'} • {hlCount} grifos
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
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
                  onClick={() => openTopicViewer(t.id, t.pdf_path)}
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

      {/* Built-in PDF Viewer + Grifos Modal */}
      {activeTopic && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-2 sm:p-4">
          <div className="card-surface w-full max-w-6xl h-[90vh] rounded-3xl overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-theme flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-bold text-sm truncate">{activeTopic.title}</h2>
                <p className="text-[11px] text-muted-theme">
                  {activeTopic.pdf_name || 'Modo anotações e grifos'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {signedPdfUrl && (
                  <a
                    href={signedPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-xl subtle-surface text-xs font-medium inline-flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir em nova aba
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
              {/* PDF Preview */}
              <div className="lg:col-span-2 bg-slate-900 flex items-center justify-center overflow-hidden">
                {signedPdfUrl ? (
                  <iframe
                    src={signedPdfUrl}
                    className="w-full h-full border-0"
                    title="Visualizador de PDF"
                  />
                ) : (
                  <div className="text-center text-slate-400 p-8">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhum PDF anexado a este tópico.</p>
                    <p className="text-xs mt-1">
                      Você pode usar o painel ao lado para salvar seus resumos e grifos!
                    </p>
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
