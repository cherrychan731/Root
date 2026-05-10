-- DSE question bank schema for Google Sheets -> Supabase sync.
-- Apply this in Supabase SQL Editor after your project is active.

create table if not exists public.dse_texts (
  text_code text primary key,
  display_order integer,
  title text not null,
  author text,
  short_author text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.dse_questions (
  question_code text primary key,
  text_code text not null references public.dse_texts(text_code) on update cascade,
  question text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  answer text not null,
  explanation text,
  dse_year integer,
  name_tag text,
  skill text,
  -- Kept for backwards compatibility with existing projects. The app no longer
  -- uses per-question difficulty; practice modes decide how many random
  -- questions to draw.
  difficulty text not null default 'normal'
    check (difficulty in ('easy', 'normal', 'master', 'hell')),
  source text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint dse_questions_answer_matches_option_a check (answer = option_a)
);

create index if not exists dse_questions_text_code_idx
  on public.dse_questions (text_code);

create index if not exists dse_questions_active_difficulty_idx
  on public.dse_questions (active, difficulty);

create index if not exists dse_questions_dse_year_idx
  on public.dse_questions (dse_year);

alter table public.dse_texts enable row level security;
alter table public.dse_questions enable row level security;

drop policy if exists "Anyone can read active DSE texts" on public.dse_texts;
create policy "Anyone can read active DSE texts"
on public.dse_texts
for select
to anon, authenticated
using (active = true);

drop policy if exists "Anyone can read active DSE questions" on public.dse_questions;
create policy "Anyone can read active DSE questions"
on public.dse_questions
for select
to anon, authenticated
using (active = true);

grant select on public.dse_texts to anon, authenticated;
grant select on public.dse_questions to anon, authenticated;

comment on column public.dse_questions.answer is
  'Mirrors option_a. In Google Sheets, option_a is always the correct answer; the website shuffles options for students.';

create table if not exists public.dse_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  nickname text,
  full_name text,
  dse_year text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dse_practice_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  text_code text,
  text_title text,
  -- Stores the selected practice mode: easy=10, normal=20, master=25, hell=all.
  difficulty text not null,
  total_questions integer not null default 0,
  first_correct integer not null default 0,
  retries integer not null default 0,
  score integer not null default 0,
  accuracy numeric(5,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.dse_practice_answers (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.dse_practice_rounds(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  question_code text not null references public.dse_questions(question_code) on update cascade,
  text_code text,
  text_title text,
  -- Stores the selected practice mode, not the original question difficulty.
  difficulty text,
  skill text,
  selected_answer text not null,
  correct_answer text not null,
  is_correct boolean not null,
  attempt_number integer not null default 1,
  created_at timestamptz not null default now()
);

alter table public.dse_profiles enable row level security;
alter table public.dse_practice_rounds enable row level security;
alter table public.dse_practice_answers enable row level security;

drop policy if exists "Users can read own DSE profile" on public.dse_profiles;
create policy "Users can read own DSE profile"
on public.dse_profiles for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can upsert own DSE profile" on public.dse_profiles;
create policy "Users can upsert own DSE profile"
on public.dse_profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own DSE profile" on public.dse_profiles;
create policy "Users can update own DSE profile"
on public.dse_profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read own practice rounds" on public.dse_practice_rounds;
create policy "Users can read own practice rounds"
on public.dse_practice_rounds for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own practice rounds" on public.dse_practice_rounds;
create policy "Users can create own practice rounds"
on public.dse_practice_rounds for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read own practice answers" on public.dse_practice_answers;
create policy "Users can read own practice answers"
on public.dse_practice_answers for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own practice answers" on public.dse_practice_answers;
create policy "Users can create own practice answers"
on public.dse_practice_answers for insert
to authenticated
with check ((select auth.uid()) = user_id);

revoke all on public.dse_profiles from anon;
revoke all on public.dse_practice_rounds from anon;
revoke all on public.dse_practice_answers from anon;

grant select, insert, update on public.dse_profiles to authenticated;
grant select, insert on public.dse_practice_rounds to authenticated;
grant select, insert on public.dse_practice_answers to authenticated;

create index if not exists idx_dse_practice_answers_user_created
  on public.dse_practice_answers (user_id, created_at desc);

create index if not exists idx_dse_practice_answers_user_skill
  on public.dse_practice_answers (user_id, skill);

create table if not exists public.dse_leaderboard_entries (
  round_id uuid primary key references public.dse_practice_rounds(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  nickname text not null,
  dse_year text,
  text_code text,
  text_title text not null,
  difficulty text not null check (difficulty in ('easy','normal','master','hell')),
  total_questions integer not null,
  first_correct integer not null,
  retries integer not null,
  score integer not null,
  accuracy numeric(5,2) not null,
  created_at timestamptz not null
);

alter table public.dse_leaderboard_entries enable row level security;

drop policy if exists "Anyone can read DSE leaderboard" on public.dse_leaderboard_entries;
create policy "Anyone can read DSE leaderboard"
on public.dse_leaderboard_entries
for select
to anon, authenticated
using (true);

revoke all on public.dse_leaderboard_entries from anon, authenticated;
grant select (
  nickname,
  dse_year,
  text_code,
  text_title,
  difficulty,
  total_questions,
  first_correct,
  retries,
  score,
  accuracy,
  created_at
) on public.dse_leaderboard_entries to anon, authenticated;

create schema if not exists private;

create or replace function private.sync_dse_leaderboard_entry()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.dse_leaderboard_entries (
    round_id, user_id, nickname, dse_year, text_code, text_title, difficulty,
    total_questions, first_correct, retries, score, accuracy, created_at
  )
  select
    new.id,
    new.user_id,
    coalesce(nullif(p.nickname, ''), nullif(p.username, ''), '同學'),
    p.dse_year,
    new.text_code,
    new.text_title,
    new.difficulty,
    new.total_questions,
    new.first_correct,
    new.retries,
    new.score,
    new.accuracy,
    new.created_at
  from public.dse_profiles p
  where p.user_id = new.user_id
  on conflict (round_id) do update set
    nickname = excluded.nickname,
    dse_year = excluded.dse_year,
    text_code = excluded.text_code,
    text_title = excluded.text_title,
    difficulty = excluded.difficulty,
    total_questions = excluded.total_questions,
    first_correct = excluded.first_correct,
    retries = excluded.retries,
    score = excluded.score,
    accuracy = excluded.accuracy,
    created_at = excluded.created_at;

  return new;
end;
$$;

drop trigger if exists trg_sync_dse_leaderboard_entry on public.dse_practice_rounds;
create trigger trg_sync_dse_leaderboard_entry
after insert or update on public.dse_practice_rounds
for each row execute function private.sync_dse_leaderboard_entry();

create or replace function private.refresh_dse_leaderboard_profile()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update public.dse_leaderboard_entries
  set
    nickname = coalesce(nullif(new.nickname, ''), nullif(new.username, ''), '同學'),
    dse_year = new.dse_year
  where user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists trg_refresh_dse_leaderboard_profile on public.dse_profiles;
create trigger trg_refresh_dse_leaderboard_profile
after update of username, nickname, dse_year on public.dse_profiles
for each row execute function private.refresh_dse_leaderboard_profile();

create index if not exists idx_dse_leaderboard_score on public.dse_leaderboard_entries (score desc, accuracy desc, created_at asc);
create index if not exists idx_dse_leaderboard_difficulty_score on public.dse_leaderboard_entries (difficulty, score desc, accuracy desc);
create index if not exists idx_dse_leaderboard_user on public.dse_leaderboard_entries (user_id);

-- Apps Script should sync with the Supabase service_role key.
-- Never put the service_role key in index.html or any browser code.

