'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ensureUserSeeded } from '@/lib/seed';
import type { Profile } from '@/lib/types';
import { SUBJECT_COLORS } from '@/lib/utils';
import { STUDY_MODES, STUDY_MODE_LIST, encodeStudyModeSlug, getStudyMode, type StudyMode } from '@/lib/studyModes';
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
  CheckCircle2,
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

type ModalStep = 'choose_mode' | 'start' | 'pci' | 'pick_role' | 'review';

export default function ProfileSelectorPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [userId, setUserId] = useState('');

  // Modal Criar Novo Perfil
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState<ModalStep>('choose_mode');
  const [studyMode, setStudyMode] = useState<StudyMode>('concurso');
  const [pickedMode, setPickedMode] = useState<StudyMode | null>(null);
  const [quickSubjectInput, setQuickSubjectInput] = useState('');

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
    setStep('choose_mode');
    setStudyMode('concurso');
    setPickedMode(null);
    setQuickSubjectInput('');
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
          slug: encodeStudyModeSlug(studyMode),
          name: name.trim(),
          role_title: roleTitle.trim(),
          icon: icon || '🏛️',
          color: SUBJECT_COLORS[profiles.length % SUBJECT_COLORS.length],
          salary_base: STUDY_MODES[studyMode].hasSalaryRaioX ? salaryBase : '',
          vale_alimentacao: STUDY_MODES[studyMode].hasSalaryRaioX ? vale : '',
          workload: STUDY_MODES[studyMode].hasSalaryRaioX ? workload : '',
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

  async function handleQuickCreateSkip() {
    if (!userId) return;
    const modeCfg = STUDY_MODES[studyMode];
    const finalName = name.trim() || `Meu plano — ${modeCfg.label}`;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: created, error } = await supabase
        .from('profiles')
        .insert({
          user_id: userId,
          slug: encodeStudyModeSlug(studyMode),
          name: finalName,
          role_title: roleTitle.trim(),
          icon: icon || modeCfg.icon,
          color: modeCfg.color,
          salary_base: '',
          vale_alimentacao: '',
          workload: '',
          extras: '',
          status_text: '',
          exam_date: examDate || null,
          daily_hours_goal: 2,
          target_accuracy: 80,
          sort_order: profiles.length,
        })
        .select('*')
        .single();
      if (error || !created) throw error || new Error('Erro ao criar perfil');

      const subjectsToInsert =
        parsedSubjects.length > 0 ? parsedSubjects : modeCfg.defaultSubjects;
      for (let i = 0; i < subjectsToInsert.length; i++) {
        const s = subjectsToInsert[i];
        const { data: sub } = await supabase
          .from('subjects')
          .insert({
            user_id: userId,
            profile_id: created.id,
            name: s.name,
            category: s.category || modeCfg.shortLabel,
            color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
            cycle_hours: 1,
            cycle_minutes: 0,
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
      setParseError(err instanceof Error ? err.message : 'Erro ao criar perfil.');
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

  const currentStepNumber =
    step === 'choose_mode' ? 1 : step === 'start' || step === 'pci' || step === 'pick_role' ? 2 : studyMode === 'concurso' ? 3 : 2;
  const totalSteps = studyMode === 'concurso' ? 3 : 2;

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-main)] flex flex-col">
      {/* Header limpo alinhado ao restante do StudyFlow */}
      <header className="w-full border-b border-theme bg-[var(--bg-card)]/90 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo-studyflow.png" alt="StudyFlow" className="h-8 object-contain" />
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
              Nuvem ativa
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-muted-theme">{userEmail}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl subtle-surface border border-theme hover:opacity-85 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center px-5 py-10 max-w-5xl mx-auto w-full">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Seus espaços de estudo
            </h1>
            <p className="text-sm text-muted-theme mt-1">
              Escolha um perfil para continuar ou crie um novo para concurso, faculdade, escola, certificação ou estudo livre.
            </p>
          </div>
          <button
            onClick={() => {
              resetModal();
              setShowModal(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm shrink-0 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Novo perfil de estudo
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 text-muted-theme py-16">
            <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
            <span className="text-sm font-medium">Carregando seus planos de estudo...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
            {profiles.map((p) => {
              const pMode = getStudyMode(p);
              return (
                <div
                  key={p.id}
                  onClick={() => router.push(`/p/${p.id}`)}
                  className="group relative cursor-pointer card-surface rounded-2xl p-5 hover:border-teal-500/50 hover:shadow-md transition-all flex flex-col justify-between gap-4"
                >
                  <button
                    onClick={(e) => handleDeleteProfile(p.id, p.name, e)}
                    title="Excluir perfil"
                    aria-label={`Excluir perfil ${p.name}`}
                    className="opacity-0 group-hover:opacity-100 absolute top-4 right-4 p-1.5 rounded-lg subtle-surface hover:bg-rose-500/15 text-muted-theme hover:text-rose-600 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
                        style={{
                          backgroundColor: `${p.color}18`,
                          border: `1px solid ${p.color}35`,
                        }}
                      >
                        {p.icon}
                      </div>
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full subtle-surface text-muted-theme">
                        {pMode.shortLabel}
                      </span>
                    </div>

                    <h2 className="text-lg font-bold leading-snug mb-1 pr-6">{p.name}</h2>
                    <p className="text-xs text-muted-theme line-clamp-2 min-h-[2rem]">
                      {p.role_title || pMode.cardSubtitle}
                    </p>
                  </div>

                  {pMode.hasSalaryRaioX && p.salary_base && (
                    <div className="text-xs subtle-surface rounded-xl px-3 py-2 space-y-1">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-theme">Salário Base:</span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-300">
                          {p.salary_base}
                        </span>
                      </div>
                      {p.vale_alimentacao && (
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-theme">Vale:</span>
                          <span className="font-semibold text-teal-700 dark:text-teal-300">
                            {p.vale_alimentacao}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-2 border-t border-theme flex items-center justify-between text-xs font-bold text-teal-700 dark:text-teal-300">
                    <span>Abrir espaço de estudo</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              );
            })}

            <button
              onClick={() => {
                resetModal();
                setShowModal(true);
              }}
              className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-teal-500/70 bg-[var(--bg-card)]/60 hover:bg-[var(--bg-card)] p-6 flex flex-col items-center justify-center text-center min-h-[210px] transition-all"
            >
              <div className="w-12 h-12 rounded-2xl bg-teal-600/12 text-teal-600 flex items-center justify-center mb-3">
                <Plus className="w-6 h-6" />
              </div>
              <span className="font-bold text-base">Criar novo perfil</span>
              <span className="text-xs text-muted-theme mt-1 max-w-[220px]">
                Concurso, faculdade, escola, certificação ou estudo livre
              </span>
            </button>
          </div>
        )}
      </main>

      {/* MODAL DE ONBOARDING CURTO (ALINHADO AO VISUAL DO APP) */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl card-surface rounded-3xl p-6 shadow-2xl my-8 animate-pop-in">
            {/* Cabeçalho do assistente com Etapa X de Y */}
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="flex items-start gap-2.5">
                {step !== 'choose_mode' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (step === 'start') setStep('choose_mode');
                      else if (step === 'review' && studyMode !== 'concurso') setStep('choose_mode');
                      else setStep('start');
                    }}
                    className="p-2 rounded-xl subtle-surface hover:opacity-85 mt-0.5 shrink-0"
                    title="Voltar"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <div>
                  <span className="inline-block text-[11px] font-bold text-teal-700 dark:text-teal-300 mb-0.5">
                    Etapa {currentStepNumber} de {totalSteps}
                  </span>
                  <h2 className="text-xl font-extrabold tracking-tight">
                    {step === 'choose_mode' && 'O que você está estudando agora?'}
                    {step === 'start' && 'Como quer configurar seu concurso?'}
                    {step === 'pci' && 'Procurar Concurso (PCI Concursos)'}
                    {step === 'pick_role' && 'Qual cargo você quer estudar?'}
                    {step === 'review' &&
                      (studyMode === 'concurso'
                        ? 'Confirmar dados do concurso'
                        : `Organizar perfil — ${STUDY_MODES[studyMode].label}`)}
                  </h2>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                aria-label="Fechar"
                className="p-2 rounded-xl subtle-surface hover:opacity-85 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {parseError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/12 border border-rose-500/30 text-rose-600 text-xs">
                {parseError}
              </div>
            )}

            {/* ETAPA 1: ESCOLHA DO OBJETIVO (6 CARTÕES CLICÁVEIS + CONTINUAR) */}
            {step === 'choose_mode' && (
              <div className="space-y-5">
                <p className="text-sm text-muted-theme">
                  Vamos adaptar seu espaço de estudo ao seu objetivo. Você pode mudar isso ou criar outros perfis depois.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {STUDY_MODE_LIST.map((m) => {
                    const isSelected = pickedMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setPickedMode(m.id)}
                        className={`text-left rounded-2xl p-4 border-2 transition-all flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'border-teal-600 bg-teal-600/8 shadow-sm'
                            : 'border-theme bg-[var(--bg-card)] hover:border-slate-400/60'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-2xl shrink-0">{m.icon}</span>
                          <div className="min-w-0">
                            <p className="font-bold text-sm leading-tight">{m.label}</p>
                            <p className="text-xs text-muted-theme mt-0.5">{m.cardSubtitle}</p>
                          </div>
                        </div>
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${
                            isSelected
                              ? 'bg-teal-600 border-teal-600 text-white'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-theme text-center">
                  Estuda para mais de um objetivo? Você poderá adicionar outro perfil depois.
                </p>

                <div className="flex justify-end gap-2 pt-2 border-t border-theme">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2.5 rounded-xl subtle-surface text-xs font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!pickedMode}
                    onClick={() => {
                      if (!pickedMode) return;
                      const m = STUDY_MODES[pickedMode];
                      setStudyMode(m.id);
                      setIcon(m.icon);
                      if (m.id === 'concurso') {
                        setParsedSubjects([]);
                        setStep('start');
                      } else {
                        setParsedSubjects(m.defaultSubjects);
                        setSalaryBase('');
                        setVale('');
                        setWorkload('');
                        setStep('review');
                      }
                    }}
                    className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40"
                  >
                    Continuar
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ETAPA 2 (CONCURSO): Procurar no PCI OU Mandar PDF OU Manual */}
            {step === 'start' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <button
                    type="button"
                    onClick={() => setStep('pci')}
                    className="text-left rounded-2xl border border-theme hover:border-teal-500/60 bg-[var(--bg-subtle)]/50 hover:bg-[var(--bg-subtle)] p-5 transition space-y-2.5"
                  >
                    <div className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                      <Search className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">Procurar Concurso</h3>
                      <p className="text-xs text-muted-theme mt-1">
                        Busca ao vivo no PCI Concursos com vagas, salários e cargos abertos.
                      </p>
                    </div>
                  </button>

                  <label className="cursor-pointer text-left rounded-2xl border border-theme hover:border-teal-500/60 bg-[var(--bg-subtle)]/50 hover:bg-[var(--bg-subtle)] p-5 transition space-y-2.5">
                    <div className="w-11 h-11 rounded-xl bg-teal-500/15 text-teal-700 dark:text-teal-300 flex items-center justify-center">
                      {parsingPdf ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Upload className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">
                        {parsingPdf ? 'Lendo PDF do Edital...' : 'Enviar PDF do Edital'}
                      </h3>
                      <p className="text-xs text-muted-theme mt-1">
                        O Gemini extrai cargos, matérias e data da prova para você revisar antes de criar.
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

                <div className="flex items-center justify-between pt-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setStep('review')}
                    className="font-semibold text-teal-700 dark:text-teal-300 hover:underline"
                  >
                    Adicionar manualmente
                  </button>
                  <button
                    type="button"
                    onClick={handleQuickCreateSkip}
                    disabled={saving}
                    className="text-muted-theme hover:underline"
                  >
                    Não sei ainda — fazer depois
                  </button>
                </div>
              </div>
            )}

            {/* ETAPA 2A: Busca PCI Concursos */}
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
                    className="flex-1 rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3.5 py-2.5 text-sm"
                  />
                  <input
                    value={pciUf}
                    onChange={(e) => setPciUf(e.target.value.slice(0, 2))}
                    placeholder="UF (mg)"
                    className="w-24 rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2.5 text-sm uppercase"
                  />
                  <button
                    type="button"
                    onClick={() => handlePciSearch(false)}
                    disabled={pciLoading}
                    className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {pciLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePciSearch(true)}
                    disabled={pciLoading}
                    className="px-3 py-2.5 rounded-xl subtle-surface border border-theme text-xs font-semibold shrink-0"
                  >
                    Ver Abertos
                  </button>
                </div>

                {pciMessage && <p className="text-xs text-amber-600 font-medium">{pciMessage}</p>}

                <div className="max-h-72 overflow-y-auto space-y-2">
                  {pciResults.map((c, i) => (
                    <div
                      key={c.id || i}
                      className="rounded-2xl subtle-surface border border-theme p-3.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{c.orgao || c.titulo}</p>
                        <p className="text-muted-theme mt-0.5">
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
                            className="p-2 rounded-xl card-surface border border-theme"
                            title="Ver edital no PCI"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => applyPciConcurso(c)}
                          className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-semibold"
                        >
                          Escolher
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ETAPA 2B: Escolha de cargo */}
            {step === 'pick_role' && (
              <div className="space-y-4">
                <p className="text-sm text-muted-theme">
                  Encontramos <strong>{roleOptions.length} cargos</strong> em{' '}
                  <strong>{pendingOrgan || name}</strong>. Clique no cargo que você vai prestar:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto">
                  {roleOptions.map((roleName, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectRole(roleName)}
                      className="text-left p-3.5 rounded-2xl subtle-surface hover:border-teal-500 border border-theme text-xs font-semibold transition flex items-center justify-between gap-2"
                    >
                      <span>{roleName}</span>
                      <ArrowRight className="w-4 h-4 shrink-0 text-teal-600" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ETAPA FINAL: REVISÃO & CRIAÇÃO (ADAPTADA AO MODO ESCOLHIDO) */}
            {step === 'review' && (
              <form onSubmit={handleCreateProfile} className="space-y-4">
                {extractingRole && (
                  <div className="p-3 rounded-xl bg-teal-500/12 border border-teal-500/30 text-teal-700 dark:text-teal-300 text-xs flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>
                      Extraindo salário, data e matérias exclusivas de <strong>{chosenRole}</strong>...
                    </span>
                  </div>
                )}

                {reconciling && (
                  <div className="p-3 rounded-xl bg-violet-500/12 border border-violet-500/30 text-violet-700 dark:text-violet-300 text-xs flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Conciliando os editais (Núcleo Comum + Módulos Exclusivos)...</span>
                  </div>
                )}

                {enrichingWeb && (
                  <div className="p-3 rounded-xl bg-sky-500/12 border border-sky-500/30 text-sky-700 dark:text-sky-300 text-xs flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Completando salário, vale e data pela internet com Gemini...</span>
                  </div>
                )}

                {addedEditais.length > 0 && (
                  <div className="rounded-2xl subtle-surface border border-theme p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5 items-center text-xs">
                      <Layers className="w-4 h-4 text-teal-600 shrink-0" />
                      {addedEditais.map((ed, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg card-surface border border-theme font-medium"
                        >
                          {ed.organName} · {ed.roleTitle}
                        </span>
                      ))}
                    </div>
                    <label className="cursor-pointer shrink-0 px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1.5">
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
                    <label className="block text-xs font-semibold text-muted-theme mb-1">Ícone</label>
                    <input
                      value={icon}
                      onChange={(e) => setIcon(e.target.value)}
                      className="w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-center"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-muted-theme mb-1">
                      {STUDY_MODES[studyMode].nameLabel}
                    </label>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={STUDY_MODES[studyMode].namePlaceholder}
                      className="w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-muted-theme mb-1">
                      {STUDY_MODES[studyMode].roleLabel}
                    </label>
                    <input
                      value={roleTitle}
                      onChange={(e) => setRoleTitle(e.target.value)}
                      placeholder={STUDY_MODES[studyMode].rolePlaceholder}
                      className="w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
                    />
                  </div>
                  {STUDY_MODES[studyMode].hasEdital && (
                    <button
                      type="button"
                      disabled={enrichingWeb || !name.trim()}
                      onClick={() => enrichMissingInfo(name, roleTitle)}
                      className="px-3 py-2 rounded-xl subtle-surface border border-theme text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                    >
                      <Globe className="w-3.5 h-3.5 text-teal-600" />
                      Completar via Web
                    </button>
                  )}
                </div>

                {STUDY_MODES[studyMode].hasSalaryRaioX ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-muted-theme mb-1">Salário Base</label>
                      <input
                        value={salaryBase}
                        onChange={(e) => setSalaryBase(e.target.value)}
                        className="w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-theme mb-1">Vale Alimentação</label>
                      <input
                        value={vale}
                        onChange={(e) => setVale(e.target.value)}
                        className="w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-theme mb-1">
                        {STUDY_MODES[studyMode].examDateLabel}
                      </label>
                      <input
                        type="date"
                        value={examDate}
                        onChange={(e) => setExamDate(e.target.value)}
                        className="w-full rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-muted-theme mb-1">
                      {STUDY_MODES[studyMode].examDateLabel}
                    </label>
                    <input
                      type="date"
                      value={examDate}
                      onChange={(e) => setExamDate(e.target.value)}
                      className="w-full sm:w-64 rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
                    />
                  </div>
                )}

                {/* Matérias editáveis (pode adicionar, remover ou deixar para depois) */}
                <div className="rounded-2xl subtle-surface border border-theme p-3.5 text-xs space-y-2.5">
                  <p className="font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-teal-600" />
                    Matérias iniciais ({parsedSubjects.length}) — você pode ajustar depois
                  </p>
                  {parsedSubjects.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {parsedSubjects.map((s, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg card-surface border border-theme inline-flex items-center gap-1.5 font-medium"
                        >
                          {s.name}
                          <button
                            type="button"
                            onClick={() =>
                              setParsedSubjects((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-muted-theme hover:text-rose-600"
                            title="Remover matéria"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <input
                      value={quickSubjectInput}
                      onChange={(e) => setQuickSubjectInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && quickSubjectInput.trim()) {
                          e.preventDefault();
                          setParsedSubjects((prev) => [
                            ...prev,
                            {
                              name: quickSubjectInput.trim(),
                              category: STUDY_MODES[studyMode].shortLabel,
                              topics: ['Tópico 1'],
                            },
                          ]);
                          setQuickSubjectInput('');
                        }
                      }}
                      placeholder="Adicionar matéria ou disciplina..."
                      className="flex-1 rounded-xl bg-[var(--bg-card)] border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!quickSubjectInput.trim()) return;
                        setParsedSubjects((prev) => [
                          ...prev,
                          {
                            name: quickSubjectInput.trim(),
                            category: STUDY_MODES[studyMode].shortLabel,
                            topics: ['Tópico 1'],
                          },
                        ]);
                        setQuickSubjectInput('');
                      }}
                      className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-semibold shrink-0"
                    >
                      + Adicionar
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-theme">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleQuickCreateSkip}
                    className="text-xs font-semibold text-muted-theme hover:underline"
                  >
                    Pular e preencher depois
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2.5 rounded-xl subtle-surface text-xs font-semibold"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={saving || extractingRole || parsingPdf || reconciling}
                      className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-2 disabled:opacity-60"
                    >
                      {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                      Criar e abrir espaço
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
