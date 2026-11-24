'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
  ThemeId,
  Topic,
  TopicHighlight,
} from '@/lib/types';
import { addDaysISO, SUBJECT_COLORS, todayISO } from '@/lib/utils';
import { useGlobal } from './GlobalProvider';
import { createRestorePoint, shouldRunAutoBackup } from '@/lib/backupManager';

interface StopwatchState {
  running: boolean;
  subjectId: string | null;
  topicId: string | null;
  elapsedSeconds: number;
  baseElapsedSeconds?: number;
  startedAt: number | null;
  quickNote?: string;
}

interface ProfileContextValue {
  loading: boolean;
  syncing: boolean;
  userId: string;
  userEmail: string;
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
  theme: ThemeId;
  setTheme: (t: ThemeId) => Promise<void>;
  refreshAll: () => Promise<void>;

  // Stopwatch
  stopwatch: StopwatchState;
  startStopwatch: (subjectId: string, topicId?: string | null) => void;
  pauseStopwatch: () => void;
  resetStopwatch: () => void;
  setStopwatchNote: (note: string) => void;

  // Actions (all auto-sync to Supabase)
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  addSubject: (name: string, category?: string, customColor?: string) => Promise<Subject | null>;
  updateSubject: (id: string, patch: Partial<Subject>) => Promise<void>;
  deleteSubject: (id: string) => Promise<void>;
  reorderSubject: (id: string, direction: 'up' | 'down') => Promise<void>;
  moveSubject: (sourceId: string, targetId: string) => Promise<void>;
  setSubjectOrder: (orderedIds: string[]) => Promise<void>;
  addTopic: (subjectId: string, title: string) => Promise<void>;
  addTopicsBatch: (subjectId: string, titles: string[]) => Promise<void>;
  updateTopicTitle: (topicId: string, title: string) => Promise<void>;
  deleteTopic: (topicId: string) => Promise<void>;
  migrateAndDeleteTopics: (topicIds: string[], targetTopicId: string | null) => Promise<void>;
  deleteSubjectsBatch: (subjectIds: string[]) => Promise<void>;
  toggleTopicStudied: (topic: Topic) => Promise<void>;
  toggleSubjectStudied: (subjectId: string, markAll: boolean) => Promise<void>;
  toggleTopicPriority: (topic: Topic) => Promise<void>;
  updateTopicPdf: (topicId: string, pdfPath: string | null, pdfName: string | null) => Promise<void>;
  updateTopicVideo: (topicId: string, videoUrl: string | null) => Promise<void>;
  addHighlight: (payload: Omit<TopicHighlight, 'id' | 'user_id' | 'profile_id' | 'created_at'>) => Promise<void>;
  deleteHighlight: (id: string) => Promise<void>;

  addStudyLog: (
    payload: Omit<StudyLog, 'id' | 'user_id' | 'profile_id' | 'created_at'>
  ) => Promise<void>;
  deleteStudyLog: (id: string) => Promise<void>;

  completeReview: (reviewId: string) => Promise<void>;
  postponeReview: (reviewId: string, newDueDate: string) => Promise<void>;
  deleteReview: (reviewId: string) => Promise<void>;
  addErrorEntry: (
    payload: Omit<ErrorEntry, 'id' | 'user_id' | 'profile_id' | 'created_at'>
  ) => Promise<ErrorEntry | null>;
  updateErrorEntry: (id: string, patch: Partial<ErrorEntry>) => Promise<void>;
  deleteErrorEntry: (id: string) => Promise<void>;

  addSimulado: (
    payload: Omit<Simulado, 'id' | 'user_id' | 'profile_id' | 'created_at'>
  ) => Promise<void>;
  deleteSimulado: (id: string) => Promise<void>;

