begin;

create table public.automated_album_import_runs (
  id uuid primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running','complete','incomplete','paused','dry_run','failed')),
  reason text,
  target_albums integer not null check (target_albums between 1 and 200),
  albums_imported integer not null default 0 check (albums_imported >= 0),
  invocation_count integer not null default 0 check (invocation_count >= 0),
  database_size_bytes bigint,
  warning_emitted boolean not null default false,
  dry_run boolean not null default false
);

alter table public.automated_album_import_runs enable row level security;
revoke all on public.automated_album_import_runs from public, anon, authenticated;
grant select, insert, update on public.automated_album_import_runs to service_role;

commit;
