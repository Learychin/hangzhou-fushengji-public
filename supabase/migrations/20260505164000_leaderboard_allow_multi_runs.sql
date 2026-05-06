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
  gr.created_at
from public.game_runs gr
left join public.profiles p on p.id = gr.user_id
order by gr.score desc, gr.created_at asc;
