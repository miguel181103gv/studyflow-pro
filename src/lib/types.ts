export type ThemeId = 'clean' | 'sepia' | 'obsidian' | 'navy';

export interface Profile {
  id: string;
  user_id: string;
  slug: string | null;
  name: string;
  role_title: string;
  icon: string;
  color: string;
  salary_base: string;
  vale_alimentacao: string;
  workload: string;
  extras: string;
  status_text: string;
  exam_date: string | null;
  daily_hours_goal: number;
  target_accuracy: number;
  sort_order: number;
  created_at: string;
}

export interface Subject {
  id: string;
  user_id: string;
  profile_id: string;
  name: string;
  category: string;
  color: string;
  cycle_hours: number;
  cycle_minutes: number;
  cycle_order: number;
  created_at: string;
}

export interface Topic {
  id: string;
  user_id: string;
  profile_id: string;
  subject_id: string;
  title: string;
  studied: boolean;
  is_priority: boolean;
  studied_at: string | null;
  pdf_path: string | null;
  pdf_name: string | null;
  video_url?: string | null;
  sort_order: number;
  created_at: string;
}

export interface TopicHighlight {
  id: string;
  user_id: string;
  profile_id: string;
  topic_id: string;
  text: string;
  color: string;
  note: string;
  page_number: number;
  created_at: string;
}

export interface StudyLog {
  id: string;
  user_id: string;
  profile_id: string;
  subject_id: string;
  topic_id: string | null;
  duration_seconds: number;
  study_date: string;
  period: string;
  method: string;
  questions_total: number;
  questions_correct: number;
  stop_point: string;
  notes: string;
  created_at: string;
}

export interface SpacedReview {
  id: string;
  user_id: string;
  profile_id: string;
  subject_id: string;
  topic_id: string;
  interval_days: number;
  due_date: string;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
}

export interface ErrorEntry {
  id: string;
  user_id: string;
  profile_id: string;
  subject_id: string;
  topic_id: string | null;
  question_text: string;
  image_path: string | null;
  user_answer: string;
  correct_answer: string;
  error_cause: string;
  explanation: string;
  golden_rule: string;
  review_count: number;
  last_reviewed_at: string | null;
  next_review_date: string;
  created_at: string;
}

export interface SimuladoSubjectScore {
  subject_id: string;
  subject_name: string;
  total: number;
  correct: number;
  weight?: number;
}

export interface Simulado {
  id: string;
  user_id: string;
  profile_id: string;
  title: string;
  exam_date: string;
  board: string;
  total_questions: number;
  correct_answers: number;
  duration_minutes: number;
  notes: string;
  subject_scores: SimuladoSubjectScore[];
  created_at: string;
}

export interface AIReport {
  id: string;
  user_id: string;
  profile_id: string;
  period_type: 'Semanal' | 'Mensal' | 'Anual';
  period_label: string;
  content_markdown: string;
  metrics_snapshot: Record<string, unknown>;
  created_at: string;
}

export interface Flashcard {
  id: string;
  user_id: string;
  profile_id: string;
  subject_id: string;
  topic_id: string | null;
  front: string;
  back: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_date: string;
  last_reviewed_at: string | null;
  created_at: string;
}
