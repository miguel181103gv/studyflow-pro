'use client';

export interface OfflineProfileSnapshot {
  savedAt: number;
  profile: unknown;
  subjects: unknown[];
  topics: unknown[];
  highlights: unknown[];
  studyLogs: unknown[];
  reviews: unknown[];
  errors: unknown[];
  simulados: unknown[];
  reports: unknown[];
  flashcards: unknown[];
  theme?: string;
}

const PREFIX = 'sf_offline_snapshot_v1_';

export function saveOfflineSnapshot(profileId: string, snapshot: OfflineProfileSnapshot) {
  if (!profileId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${PREFIX}${profileId}`, JSON.stringify(snapshot));
  } catch {
    // ignore quota errors
  }
}

export function loadOfflineSnapshot(profileId: string): OfflineProfileSnapshot | null {
  if (!profileId || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}${profileId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineProfileSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}
