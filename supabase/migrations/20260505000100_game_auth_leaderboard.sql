create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  score integer not null,
  cash integer not null,
  bank integer not null,
  debt integer not null,
  health integer not null,
  fame integer not null,
  coat integer not null,
  days_used integer not null,
  ended_reason text not null default 'completed',
  final_state jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.game_runs enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select on public.game_runs to authenticated;
grant insert on public.game_runs to authenticated;

create policy "Profiles are publicly readable"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can insert their own runs"
  on public.game_runs for insert
  with check (auth.uid() = user_id);

create policy "Users can view their own runs"
  on public.game_runs for select
  using (auth.uid() = user_id);

create or replace view public.leaderboard as
select distinct on (gr.user_id)
  gr.user_id,
  coalesce(p.display_name, '匿名玩家') as display_name,
  p.avatar_url,
  gr.id as run_id,
  gr.score,
  gr.cash,
  gr.bank,
  gr.debt,
  gr.health,
  gr.days_used,
  gr.created_at
from public.game_runs gr
left join public.profiles p on p.id = gr.user_id
order by gr.user_id, gr.score desc, gr.created_at asc;

grant select on public.leaderboard to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end;
$$;
