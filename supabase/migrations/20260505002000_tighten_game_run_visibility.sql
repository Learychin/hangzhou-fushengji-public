drop policy if exists "Leaderboard runs are publicly readable" on public.game_runs;
drop policy if exists "Users can view their own runs" on public.game_runs;

revoke select on public.game_runs from anon;
grant select on public.game_runs to authenticated;

create policy "Users can view their own runs"
  on public.game_runs for select
  using (auth.uid() = user_id);
