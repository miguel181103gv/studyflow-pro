'use client';

import { createClient } from '@/lib/supabase/client';

export const CLOUD_SYNC_EVENT = 'studyflow:cloud-sync';

export type CloudSyncScope =
  | 'notes'
  | 'questions'
  | 'lei-seca'
  | 'agenda'
  | 'simulados-gen';

export function dispatchCloudSync(scope: CloudSyncScope) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CLOUD_SYNC_EVENT, { detail: { scope } }));
}

const syncRowCache = new Map<string, string>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // ignore quota errors
  }
}

export function trackDeletedIds(scope: CloudSyncScope, profileId: string, ids: string[]) {
  if (!ids.length) return;
  const k = `sf_sync_deleted_${scope}_${profileId}`;
  const prev = safeReadJson<string[]>(k, []);
  const next = Array.from(new Set([...ids, ...prev])).slice(0, 500);
  safeWriteJson(k, next);
}

function getDeletedIds(scope: CloudSyncScope, profileId: string): string[] {
  return safeReadJson<string[]>(`sf_sync_deleted_${scope}_${profileId}`, []);
}

async function upsertSyncRow(
  userId: string,
  profileId: string,
  periodType: string,
  label: string,
  payload: unknown
) {
  if (!userId || !profileId) return;
  try {
    const supabase = createClient();
    const cacheKey = `${profileId}:${periodType}`;
    const content = JSON.stringify(payload);
    const cachedId = syncRowCache.get(cacheKey);
    if (cachedId) {
      const { error } = await supabase
        .from('ai_reports')
        .update({ content_markdown: content })
        .eq('id', cachedId);
      if (!error) return;
    }

    const { data: existing } = await supabase
      .from('ai_reports')
      .select('id')
      .eq('user_id', userId)
      .eq('profile_id', profileId)
      .eq('period_type', periodType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      syncRowCache.set(cacheKey, existing.id);
      await supabase
        .from('ai_reports')
        .update({ content_markdown: content })
        .eq('id', existing.id);
    } else {
      const { data: inserted } = await supabase
        .from('ai_reports')
        .insert({
          user_id: userId,
          profile_id: profileId,
          period_type: periodType,
          period_label: label,
          content_markdown: content,
        })
        .select('id')
        .single();
      if (inserted?.id) syncRowCache.set(cacheKey, inserted.id);
    }
  } catch {
    // silencioso se offline
  }
}

function schedulePush(key: string, fn: () => Promise<void>, delayMs = 600) {
  const prev = debounceTimers.get(key);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    debounceTimers.delete(key);
    void fn();
  }, delayMs);
  debounceTimers.set(key, t);
}

// ---------------------------------------------------------------------------
// 1. TEXTOS / ANOTAÇÕES DOS TÓPICOS + DIFICULDADE
// ---------------------------------------------------------------------------
export function pushTopicNotesToCloud(userId: string, profileId: string) {
  if (!userId || !profileId) return;
  schedulePush(`notes:${profileId}`, async () => {
    const notes = safeReadJson<Record<string, unknown>>(`sf_topic_notes_${profileId}`, {});
    const difficulty = safeReadJson<Record<string, unknown>>(
      `sf_topic_difficulty_${profileId}`,
      {}
    );
    await upsertSyncRow(userId, profileId, '__SYNC_NOTES__', 'Sincronização Textos', {
      notes,
      difficulty,
      updatedAt: Date.now(),
    });
  });
}

