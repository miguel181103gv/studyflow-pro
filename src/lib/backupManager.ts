import { createClient } from '@/lib/supabase/client';
import type {
  AIReport,
  ErrorEntry,
  Flashcard,
  Profile,
  Simulado,
  SpacedReview,
  StudyLog,
  Subject,
  Topic,
  TopicHighlight,
} from '@/lib/types';

export type BackupReason = 'auto' | 'manual' | 'pre-restore';

export interface BackupSummary {
  subjects: number;
  topics: number;
  highlights: number;
  studyLogs: number;
  reviews: number;
  errors: number;
  flashcards: number;
  simulados: number;
  notes: number;
  questions: number;
  words: number;
}

export interface BackupLocalData {
  agendaPrefs?: unknown;
  agendaPlans?: unknown;
  topicNotes?: Record<string, string>;
  topicDifficulty?: Record<string, string>;
  questionBank?: unknown;
  dictionary?: unknown;
  leiSeca?: unknown;
  cycleReset?: string | null;
}

export interface BackupPayload {
  version: string;
  exported_at: string;
  reason?: BackupReason;
  label?: string;
  profile: Profile | null;
  subjects: Subject[];
  topics: Topic[];
  highlights: TopicHighlight[];
  studyLogs: StudyLog[];
  reviews: SpacedReview[];
  errors: ErrorEntry[];
  flashcards: Flashcard[];
  simulados: Simulado[];
  reports: AIReport[];
  localData?: BackupLocalData;
  agendaPrefs?: unknown; // compatibilidade com backups v7
  summary?: BackupSummary;
}

export interface RestorePointMeta {
  id: string;
  profileId: string;
  timestampMs: number;
  createdAt: string;
  reason: BackupReason;
  label: string;
  source: 'cloud+local' | 'cloud' | 'local';
  cloudPath?: string;
  sizeBytes?: number;
  summary?: BackupSummary;
}

interface StoredSnapshotRecord {
  id: string;
  profileId: string;
  timestampMs: number;
  createdAt: string;
  reason: BackupReason;
  label: string;
  sizeBytes: number;
  summary: BackupSummary;
  payload: BackupPayload;
}

export const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
export const BACKUP_RETENTION_DAYS = 7;
export const BACKUP_RETENTION_MS = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const IDB_NAME = 'studyflow_restore_points_v1';
const IDB_STORE = 'snapshots';
const BUCKET = 'study-assets';

export function getLastAutoBackupKey(profileId: string): string {
  return `sf_last_autobackup_${profileId}`;
}

export function getLastAutoBackupTimestamp(profileId: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(getLastAutoBackupKey(profileId));
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

export function setLastAutoBackupTimestamp(profileId: string, ts: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getLastAutoBackupKey(profileId), String(ts));
  } catch {
    // ignore
  }
}

export function shouldRunAutoBackup(profileId: string): boolean {
  const last = getLastAutoBackupTimestamp(profileId);
  return Date.now() - last >= AUTO_BACKUP_INTERVAL_MS;
}