  addAIReport: (
    payload: Omit<AIReport, 'id' | 'user_id' | 'profile_id' | 'created_at'>
  ) => Promise<void>;
  addFlashcards: (items: { subject_id: string; topic_id: string | null; front: string; back: string }[]) => Promise<void>;
  reviewFlashcard: (card: Flashcard, quality: 1 | 2 | 3 | 4) => Promise<void>;
  deleteFlashcard: (id: string) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({
  profileId,
  children,
}: {
  profileId: string;
  children: React.ReactNode;
}) {
  const { notify } = useGlobal();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [highlights, setHighlights] = useState<TopicHighlight[]>([]);
  const [studyLogs, setStudyLogs] = useState<StudyLog[]>([]);
  const [reviews, setReviews] = useState<SpacedReview[]>([]);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [simulados, setSimulados] = useState<Simulado[]>([]);
  const [reports, setReports] = useState<AIReport[]>([]);
  const [theme, setThemeState] = useState<ThemeId>('clean');

  const swStorageKey = `sf_stopwatch_${profileId}`;

  const [stopwatch, setStopwatch] = useState<StopwatchState>({
    running: false,
    subjectId: null,
    topicId: null,
    elapsedSeconds: 0,
    baseElapsedSeconds: 0,
    startedAt: null,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(swStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as StopwatchState;
      if (saved.running && saved.startedAt) {
        const base =
          typeof saved.baseElapsedSeconds === 'number'
            ? saved.baseElapsedSeconds
            : saved.elapsedSeconds;
        const extra = Math.max(0, Math.floor((Date.now() - saved.startedAt) / 1000));
        setStopwatch({
          ...saved,
          baseElapsedSeconds: base,
          elapsedSeconds: base + extra,
        });
      } else if (saved.subjectId) {
        setStopwatch({
          ...saved,
          baseElapsedSeconds: saved.baseElapsedSeconds ?? saved.elapsedSeconds,
        });
      }
    } catch {
      // ignore storage errors
    }
  }, [swStorageKey]);

  useEffect(() => {
    try {
      if (stopwatch.subjectId) {
        localStorage.setItem(swStorageKey, JSON.stringify(stopwatch));
      } else {
        localStorage.removeItem(swStorageKey);
      }
    } catch {
      // ignore
    }
  }, [stopwatch, swStorageKey]);

  useEffect(() => {
    if (!stopwatch.running) return;
    const syncElapsed = () => {
      setStopwatch((prev) => {
        if (!prev.running || !prev.startedAt) return prev;
        const base = prev.baseElapsedSeconds ?? 0;
        const realElapsed = base + Math.max(0, Math.floor((Date.now() - prev.startedAt) / 1000));
        if (realElapsed === prev.elapsedSeconds) return prev;
        return { ...prev, elapsedSeconds: realElapsed };
      });
    };
    const timer = setInterval(syncElapsed, 1000);
    const onResume = () => {
      if (document.visibilityState === 'visible') syncElapsed();
    };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', syncElapsed);
    window.addEventListener('pageshow', syncElapsed);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', syncElapsed);
      window.removeEventListener('pageshow', syncElapsed);
    };
  }, [stopwatch.running]);

  const setStopwatchNote = (note: string) => {
    setStopwatch((prev) => ({ ...prev, quickNote: note }));
  };

  const startStopwatch = (subjectId: string, topicId: string | null = null) => {
    if (
      stopwatch.subjectId &&
      stopwatch.subjectId !== subjectId &&
      stopwatch.elapsedSeconds > 10 &&
      typeof window !== 'undefined'
    ) {
      const ok = window.confirm(
        'Já existe outro cronômetro ativo em outra matéria. Deseja trocar e iniciar o novo cronômetro?'
      );
      if (!ok) return;
    }
    setStopwatch((prev) => {
      const sameSubject = prev.subjectId === subjectId;
      const base = sameSubject ? prev.elapsedSeconds : 0;
      return {
        running: true,
        subjectId,
        topicId: topicId ?? (sameSubject ? prev.topicId : null),
        elapsedSeconds: base,
        baseElapsedSeconds: base,
        startedAt: Date.now(),
        quickNote: sameSubject ? prev.quickNote : undefined,
      };
    });
  };

  const pauseStopwatch = () => {
    setStopwatch((prev) => {
      const base = prev.baseElapsedSeconds ?? prev.elapsedSeconds;
      const finalElapsed =
        prev.running && prev.startedAt
          ? base + Math.max(0, Math.floor((Date.now() - prev.startedAt) / 1000))
          : prev.elapsedSeconds;
      return {
        ...prev,
        running: false,
        elapsedSeconds: finalElapsed,
        baseElapsedSeconds: finalElapsed,
        startedAt: null,
      };
    });
  };

  const resetStopwatch = () => {
    try {
      localStorage.removeItem(swStorageKey);
    } catch {}
    setStopwatch({
      running: false,
      subjectId: null,
      topicId: null,
      elapsedSeconds: 0,
      baseElapsedSeconds: 0,
      startedAt: null,
    });
  };

  const refreshAll = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    setUserEmail(user.email || '');