export function mergeTopicNotesFromCloud(
  userId: string,
  profileId: string,
  cloudContent: string | null | undefined
) {
  const localNotes = safeReadJson<Record<string, { updatedAt?: string }>>(
    `sf_topic_notes_${profileId}`,
    {}
  );
  const localDiff = safeReadJson<Record<string, unknown>>(
    `sf_topic_difficulty_${profileId}`,
    {}
  );

  let cloudNotes: Record<string, { updatedAt?: string }> = {};
  let cloudDiff: Record<string, unknown> = {};
  if (cloudContent) {
    try {
      const parsed = JSON.parse(cloudContent);
      if (parsed && typeof parsed === 'object') {
        cloudNotes = parsed.notes || {};
        cloudDiff = parsed.difficulty || {};
      }
    } catch {
      // ignore
    }
  }

  const mergedNotes: Record<string, unknown> = { ...cloudNotes };
  let localHadExtra = false;

  for (const [topicId, loc] of Object.entries(localNotes)) {
    const cld = cloudNotes[topicId];
    if (!cld) {
      mergedNotes[topicId] = loc;
      localHadExtra = true;
    } else {
      const locTs = loc?.updatedAt ? Date.parse(loc.updatedAt) || 0 : 0;
      const cldTs = cld?.updatedAt ? Date.parse(cld.updatedAt) || 0 : 0;
      if (locTs > cldTs) {
        mergedNotes[topicId] = loc;
        localHadExtra = true;
      }
    }
  }

  const mergedDiff = { ...cloudDiff, ...localDiff };
  for (const k of Object.keys(localDiff)) {
    if (!(k in cloudDiff)) localHadExtra = true;
  }

  if (Object.keys(mergedNotes).length > 0) {
    safeWriteJson(`sf_topic_notes_${profileId}`, mergedNotes);
  }
  if (Object.keys(mergedDiff).length > 0) {
    safeWriteJson(`sf_topic_difficulty_${profileId}`, mergedDiff);
  }

  if (localHadExtra && userId) {
    pushTopicNotesToCloud(userId, profileId);
  }
  dispatchCloudSync('notes');
}

// ---------------------------------------------------------------------------
// 2. QUESTÕES (BANCO + RESOLVIDAS)
// ---------------------------------------------------------------------------
export function pushQuestionsToCloud(
  userId: string,
  profileId: string,
  newlyDeletedIds: string[] = []
) {
  if (!userId || !profileId) return;
  if (newlyDeletedIds.length) trackDeletedIds('questions', profileId, newlyDeletedIds);
  schedulePush(`questions:${profileId}`, async () => {
    const questions = safeReadJson<Array<{ id: string }>>(
      `sf_question_bank_${profileId}`,
      []
    );
    const solved = safeReadJson<Record<string, unknown>>(
      `sf_question_solved_${profileId}`,
      {}
    );
    const deletedIds = getDeletedIds('questions', profileId);
    await upsertSyncRow(userId, profileId, '__SYNC_QUESTIONS__', 'Sincronização Questões', {
      questions,
      solved,
      deletedIds,
      updatedAt: Date.now(),
    });
  });
}

export function mergeQuestionsFromCloud(
  userId: string,
  profileId: string,
  cloudContent: string | null | undefined
) {
  const localQ = safeReadJson<Array<{ id: string; created_at?: string }>>(
    `sf_question_bank_${profileId}`,
    []
  );
  const localSolved = safeReadJson<Record<string, { answeredAt?: string }>>(
    `sf_question_solved_${profileId}`,
    {}
  );
  const localDel = getDeletedIds('questions', profileId);

  let cloudQ: Array<{ id: string; created_at?: string }> = [];
  let cloudSolved: Record<string, { answeredAt?: string }> = {};
  let cloudDel: string[] = [];

  if (cloudContent) {
    try {
      const parsed = JSON.parse(cloudContent);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.questions)) cloudQ = parsed.questions;
        if (parsed.solved && typeof parsed.solved === 'object') cloudSolved = parsed.solved;
        if (Array.isArray(parsed.deletedIds)) cloudDel = parsed.deletedIds;
      }
    } catch {
      // ignore
    }
  }

  const deletedSet = new Set([...localDel, ...cloudDel]);
  const byId = new Map<string, { id: string; created_at?: string }>();
  for (const q of cloudQ) {
    if (q?.id && !deletedSet.has(q.id)) byId.set(q.id, q);
  }
  let localHadExtra = false;
  for (const q of localQ) {
    if (q?.id && !deletedSet.has(q.id) && !byId.has(q.id)) {
      byId.set(q.id, q);
      localHadExtra = true;
    }
  }

  const mergedQ = Array.from(byId.values());
  const mergedSolved: Record<string, unknown> = { ...cloudSolved };
  for (const [qid, s] of Object.entries(localSolved)) {
    if (deletedSet.has(qid)) continue;
    const cs = cloudSolved[qid];
    if (!cs) {
      mergedSolved[qid] = s;
      localHadExtra = true;
    } else {
      const lTs = s?.answeredAt ? Date.parse(s.answeredAt) || 0 : 0;
      const cTs = cs?.answeredAt ? Date.parse(cs.answeredAt) || 0 : 0;
      if (lTs > cTs) {
        mergedSolved[qid] = s;
        localHadExtra = true;
      }
    }
  }

  safeWriteJson(`sf_question_bank_${profileId}`, mergedQ);
  safeWriteJson(`sf_question_solved_${profileId}`, mergedSolved);
  safeWriteJson(`sf_sync_deleted_questions_${profileId}`, Array.from(deletedSet).slice(0, 500));

  if ((localHadExtra || localDel.length > cloudDel.length) && userId) {
    pushQuestionsToCloud(userId, profileId);
  }
  dispatchCloudSync('questions');
}

