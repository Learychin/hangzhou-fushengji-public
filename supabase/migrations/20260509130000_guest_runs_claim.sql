create table if not exists public.guest_runs (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null,
  nickname text not null,
  device_fingerprint text,
  claim_token text not null unique,
  claimed_user_id uuid references auth.users(id) on delete set null,
  score integer not null,
  cash integer not null,
  bank integer not null,
  debt integer not null,
  health integer not null,
  fame integer not null,
  coat integer not null,
  days_used integer not null,
  ended_reason text not null default 'completed',
  final_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint guest_runs_nickname_len check (char_length(nickname) between 1 and 24)
);

alter table public.guest_runs enable row level security;

grant select, insert on public.guest_runs to anon, authenticated;

create policy "Guest runs are publicly readable"
  on public.guest_runs for select
  using (true);

create policy "Anonymous users can submit guest runs"
  on public.guest_runs for insert
  with check (true);

create or replace function public.claim_guest_runs(p_claim_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.guest_runs
  set claimed_user_id = v_uid
  where claim_token = p_claim_token
    and claimed_user_id is null;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.claim_guest_runs(text) to authenticated;

create or replace function public.claim_guest_runs_by_guest_id(p_guest_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.guest_runs
  set claimed_user_id = v_uid
  where guest_id = p_guest_id
    and claimed_user_id is null;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.claim_guest_runs_by_guest_id(text) to authenticated;

create index if not exists guest_runs_score_created_idx
  on public.guest_runs (score desc, created_at asc);

create index if not exists guest_runs_guest_id_created_idx
  on public.guest_runs (guest_id, created_at desc);

create or replace view public.leaderboard as
select
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
  gr.created_at,
  'account'::text as entry_type,
  null::text as claim_token
from public.game_runs gr
left join public.profiles p on p.id = gr.user_id

union all

select
  g.claimed_user_id as user_id,
  g.nickname as display_name,
  null::text as avatar_url,
  g.id as run_id,
  g.score,
  g.cash,
  g.bank,
  g.debt,
  g.health,
  g.days_used,
  g.created_at,
  'guest'::text as entry_type,
  g.claim_token
from public.guest_runs g

order by score desc, created_at asc;

grant select on public.leaderboard to anon, authenticated;
