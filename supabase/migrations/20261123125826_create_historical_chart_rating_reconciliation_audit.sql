create schema if not exists private;

create table private.historical_chart_rating_reconciliation_audit (
  id bigint generated always as identity primary key,
  operation_key text not null,
  chart_entry_id bigint not null
    references public.quick_rate_collection_tracks(id) on delete restrict,
  source_entry_key text not null,
  user_id uuid not null,
  source_canonical_song_id uuid not null
    references public.canonical_recordings(id) on delete restrict,
  target_canonical_song_id uuid not null
    references public.canonical_recordings(id) on delete restrict,
  source_rating numeric not null check (source_rating between 0 and 10),
  source_song_rating_rows integer not null check (source_song_rating_rows >= 0),
  source_historical_rating_rows integer not null check (source_historical_rating_rows >= 0),
  source_kinds text[] not null,
  reconciliation_status text not null
    check (reconciliation_status in ('copied', 'already_equal')),
  -- Evidence only: do not foreign-key this ID back to song_ratings. Users must
  -- remain able to update or clear the visible target rating after reconciliation.
  target_song_rating_id bigint not null,
  reconciled_at timestamptz not null default timezone('utc', now()),
  constraint historical_chart_rating_reconciliation_audit_source_rows_check
    check (source_song_rating_rows + source_historical_rating_rows > 0),
  constraint historical_chart_rating_reconciliation_audit_operation_user_key
    unique (operation_key, chart_entry_id, user_id)
);

create index historical_chart_rating_reconciliation_audit_target_idx
  on private.historical_chart_rating_reconciliation_audit
  (target_canonical_song_id, user_id);

alter table private.historical_chart_rating_reconciliation_audit enable row level security;

revoke all on table private.historical_chart_rating_reconciliation_audit
  from public, anon, authenticated;
revoke all on sequence private.historical_chart_rating_reconciliation_audit_id_seq
  from public, anon, authenticated;

grant usage on schema private to service_role;
grant select, insert on table private.historical_chart_rating_reconciliation_audit
  to service_role;
grant usage, select on sequence private.historical_chart_rating_reconciliation_audit_id_seq
  to service_role;

comment on table private.historical_chart_rating_reconciliation_audit is
  'Immutable evidence for approval-gated historical chart rating reconciliation. Source ratings remain in place for rollback.';