// ---------------------------------------------------------------------------
// 3. LEI SECA
// ---------------------------------------------------------------------------
export function pushLeiSecaToCloud(
  userId: string,
  profileId: string,
  newlyDeletedIds: string[] = []
) {
  if (!userId || !profileId) return;
  if (newlyDeletedIds.length) trackDeletedIds('lei-seca', profileId, newlyDeletedIds);
  schedulePush(`lei-seca:${profileId}`, async () => {
    const articles = safeReadJson<Array<{ id: string }>>(`sf_lei_seca_${profileId}`, []);
    const deletedIds = getDeletedIds('lei-seca', profileId);
    await upsertSyncRow(userId, profileId, '__SYNC_LEI_SECA__', 'Sincronização Lei Seca', {
      articles,
      deletedIds,
      updatedAt: Date.now(),
    });
  }, 900);
}

export function mergeLeiSecaFromCloud(
  userId: string,
  profileId: string,
  cloudContent: string | null | undefined
) {
  const localArts = safeReadJson<Array<{ id: string; updatedAt?: string }>>(
    `sf_lei_seca_${profileId}`,
    []
  );
  const localDel = getDeletedIds('lei-seca', profileId);

  let cloudArts: Array<{ id: string; updatedAt?: string }> = [];
  let cloudDel: string[] = [];
  if (cloudContent) {
    try {
      const parsed = JSON.parse(cloudContent);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.articles)) cloudArts = parsed.articles;
        if (Array.isArray(parsed.deletedIds)) cloudDel = parsed.deletedIds;
      }
    } catch {
      // ignore
    }
  }

  const deletedSet = new Set([...localDel, ...cloudDel]);
  const byId = new Map<string, { id: string; updatedAt?: string }>();
  for (const a of cloudArts) {
    if (a?.id && !deletedSet.has(a.id)) byId.set(a.id, a);
  }

  let localHadExtra = false;
  for (const a of localArts) {
    if (!a?.id || deletedSet.has(a.id)) continue;
    const existing = byId.get(a.id);
    if (!existing) {
      byId.set(a.id, a);
      localHadExtra = true;
    } else {
      const lTs = a.updatedAt ? Date.parse(a.updatedAt) || 0 : 0;
      const cTs = existing.updatedAt ? Date.parse(existing.updatedAt) || 0 : 0;
      if (lTs > cTs) {
        byId.set(a.id, a);
        localHadExtra = true;
      }
    }
  }

  const merged = Array.from(byId.values());
  safeWriteJson(`sf_lei_seca_${profileId}`, merged);
  safeWriteJson(`sf_sync_deleted_lei-seca_${profileId}`, Array.from(deletedSet).slice(0, 500));

  if ((localHadExtra || localDel.length > cloudDel.length) && userId) {
    pushLeiSecaToCloud(userId, profileId);
  }
  dispatchCloudSync('lei-seca');
}

// ---------------------------------------------------------------------------
// 4. AGENDA (STORE + PREFERÊNCIAS)
// ---------------------------------------------------------------------------
export function pushAgendaToCloud(userId: string, profileId: string) {
  if (!userId || !profileId) return;
  schedulePush(`agenda:${profileId}`, async () => {
    const store = safeReadJson<Record<string, unknown> | null>(
      `sf_agenda_plans_v2_${profileId}`,
      null
    );
    const prefs = safeReadJson<Record<string, unknown>>(`sf_agenda_prefs_${profileId}`, {});
    const ts = Date.now();
    if (store) {
      safeWriteJson(`sf_agenda_plans_v2_${profileId}`, { ...store, _updatedAt: ts });
    }
    await upsertSyncRow(userId, profileId, '__SYNC_AGENDA__', 'Sincronização Agenda', {
      store: store ? { ...store, _updatedAt: ts } : null,
      prefs,
      updatedAt: ts,
    });
  });
}

