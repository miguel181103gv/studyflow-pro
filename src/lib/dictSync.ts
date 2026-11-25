'use client';

import { createClient } from '@/lib/supabase/client';
import { dispatchDictionaryUpdated } from '@/components/DictionaryText';

export interface SyncedDictEntry {
  id: string;
  word: string;
  meaning: string;
  example?: string;
  subject_id?: string;
  created_at: string;
}

export function sortDictEntries<T extends { word: string }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    a.word.localeCompare(b.word, 'pt-BR', { sensitivity: 'base' })
  );
}

export function readLocalDictionary(profileId: string): SyncedDictEntry[] {
  try {
    const raw = localStorage.getItem(`sf_dictionary_${profileId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeLocalDictionary(profileId: string, entries: SyncedDictEntry[]) {
  try {
    localStorage.setItem(
      `sf_dictionary_${profileId}`,
      JSON.stringify(sortDictEntries(entries))
    );
    dispatchDictionaryUpdated();
  } catch {
    // ignore
  }
}

export function mergeDictionaryLists(
  localList: SyncedDictEntry[],
  cloudList: SyncedDictEntry[]
): { merged: SyncedDictEntry[]; localHadExtra: boolean } {
  const byKey = new Map<string, SyncedDictEntry>();
  const keyOf = (e: SyncedDictEntry) =>
    (e.word || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim() || e.id;

  cloudList.forEach((e) => {
    if (e?.word) byKey.set(keyOf(e), e);
  });

  let localHadExtra = false;
  localList.forEach((e) => {
    if (!e?.word) return;
    const k = keyOf(e);
    if (!byKey.has(k)) {
      byKey.set(k, e);
      localHadExtra = true;
    }
  });

  return {
    merged: sortDictEntries(Array.from(byKey.values())),
    localHadExtra,
  };
}

export async function syncDictionaryToCloud(
  userId: string,
  profileId: string,
  entries: SyncedDictEntry[]
) {
  if (!userId || !profileId) return;
  try {
    const supabase = createClient();
    const payload = JSON.stringify(sortDictEntries(entries));
    const { data: existing } = await supabase
      .from('ai_reports')
      .select('id')
      .eq('user_id', userId)
      .eq('profile_id', profileId)
      .eq('period_type', '__SYNC_DICT__')
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from('ai_reports')
        .update({ content_markdown: payload })
        .eq('id', existing.id);
    } else {
      await supabase.from('ai_reports').insert({
        user_id: userId,
        profile_id: profileId,
        period_type: '__SYNC_DICT__',
        period_label: 'Sincronização Dicionário',
        content_markdown: payload,
      });
    }
  } catch {
    // ignore
  }
}
