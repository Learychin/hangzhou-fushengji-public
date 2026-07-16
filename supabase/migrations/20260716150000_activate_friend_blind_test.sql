-- Start the first hidden five-way friend playtest with equal allocation.

update public.gameplay_experiments
set status = 'paused', updated_at = now()
where city_key = 'hangzhou'
  and status = 'active'
  and experiment_key not in (
    'control_current',
    'clue_balanced',
    'small_goods_comeback',
    'high_risk_black_horse',
    'news_story_storm'
  );

update public.gameplay_experiments
set status = 'active', allocation_weight = 100, updated_at = now()
where city_key = 'hangzhou'
  and experiment_key in (
    'control_current',
    'clue_balanced',
    'small_goods_comeback',
    'high_risk_black_horse',
    'news_story_storm'
  );

-- Campaign delivery stays out of the first gameplay test so it cannot bias feedback.
update public.campaigns
set status = 'draft', updated_at = now()
where status = 'active';