export function mergeAgendaFromCloud(
  userId: string,
  profileId: string,
  cloudContent: string | null | undefined
) {
  const localStore = safeReadJson<Record<string, unknown> & { _updatedAt?: number } | null>(
    `sf_agenda_plans_v2_${profileId}`,
    null
  );
  const localPrefs = safeReadJson<Record<string, unknown>>(
    `sf_agenda_prefs_${profileId}`,
    {}
  );

  let cloudStore: (Record<string, unknown> & { _updatedAt?: number }) | null = null;
  let cloudPrefs: Record<string, unknown> = {};
  if (cloudContent) {
    try {
      const parsed = JSON.parse(cloudContent);
      if (parsed && typeof parsed === 'object') {
        if (parsed.store && typeof parsed.store === 'object') cloudStore = parsed.store;
        if (parsed.prefs && typeof parsed.prefs === 'object') cloudPrefs = parsed.prefs;
      }
    } catch {
      // ignore
    }
  }

  let localHadExtra = false;
  let chosenStore = cloudStore || localStore;
  if (localStore && cloudStore) {
    const lTs = Number(localStore._updatedAt || 0);
    const cTs = Number(cloudStore._updatedAt || 0);
    if (lTs > cTs) {
      chosenStore = localStore;
      localHadExtra = true;
    }
  } else if (localStore && !cloudStore) {
    chosenStore = localStore;
    localHadExtra = true;
  }

  const mergedPrefs = { ...cloudPrefs, ...localPrefs };
  if (Object.keys(localPrefs).some((k) => !(k in cloudPrefs))) localHadExtra = true;

  if (chosenStore) safeWriteJson(`sf_agenda_plans_v2_${profileId}`, chosenStore);
  if (Object.keys(mergedPrefs).length > 0) safeWriteJson(`sf_agenda_prefs_${profileId}`, mergedPrefs);

  if (localHadExtra && userId) {
    pushAgendaToCloud(userId, profileId);
  }
  dispatchCloudSync('agenda');
}

// ---------------------------------------------------------------------------
// 5. SIMULADOS GERADOS
// ---------------------------------------------------------------------------
export function pushGeneratedSimuladosToCloud(
  userId: string,
  profileId: string,
  newlyDeletedIds: string[] = []
) {
  if (!userId || !profileId) return;
  if (newlyDeletedIds.length) trackDeletedIds('simulados-gen', profileId, newlyDeletedIds);
  schedulePush(`simulados-gen:${profileId}`, async () => {
    const items = safeReadJson<Array<{ id: string }>>(
      `sf_generated_simulados_${profileId}`,
      []
    );
    const deletedIds = getDeletedIds('simulados-gen', profileId);
    await upsertSyncRow(
      userId,
      profileId,
      '__SYNC_SIMULADOS_GEN__',
      'Sincronização Simulados Gerados',
      { items, deletedIds, updatedAt: Date.now() }
    );
  });
}

export function mergeGeneratedSimuladosFromCloud(
  userId: string,
  profileId: string,
  cloudContent: string | null | undefined
) {
  const localItems = safeReadJson<Array<{ id: string }>>(
    `sf_generated_simulados_${profileId}`,
    []
  );
  const localDel = getDeletedIds('simulados-gen', profileId);

  let cloudItems: Array<{ id: string }> = [];
  let cloudDel: string[] = [];
  if (cloudContent) {
    try {
      const parsed = JSON.parse(cloudContent);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.items)) cloudItems = parsed.items;
        if (Array.isArray(parsed.deletedIds)) cloudDel = parsed.deletedIds;
      }
    } catch {
      // ignore
    }
  }

  const deletedSet = new Set([...localDel, ...cloudDel]);
  const byId = new Map<string, { id: string }>();
  for (const it of cloudItems) {
    if (it?.id && !deletedSet.has(it.id)) byId.set(it.id, it);
  }
  let localHadExtra = false;
  for (const it of localItems) {
    if (it?.id && !deletedSet.has(it.id) && !byId.has(it.id)) {
      byId.set(it.id, it);
      localHadExtra = true;
    }
  }

  safeWriteJson(`sf_generated_simulados_${profileId}`, Array.from(byId.values()));
  safeWriteJson(`sf_sync_deleted_simulados-gen_${profileId}`, Array.from(deletedSet).slice(0, 500));

  if ((localHadExtra || localDel.length > cloudDel.length) && userId) {
    pushGeneratedSimuladosToCloud(userId, profileId);
  }
  dispatchCloudSync('simulados-gen');
}