function readLocalJson<T>(key: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function readLocalString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function collectProfileLocalData(profileId: string): BackupLocalData {
  return {
    agendaPrefs: readLocalJson(`sf_agenda_prefs_${profileId}`),
    agendaPlans: readLocalJson(`sf_agenda_plans_v2_${profileId}`),
    topicNotes: readLocalJson<Record<string, string>>(`sf_topic_notes_${profileId}`),
    topicDifficulty: readLocalJson<Record<string, string>>(`sf_topic_difficulty_${profileId}`),
    questionBank: readLocalJson(`sf_question_bank_${profileId}`),
    dictionary: readLocalJson(`sf_dictionary_${profileId}`),
    leiSeca: readLocalJson(`sf_lei_seca_${profileId}`),
    cycleReset: readLocalString(`sf_cycle_reset_${profileId}`),
  };
}

export function computeBackupSummary(payload: {
  subjects?: unknown[];
  topics?: unknown[];
  highlights?: unknown[];
  studyLogs?: unknown[];
  reviews?: unknown[];
  errors?: unknown[];
  flashcards?: unknown[];
  simulados?: unknown[];
  localData?: BackupLocalData;
}): BackupSummary {
  const notesCount = payload.localData?.topicNotes
    ? Object.values(payload.localData.topicNotes).filter((v) => typeof v === 'string' && v.trim().length > 0).length
    : 0;
  const questionsCount = Array.isArray(payload.localData?.questionBank)
    ? payload.localData!.questionBank.length
    : 0;
  const wordsCount = Array.isArray(payload.localData?.dictionary)
    ? payload.localData!.dictionary.length
    : 0;

  return {
    subjects: Array.isArray(payload.subjects) ? payload.subjects.length : 0,
    topics: Array.isArray(payload.topics) ? payload.topics.length : 0,
    highlights: Array.isArray(payload.highlights) ? payload.highlights.length : 0,
    studyLogs: Array.isArray(payload.studyLogs) ? payload.studyLogs.length : 0,
    reviews: Array.isArray(payload.reviews) ? payload.reviews.length : 0,
    errors: Array.isArray(payload.errors) ? payload.errors.length : 0,
    flashcards: Array.isArray(payload.flashcards) ? payload.flashcards.length : 0,
    simulados: Array.isArray(payload.simulados) ? payload.simulados.length : 0,
    notes: notesCount,
    questions: questionsCount,
    words: wordsCount,
  };
}

export function buildBackupPayload(params: {
  profile: Profile;
  subjects: Subject[];
  topics: Topic[];
  highlights: TopicHighlight[];
  studyLogs: StudyLog[];
  reviews: SpacedReview[];
  errors: ErrorEntry[];
  flashcards: Flashcard[];
  simulados: Simulado[];
  reports: AIReport[];
  reason?: BackupReason;
  label?: string;
}): BackupPayload {
  const reason: BackupReason = params.reason || 'manual';
  const label =
    params.label ||
    (reason === 'auto'
      ? 'Automático (horário)'
      : reason === 'pre-restore'
      ? 'Segurança pré-restauração'
      : 'Ponto manual');
  const localData = collectProfileLocalData(params.profile.id);
  const summary = computeBackupSummary({
    subjects: params.subjects,
    topics: params.topics,
    highlights: params.highlights,
    studyLogs: params.studyLogs,
    reviews: params.reviews,
    errors: params.errors,
    flashcards: params.flashcards,
    simulados: params.simulados,
    localData,
  });

  return {
    version: 'studyflow-backup-v2',
    exported_at: new Date().toISOString(),
    reason,
    label,
    profile: params.profile,
    subjects: params.subjects,
    topics: params.topics,
    highlights: params.highlights,
    studyLogs: params.studyLogs,
    reviews: params.reviews,
    errors: params.errors,
    flashcards: params.flashcards,
    simulados: params.simulados,
    reports: params.reports,
    localData,
    agendaPrefs: localData.agendaPrefs ?? null,
    summary,
  };
}

// ---------------- IndexedDB Helpers ----------------

function openBackupDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          store.createIndex('by_profile', 'profileId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPutSnapshot(record: StoredSnapshotRecord): Promise<boolean> {
  const db = await openBackupDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbListSnapshots(profileId: string): Promise<StoredSnapshotRecord[]> {
  const db = await openBackupDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const idx = tx.objectStore(IDB_STORE).index('by_profile');
      const req = idx.getAll(profileId);
      req.onsuccess = () => resolve((req.result as StoredSnapshotRecord[]) || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function idbGetSnapshot(id: string): Promise<StoredSnapshotRecord | null> {
  const db = await openBackupDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(id);
      req.onsuccess = () => resolve((req.result as StoredSnapshotRecord) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbDeleteSnapshot(id: string): Promise<void> {
  const db = await openBackupDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------------- Filename & Parsing Helpers ----------------

function parseSnapshotFilename(name: string): { id: string; timestampMs: number; reason: BackupReason } | null {
  const match = name.match(/^rp_(\d+)_(auto|manual|pre-restore)\.json$/);
  if (!match) return null;
  const timestampMs = Number(match[1]);
  const reason = match[2] as BackupReason;
  return {
    id: `rp_${timestampMs}_${reason}`,
    timestampMs,
    reason,
  };
}

function getReasonLabel(reason: BackupReason): string {
  if (reason === 'auto') return 'Automático (horário)';
  if (reason === 'pre-restore') return 'Segurança pré-restauração';
  return 'Ponto manual';
}

// ---------------- Core Operations ----------------

export async function createRestorePoint(params: {
  userId: string;
  profile: Profile;
  subjects: Subject[];
  topics: Topic[];
  highlights: TopicHighlight[];
  studyLogs: StudyLog[];
  reviews: SpacedReview[];
  errors: ErrorEntry[];
  flashcards: Flashcard[];
  simulados: Simulado[];
  reports: AIReport[];
  reason?: BackupReason;
  label?: string;
}): Promise<{ meta: RestorePointMeta; cloudSaved: boolean; localSaved: boolean }> {
  const reason: BackupReason = params.reason || 'manual';
  const timestampMs = Date.now();
  const id = `rp_${timestampMs}_${reason}`;
  const payload = buildBackupPayload({
    ...params,
    reason,
    label: params.label || getReasonLabel(reason),
  });
  const jsonText = JSON.stringify(payload);
  const sizeBytes = new Blob([jsonText]).size;

  // 1. Salva localmente no IndexedDB
  const localSaved = await idbPutSnapshot({
    id,
    profileId: params.profile.id,
    timestampMs,
    createdAt: payload.exported_at,
    reason,
    label: payload.label || getReasonLabel(reason),
    sizeBytes,
    summary: payload.summary!,
    payload,
  });

  // 2. Salva na nuvem (Supabase Storage: study-assets)
  let cloudSaved = false;
  const cloudFolder = `${params.userId}/${params.profile.id}/backups`;
  const cloudPath = `${cloudFolder}/${id}.json`;
  try {
    const supabase = createClient();
    const blob = new Blob([jsonText], { type: 'application/json' });
    const { error } = await supabase.storage.from(BUCKET).upload(cloudPath, blob, {
      contentType: 'application/json',
      upsert: false,
    });
    if (!error) cloudSaved = true;
  } catch {
    cloudSaved = false;
  }

  if (reason === 'auto') {
    setLastAutoBackupTimestamp(params.profile.id, timestampMs);
  }

  // 3. Limpa pontos com mais de 7 dias (mantendo sempre pelo menos o mais recente)
  void pruneOldRestorePoints(params.userId, params.profile.id);

  const meta: RestorePointMeta = {
    id,
    profileId: params.profile.id,
    timestampMs,
    createdAt: payload.exported_at,
    reason,
    label: payload.label || getReasonLabel(reason),
    source: cloudSaved && localSaved ? 'cloud+local' : cloudSaved ? 'cloud' : 'local',
    cloudPath: cloudSaved ? cloudPath : undefined,
    sizeBytes,
    summary: payload.summary,
  };

  return { meta, cloudSaved, localSaved };
}

export async function pruneOldRestorePoints(userId: string, profileId: string): Promise<void> {
  const cutoff = Date.now() - BACKUP_RETENTION_MS;

  // Prune local IndexedDB
  try {
    const localItems = await idbListSnapshots(profileId);
    const sorted = [...localItems].sort((a, b) => b.timestampMs - a.timestampMs);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].timestampMs < cutoff) {
        await idbDeleteSnapshot(sorted[i].id);
      }
    }
  } catch {
    // ignore
  }

  // Prune Supabase Storage
  try {
    const supabase = createClient();
    const folder = `${userId}/${profileId}/backups`;
    const { data: files } = await supabase.storage.from(BUCKET).list(folder, {
      limit: 200,
      sortBy: { column: 'name', order: 'desc' },
    });
    if (files && files.length > 1) {
      const parsed = files
        .map((f) => ({ name: f.name, parsed: parseSnapshotFilename(f.name) }))
        .filter((x): x is { name: string; parsed: NonNullable<ReturnType<typeof parseSnapshotFilename>> } => !!x.parsed)
        .sort((a, b) => b.parsed.timestampMs - a.parsed.timestampMs);

      const toRemove: string[] = [];
      for (let i = 1; i < parsed.length; i++) {
        if (parsed[i].parsed.timestampMs < cutoff) {
          toRemove.push(`${folder}/${parsed[i].name}`);
        }
      }
      if (toRemove.length > 0) {
        await supabase.storage.from(BUCKET).remove(toRemove);
      }
    }
  } catch {
    // ignore
  }
}

export async function listRestorePoints(userId: string, profileId: string): Promise<RestorePointMeta[]> {
  const map = new Map<string, RestorePointMeta>();

  // 1. Local IndexedDB
  const localItems = await idbListSnapshots(profileId);
  for (const item of localItems) {
    map.set(item.id, {
      id: item.id,
      profileId,
      timestampMs: item.timestampMs,
      createdAt: item.createdAt,
      reason: item.reason,
      label: item.label || getReasonLabel(item.reason),
      source: 'local',
      sizeBytes: item.sizeBytes,
      summary: item.summary,
    });
  }

  // 2. Cloud Supabase Storage
  try {
    const supabase = createClient();
    const folder = `${userId}/${profileId}/backups`;
    const { data: files } = await supabase.storage.from(BUCKET).list(folder, {
      limit: 200,
      sortBy: { column: 'name', order: 'desc' },
    });
    if (files) {
      for (const f of files) {
        const parsed = parseSnapshotFilename(f.name);
        if (!parsed) continue;
        const cloudPath = `${folder}/${f.name}`;
        const existing = map.get(parsed.id);
        const sizeFromMeta =
          typeof (f.metadata as { size?: number } | null)?.size === 'number'
            ? (f.metadata as { size?: number }).size
            : undefined;
        if (existing) {
          existing.source = 'cloud+local';
          existing.cloudPath = cloudPath;
          if (!existing.sizeBytes && sizeFromMeta) existing.sizeBytes = sizeFromMeta;
        } else {
          map.set(parsed.id, {
            id: parsed.id,
            profileId,
            timestampMs: parsed.timestampMs,
            createdAt: new Date(parsed.timestampMs).toISOString(),
            reason: parsed.reason,
            label: getReasonLabel(parsed.reason),
            source: 'cloud',
            cloudPath,
            sizeBytes: sizeFromMeta,
          });
        }
      }
    }
  } catch {
    // ignore cloud errors, keep local list
  }

  return Array.from(map.values()).sort((a, b) => b.timestampMs - a.timestampMs);
}

export async function loadRestorePointPayload(point: RestorePointMeta): Promise<BackupPayload | null> {
  // Tenta local primeiro (instantâneo)
  const localRec = await idbGetSnapshot(point.id);
  if (localRec?.payload) return localRec.payload;

  // Fallback para nuvem
  if (point.cloudPath) {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from(BUCKET).download(point.cloudPath);
    if (!error && data) {
      const text = await data.text();
      return JSON.parse(text) as BackupPayload;
    }
  }
  return null;
}

export async function deleteRestorePoint(point: RestorePointMeta): Promise<void> {
  await idbDeleteSnapshot(point.id);
  if (point.cloudPath) {
    try {
      const supabase = createClient();
      await supabase.storage.from(BUCKET).remove([point.cloudPath]);
    } catch {
      // ignore
    }
  }
}

// ---------------- Restore Engine ----------------

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function restoreBackupPayload(params: {
  payload: BackupPayload;
  userId: string;
  currentProfile: Profile;
  currentData?: {
    subjects: Subject[];
    topics: Topic[];
    highlights: TopicHighlight[];
    studyLogs: StudyLog[];
    reviews: SpacedReview[];
    errors: ErrorEntry[];
    flashcards: Flashcard[];
    simulados: Simulado[];
    reports: AIReport[];
  };
  createSafetyPoint?: boolean;
}): Promise<{ restoredCounts: BackupSummary }> {
  const { payload, userId, currentProfile, currentData, createSafetyPoint = true } = params;
  const supabase = createClient();

  // 1. Cria um ponto de segurança antes de mexer no banco
  if (createSafetyPoint && currentData) {
    try {
      await createRestorePoint({
        userId,
        profile: currentProfile,
        ...currentData,
        reason: 'pre-restore',
        label: 'Segurança pré-restauração',
      });
    } catch {
      // não impede a restauração se falhar o ponto extra
    }
  }

  const preserveIds = Boolean(payload.profile?.id && payload.profile.id === currentProfile.id);

  // 2. Limpa os dados atuais deste perfil (ordem segura de FK)
  const tablesToClear = [
    'topic_highlights',
    'spaced_reviews',
    'study_logs',
    'error_entries',
    'flashcards',
    'simulados',
    'ai_reports',
    'topics',
    'subjects',
  ];
  for (const tbl of tablesToClear) {
    const { error } = await supabase
      .from(tbl)
      .delete()
      .eq('profile_id', currentProfile.id)
      .eq('user_id', userId);
    if (error) {
      throw new Error(`Erro ao preparar restauração (${tbl}): ${error.message}`);
    }
  }

  // 3. Atualiza metadados do perfil (se existirem no backup)
  if (payload.profile) {
    await supabase
      .from('profiles')
      .update({
        slug: payload.profile.slug ?? currentProfile.slug,
        name: payload.profile.name || currentProfile.name,
        role_title: payload.profile.role_title ?? '',
        icon: payload.profile.icon || currentProfile.icon,
        color: payload.profile.color || currentProfile.color,
        salary_base: payload.profile.salary_base ?? '',
        vale_alimentacao: payload.profile.vale_alimentacao ?? '',
        workload: payload.profile.workload ?? '',
        extras: payload.profile.extras ?? '',
        status_text: payload.profile.status_text ?? '',
        exam_date: payload.profile.exam_date || null,
        daily_hours_goal: Number(payload.profile.daily_hours_goal) || 4,
        target_accuracy: Number(payload.profile.target_accuracy) || 80,
      })
      .eq('id', currentProfile.id)
      .eq('user_id', userId);
  }

  // 4. Restaura Matérias (subjects)
  const subjectMap = new Map<string, string>();
  const rawSubjects = Array.isArray(payload.subjects) ? payload.subjects : [];
  let firstSubjectId: string | null = null;

  if (preserveIds) {
    const rows = rawSubjects.map((s, idx) => ({
      ...(UUID_REGEX.test(String(s.id || '')) ? { id: s.id } : {}),
      user_id: userId,
      profile_id: currentProfile.id,
      name: String(s.name || 'Matéria'),
      category: String(s.category || 'Conhecimentos Específicos'),
      color: String(s.color || '#0d9488'),
      cycle_hours: Number(s.cycle_hours ?? 1),
      cycle_minutes: Number(s.cycle_minutes ?? 30),
      cycle_order: Number(s.cycle_order ?? idx),
    }));
    for (const chunk of chunkArray(rows, 100)) {
      const { data: inserted, error } = await supabase.from('subjects').insert(chunk).select('id, name');
      if (error) throw new Error(`Erro ao restaurar matérias: ${error.message}`);
      if (inserted) {
        for (const r of inserted) {
          if (!firstSubjectId) firstSubjectId = r.id;
          subjectMap.set(r.id, r.id);
        }
      }
    }
  } else {
    for (let idx = 0; idx < rawSubjects.length; idx++) {
      const s = rawSubjects[idx];
      const { data: created, error } = await supabase
        .from('subjects')
        .insert({
          user_id: userId,
          profile_id: currentProfile.id,
          name: String(s.name || 'Matéria'),
          category: String(s.category || 'Conhecimentos Específicos'),
          color: String(s.color || '#0d9488'),
          cycle_hours: Number(s.cycle_hours ?? 1),
          cycle_minutes: Number(s.cycle_minutes ?? 30),
          cycle_order: Number(s.cycle_order ?? idx),
        })
        .select('id')
        .single();
      if (error) throw new Error(`Erro ao restaurar matérias: ${error.message}`);
      if (created) {
        if (!firstSubjectId) firstSubjectId = created.id;
        if (s.id) subjectMap.set(String(s.id), created.id);
      }
    }
  }

  // 5. Restaura Tópicos (topics)
  const topicMap = new Map<string, string>();
  const rawTopics = Array.isArray(payload.topics) ? payload.topics : [];

  if (preserveIds) {
    const rows = rawTopics
      .map((t, idx) => {
        const sid = subjectMap.get(String(t.subject_id || ''));
        if (!sid) return null;
        return {
          ...(UUID_REGEX.test(String(t.id || '')) ? { id: t.id } : {}),
          user_id: userId,
          profile_id: currentProfile.id,
          subject_id: sid,
          title: String(t.title || 'Tópico'),
          studied: Boolean(t.studied),
          is_priority: Boolean(t.is_priority),
          studied_at: t.studied_at || null,
          pdf_path: t.pdf_path || null,
          pdf_name: t.pdf_name || null,
          video_url: t.video_url || null,
          sort_order: Number(t.sort_order ?? idx),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    for (const chunk of chunkArray(rows, 100)) {
      const { data: inserted, error } = await supabase.from('topics').insert(chunk).select('id');
      if (error) throw new Error(`Erro ao restaurar tópicos: ${error.message}`);
      if (inserted) {
        for (const r of inserted) topicMap.set(r.id, r.id);
      }
    }
  } else {
    for (let idx = 0; idx < rawTopics.length; idx++) {
      const t = rawTopics[idx];
      const sid = subjectMap.get(String(t.subject_id || ''));
      if (!sid) continue;
      const { data: created, error } = await supabase
        .from('topics')
        .insert({
          user_id: userId,
          profile_id: currentProfile.id,
          subject_id: sid,
          title: String(t.title || 'Tópico'),
          studied: Boolean(t.studied),
          is_priority: Boolean(t.is_priority),
          studied_at: t.studied_at || null,
          pdf_path: t.pdf_path || null,
          pdf_name: t.pdf_name || null,
          video_url: t.video_url || null,
          sort_order: Number(t.sort_order ?? idx),
        })
        .select('id')
        .single();
      if (error) throw new Error(`Erro ao restaurar tópicos: ${error.message}`);
      if (created && t.id) topicMap.set(String(t.id), created.id);
    }
  }

  // 6. Restaura Grifos (topic_highlights)
  const rawHighlights = Array.isArray(payload.highlights) ? payload.highlights : [];
  const highlightRows = rawHighlights
    .map((h) => {
      const tid = topicMap.get(String(h.topic_id || ''));
      if (!tid) return null;
      return {
        user_id: userId,
        profile_id: currentProfile.id,
        topic_id: tid,
        text: String(h.text || ''),
        color: String(h.color || '#fef08a'),
        note: String(h.note || ''),
        page_number: Number(h.page_number || 1),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.text.length > 0);
  for (const chunk of chunkArray(highlightRows, 100)) {
    await supabase.from('topic_highlights').insert(chunk);
  }

  // 7. Restaura Sessões de Estudo (study_logs)
  const rawLogs = Array.isArray(payload.studyLogs) ? payload.studyLogs : [];
  const logRows = rawLogs
    .map((l) => {
      const sid = subjectMap.get(String(l.subject_id || '')) || firstSubjectId;
      if (!sid) return null;
      const tid = l.topic_id ? topicMap.get(String(l.topic_id)) || null : null;
      return {
        user_id: userId,
        profile_id: currentProfile.id,
        subject_id: sid,
        topic_id: tid,
        duration_seconds: Number(l.duration_seconds) || 0,
        study_date: String(l.study_date || new Date().toISOString().slice(0, 10)),
        period: String(l.period || 'Manhã'),
        method: String(l.method || 'PDF + Questões'),
        questions_total: Number(l.questions_total) || 0,
        questions_correct: Number(l.questions_correct) || 0,
        stop_point: String(l.stop_point || ''),
        notes: String(l.notes || ''),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  for (const chunk of chunkArray(logRows, 100)) {
    await supabase.from('study_logs').insert(chunk);
  }

  // 8. Restaura Revisões Espaçadas (spaced_reviews)
  const rawReviews = Array.isArray(payload.reviews) ? payload.reviews : [];
  const reviewRows = rawReviews
    .map((r) => {
      const sid = subjectMap.get(String(r.subject_id || ''));
      const tid = topicMap.get(String(r.topic_id || ''));
      if (!sid || !tid) return null;
      return {
        user_id: userId,
        profile_id: currentProfile.id,
        subject_id: sid,
        topic_id: tid,
        interval_days: Number(r.interval_days) || 1,
        due_date: String(r.due_date || new Date().toISOString().slice(0, 10)),
        completed: Boolean(r.completed),
        completed_at: r.completed_at || null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  for (const chunk of chunkArray(reviewRows, 100)) {
    await supabase.from('spaced_reviews').insert(chunk);
  }

  // 9. Restaura Caderno de Erros (error_entries)
  const rawErrors = Array.isArray(payload.errors) ? payload.errors : [];
  const errorRows = rawErrors
    .map((er) => {
      const sid = subjectMap.get(String(er.subject_id || '')) || firstSubjectId;
      if (!sid) return null;
      const tid = er.topic_id ? topicMap.get(String(er.topic_id)) || null : null;
      return {
        user_id: userId,
        profile_id: currentProfile.id,
        subject_id: sid,
        topic_id: tid,
        question_text: String(er.question_text || ''),
        image_path: er.image_path || null,
        user_answer: String(er.user_answer || ''),
        correct_answer: String(er.correct_answer || ''),
        error_cause: String(er.error_cause || 'Lacuna teórica'),
        explanation: String(er.explanation || ''),
        golden_rule: String(er.golden_rule || ''),
        review_count: Number(er.review_count) || 0,
        last_reviewed_at: er.last_reviewed_at || null,
        next_review_date: String(er.next_review_date || new Date().toISOString().slice(0, 10)),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  for (const chunk of chunkArray(errorRows, 100)) {
    await supabase.from('error_entries').insert(chunk);
  }

  // 10. Restaura Flashcards (flashcards)
  const rawFlashcards = Array.isArray(payload.flashcards) ? payload.flashcards : [];
  const cardRows = rawFlashcards
    .map((c) => {
      const sid = subjectMap.get(String(c.subject_id || '')) || firstSubjectId;
      if (!sid) return null;
      const tid = c.topic_id ? topicMap.get(String(c.topic_id)) || null : null;
      return {
        user_id: userId,
        profile_id: currentProfile.id,
        subject_id: sid,
        topic_id: tid,
        front: String(c.front || ''),
        back: String(c.back || ''),
        ease_factor: Number(c.ease_factor) || 2.5,
        interval_days: Number(c.interval_days) || 0,
        repetitions: Number(c.repetitions) || 0,
        due_date: String(c.due_date || new Date().toISOString().slice(0, 10)),
        last_reviewed_at: c.last_reviewed_at || null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.front.length > 0);
  for (const chunk of chunkArray(cardRows, 100)) {
    await supabase.from('flashcards').insert(chunk);
  }

  // 11. Restaura Simulados (simulados)
  const rawSimulados = Array.isArray(payload.simulados) ? payload.simulados : [];
  const simRows = rawSimulados.map((sm) => ({
    user_id: userId,
    profile_id: currentProfile.id,
    title: String(sm.title || 'Simulado'),
    exam_date: String(sm.exam_date || new Date().toISOString().slice(0, 10)),
    board: String(sm.board || ''),
    total_questions: Number(sm.total_questions) || 60,
    correct_answers: Number(sm.correct_answers) || 0,
    duration_minutes: Number(sm.duration_minutes) || 240,
    notes: String(sm.notes || ''),
    subject_scores: Array.isArray(sm.subject_scores) ? sm.subject_scores : [],
  }));
  for (const chunk of chunkArray(simRows, 100)) {
    await supabase.from('simulados').insert(chunk);
  }

  // 12. Restaura Relatórios IA (ai_reports)
  const rawReports = Array.isArray(payload.reports) ? payload.reports : [];
  const reportRows = rawReports.map((rp) => ({
    user_id: userId,
    profile_id: currentProfile.id,
    period_type: String(rp.period_type || 'Semanal'),
    period_label: String(rp.period_label || ''),
    content_markdown: String(rp.content_markdown || ''),
    metrics_snapshot: rp.metrics_snapshot && typeof rp.metrics_snapshot === 'object' ? rp.metrics_snapshot : {},
  }));
  for (const chunk of chunkArray(reportRows, 50)) {
    await supabase.from('ai_reports').insert(chunk);
  }

  // 13. Restaura dados locais (Textos, Dificuldades, Agenda, Questões, Dicionário, Ciclo)
  const local: BackupLocalData = payload.localData || {
    agendaPrefs: payload.agendaPrefs,
  };
  try {
    if (local.agendaPrefs !== undefined && local.agendaPrefs !== null) {
      localStorage.setItem(`sf_agenda_prefs_${currentProfile.id}`, JSON.stringify(local.agendaPrefs));
    }
    if (local.agendaPlans !== undefined && local.agendaPlans !== null) {
      localStorage.setItem(`sf_agenda_plans_v2_${currentProfile.id}`, JSON.stringify(local.agendaPlans));
    }
    if (local.topicNotes && typeof local.topicNotes === 'object') {
      const remapped: Record<string, string> = {};
      for (const [oldTid, text] of Object.entries(local.topicNotes)) {
        const newTid = preserveIds ? oldTid : topicMap.get(oldTid);
        if (newTid && typeof text === 'string') remapped[newTid] = text;
      }
      localStorage.setItem(`sf_topic_notes_${currentProfile.id}`, JSON.stringify(remapped));
    }
    if (local.topicDifficulty && typeof local.topicDifficulty === 'object') {
      const remapped: Record<string, string> = {};
      for (const [oldTid, diff] of Object.entries(local.topicDifficulty)) {
        const newTid = preserveIds ? oldTid : topicMap.get(oldTid);
        if (newTid && typeof diff === 'string') remapped[newTid] = diff;
      }
      localStorage.setItem(`sf_topic_difficulty_${currentProfile.id}`, JSON.stringify(remapped));
    }
    if (local.questionBank !== undefined && local.questionBank !== null) {
      localStorage.setItem(`sf_question_bank_${currentProfile.id}`, JSON.stringify(local.questionBank));
    }
    if (local.dictionary !== undefined && local.dictionary !== null) {
      localStorage.setItem(`sf_dictionary_${currentProfile.id}`, JSON.stringify(local.dictionary));
    }
    if (local.leiSeca !== undefined && local.leiSeca !== null) {
      localStorage.setItem(`sf_lei_seca_${currentProfile.id}`, JSON.stringify(local.leiSeca));
    }
    if (local.cycleReset) {
      localStorage.setItem(`sf_cycle_reset_${currentProfile.id}`, local.cycleReset);
    }
  } catch {
    // ignore localStorage errors
  }

  return {
    restoredCounts: computeBackupSummary({
      subjects: rawSubjects,
      topics: rawTopics,
      highlights: highlightRows,
      studyLogs: logRows,
      reviews: reviewRows,
      errors: errorRows,
      flashcards: cardRows,
      simulados: simRows,
      localData: local,
    }),
  };
}
