'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAiProviderName } from '@/lib/useAiProvider';
import { useProfile } from '@/components/ProfileProvider';
import { useGlobal } from '@/components/GlobalProvider';
import { dispatchDictionaryUpdated } from '@/components/DictionaryText';
import { syncDictionaryToCloud } from '@/lib/dictSync';
import { DuplicateWarningBanner } from '@/components/DuplicateWarningBanner';
import { compareShortTerms, findSimilarItems } from '@/lib/similarity';
import {
  BookA,
  Plus,
  Search,
  Trash2,
  Pencil,
  RotateCw,
  X,
  Check,
  FileText,
  Zap,
  ArrowLeftRight,
  Sparkles,
  Loader2,
  CheckSquare,
  FolderInput,
} from 'lucide-react';

interface DictEntry {
  id: string;
  word: string;
  aliases?: string[];
  meaning: string;
  example?: string;
  subject_id?: string;
  created_at: string;
}

function parseBulkDictionary(raw: string): { word: string; meaning: string }[] {
  const out: { word: string; meaning: string }[] = [];
  raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((line) => {
      const clean = line.trim().replace(/^[-*•]\s+/, '');
      if (!clean) return;
      const sep = clean.includes(':')
        ? ':'
        : clean.includes('|')
        ? '|'
        : clean.includes(' - ')
        ? ' - '
        : clean.includes(' — ')
        ? ' — '
        : null;
      if (!sep) return;
      const idx = clean.indexOf(sep);
      const w = clean.slice(0, idx).trim();
      const m = clean.slice(idx + sep.length).trim();
      if (w && m) out.push({ word: w, meaning: m });
    });
  return out;
}

