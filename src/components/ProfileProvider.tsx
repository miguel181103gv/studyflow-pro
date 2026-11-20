'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
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

interface StopwatchState {
  running: boolean;
  subjectId: string | null;
  topicId: string | null;
  elapsedSeconds: number;
  startedAt: number | null;
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

  // Actions (all auto-sync to Supabase)
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  addSubject: (name: string, category?: string) => Promise<Subject | null>;
  updateSubject: (id: string, patch: Partial<Subject>) => Promise<void>;
  reorderSubject: (id: string, direction: 'up' | 'down') => Promise<void>;
  moveSubject: (sourceId: string, targetId: string) => Promise<void>;
  addTopic: (subjectId: string, title: string) => Promise<void>;
  toggleTopicStudied: (topic: Topic) => Promise<void>;
  toggleTopicPriority: (topic: Topic) => Promise<void>;
  updateTopicPdf: (topicId: string, pdfPath: string, pdfName: string) => Promise<void>;
  updateTopicVideo: (topicId: string, videoUrl: string | null) => Promise<void>;
  addHighlight: (payload: Omit<TopicHighlight, 'id' | 'user_id' | 'profile_id' | 'created_at'>) => Promise<void>;
  deleteHighlight: (id: string) => Promise<void>;

  addStudyLog: (
    payload: Omit<StudyLog, 'id' | 'user_id' | 'profile_id' | 'created_at'>
  ) => Promise<void>;
  deleteStudyLog: (id: string) => Promise<void>;

  completeReview: (reviewId: string) => Promise<void>;
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
    startedAt: null,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(swStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as StopwatchState;
      if (saved.running && saved.startedAt) {
        const extra = Math.max(0, Math.floor((Date.now() - saved.startedAt) / 1000));
        setStopwatch({
          ...saved,
          elapsedSeconds: saved.elapsedSeconds + extra,
          startedAt: Date.now(),
        });
      } else if (saved.subjectId) {
        setStopwatch(saved);
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
    const timer = setInterval(() => {
      setStopwatch((prev) => {
        if (!prev.running || !prev.startedAt) return prev;
        return { ...prev, elapsedSeconds: prev.elapsedSeconds + 1, startedAt: Date.now() };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [stopwatch.running]);

  const startStopwatch = (subjectId: string, topicId: string | null = null) => {
    setStopwatch((prev) => ({
      running: true,
      subjectId,
      topicId: topicId ?? prev.topicId,
      elapsedSeconds: prev.subjectId === subjectId ? prev.elapsedSeconds : 0,
      startedAt: Date.now(),
    }));
  };

  const pauseStopwatch = () => {
    setStopwatch((prev) => ({ ...prev, running: false, startedAt: null }));
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

  const addSubject = async (name: string, category = 'Personalizada'): Promise<Subject | null> => {
    if (!userId || !name.trim()) return null;
    return withSync(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('subjects')
        .insert({
          user_id: userId,
          profile_id: profileId,
          name: name.trim(),
          category,
          color: SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length],
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
        const intervals = [1, 7, 30];
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

  const updateTopicPdf = async (topicId: string, pdfPath: string, pdfName: string) => {
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
      notify('Revisão concluída! Progresso atualizado no Edital.');
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
    setFlashcards((prev) => prev.filter((c) => c.id !== id));
    await withSync(async () => {
      const supabase = createClient();
      await supabase.from('flashcards').delete().eq('id', id);
    });
  };

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
        updateProfile,
        addSubject,
        updateSubject,
        reorderSubject,
        moveSubject,
        addTopic,
        toggleTopicStudied,
        toggleTopicPriority,
        updateTopicPdf,
        updateTopicVideo,
        addHighlight,
        deleteHighlight,
        addStudyLog,
        deleteStudyLog,
        completeReview,
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
