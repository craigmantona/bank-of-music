create schema if not exists private;

create table private.historical_chart_reconciliation_operation_audit (
  id bigint generated always as identity primary key,
  operation_key text not null,
  event_kind text not null check (event_kind in ('apply', 'rollback')),
  manifest_sha256 text not null
    check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  chart_entry_id bigint not null
    references public.quick_rate_collection_tracks(id) on delete restrict,
  source_entry_key text not null,
  action text not null
    check (action in ('link_existing', 'import_verified')),
  placeholder_canonical_song_id uuid not null
    references public.canonical_recordings(id) on delete restrict,
  target_canonical_song_id uuid not null
    references public.canonical_recordings(id) on delete restrict,
  -- Evidence-only identifiers deliberately have no foreign keys. A guarded
  -- rollback may remove an imported song and album while retaining this row.
  target_song_id bigint,
  target_album_id bigint,
  musicbrainz_recording_id text not null,
  musicbrainz_release_id text not null,
  musicbrainz_release_group_id text not null,
  evidence_sha256 text not null
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  before_state jsonb not null,
  after_state jsonb not null,
  recorded_at timestamptz not null default timezone('utc', now()),
  constraint historical_chart_reconciliation_operation_event_key
    unique (operation_key, event_kind, chart_entry_id),
  constraint historical_chart_reconciliation_operation_state_objects
    check (
      jsonb_typeof(before_state) = 'object'
      and jsonb_typeof(after_state) = 'object'
    )
);

create index historical_chart_reconciliation_operation_recording_idx
  on private.historical_chart_reconciliation_operation_audit
  (musicbrainz_recording_id, recorded_at);

create index historical_chart_reconciliation_operation_chart_entry_idx
  on private.historical_chart_reconciliation_operation_audit
  (chart_entry_id);

create index historical_chart_reconciliation_operation_placeholder_idx
  on private.historical_chart_reconciliation_operation_audit
  (placeholder_canonical_song_id);

create index historical_chart_reconciliation_operation_target_idx
  on private.historical_chart_reconciliation_operation_audit
  (target_canonical_song_id);

create or replace function private.reject_historical_chart_reconciliation_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'historical chart reconciliation operation audit is append-only';
end;
$$;

create trigger reject_historical_chart_reconciliation_audit_row_mutation
before update or delete
on private.historical_chart_reconciliation_operation_audit
for each row
execute function private.reject_historical_chart_reconciliation_audit_mutation();

create trigger reject_historical_chart_reconciliation_audit_truncate
before truncate
on private.historical_chart_reconciliation_operation_audit
for each statement
execute function private.reject_historical_chart_reconciliation_audit_mutation();

alter table private.historical_chart_reconciliation_operation_audit
  enable row level security;

revoke all on table private.historical_chart_reconciliation_operation_audit
  from public, anon, authenticated;
revoke all on sequence
  private.historical_chart_reconciliation_operation_audit_id_seq
  from public, anon, authenticated;
revoke execute on function
  private.reject_historical_chart_reconciliation_audit_mutation()
  from public, anon, authenticated;

grant usage on schema private to service_role;
grant select, insert on table
  private.historical_chart_reconciliation_operation_audit
  to service_role;
grant usage, select on sequence
  private.historical_chart_reconciliation_operation_audit_id_seq
  to service_role;

comment on table private.historical_chart_reconciliation_operation_audit is
  'Append-only private evidence for approval-gated historical chart identity operations and guarded rollbacks.';
