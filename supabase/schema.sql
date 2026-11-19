-- StudyFlow Concursos - Schema Completo Supabase (PostgreSQL + RLS + Storage)
-- Cole este arquivo inteiro no SQL Editor do seu projeto Supabase e clique em "Run".

create extension if not exists "uuid-ossp";

-- 1. Perfis de Concurso (ex: TRT-MG, Área Bancária, ou novos criados via PDF)
create table if not exists public.profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text,
  name text not null,
  role_title text not null default '',
  icon text not null default '⚖️',
  color text not null default '#2563eb',
  salary_base text not null default '',
  vale_alimentacao text not null default '',
  workload text not null default '',
  extras text not null default '',
  status_text text not null default '',
  exam_date date,
  daily_hours_goal numeric(4,2) not null default 4.0,
  target_accuracy integer not null default 80,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 2. Matérias / Disciplinas
create table if not exists public.subjects (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  category text not null default 'Conhecimentos Específicos',
  color text not null default '#2563eb',
  cycle_hours integer not null default 1,
  cycle_minutes integer not null default 30,
  cycle_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 3. Tópicos do Edital Verticalizado
create table if not exists public.topics (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  studied boolean not null default false,
  is_priority boolean not null default false,
  studied_at timestamptz,
  pdf_path text,
  pdf_name text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 4. Grifos e Anotações em PDFs / Tópicos
create table if not exists public.topic_highlights (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  text text not null,
  color text not null default '#fef08a',
  note text not null default '',
  page_number integer not null default 1,
  created_at timestamptz not null default now()
);

-- 5. Registros de Estudo e Questões (Ciclo + Sessões + Lançamento Rápido)
create table if not exists public.study_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  duration_seconds integer not null default 0,
  study_date date not null default current_date,
  period text not null default 'Manhã',
  method text not null default 'PDF + Questões',
  questions_total integer not null default 0,
  questions_correct integer not null default 0,
  stop_point text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- 6. Agenda de Revisões Espaçadas (1, 7, 30 dias)
create table if not exists public.spaced_reviews (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  interval_days integer not null default 1,
  due_date date not null,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- 7. Caderno de Erros
create table if not exists public.error_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  question_text text not null default '',
  image_path text,
  user_answer text not null default '',
  correct_answer text not null default '',
  error_cause text not null default 'Lacuna teórica',
  explanation text not null default '',
  golden_rule text not null default '',
  review_count integer not null default 0,
  last_reviewed_at timestamptz,
  next_review_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- 8. Simulados
create table if not exists public.simulados (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  exam_date date not null default current_date,
  board text not null default '',
  total_questions integer not null default 60,
  correct_answers integer not null default 0,
  duration_minutes integer not null default 240,
  notes text not null default '',
  subject_scores jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 9. Relatórios do Mentor Gemini AI
create table if not exists public.ai_reports (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  period_type text not null default 'Semanal',
  period_label text not null default '',
  content_markdown text not null,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 10. Configurações Globais do Usuário
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'clean',
  updated_at timestamptz not null default now()
);

-- Índices para performance
create index if not exists idx_profiles_user on public.profiles(user_id);
create index if not exists idx_subjects_profile on public.subjects(profile_id);
create index if not exists idx_topics_subject on public.topics(subject_id);
create index if not exists idx_study_logs_profile_date on public.study_logs(profile_id, study_date desc);
create index if not exists idx_reviews_profile_due on public.spaced_reviews(profile_id, due_date);
create index if not exists idx_errors_profile on public.error_entries(profile_id, created_at desc);

-- Ativar Row Level Security (RLS) em todas as tabelas
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.topics enable row level security;
alter table public.topic_highlights enable row level security;
alter table public.study_logs enable row level security;
alter table public.spaced_reviews enable row level security;
alter table public.error_entries enable row level security;
alter table public.simulados enable row level security;
alter table public.ai_reports enable row level security;
alter table public.user_settings enable row level security;

-- Políticas RLS: cada usuário acessa apenas os próprios dados
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'profiles','subjects','topics','topic_highlights',
    'study_logs','spaced_reviews','error_entries','simulados',
    'ai_reports','user_settings'
  ])
  loop
    execute format('drop policy if exists "own_data_select" on public.%I', t);
    execute format('create policy "own_data_select" on public.%I for select using (auth.uid() = user_id)', t);
    execute format('drop policy if exists "own_data_insert" on public.%I', t);
    execute format('create policy "own_data_insert" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format('drop policy if exists "own_data_update" on public.%I', t);
    execute format('create policy "own_data_update" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('drop policy if exists "own_data_delete" on public.%I', t);
    execute format('create policy "own_data_delete" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- Bucket de Storage para PDFs de matérias e Prints do Caderno de Erros
insert into storage.buckets (id, name, public)
values ('study-assets', 'study-assets', false)
on conflict (id) do nothing;

drop policy if exists "study_assets_select" on storage.objects;
create policy "study_assets_select" on storage.objects
  for select using (bucket_id = 'study-assets' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "study_assets_insert" on storage.objects;
create policy "study_assets_insert" on storage.objects
  for insert with check (bucket_id = 'study-assets' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "study_assets_delete" on storage.objects;
create policy "study_assets_delete" on storage.objects
  for delete using (bucket_id = 'study-assets' and auth.uid()::text = (storage.foldername(name))[1]);