function normalizeFirstLetter(word: string): string {
  const first = word
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

export default function DicionarioPage() {
  const { userId, profile, subjects } = useProfile();
  const aiName = useAiProviderName();
  const { notify } = useGlobal();

  const storageKey = `sf_dictionary_${profile?.id || 'default'}`;
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [search, setSearch] = useState('');
  const [letterFilter, setLetterFilter] = useState<string>('');
  const [subjectFilter, setSubjectFilter] = useState<string>('');

  // Adicionar (Manual ou Lista em Lote)
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<'manual' | 'bulk'>('manual');
  const [word, setWord] = useState('');
  const [meaning, setMeaning] = useState('');
  const [example, setExample] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [definingAi, setDefiningAi] = useState(false);
  const [confirmDupManual, setConfirmDupManual] = useState(false);

  // Editar inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWord, setEditWord] = useState('');
  const [editMeaning, setEditMeaning] = useState('');
  const [editExample, setEditExample] = useState('');
  const [editSubjectId, setEditSubjectId] = useState('');

  // Seleção múltipla (excluir ou mover para outra matéria)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMoveSubjectId, setBulkMoveSubjectId] = useState('');

  // Modo Praticar Flashcard
  const [practicing, setPracticing] = useState(false);
  const [reverseMode, setReverseMode] = useState(false); // false = Palavra -> Significado | true = Significado -> Palavra
  const [queue, setQueue] = useState<DictEntry[]>([]);
  const [totalInSession, setTotalInSession] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [hits, setHits] = useState(0);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const qParam = params.get('q');
      if (qParam) setSearch(qParam);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setEntries(parsed);
        }
      } catch {
        // ignore
      }
    };
    load();
    window.addEventListener('sf-dictionary-updated', load);
    return () => window.removeEventListener('sf-dictionary-updated', load);
  }, [storageKey]);

  function saveEntries(next: DictEntry[]) {
    const sorted = [...next].sort((a, b) =>
      a.word.localeCompare(b.word, 'pt-BR', { sensitivity: 'base' })
    );
    setEntries(sorted);
    try {
      localStorage.setItem(storageKey, JSON.stringify(sorted));
      dispatchDictionaryUpdated();
      if (userId && profile?.id) {
        void syncDictionaryToCloud(userId, profile.id, sorted);
      }
    } catch {
      // ignore
    }
  }

  const parsedBulk = useMemo(() => parseBulkDictionary(bulkText), [bulkText]);

  const manualWordMatches = useMemo(
    () => (word.trim() ? findSimilarItems(word, entries, (e) => e.word, 'short', 3) : []),
    [word, entries]
  );

  const bulkDuplicates = useMemo(() => {
    const dupIdx = new Set<number>();
    const matches: { word: string; existing: string; kind: 'exact' | 'similar' }[] = [];
    parsedBulk.forEach((item, idx) => {
      const m = findSimilarItems(item.word, entries, (e) => e.word, 'short', 1);
      if (m.length > 0) {
        dupIdx.add(idx);
        matches.push({ word: item.word, existing: m[0].item.word, kind: m[0].kind });
      } else {
        // Também checa duplicidade dentro do próprio lote
        for (let j = 0; j < idx; j++) {
          const selfM = compareShortTerms(item.word, parsedBulk[j].word);
          if (selfM) {
            dupIdx.add(idx);
            matches.push({ word: item.word, existing: parsedBulk[j].word, kind: selfM.kind });
            break;
          }
        }
      }
    });
    return { dupIdx, matches };
  }, [parsedBulk, entries]);

  async function fetchGeminiMeaning(
    targetWord: string
  ): Promise<{ corrected_word?: string; meaning: string; example?: string } | null> {
    if (!targetWord.trim()) return null;
    setDefiningAi(true);
    try {
      const sub = subjects.find((s) => s.id === subjectId);
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'define_word',
          word: targetWord.trim(),
          subjectName: sub?.name || '',
          profileName: profile?.name || '',
          roleTitle: profile?.role_title || '',
          subjectsContext: subjects.map((s) => s.name).slice(0, 12).join(', '),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data?.meaning) {
        throw new Error(json.error || 'Não foi possível definir com a IA.');
      }
      return {
        corrected_word: json.data.corrected_word ? String(json.data.corrected_word).trim() : undefined,
        meaning: String(json.data.meaning).trim(),
        example: json.data.example ? String(json.data.example).trim() : undefined,
      };
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao consultar a IA.', 'error');
      return null;
    } finally {
      setDefiningAi(false);
    }
  }

  async function spellCheckWordSilent(targetWord: string): Promise<string> {
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'define_word',
          word: targetWord.trim(),
          onlySpellCheck: true,
        }),
      });
      const json = await res.json();
      if (res.ok && json.ok && json.data?.corrected_word) {
        return String(json.data.corrected_word).trim();
      }
    } catch {
      // ignore
    }
    return targetWord.trim();
  }

  async function handleFillWithGemini() {
    if (!word.trim()) return;
    const data = await fetchGeminiMeaning(word);
    if (data) {
      if (data.corrected_word) setWord(data.corrected_word);
      setMeaning(data.meaning);
      if (data.example && !example.trim()) setExample(data.example);
    }
  }

  async function saveManualConfirmed() {
    if (!word.trim()) return;

    const typedWord = word.trim();
    let finalWord = typedWord;
    let finalMeaning = meaning.trim();
    let finalExample = example.trim();

    if (!finalMeaning) {
      const data = await fetchGeminiMeaning(typedWord);
      if (!data) return;
      if (data.corrected_word) finalWord = data.corrected_word;
      finalMeaning = data.meaning;
      if (!finalExample && data.example) finalExample = data.example;
    } else {
      setDefiningAi(true);
      finalWord = await spellCheckWordSilent(typedWord);
      setDefiningAi(false);
    }

    const item: DictEntry = {
      id: `dict-${Date.now()}`,
      word: finalWord,
      meaning: finalMeaning,
      example: finalExample || undefined,
      subject_id: subjectId || undefined,
      created_at: new Date().toISOString(),
    };
    saveEntries([...entries, item]);
    setWord('');
    setMeaning('');
    setExample('');
    setConfirmDupManual(false);
    notify(
      finalWord.toLowerCase() !== typedWord.toLowerCase()
        ? `"${typedWord}" corrigida para "${finalWord}" e salva no Dicionário!`
        : `"${item.word}" adicionado ao Dicionário!`,
      'success'
    );
  }

  function handleMergeManualDict(targetId: string) {
    const newTerm = word.trim();
    if (!newTerm) return;
    let mergedTargetWord = '';
    const next = entries.map((entry) => {
      if (entry.id !== targetId) return entry;
      mergedTargetWord = entry.word;
      const existingAliases = Array.isArray(entry.aliases) ? entry.aliases : [];
      const allLower = new Set(
        [entry.word, ...existingAliases].map((x) => (x || '').trim().toLowerCase())
      );
      const nextAliases = allLower.has(newTerm.toLowerCase())
        ? existingAliases
        : [...existingAliases, newTerm];
      const extraMeaning = meaning.trim();
      const updatedMeaning =
        extraMeaning && !entry.meaning.toLowerCase().includes(extraMeaning.toLowerCase())
          ? `${entry.meaning}

• ${newTerm}: ${extraMeaning}`
          : entry.meaning;
      return { ...entry, aliases: nextAliases, meaning: updatedMeaning };
    });
    saveEntries(next);
    setWord('');
    setMeaning('');
    setExample('');
    setConfirmDupManual(false);
    setShowAdd(false);
    notify(
      `"${newTerm}" mesclado com "${mergedTargetWord}"! Ambas as formas serão destacadas.`,
      'success'
    );
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    if (!word.trim()) return;
    if (manualWordMatches.length > 0 && !confirmDupManual) {
      setConfirmDupManual(true);
      return;
    }
    await saveManualConfirmed();
  }

  function handleBulkImport(skipDuplicates = false) {
    const list = skipDuplicates
      ? parsedBulk.filter((_, idx) => !bulkDuplicates.dupIdx.has(idx))
      : parsedBulk;
    if (list.length === 0) {
      notify('Todos os termos da lista já existem ou são parecidos.', 'info');
      return;
    }
    const now = Date.now();
    const created: DictEntry[] = list.map((item, idx) => ({
      id: `dict-${now}-${idx}`,
      word: item.word,
      meaning: item.meaning,
      subject_id: subjectId || undefined,
      created_at: new Date().toISOString(),
    }));
    saveEntries([...entries, ...created]);
    setBulkText('');
    setShowAdd(false);
    notify(`${created.length} termo(s) importado(s) em ordem alfabética!`, 'success');
  }

  function handleSaveEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    if (!editWord.trim() || !editMeaning.trim()) return;
    saveEntries(
      entries.map((it) =>
        it.id === id
          ? {
              ...it,
              word: editWord.trim(),
              meaning: editMeaning.trim(),
              example: editExample.trim() || undefined,
              subject_id: editSubjectId || undefined,
            }
          : it
      )
    );
    setEditingId(null);
    notify('Termo atualizado!', 'success');
  }

  function handleBulkDelete() {
    if (selectedIds.length === 0) return;
    if (
      !window.confirm(
        `Excluir ${selectedIds.length} ${
          selectedIds.length === 1 ? 'termo selecionado' : 'termos selecionados'
        } do Dicionário?`
      )
    ) {
      return;
    }
    const idSet = new Set(selectedIds);
    saveEntries(entries.filter((it) => !idSet.has(it.id)));
    const count = selectedIds.length;
    setSelectedIds([]);
    setSelectMode(false);
    notify(`${count} ${count === 1 ? 'termo excluído' : 'termos excluídos'}!`, 'info');
  }

  function handleBulkMoveSubject() {
    if (selectedIds.length === 0) return;
    const idSet = new Set(selectedIds);
    const targetSub = subjects.find((s) => s.id === bulkMoveSubjectId);
    saveEntries(
      entries.map((it) =>
        idSet.has(it.id)
          ? { ...it, subject_id: bulkMoveSubjectId || undefined }
          : it
      )
    );
    const count = selectedIds.length;
    setSelectedIds([]);
    setSelectMode(false);
    notify(
      `${count} ${count === 1 ? 'termo movido' : 'termos movidos'} para ${
        targetSub ? targetSub.name : 'Geral'
      }!`,
      'success'
    );
  }

  function handleDelete(id: string) {
    saveEntries(entries.filter((it) => it.id !== id));
    notify('Termo removido do Dicionário.', 'info');
  }

  // Filtragem e agrupamento alfabético A-Z
  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((it) => {
      if (subjectFilter && it.subject_id !== subjectFilter) return false;
      if (letterFilter && normalizeFirstLetter(it.word) !== letterFilter) return false;
      if (
        q &&
        !it.word.toLowerCase().includes(q) &&
        !it.meaning.toLowerCase().includes(q) &&
        !(it.example || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [entries, search, letterFilter, subjectFilter]);

  const availableLetters = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((it) => {
      if (!subjectFilter || it.subject_id === subjectFilter) {
        set.add(normalizeFirstLetter(it.word));
      }
    });
    return Array.from(set).sort();
  }, [entries, subjectFilter]);

  const groupedByLetter = useMemo(() => {
    const map = new Map<string, DictEntry[]>();
    filteredEntries.forEach((it) => {
      const l = normalizeFirstLetter(it.word);
      if (!map.has(l)) map.set(l, []);
      map.get(l)!.push(it);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEntries]);

  function startFlashcardPractice(pool: DictEntry[], reversed = false) {
    if (pool.length === 0) return;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    setReverseMode(reversed);
    setQueue(shuffled);
    setTotalInSession(shuffled.length);
    setRevealed(false);
    setHits(0);
    setPracticing(true);
  }

  const activeCard = queue[0];

  useEffect(() => {
    if (!practicing || !activeCard) return;
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault();
        setRevealed((v) => !v);
      } else if (revealed && e.key === '1') {
        e.preventDefault();
        setQueue((prev) => [...prev.slice(1), prev[0]]);
        setRevealed(false);
      } else if (revealed && e.key === '2') {
        e.preventDefault();
        setHits((h) => h + 1);
        setQueue((prev) => prev.slice(1));
        setRevealed(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [practicing, activeCard, revealed]);

  const inputClass =
    'w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3.5 py-2.5 text-sm';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Cabeçalho + Botões de Praticar e Adicionar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookA className="w-6 h-6 text-teal-600" />
            Dicionário & Glossário
          </h1>
          <p className="text-sm text-muted-theme mt-0.5">
            Leia em ordem alfabética (A–Z) para revisar conceitos ou pratique como flashcards.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectMode((v) => !v);
                setSelectedIds([]);
                setBulkMoveSubjectId(subjects[0]?.id || '');
              }}
              className={`px-3.5 py-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border transition ${
                selectMode
                  ? 'bg-rose-600 border-rose-600 text-white shadow-sm'
                  : 'subtle-surface border-theme hover:border-teal-500/50'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              {selectMode ? 'Cancelar seleção' : 'Selecionar'}
            </button>
          )}
          {filteredEntries.length > 0 && (
            <button
              type="button"
              onClick={() => startFlashcardPractice(filteredEntries, false)}
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Zap className="w-4 h-4" />
              Praticar Flashcards ({filteredEntries.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
          >
            {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showAdd ? 'Fechar' : 'Nova Palavra'}
          </button>
        </div>
      </div>

      {/* Formulário recolhível: Adicionar Palavra Manual ou Colar Lista */}
      {showAdd && (
        <div className="card-surface rounded-2xl p-5 space-y-4 animate-fade-in-up">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-bold text-sm">Adicionar ao Dicionário</h2>
            <div className="inline-flex p-1 rounded-xl subtle-surface gap-1 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setAddMode('manual')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  addMode === 'manual' ? 'bg-teal-600 text-white' : 'text-muted-theme'
                }`}
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => setAddMode('bulk')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 ${
                  addMode === 'bulk' ? 'bg-teal-600 text-white' : 'text-muted-theme'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Colar Lista
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-theme mb-1">
              Matéria (opcional)
            </label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full sm:w-72 rounded-xl subtle-surface border border-theme px-3 py-2 text-xs"
            >
              <option value="">Geral (todas as matérias)</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {addMode === 'manual' ? (
            <form onSubmit={handleAddManual} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Palavra / Termo *</label>
                <input
                  required
                  value={word}
                  onChange={(e) => {
                    setWord(e.target.value);
                    setConfirmDupManual(false);
                  }}
                  placeholder="Ex: Erga omnes, Prescrição, Hedge, Metonímia..."
                  className={inputClass}
                />
              </div>
              {manualWordMatches.length > 0 && (
                <DuplicateWarningBanner
                  title="Atenção: já existe palavra igual ou parecida no Dicionário"
                  items={manualWordMatches.map((m) => ({
                    id: m.item.id,
                    label: m.item.word,
                    detail: m.item.meaning?.slice(0, 70),
                    kind: m.kind,
                  }))}
                  pendingConfirm={confirmDupManual}
                  onConfirmAnyway={() => void saveManualConfirmed()}
                  onCancelConfirm={() => setConfirmDupManual(false)}
                  onMergeItem={(targetId) => handleMergeManualDict(targetId)}
                />
              )}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-semibold">
                    Significado{' '}
                    <span className="font-normal text-muted-theme">
                      (opcional — deixe vazio para o Gemini preencher de forma simples)
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={definingAi || !word.trim()}
                    onClick={handleFillWithGemini}
                    className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-45 shrink-0"
                  >
                    {definingAi ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {definingAi ? 'Definindo...' : `Definir com ${aiName}`}
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={meaning}
                  onChange={(e) => setMeaning(e.target.value)}
                  placeholder="Digite o significado ou deixe em branco para o Gemini gerar curto e direto..."
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  Exemplo ou observação (opcional)
                </label>
                <input
                  value={example}
                  onChange={(e) => setExample(e.target.value)}
                  placeholder="Ex: A decisão em ADI tem efeito erga omnes."
                  className={inputClass}
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={definingAi}
                  className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  {definingAi ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  {definingAi
                    ? 'Gerando significado...'
                    : !meaning.trim() && word.trim()
                    ? `Definir com ${aiName} e Salvar`
                    : 'Salvar Palavra'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <textarea
                rows={5}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={
                  'Cole uma lista (uma por linha) usando ":" ou "-" entre palavra e significado:\nErga omnes: Vale contra todos.\nEx tunc: Efeito retroativo (bate na testa e vai para trás).'
                }
                className={`${inputClass} font-mono text-xs`}
              />
              {bulkDuplicates.matches.length > 0 && (
                <DuplicateWarningBanner
                  title={`${bulkDuplicates.matches.length} termo(s) da lista já existem ou são parecidos`}
                  items={bulkDuplicates.matches.slice(0, 4).map((m, i) => ({
                    id: `b-${i}`,
                    label: m.word,
                    detail: `já existe como "${m.existing}"`,
                    kind: m.kind,
                  }))}
                />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-theme">
                  {parsedBulk.length > 0
                    ? `${parsedBulk.length} termo(s) identificado(s)`
                    : 'Separe palavra e significado com ":" ou " - "'}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {bulkDuplicates.matches.length > 0 && parsedBulk.length > bulkDuplicates.dupIdx.size && (
                    <button
                      type="button"
                      onClick={() => handleBulkImport(true)}
                      className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold"
                    >
                      Ignorar parecidos ({parsedBulk.length - bulkDuplicates.dupIdx.size} novos)
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={parsedBulk.length === 0}
                    onClick={() => handleBulkImport(false)}
                    className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold disabled:opacity-50"
                  >
                    Importar {parsedBulk.length} termo(s)
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Barra de Busca + Filtro por Matéria + Índice Alfabético A–Z */}
      <div className="card-surface rounded-2xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="flex-1 subtle-surface rounded-xl px-3.5 py-2 flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-theme shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar palavra ou significado no dicionário..."
              className="flex-1 bg-transparent text-xs focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-[11px] font-bold text-muted-theme hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
          <select
            value={subjectFilter}
            onChange={(e) => {
              setSubjectFilter(e.target.value);
              setLetterFilter('');
            }}
            className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold"
          >
            <option value="">Todas as matérias ({entries.length})</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Índice A–Z */}
        {availableLetters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <button
              type="button"
              onClick={() => setLetterFilter('')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                !letterFilter ? 'bg-teal-600 text-white' : 'subtle-surface text-muted-theme'
              }`}
            >
              A–Z
            </button>
            {availableLetters.map((letter) => (
              <button
                key={letter}
                type="button"
                onClick={() => setLetterFilter(letterFilter === letter ? '' : letter)}
                className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center ${
                  letterFilter === letter
                    ? 'bg-teal-600 text-white'
                    : 'subtle-surface text-muted-theme hover:text-[var(--text-main)]'
                }`}
              >
                {letter}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Barra de Seleção Múltipla (Mover para matéria ou Excluir) */}
      {selectMode && (
        <div className="sticky top-3 z-20 card-surface rounded-2xl p-4 border-2 border-teal-500/40 bg-[var(--bg-card)]/95 backdrop-blur-md shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-extrabold text-teal-700 dark:text-teal-300">
              {selectedIds.length} selecionado{selectedIds.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => {
                const visibleIds = filteredEntries.map((e) => e.id);
                const allSelected =
                  visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
                setSelectedIds(allSelected ? [] : visibleIds);
              }}
              className="px-3 py-1.5 rounded-xl subtle-surface border border-theme text-xs font-bold hover:opacity-85"
            >
              {filteredEntries.length > 0 &&
              filteredEntries.every((e) => selectedIds.includes(e.id))
                ? 'Desmarcar todos'
                : `Selecionar todos (${filteredEntries.length})`}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <select
                value={bulkMoveSubjectId}
                onChange={(e) => setBulkMoveSubjectId(e.target.value)}
                className="rounded-xl subtle-surface border border-theme px-3 py-2 text-xs font-semibold"
              >
                <option value="">Geral (sem matéria)</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={handleBulkMoveSubject}
                className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <FolderInput className="w-3.5 h-3.5" />
                Mover p/ matéria
              </button>
            </div>

            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={handleBulkDelete}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir ({selectedIds.length})
            </button>
          </div>
        </div>
      )}

      {/* Lista em Ordem Alfabética estilo Dicionário */}
      {groupedByLetter.length === 0 ? (
        <div className="card-surface rounded-2xl p-10 text-center space-y-3">
          <BookA className="w-9 h-9 mx-auto text-teal-600 opacity-70" />
          <p className="text-sm font-bold">Seu dicionário está vazio</p>
          <p className="text-xs text-muted-theme max-w-md mx-auto">
            Adicione palavras, termos jurídicos, vocabulário de inglês ou conceitos importantes para estudar lendo em ordem alfabética ou praticar em modo flashcard.
          </p>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Adicionar primeira palavra
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {groupedByLetter.map(([letter, list]) => (
            <div key={letter} className="space-y-2">
              <div className="flex items-center gap-2.5 px-1">
                <span className="w-8 h-8 rounded-xl bg-teal-600 text-white font-extrabold text-sm flex items-center justify-center shadow-xs">
                  {letter}
                </span>
                <span className="text-xs font-semibold text-muted-theme">
                  {list.length} {list.length === 1 ? 'termo' : 'termos'}
                </span>
              </div>

              <div className="card-surface rounded-2xl divide-y divide-[var(--border-main)] overflow-hidden">
                {list.map((it) => {
                  const sub = subjects.find((s) => s.id === it.subject_id);
                  const isEditing = editingId === it.id;

                  return (
                    <div
                      key={it.id}
                      className="p-4 hover:bg-[var(--bg-subtle)]/40 transition border-l-4"
                      style={{ borderLeftColor: sub?.color || 'transparent' }}
                    >
                      {isEditing ? (
                        <form
                          onSubmit={(e) => handleSaveEdit(e, it.id)}
                          className="space-y-2.5"
                        >
                          <input
                            autoFocus
                            required
                            value={editWord}
                            onChange={(e) => setEditWord(e.target.value)}
                            className={inputClass}
                          />
                          <textarea
                            required
                            rows={2}
                            value={editMeaning}
                            onChange={(e) => setEditMeaning(e.target.value)}
                            className={inputClass}
                          />
                          <input
                            value={editExample}
                            onChange={(e) => setEditExample(e.target.value)}
                            placeholder="Exemplo (opcional)"
                            className={inputClass}
                          />
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-theme mb-1">
                              Matéria
                            </label>
                            <select
                              value={editSubjectId}
                              onChange={(e) => setEditSubjectId(e.target.value)}
                              className={inputClass}
                            >
                              <option value="">Geral (sem matéria)</option>
                              {subjects.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 rounded-xl subtle-surface text-xs font-semibold"
                            >
                              Cancelar
                            </button>
                            <button
                              type="submit"
                              className="px-3.5 py-1.5 rounded-xl bg-teal-600 text-white text-xs font-bold inline-flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Salvar
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div
                          className={`flex items-start justify-between gap-3 ${
                            selectMode && selectedIds.includes(it.id)
                              ? 'bg-teal-500/10 -m-4 p-4'
                              : ''
                          }`}
                        >
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            {selectMode && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedIds((prev) =>
                                    prev.includes(it.id)
                                      ? prev.filter((id) => id !== it.id)
                                      : [...prev, it.id]
                                  )
                                }
                                className={`mt-1 w-5 h-5 rounded-md flex items-center justify-center border-2 shrink-0 transition ${
                                  selectedIds.includes(it.id)
                                    ? 'bg-teal-600 border-teal-600 text-white'
                                    : 'bg-white dark:bg-slate-800 border-slate-400'
                                }`}
                              >
                                {selectedIds.includes(it.id) && (
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                )}
                              </button>
                            )}
                            <div className="min-w-0 space-y-1 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3
                                className={`font-extrabold text-base ${
                                  sub?.color ? '' : 'text-teal-700 dark:text-teal-300'
                                }`}
                                style={sub?.color ? { color: sub.color } : undefined}
                              >
                                {it.word}
                              </h3>
                              {sub && (
                                <span
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                                  style={{ backgroundColor: sub.color }}
                                >
                                  {sub.name}
                                </span>
                              )}
                            </div>
                            <p className="text-sm leading-relaxed">{it.meaning}</p>
                            {it.example && (
                              <p className="text-xs italic text-muted-theme pt-0.5">
                                Ex: &ldquo;{it.example}&rdquo;
                              </p>
                            )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(it.id);
                                setEditWord(it.word);
                                setEditMeaning(it.meaning);
                                setEditExample(it.example || '');
                                setEditSubjectId(it.subject_id || '');
                              }}
                              title="Editar"
                              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-theme hover:text-[var(--text-main)]"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(it.id)}
                              title="Excluir"
                              className="p-1.5 rounded-lg hover:bg-rose-500/15 text-muted-theme hover:text-rose-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Praticar Dicionário como Flashcard */}
      {practicing && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-xl rounded-3xl p-6 space-y-5 shadow-2xl animate-pop-in">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-teal-600">
                  {activeCard
                    ? `Restam ${queue.length} de ${totalInSession} · ${hits} acerto(s)`
                    : 'Sessão Concluída!'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setReverseMode((v) => !v);
                    setRevealed(false);
                  }}
                  className="px-2.5 py-1 rounded-xl subtle-surface text-[11px] font-semibold inline-flex items-center gap-1"
                  title="Inverter frente e verso"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  {reverseMode ? 'Significado → Palavra' : 'Palavra → Significado'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPracticing(false)}
                className="p-2 rounded-xl subtle-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeCard ? (
              <>
                <div
                  onClick={() => setRevealed((v) => !v)}
                  className="cursor-pointer subtle-surface rounded-2xl p-7 min-h-[150px] flex flex-col justify-center text-center space-y-2.5"
                >
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-theme">
                    {reverseMode ? 'Qual é a palavra?' : 'Qual é o significado?'} (toque ou Espaço)
                  </p>
                  <p className="text-xl font-extrabold">
                    {reverseMode ? activeCard.meaning : activeCard.word}
                  </p>
                </div>

                {revealed ? (
                  <>
                    <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-5 text-center space-y-2 animate-fade-in-up">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        {reverseMode ? 'Palavra' : 'Significado'}
                      </p>
                      <p className="text-base font-bold leading-relaxed">
                        {reverseMode ? activeCard.word : activeCard.meaning}
                      </p>
                      {activeCard.example && (
                        <p className="text-xs italic text-muted-theme">
                          Ex: &ldquo;{activeCard.example}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setQueue((prev) => [...prev.slice(1), prev[0]]);
                          setRevealed(false);
                        }}
                        className="py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                      >
                        1 · Repetir depois
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setHits((h) => h + 1);
                          setQueue((prev) => prev.slice(1));
                          setRevealed(false);
                        }}
                        className="py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                      >
                        2 · Lembrei!
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
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
                <p className="text-xl font-extrabold">Dicionário revisado!</p>
                <p className="text-xs text-muted-theme">
                  Você revisou todos os {totalInSession} termos desta sessão.
                </p>
                <button
                  type="button"
                  onClick={() => setPracticing(false)}
                  className="px-5 py-2.5 rounded-xl bg-teal-600 text-white text-xs font-bold"
                >
                  Voltar ao Dicionário
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
