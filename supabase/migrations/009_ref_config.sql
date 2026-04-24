-- Reference config: synced settings (tags, feature flags)
-- pushed by the desktop app, read by the PWA.
create table if not exists ref_config (
  user_id uuid primary key references auth.users(id)
    on delete cascade,
  config  jsonb not null default '{}',
  updated_at timestamptz not null
    default now()
);

alter table ref_config
  enable row level security;

create policy "Users read own config"
  on ref_config for select
  using (auth.uid() = user_id);

create policy "Users write own config"
  on ref_config for all
  using (auth.uid() = user_id);