    const [
      profRes,
      subRes,
      topRes,
      hlRes,
      logRes,
      revRes,
      errRes,
      simRes,
      repRes,
      setRes,
      fcRes,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', profileId).single(),
      supabase
        .from('subjects')
        .select('*')
        .eq('profile_id', profileId)
        .order('cycle_order', { ascending: true }),
      supabase
        .from('topics')
        .select('*')
        .eq('profile_id', profileId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('topic_highlights')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false }),
      supabase
        .from('study_logs')
        .select('*')
        .eq('profile_id', profileId)
        .order('study_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('spaced_reviews')
        .select('*')
        .eq('profile_id', profileId)
        .order('due_date', { ascending: true }),
      supabase
        .from('error_entries')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false }),
      supabase
        .from('simulados')
        .select('*')
        .eq('profile_id', profileId)
        .order('exam_date', { ascending: false }),
      supabase
        .from('ai_reports')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false }),
      supabase.from('user_settings').select('theme').eq('user_id', user.id).maybeSingle(),
      supabase.from('flashcards').select('*').eq('profile_id', profileId).order('due_date', { ascending: true }).order('created_at', { ascending: false }),
    ]);

    if (profRes.data) setProfile(profRes.data as Profile);
    setSubjects((subRes.data as Subject[]) || []);
    setTopics((topRes.data as Topic[]) || []);
    setHighlights((hlRes.data as TopicHighlight[]) || []);
    setStudyLogs((logRes.data as StudyLog[]) || []);
    setReviews((revRes.data as SpacedReview[]) || []);
    setErrors((errRes.data as ErrorEntry[]) || []);
    setSimulados((simRes.data as Simulado[]) || []);
    setReports((repRes.data as AIReport[]) || []);
    setFlashcards((fcRes?.data as Flashcard[]) || []);

    const savedTheme = (setRes.data?.theme as ThemeId) || 'clean';
    setThemeState(savedTheme);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }

    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const onRefresh = () => {
      refreshAll();
    };
    window.addEventListener('studyflow:profile-refresh', onRefresh);
    return () => window.removeEventListener('studyflow:profile-refresh', onRefresh);
  }, [refreshAll]);

  const withSync = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setSyncing(true);
    try {
      return await fn();
    } finally {
      setSyncing(false);
    }
  };

  const setTheme = async (t: ThemeId) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    if (!userId) return;
    await withSync(async () => {
      const supabase = createClient();
      await supabase
        .from('user_settings')
        .upsert({ user_id: userId, theme: t, updated_at: new Date().toISOString() });
    });
  };

  const updateProfile = async (patch: Partial<Profile>) => {
    if (!profile) return;
    setProfile({ ...profile, ...patch });
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('profiles').update(patch).eq('id', profile.id);
    });
  };

  const addSubject = async (
    name: string,
    category = 'Personalizada',
    customColor?: string
  ): Promise<Subject | null> => {
    if (!userId || !name.trim()) return null;
    const usedColors = new Set(subjects.map((s) => (s.color || '').toLowerCase()));
    const autoDistinct =
      SUBJECT_COLORS.find((c) => !usedColors.has(c.toLowerCase())) ||
      SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length];
    const finalColor = customColor && /^#[0-9a-fA-F]{6}$/.test(customColor) ? customColor : autoDistinct;
    return withSync(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('subjects')
        .insert({
          user_id: userId,
          profile_id: profileId,
          name: name.trim(),
          category,
          color: finalColor,
          cycle_hours: 1,
          cycle_minutes: 30,
          cycle_order: subjects.length,
        })
        .select('*')
        .single();
      if (data) {
        const sub = data as Subject;
        setSubjects((prev) => [...prev, sub]);
        return sub;
      }
      return null;
    });
  };

  const updateSubject = async (id: string, patch: Partial<Subject>) => {
    setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('subjects').update(patch).eq('id', id);
    });
  };

  const setSubjectOrder = async (orderedIds: string[]) => {
    const idPos = new Map(orderedIds.map((id, i) => [id, i]));
    const next = [...subjects].sort((a, b) => {
      const pa = idPos.has(a.id) ? idPos.get(a.id)! : 9999 + a.cycle_order;
      const pb = idPos.has(b.id) ? idPos.get(b.id)! : 9999 + b.cycle_order;
      return pa - pb;
    });
    const updated = next.map((s, i) => ({ ...s, cycle_order: i }));
    setSubjects(updated);

    await withSync(async () => {
      const supabase = createClient();
      await Promise.all(
        updated.map((s) =>
          supabase.from('subjects').update({ cycle_order: s.cycle_order }).eq('id', s.id)
        )
      );
      notify('Ordem do Ciclo de Estudos atualizada pelo cronograma!');
    });
  };

  const moveSubject = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const fromIdx = subjects.findIndex((s) => s.id === sourceId);
    const toIdx = subjects.findIndex((s) => s.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const next = [...subjects];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    const updated = next.map((s, i) => ({ ...s, cycle_order: i }));
    setSubjects(updated);

    await withSync(async () => {
      const supabase = createClient();
      await Promise.all(
        updated.map((s) =>
          supabase.from('subjects').update({ cycle_order: s.cycle_order }).eq('id', s.id)
        )
      );
    });
  };

  const reorderSubject = async (id: string, direction: 'up' | 'down') => {
    const idx = subjects.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= subjects.length) return;

    const next = [...subjects];
    const [moved] = next.splice(idx, 1);
    next.splice(swapIdx, 0, moved);
    const updated = next.map((s, i) => ({ ...s, cycle_order: i }));
    setSubjects(updated);

    await withSync(async () => {
      const supabase = createClient();
      await Promise.all(
        updated.map((s) =>
          supabase.from('subjects').update({ cycle_order: s.cycle_order }).eq('id', s.id)
        )
      );
    });
  };

  const addTopic = async (subjectId: string, title: string) => {
    if (!userId || !title.trim()) return;
    await withSync(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('topics')
        .insert({
          user_id: userId,
          profile_id: profileId,
          subject_id: subjectId,
          title: title.trim(),
          studied: false,
          is_priority: false,
          sort_order: topics.filter((t) => t.subject_id === subjectId).length,
        })
        .select('*')
        .single();
      if (data) setTopics((prev) => [...prev, data as Topic]);
    });
  };

  const addTopicsBatch = async (subjectId: string, titles: string[]) => {
    const clean = titles.map((t) => t.trim()).filter(Boolean);
    if (!userId || clean.length === 0) return;
    await withSync(async () => {
      const supabase = createClient();
      const baseOrder = topics.filter((t) => t.subject_id === subjectId).length;
      const { data } = await supabase
        .from('topics')
        .insert(
          clean.map((title, idx) => ({
            user_id: userId,
            profile_id: profileId,
            subject_id: subjectId,
            title,
            studied: false,
            is_priority: false,
            sort_order: baseOrder + idx,
          }))
        )
        .select('*');
      if (data && data.length > 0) {
        setTopics((prev) => [...prev, ...(data as Topic[])]);
        notify(
          data.length === 1
            ? 'Tópico adicionado!'
            : `${data.length} tópicos adicionados como checklist!`,
          'success'
        );
      }
    });
  };

  const toggleSubjectStudied = async (subjectId: string, markAll: boolean) => {
    const subTopics = topics.filter((t) => t.subject_id === subjectId);
    if (subTopics.length === 0) return;
    const studiedAt = markAll ? new Date().toISOString() : null;

    setTopics((prev) =>
      prev.map((t) =>
        t.subject_id === subjectId ? { ...t, studied: markAll, studied_at: studiedAt } : t
      )
    );

    await withSync(async () => {
      const supabase = createClient();
      await supabase
        .from('topics')
        .update({ studied: markAll, studied_at: studiedAt })
        .eq('subject_id', subjectId);

      if (markAll) {
        const base = todayISO();
        const intervals = [1, 7, 30, 90];
        const newReviewsPayload: {
          user_id: string;
          profile_id: string;
          subject_id: string;
          topic_id: string;
          interval_days: number;
          due_date: string;
          completed: boolean;
        }[] = [];

        subTopics.forEach((t) => {
          const hasRev = reviews.some((r) => r.topic_id === t.id);
          if (!hasRev) {
            intervals.forEach((days) => {
              newReviewsPayload.push({
                user_id: userId,
                profile_id: profileId,
                subject_id: subjectId,
                topic_id: t.id,
                interval_days: days,
                due_date: addDaysISO(base, days),
                completed: false,
              });
            });
          }
        });

        if (newReviewsPayload.length > 0) {
          const { data: createdRevs } = await supabase
            .from('spaced_reviews')
            .insert(newReviewsPayload)
            .select('*');
          if (createdRevs) {
            setReviews((prev) => [...prev, ...(createdRevs as SpacedReview[])]);
          }
        }
        notify('Todos os tópicos da matéria foram marcados como estudados!');
      } else {
        notify('Tópicos da matéria desmarcados.', 'info');
      }
    });
  };

  const toggleTopicStudied = async (topic: Topic) => {
    const nextStudied = !topic.studied;
    const studiedAt = nextStudied ? new Date().toISOString() : null;
    setTopics((prev) =>
      prev.map((t) =>
        t.id === topic.id ? { ...t, studied: nextStudied, studied_at: studiedAt } : t
      )
    );

    await withSync(async () => {
      const supabase = createClient();
      await supabase
        .from('topics')
        .update({ studied: nextStudied, studied_at: studiedAt })
        .eq('id', topic.id);

      if (nextStudied) {
        const base = todayISO();
        const intervals = [1, 7, 30, 90];
        const existingForTopic = reviews.filter((r) => r.topic_id === topic.id);
        if (existingForTopic.length === 0) {
          const { data: createdRevs } = await supabase
            .from('spaced_reviews')
            .insert(
              intervals.map((days) => ({
                user_id: userId,
                profile_id: profileId,
                subject_id: topic.subject_id,
                topic_id: topic.id,
                interval_days: days,
                due_date: addDaysISO(base, days),
                completed: false,
              }))
            )
            .select('*');
          if (createdRevs) {
            setReviews((prev) => [...prev, ...(createdRevs as SpacedReview[])]);
            notify('Tópico estudado! Revisões de 1, 7 e 30 dias agendadas.');
          }
        }
      }
    });
  };

  const toggleTopicPriority = async (topic: Topic) => {
    const next = !topic.is_priority;
    setTopics((prev) =>
      prev.map((t) => (t.id === topic.id ? { ...t, is_priority: next } : t))
    );
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('topics').update({ is_priority: next }).eq('id', topic.id);
    });
  };

  const updateTopicVideo = async (topicId: string, videoUrl: string | null) => {
    setTopics((prev) =>
      prev.map((t) => (t.id === topicId ? { ...t, video_url: videoUrl } : t))
    );
    await withSync(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from('topics')
        .update({ video_url: videoUrl })
        .eq('id', topicId);
      if (error) {
        console.error('Erro ao salvar video_url:', error.message);
        if (typeof window !== 'undefined' && error.message.includes('video_url')) {
          alert(
            'A coluna video_url ainda não foi criada no Supabase. Rode no SQL Editor: alter table public.topics add column if not exists video_url text;'
          );
        }
      }
    });
  };

  const deleteSubject = async (id: string) => {
    setSubjects((prev) => prev.filter((s) => s.id !== id));
    setTopics((prev) => prev.filter((t) => t.subject_id !== id));
    setReviews((prev) => prev.filter((r) => r.subject_id !== id));
    setFlashcards((prev) => prev.filter((c) => c.subject_id !== id));
    setErrors((prev) => prev.filter((e) => e.subject_id !== id));
    setStudyLogs((prev) => prev.filter((l) => l.subject_id !== id));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('subjects').delete().eq('id', id);
      notify('Matéria removida.', 'info');
    });
  };

  const updateTopicTitle = async (topicId: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    setTopics((prev) => prev.map((t) => (t.id === topicId ? { ...t, title: clean } : t)));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('topics').update({ title: clean }).eq('id', topicId);
      notify('Tópico atualizado!', 'success');
    });
  };

  const deleteTopic = async (topicId: string) => {
    setTopics((prev) => prev.filter((t) => t.id !== topicId));
    setReviews((prev) => prev.filter((r) => r.topic_id !== topicId));
    setHighlights((prev) => prev.filter((h) => h.topic_id !== topicId));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('topics').delete().eq('id', topicId);
      notify('Tópico removido.', 'info');
    });
  };

  const migrateAndDeleteTopics = async (topicIds: string[], targetTopicId: string | null) => {
    if (topicIds.length === 0) return;
    const idSet = new Set(topicIds);
    const sourceTopics = topics.filter((t) => idSet.has(t.id));
    const targetTopic = targetTopicId ? topics.find((t) => t.id === targetTopicId) : null;

    await withSync(async () => {
      const supabase = createClient();

      if (targetTopic) {
        // 1. Migrar grifos, flashcards e erros para o tópico de destino
        await Promise.all([
          supabase
            .from('topic_highlights')
            .update({ topic_id: targetTopic.id })
            .in('topic_id', topicIds),
          supabase
            .from('flashcards')
            .update({ topic_id: targetTopic.id, subject_id: targetTopic.subject_id })
            .in('topic_id', topicIds),
          supabase
            .from('error_entries')
            .update({ topic_id: targetTopic.id, subject_id: targetTopic.subject_id })
            .in('topic_id', topicIds),
        ]);

        // 2. Migrar PDF e Videoaula se o destino ainda não tiver
        const firstWithPdf = sourceTopics.find((t) => t.pdf_path);
        const firstWithVideo = sourceTopics.find((t) => t.video_url);
        const targetPatch: Partial<Topic> = {};
        if (!targetTopic.pdf_path && firstWithPdf?.pdf_path) {
          targetPatch.pdf_path = firstWithPdf.pdf_path;
          targetPatch.pdf_name = firstWithPdf.pdf_name;
        }
        if (!targetTopic.video_url && firstWithVideo?.video_url) {
          targetPatch.video_url = firstWithVideo.video_url;
        }
        if (Object.keys(targetPatch).length > 0) {
          await supabase.from('topics').update(targetPatch).eq('id', targetTopic.id);
        }
      }

      // 3. Excluir os tópicos de origem
      await supabase.from('topics').delete().in('id', topicIds);
      await refreshAll();
      notify(
        targetTopic
          ? `Materiais migrados para "${targetTopic.title}" e ${topicIds.length} tópico(s) removido(s)!`
          : `${topicIds.length} tópico(s) removido(s).`,
        'success'
      );
    });
  };

  const deleteSubjectsBatch = async (subjectIds: string[]) => {
    if (subjectIds.length === 0) return;
    const idSet = new Set(subjectIds);
    setSubjects((prev) => prev.filter((s) => !idSet.has(s.id)));
    setTopics((prev) => prev.filter((t) => !idSet.has(t.subject_id)));
    setReviews((prev) => prev.filter((r) => !idSet.has(r.subject_id)));
    setFlashcards((prev) => prev.filter((c) => !idSet.has(c.subject_id)));
    setErrors((prev) => prev.filter((e) => !idSet.has(e.subject_id)));
    setStudyLogs((prev) => prev.filter((l) => !idSet.has(l.subject_id)));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('subjects').delete().in('id', subjectIds);
      notify(
        subjectIds.length === 1
          ? 'Matéria removida.'
          : `${subjectIds.length} matérias removidas.`,
        'info'
      );
    });
  };

  const updateTopicPdf = async (topicId: string, pdfPath: string | null, pdfName: string | null) => {
    setTopics((prev) =>
      prev.map((t) => (t.id === topicId ? { ...t, pdf_path: pdfPath, pdf_name: pdfName } : t))
    );
    await withSync(async () => {
      const supabase = createClient();
      await supabase
        .from('topics')
        .update({ pdf_path: pdfPath, pdf_name: pdfName })
        .eq('id', topicId);
    });
  };

  const addHighlight = async (
    payload: Omit<TopicHighlight, 'id' | 'user_id' | 'profile_id' | 'created_at'>
  ) => {
    await withSync(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('topic_highlights')
        .insert({ ...payload, user_id: userId, profile_id: profileId })
        .select('*')
        .single();
      if (data) setHighlights((prev) => [data as TopicHighlight, ...prev]);
    });
  };

  const deleteHighlight = async (id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('topic_highlights').delete().eq('id', id);
    });
  };

  const addStudyLog = async (
    payload: Omit<StudyLog, 'id' | 'user_id' | 'profile_id' | 'created_at'>
  ) => {
    await withSync(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('study_logs')
        .insert({ ...payload, user_id: userId, profile_id: profileId })
        .select('*')
        .single();
      if (data) {
        setStudyLogs((prev) => [data as StudyLog, ...prev]);
        notify('Sessão salva na nuvem!');
      }
    });
  };

  const deleteStudyLog = async (id: string) => {
    setStudyLogs((prev) => prev.filter((l) => l.id !== id));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('study_logs').delete().eq('id', id);
    });
  };

  const completeReview = async (reviewId: string) => {
    const completedAt = new Date().toISOString();
    setReviews((prev) =>
      prev.map((r) => (r.id === reviewId ? { ...r, completed: true, completed_at: completedAt } : r))
    );
    await withSync(async () => {
      const supabase = createClient();
      await supabase
        .from('spaced_reviews')
        .update({ completed: true, completed_at: completedAt })
        .eq('id', reviewId);
      notify('Revisão concluída!', 'success', async () => {
        setReviews((prev) =>
          prev.map((r) => (r.id === reviewId ? { ...r, completed: false, completed_at: null } : r))
        );
        const sb = createClient();
        await sb
          .from('spaced_reviews')
          .update({ completed: false, completed_at: null })
          .eq('id', reviewId);
      });
    });
  };

  const postponeReview = async (reviewId: string, newDueDate: string) => {
    const prevRev = reviews.find((r) => r.id === reviewId);
    setReviews((prev) =>
      prev.map((r) => (r.id === reviewId ? { ...r, due_date: newDueDate } : r))
    );
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('spaced_reviews').update({ due_date: newDueDate }).eq('id', reviewId);
      notify(`Revisão adiada para ${newDueDate.split('-').reverse().join('/')}.`, 'info', async () => {
        if (!prevRev) return;
        setReviews((prev) =>
          prev.map((r) => (r.id === reviewId ? { ...r, due_date: prevRev.due_date } : r))
        );
        const sb = createClient();
        await sb
          .from('spaced_reviews')
          .update({ due_date: prevRev.due_date })
          .eq('id', reviewId);
      });
    });
  };

  const deleteReview = async (reviewId: string) => {
    const deleted = reviews.find((r) => r.id === reviewId);
    setReviews((prev) => prev.filter((r) => r.id !== reviewId));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('spaced_reviews').delete().eq('id', reviewId);
      if (deleted) {
        notify('Revisão excluída.', 'info', async () => {
          const sb = createClient();
          const { data } = await sb
            .from('spaced_reviews')
            .insert({
              user_id: userId,
              profile_id: profileId,
              subject_id: deleted.subject_id,
              topic_id: deleted.topic_id,
              interval_days: deleted.interval_days,
              due_date: deleted.due_date,
              completed: deleted.completed,
              completed_at: deleted.completed_at,
            })
            .select('*')
            .single();
          if (data) setReviews((prev) => [...prev, data as SpacedReview]);
        });
      }
    });
  };

  const addErrorEntry = async (
    payload: Omit<ErrorEntry, 'id' | 'user_id' | 'profile_id' | 'created_at'>
  ): Promise<ErrorEntry | null> => {
    return withSync(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('error_entries')
        .insert({ ...payload, user_id: userId, profile_id: profileId })
        .select('*')
        .single();
      if (data) {
        const entry = data as ErrorEntry;
        setErrors((prev) => [entry, ...prev]);
        return entry;
      }
      return null;
    });
  };

  const updateErrorEntry = async (id: string, patch: Partial<ErrorEntry>) => {
    setErrors((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('error_entries').update(patch).eq('id', id);
    });
  };

  const deleteErrorEntry = async (id: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('error_entries').delete().eq('id', id);
    });
  };

  const addSimulado = async (
    payload: Omit<Simulado, 'id' | 'user_id' | 'profile_id' | 'created_at'>
  ) => {
    await withSync(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('simulados')
        .insert({ ...payload, user_id: userId, profile_id: profileId })
        .select('*')
        .single();
      if (data) setSimulados((prev) => [data as Simulado, ...prev]);
    });
  };

  const deleteSimulado = async (id: string) => {
    setSimulados((prev) => prev.filter((s) => s.id !== id));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('simulados').delete().eq('id', id);
    });
  };

  const addAIReport = async (
    payload: Omit<AIReport, 'id' | 'user_id' | 'profile_id' | 'created_at'>
  ) => {
    await withSync(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('ai_reports')
        .insert({ ...payload, user_id: userId, profile_id: profileId })
        .select('*')
        .single();
      if (data) setReports((prev) => [data as AIReport, ...prev]);
    });
  };


  const addFlashcards = async (
    items: { subject_id: string; topic_id: string | null; front: string; back: string }[]
  ) => {
    if (!userId || items.length === 0) return;
    await withSync(async () => {
      const supabase = createClient();
      const today = todayISO();
      const { data } = await supabase
        .from('flashcards')
        .insert(
          items.map((it) => ({
            user_id: userId,
            profile_id: profileId,
            subject_id: it.subject_id,
            topic_id: it.topic_id,
            front: it.front.trim(),
            back: it.back.trim(),
            ease_factor: 2.5,
            interval_days: 0,
            repetitions: 0,
            due_date: today,
          }))
        )
        .select('*');
      if (data) setFlashcards((prev) => [...(data as Flashcard[]), ...prev]);
    });
  };

  // SM-2 Spaced Repetition: 1=Errei, 2=Difícil, 3=Bom, 4=Fácil
  const reviewFlashcard = async (card: Flashcard, quality: 1 | 2 | 3 | 4) => {
    let reps = card.repetitions;
    let interval = card.interval_days;
    let ease = Number(card.ease_factor) || 2.5;

    if (quality === 1) {
      reps = 0;
      interval = 1;
      ease = Math.max(1.3, ease - 0.2);
    } else if (quality === 2) {
      reps = reps + 1;
      interval = reps === 1 ? 1 : Math.max(2, Math.round(interval * 1.2));
      ease = Math.max(1.3, ease - 0.1);
    } else if (quality === 3) {
      reps = reps + 1;
      interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ease);
    } else {
      reps = reps + 1;
      interval = reps === 1 ? 3 : reps === 2 ? 8 : Math.round(interval * ease * 1.3);
      ease = Math.min(3.0, ease + 0.15);
    }

    const nextDue = addDaysISO(todayISO(), interval);
    const nowIso = new Date().toISOString();
    const patch = {
      repetitions: reps,
      interval_days: interval,
      ease_factor: Number(ease.toFixed(2)),
      due_date: nextDue,
      last_reviewed_at: nowIso,
    };

    setFlashcards((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...patch } : c)));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('flashcards').update(patch).eq('id', card.id);
      notify(quality === 1 ? 'Card voltará nesta sessão para fixação.' : `Ótimo! Card agendado para daqui a ${interval} dia(s).`);
    });
  };

  const deleteFlashcard = async (id: string) => {
    const deleted = flashcards.find((c) => c.id === id);
    setFlashcards((prev) => prev.filter((c) => c.id !== id));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('flashcards').delete().eq('id', id);
      if (deleted) {
        notify('Flashcard excluído.', 'info', async () => {
          await addFlashcards([
            {
              subject_id: deleted.subject_id,
              topic_id: deleted.topic_id,
              front: deleted.front,
              back: deleted.back,
            },
          ]);
        });
      }
    });
  };

  // Pontos de restauração automáticos a cada 1 hora (mantém últimos 7 dias)
  const backupDataRef = useRef({
    userId,
    profile,
    subjects,
    topics,
    highlights,
    studyLogs,
    reviews,
    errors,
    flashcards,
    simulados,
    reports,
    loading,
  });
  backupDataRef.current = {
    userId,
    profile,
    subjects,
    topics,
    highlights,
    studyLogs,
    reviews,
    errors,
    flashcards,
    simulados,
    reports,
    loading,
  };
  const autoBackupInFlightRef = useRef(false);

  useEffect(() => {
    if (loading || !profile?.id || !userId) return;

    const tryAutoBackup = async () => {
      const snap = backupDataRef.current;
      if (snap.loading || !snap.profile || !snap.userId) return;
      if (autoBackupInFlightRef.current) return;
      const hasData =
        snap.subjects.length > 0 ||
        snap.topics.length > 0 ||
        snap.studyLogs.length > 0 ||
        snap.flashcards.length > 0 ||
        snap.errors.length > 0 ||
        snap.simulados.length > 0;
      if (!hasData) return;
      if (!shouldRunAutoBackup(snap.profile.id)) return;

      autoBackupInFlightRef.current = true;
      try {
        await createRestorePoint({
          userId: snap.userId,
          profile: snap.profile,
          subjects: snap.subjects,
          topics: snap.topics,
          highlights: snap.highlights,
          studyLogs: snap.studyLogs,
          reviews: snap.reviews,
          errors: snap.errors,
          flashcards: snap.flashcards,
          simulados: snap.simulados,
          reports: snap.reports,
          reason: 'auto',
          label: 'Automático (horário)',
        });
      } catch {
        // silencioso — tenta novamente no próximo ciclo
      } finally {
        autoBackupInFlightRef.current = false;
      }
    };

    const initialTimer = window.setTimeout(() => {
      void tryAutoBackup();
    }, 4000);

    const interval = window.setInterval(() => {
      void tryAutoBackup();
    }, 15 * 60 * 1000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [loading, profile?.id, userId]);

  return (
    <ProfileContext.Provider
      value={{
        loading,
        syncing,
        userId,
        userEmail,
        profile,
        subjects,
        topics,
        highlights,
        studyLogs,
        reviews,
        errors,
        flashcards,
        simulados,
        reports,
        theme,
        setTheme,
        refreshAll,
        stopwatch,
        startStopwatch,
        pauseStopwatch,
        resetStopwatch,
        setStopwatchNote,
        updateProfile,
        addSubject,
        updateSubject,
        deleteSubject,
        reorderSubject,
        moveSubject,
        setSubjectOrder,
        addTopic,
        addTopicsBatch,
        updateTopicTitle,
        deleteTopic,
        migrateAndDeleteTopics,
        deleteSubjectsBatch,
        toggleTopicStudied,
        toggleSubjectStudied,
        toggleTopicPriority,
        updateTopicPdf,
        updateTopicVideo,
        addHighlight,
        deleteHighlight,
        addStudyLog,
        deleteStudyLog,
        completeReview,
        postponeReview,
        deleteReview,
        addErrorEntry,
        updateErrorEntry,
        deleteErrorEntry,
        addSimulado,
        deleteSimulado,
        addAIReport,
        addFlashcards,
        reviewFlashcard,
        deleteFlashcard,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile deve ser usado dentro de ProfileProvider');
  return ctx;
}
