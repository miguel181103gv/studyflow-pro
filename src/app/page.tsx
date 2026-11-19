'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ensureUserSeeded } from '@/lib/seed';
import type { Profile } from '@/lib/types';
import { SUBJECT_COLORS } from '@/lib/utils';
import {
  Plus,
  LogOut,
  Sparkles,
  Upload,
  X,
  ArrowRight,
  Loader2,
  Trash2,
  Check,
  Globe,
  Search,
  ExternalLink,
  Layers,
  ArrowLeft,
} from 'lucide-react';

interface ParsedSubject {
  name: string;
  category: string;
  topics: string[];
}

interface EditalDraft {
  organName: string;
  roleTitle: string;
  salaryBase: string;
  vale: string;
  examDate: string;
  subjects: ParsedSubject[];
}

interface PciConcurso {
  id?: string | number;
  titulo?: string;
  orgao?: string;
  uf?: string;
  vagas?: string | number;
  salario?: string;
  vagas_salario?: string;
  cargos?: string[];
  datas?: {
    aberto?: boolean;
    em_breve?: boolean;
    inicio?: string;
    fim?: string;
  };
  noticia?: {
    link?: string;
  };
}

type ModalStep = 'start' | 'pci' | 'pick_role' | 'review';

export default function ProfileSelectorPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [userId, setUserId] = useState('');

  // Modal Criar Novo Perfil
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState<ModalStep>('start');

  const [pdfBase64Cache, setPdfBase64Cache] = useState<string | null>(null);
  const [pdfMimeCache, setPdfMimeCache] = useState<string>('application/pdf');
  const [parsingPdf, setParsingPdf] = useState(false);
  const [extractingRole, setExtractingRole] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [enrichingWeb, setEnrichingWeb] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // PCI Concursos Search
  const [pciQuery, setPciQuery] = useState('');
  const [pciUf, setPciUf] = useState('');
  const [pciLoading, setPciLoading] = useState(false);
  const [pciResults, setPciResults] = useState<PciConcurso[]>([]);
  const [pciMessage, setPciMessage] = useState<string | null>(null);

  // Etapa de escolha de cargo
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
  const [chosenRole, setChosenRole] = useState<string>('');

  // Lista de editais adicionados para conciliação
  const [addedEditais, setAddedEditais] = useState<EditalDraft[]>([]);
  const [pendingOrgan, setPendingOrgan] = useState('');

  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [icon, setIcon] = useState('🏛️');
  const [salaryBase, setSalaryBase] = useState('');
  const [vale, setVale] = useState('');
  const [workload, setWorkload] = useState('40h/sem');
  const [extras, setExtras] = useState('');
  const [statusText, setStatusText] = useState('');
  const [examDate, setExamDate] = useState('');
  const [parsedSubjects, setParsedSubjects] = useState<ParsedSubject[]>([]);

  async function loadProfiles() {
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/login');
        return;
      }

      setUserId(user.id);
      setUserEmail(user.email || '');

      await ensureUserSeeded(supabase, user.id);

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order', { ascending: true });

      setProfiles((data as Profile[]) || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetModal() {
    setStep('start');
    setPdfBase64Cache(null);
    setRoleOptions([]);
    setChosenRole('');
    setAddedEditais([]);
    setPendingOrgan('');
    setName('');
    setRoleTitle('');
    setIcon('🏛️');
    setSalaryBase('');
    setVale('');
    setWorkload('40h/sem');
    setExtras('');
    setStatusText('');
    setExamDate('');
    setParsedSubjects([]);
    setParseError(null);
    setPciResults([]);
    setPciMessage(null);
  }

  async function handlePciSearch(listAll = false) {
    if (!listAll && !pciQuery.trim()) {
      listAll = true;
    }
    setPciLoading(true);
    setPciMessage(null);
    setPciResults([]);
    try {
      const res = await fetch('/api/pci', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          listAll
            ? { action: 'listar' }
            : { action: 'pesquisar', termo: pciQuery, uf: pciUf }
        ),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao buscar no PCI.');
      const list: PciConcurso[] =
        json.data?.data || json.data?.concursos || json.data?.resultados || [];
      setPciResults(list);
      if (list.length === 0) {
        setPciMessage(
          json.data?.message || 'Nenhum concurso aberto encontrado com esse termo no momento.'
        );
      }
    } catch (err) {
      setPciMessage(err instanceof Error ? err.message : 'Erro ao consultar PCI.');
    } finally {
      setPciLoading(false);
    }
  }

  async function applyPciConcurso(c: PciConcurso) {
    const organ = c.titulo || c.orgao || '';
    setPendingOrgan(organ);
    setName(organ);
    setSalaryBase(c.salario || c.vagas_salario || '');
    setStatusText(
      c.datas?.aberto
        ? `Inscrições abertas até ${c.datas.fim || 'breve'}`
        : c.datas?.em_breve
        ? `Inscrições abrem em ${c.datas.inicio || 'breve'}`
        : 'Encontrado via PCI Concursos'
    );
    setPciResults([]);

    if (c.cargos && c.cargos.length > 1) {
      setRoleOptions(c.cargos);
      setChosenRole('');
      setStep('pick_role');
    } else if (c.cargos && c.cargos.length === 1) {
      setRoleOptions([]);
      setChosenRole(c.cargos[0]);
      setRoleTitle(c.cargos[0]);
      setStep('review');
      await enrichMissingInfo(organ, c.cargos[0]);
    } else {
      setStep('review');
      await enrichMissingInfo(organ, '');
    }
  }

  async function enrichMissingInfo(organName: string, targetRole: string) {
    if (!organName.trim()) return;
    setEnrichingWeb(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'enrich_edital',
          organName,
          roleTitle: targetRole,
        }),
      });
      const json = await res.json();
      if (res.ok && json.ok && json.data) {
        const w = json.data;
        if (w.salary_base) setSalaryBase((prev) => prev || w.salary_base);
        if (w.vale_alimentacao) setVale((prev) => prev || w.vale_alimentacao);
        if (w.workload) setWorkload((prev) => (prev && prev !== '40h/sem' ? prev : w.workload));
        if (w.extras) setExtras((prev) => prev || w.extras);
        if (w.status_text) setStatusText((prev) => prev || w.status_text);
        if (w.exam_date) setExamDate((prev) => prev || w.exam_date);
      }
    } catch {
      // Silencioso
    } finally {
      setEnrichingWeb(false);
    }
  }

  async function reconcileEditaisList(list: EditalDraft[]) {
    if (list.length < 2) return;
    setReconciling(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconcile_editais', editais: list }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao conciliar editais.');
      const d = json.data;
      if (d.combined_name) setName(d.combined_name);
      if (d.combined_role) setRoleTitle(d.combined_role);
      if (Array.isArray(d.subjects)) setParsedSubjects(d.subjects);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Erro ao conciliar editais.');
    } finally {
      setReconciling(false);
    }
  }

  async function handleSelectRole(selectedRole: string, organOverride?: string, b64Override?: string) {
    const organ = organOverride ?? (pendingOrgan || name);
    const b64 = b64Override ?? pdfBase64Cache;
    setChosenRole(selectedRole);
    setParseError(null);
    setStep('review');

    if (!b64) {
      setRoleTitle(selectedRole);
      await enrichMissingInfo(organ, selectedRole);
      return;
    }

    setExtractingRole(true);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extract_role_details',
          pdfBase64: b64,
          mimeType: pdfMimeCache,
          organName: organ,
          roleTitle: selectedRole,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao extrair dados do cargo.');

      const d = json.data;
      const newDraft: EditalDraft = {
        organName: organ,
        roleTitle: selectedRole,
        salaryBase: d.salary_base || '',
        vale: d.vale_alimentacao || '',
        examDate: d.exam_date || examDate || '',
        subjects: Array.isArray(d.subjects) ? d.subjects : [],
      };

      const nextList = [...addedEditais, newDraft];
      setAddedEditais(nextList);
      setRoleOptions([]);
      setPdfBase64Cache(null);

      if (nextList.length === 1) {
        setName(organ);
        setRoleTitle(selectedRole);
        setSalaryBase(d.salary_base || '');
        setVale(d.vale_alimentacao || '');
        if (d.workload) setWorkload(d.workload);
        if (d.extras) setExtras(d.extras);
        if (d.exam_date) setExamDate(d.exam_date);
        if (d.status_text) setStatusText((prev) => d.status_text || prev);
        setParsedSubjects(newDraft.subjects);

        if (!d.salary_base || !d.vale_alimentacao || !d.exam_date) {
          await enrichMissingInfo(organ, selectedRole);
        }
      } else {
        await reconcileEditaisList(nextList);
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Erro ao extrair cargo.');
    } finally {
      setExtractingRole(false);
    }
  }

  async function handlePdfUpload(file: File) {
    try {
      setParsingPdf(true);
      setParseError(null);
      setRoleOptions([]);
      setChosenRole('');

      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const mime = file.type || 'application/pdf';
      setPdfBase64Cache(base64);
      setPdfMimeCache(mime);

      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list_edital_roles',
          pdfBase64: base64,
          mimeType: mime,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Não foi possível ler o PDF.');
      }

      const d = json.data;
      const organName = d.name || '';
      setPendingOrgan(organName);
      if (addedEditais.length === 0) {
        setName(organName);
        setIcon(d.icon || '🏛️');
        setStatusText(d.status_text || '');
        if (d.exam_date) setExamDate(d.exam_date);
      }

      const roles: string[] = Array.isArray(d.roles) ? d.roles.filter(Boolean) : [];
      setRoleOptions(roles);

      if (roles.length === 1) {
        await handleSelectRole(roles[0], organName, base64);
      } else if (roles.length > 1) {
        setStep('pick_role');
      } else {
        setStep('review');
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Erro ao analisar PDF.');
    } finally {
      setParsingPdf(false);
    }
  }

  async function handleCreateProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !userId) return;

    setSaving(true);
    try {
      const supabase = createClient();
      const { data: created, error } = await supabase
        .from('profiles')
        .insert({
          user_id: userId,
          name: name.trim(),
          role_title: roleTitle.trim(),
          icon: icon || '🏛️',
          color: SUBJECT_COLORS[profiles.length % SUBJECT_COLORS.length],
          salary_base: salaryBase,
          vale_alimentacao: vale,
          workload,
          extras,
          status_text: statusText,
          exam_date: examDate || null,
          daily_hours_goal: 4,
          target_accuracy: 80,
          sort_order: profiles.length,
        })
        .select('*')
        .single();

      if (error || !created) throw error || new Error('Erro ao criar perfil');

      const subjectsToInsert =
        parsedSubjects.length > 0
          ? parsedSubjects
          : [
              {
                name: 'Língua Portuguesa',
                category: 'Conhecimentos Gerais',
                topics: ['Interpretação de Texto', 'Gramática e Sintaxe'],
              },
            ];

      for (let i = 0; i < subjectsToInsert.length; i++) {
        const s = subjectsToInsert[i];
        const { data: sub } = await supabase
          .from('subjects')
          .insert({
            user_id: userId,
            profile_id: created.id,
            name: s.name,
            category: s.category || 'Geral',
            color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
            cycle_hours: 1,
            cycle_minutes: 30,
            cycle_order: i,
          })
          .select('id')
          .single();

        if (sub && s.topics?.length) {
          await supabase.from('topics').insert(
            s.topics.map((t, tIdx) => ({
              user_id: userId,
              profile_id: created.id,
              subject_id: sub.id,
              title: t,
              studied: false,
              is_priority: false,
              sort_order: tIdx,
            }))
          );
        }
      }

      setShowModal(false);
      router.push(`/p/${created.id}`);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Erro ao salvar perfil.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProfile(id: string, profileName: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Excluir o perfil "${profileName}" e todos os seus dados?`)) return;
    const supabase = createClient();
    await supabase.from('profiles').delete().eq('id', id);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎯</span>
          <div>
            <span className="font-bold text-lg tracking-tight">StudyFlow Pro</span>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
              Nuvem ativa
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-slate-300">{userEmail}</span>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10 max-w-5xl mx-auto w-full">
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
            Qual foco vamos estudar hoje?
          </h1>
          <p className="text-slate-300 text-sm sm:text-base">
            Escolha seu concurso abaixo ou crie um novo perfil pelo PCI Concursos ou PDF.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 text-slate-300 py-16">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Carregando seus concursos da nuvem...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full">
            {profiles.map((p) => (
              <div
                key={p.id}
                onClick={() => router.push(`/p/${p.id}`)}
                className="group relative cursor-pointer rounded-3xl bg-white/10 hover:bg-white/15 border border-white/15 hover:border-blue-400/60 p-6 transition-all duration-200 hover:-translate-y-1 shadow-xl"
              >
                <button
                  onClick={(e) => handleDeleteProfile(p.id, p.name, e)}
                  title="Excluir perfil"
                  className="opacity-0 group-hover:opacity-100 absolute top-4 right-4 p-1.5 rounded-lg bg-white/10 hover:bg-red-500/40 text-slate-300 hover:text-white transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-lg"
                  style={{ backgroundColor: `${p.color}33`, border: `1px solid ${p.color}66` }}
                >
                  {p.icon}
                </div>

                <h2 className="text-xl font-bold mb-1">{p.name}</h2>
                <p className="text-xs text-slate-300 line-clamp-2 mb-4 min-h-[2rem]">
                  {p.role_title || 'Plano de estudos personalizado'}
                </p>

                {p.salary_base && (
                  <div className="text-xs bg-black/25 rounded-xl px-3 py-2 mb-4 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Salário Base:</span>
                      <span className="font-semibold text-emerald-300">{p.salary_base}</span>
                    </div>
                    {p.vale_alimentacao && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Vale:</span>
                        <span className="font-semibold text-sky-300">{p.vale_alimentacao}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between text-xs font-medium text-blue-300 group-hover:text-blue-200">
                  <span>Abrir painel de estudos</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            ))}

            <button
              onClick={() => {
                resetModal();
                setShowModal(true);
              }}
              className="rounded-3xl border-2 border-dashed border-white/25 hover:border-blue-400/70 bg-white/5 hover:bg-white/10 p-6 flex flex-col items-center justify-center text-center min-h-[240px] transition-all"
            >
              <div className="w-14 h-14 rounded-2xl bg-blue-600/30 border border-blue-400/40 flex items-center justify-center mb-3">
                <Plus className="w-7 h-7 text-blue-300" />
              </div>
              <span className="font-bold text-lg">Criar Novo Perfil</span>
              <span className="text-xs text-slate-300 mt-1 max-w-[210px]">
                Procurar concurso ou mandar PDF do edital
              </span>
            </button>
          </div>
        )}
      </main>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-white/15 p-6 text-white shadow-2xl my-8">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                {step !== 'start' && (
                  <button
                    type="button"
                    onClick={() => setStep('start')}
                    className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 mr-1"
                    title="Voltar"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <Sparkles className="w-5 h-5 text-blue-400" />
                <h2 className="text-xl font-bold">
                  {step === 'start' && 'Adicionar Novo Concurso'}
                  {step === 'pci' && 'Procurar Concurso (PCI Concursos)'}
                  {step === 'pick_role' && 'Qual cargo você quer estudar?'}
                  {step === 'review' && 'Confirmar Dados do Perfil'}
                </h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {parseError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-400/40 text-red-200 text-xs">
                {parseError}
              </div>
            )}

            {/* TELA 1: Apenas Procurar Concurso OU Mandar PDF */}
            {step === 'start' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setStep('pci')}
                    className="group text-left rounded-2xl bg-emerald-950/40 hover:bg-emerald-900/40 border border-emerald-500/35 hover:border-emerald-400 p-6 transition space-y-3"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center">
                      <Search className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-white">Procurar Concurso</h3>
                      <p className="text-xs text-slate-300 mt-1">
                        Busca ao vivo no PCI Concursos com vagas, salários e cargos abertos.
                      </p>
                    </div>
                  </button>

                  <label className="cursor-pointer group text-left rounded-2xl bg-blue-950/40 hover:bg-blue-900/40 border border-blue-500/35 hover:border-blue-400 p-6 transition space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/20 text-blue-300 flex items-center justify-center">
                      {parsingPdf ? (
                        <Loader2 className="w-6 h-6 animate-spin" />
                      ) : (
                        <Upload className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-white">
                        {parsingPdf ? 'Lendo PDF do Edital...' : 'Mandar PDF do Edital'}
                      </h3>
                      <p className="text-xs text-slate-300 mt-1">
                        O Gemini lê o PDF, pergunta o cargo e completa o que faltar pela internet.
                      </p>
                    </div>
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      disabled={parsingPdf}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handlePdfUpload(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => setStep('review')}
                    className="text-xs text-slate-400 hover:text-slate-200 underline"
                  >
                    Ou preencher manualmente
                  </button>
                </div>
              </div>
            )}

            {/* TELA 2A: Busca PCI Concursos */}
            {step === 'pci' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    autoFocus
                    value={pciQuery}
                    onChange={(e) => setPciQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handlePciSearch();
                      }
                    }}
                    placeholder="Ex: INSS, Câmara, Polícia Civil, TRT..."
                    className="flex-1 rounded-xl bg-white/10 border border-white/15 px-4 py-2.5 text-sm"
                  />
                  <input
                    value={pciUf}
                    onChange={(e) => setPciUf(e.target.value.slice(0, 2))}
                    placeholder="UF (mg)"
                    className="w-24 rounded-xl bg-white/10 border border-white/15 px-3 py-2.5 text-sm uppercase"
                  />
                  <button
                    type="button"
                    onClick={() => handlePciSearch(false)}
                    disabled={pciLoading}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {pciLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePciSearch(true)}
                    disabled={pciLoading}
                    className="px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold shrink-0"
                  >
                    Ver Abertos
                  </button>
                </div>

                {pciMessage && <p className="text-xs text-amber-300">{pciMessage}</p>}

                <div className="max-h-72 overflow-y-auto space-y-2">
                  {pciResults.map((c, i) => (
                    <div
                      key={c.id || i}
                      className="rounded-2xl bg-white/5 border border-white/10 p-3.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{c.orgao || c.titulo}</p>
                        <p className="text-slate-300 mt-0.5">
                          {c.uf ? `${c.uf} • ` : ''}
                          {c.vagas_salario || `${c.vagas ? `${c.vagas} vagas • ` : ''}${c.salario || ''}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.noticia?.link && (
                          <a
                            href={c.noticia.link}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 rounded-xl bg-white/10 hover:bg-white/20"
                            title="Ver edital no PCI"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => applyPciConcurso(c)}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold"
                        >
                          Escolher
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TELA 2B: Pergunta qual cargo o usuário quer */}
            {step === 'pick_role' && (
              <div className="space-y-4">
                <p className="text-sm text-slate-300">
                  Encontramos <strong>{roleOptions.length} cargos</strong> em{' '}
                  <strong>{pendingOrgan || name}</strong>. Clique no cargo que você vai prestar:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto">
                  {roleOptions.map((roleName, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectRole(roleName)}
                      className="text-left p-3.5 rounded-2xl bg-white/5 hover:bg-blue-600/30 border border-white/10 hover:border-blue-400 text-xs font-medium transition flex items-center justify-between gap-2"
                    >
                      <span>{roleName}</span>
                      <ArrowRight className="w-4 h-4 shrink-0 text-blue-300" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* TELA 3: Revisão e Conciliação (só aparece depois de escolher/ler) */}
            {step === 'review' && (
              <form onSubmit={handleCreateProfile} className="space-y-4">
                {extractingRole && (
                  <div className="p-3 rounded-xl bg-blue-500/20 border border-blue-400/40 text-blue-200 text-xs flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>
                      Extraindo salário, data e matérias exclusivas de <strong>{chosenRole}</strong>...
                    </span>
                  </div>
                )}

                {reconciling && (
                  <div className="p-3 rounded-xl bg-violet-500/20 border border-violet-400/40 text-violet-200 text-xs flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>
                      Conciliando os editais (Núcleo Comum + Módulos Exclusivos)...
                    </span>
                  </div>
                )}

                {enrichingWeb && (
                  <div className="p-3 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-200 text-xs flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Completando salário, vale e data pela internet com Gemini...</span>
                  </div>
                )}

                {addedEditais.length > 0 && (
                  <div className="rounded-2xl bg-blue-950/40 border border-blue-400/30 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5 items-center text-xs">
                      <Layers className="w-4 h-4 text-blue-300 shrink-0" />
                      {addedEditais.map((ed, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg bg-blue-600/30 border border-blue-400/30"
                        >
                          {ed.organName} · {ed.roleTitle}
                        </span>
                      ))}
                    </div>
                    <label className="cursor-pointer shrink-0 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold inline-flex items-center gap-1.5">
                      {parsingPdf ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      Conciliar outro PDF
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        disabled={parsingPdf || extractingRole || reconciling}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handlePdfUpload(f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Ícone</label>
                    <input
                      value={icon}
                      onChange={(e) => setIcon(e.target.value)}
                      className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-sm text-center"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs text-slate-300 mb-1">Concurso / Órgão *</label>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-slate-300 mb-1">Cargo</label>
                    <input
                      value={roleTitle}
                      onChange={(e) => setRoleTitle(e.target.value)}
                      className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={enrichingWeb || !name.trim()}
                    onClick={() => enrichMissingInfo(name, roleTitle)}
                    className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                  >
                    <Globe className="w-3.5 h-3.5 text-sky-300" />
                    Completar via Web
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Salário Base</label>
                    <input
                      value={salaryBase}
                      onChange={(e) => setSalaryBase(e.target.value)}
                      className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Vale Alimentação</label>
                    <input
                      value={vale}
                      onChange={(e) => setVale(e.target.value)}
                      className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Data da Prova</label>
                    <input
                      type="date"
                      value={examDate}
                      onChange={(e) => setExamDate(e.target.value)}
                      className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {parsedSubjects.length > 0 && (
                  <div className="rounded-2xl bg-emerald-950/30 border border-emerald-500/30 p-3 text-xs space-y-2">
                    <p className="font-semibold text-emerald-300 flex items-center gap-1.5">
                      <Check className="w-4 h-4" />
                      {parsedSubjects.length} matérias prontas:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {parsedSubjects.map((s, idx) => (
                        <span
                          key={idx}
                          className={`px-2 py-0.5 rounded-lg ${
                            s.category.includes('Comum')
                              ? 'bg-emerald-500/25 text-emerald-200'
                              : 'bg-amber-500/20 text-amber-200'
                          }`}
                        >
                          {s.name} ({s.topics?.length || 0})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving || extractingRole || parsingPdf || reconciling}
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Criar e Abrir Perfil
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
