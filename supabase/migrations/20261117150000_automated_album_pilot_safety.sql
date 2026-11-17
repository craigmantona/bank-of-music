begin;

alter table public.automated_album_import_runs
  add column approved_release_group_ids uuid[] not null default '{}',
  add column pilot_album_limit integer not null default 5;

create or replace function public.automated_album_approved_ids_valid(p_ids uuid[])
returns boolean language sql immutable strict
set search_path = public, pg_temp
as $$
  select cardinality(p_ids)=5
    and cardinality(p_ids)=(select count(distinct id) from unnest(p_ids) as id)
$$;

revoke all on function public.automated_album_approved_ids_valid(uuid[]) from public,anon,authenticated;

alter table public.automated_album_import_runs
  add constraint automated_album_import_runs_pilot_target_check
    check (target_albums between 1 and 5),
  add constraint automated_album_import_runs_pilot_limit_check
    check (pilot_album_limit between 1 and 5),
  add constraint automated_album_import_runs_approved_groups_check
    check (public.automated_album_approved_ids_valid(approved_release_group_ids));

create or replace function public.automated_album_pilot_guard(
  p_run_id uuid, p_release_group_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
set statement_timeout = '5s'
as $$
declare
  pilot public.automated_album_import_runs;
begin
  if p_run_id is null or p_release_group_id is null then
    raise exception 'Pilot run and release-group IDs are required';
  end if;
  select * into pilot from public.automated_album_import_runs where id=p_run_id;
  if pilot.id is null then raise exception 'Unknown automated album pilot run'; end if;
  if pilot.status <> 'running' then raise exception 'Automated album pilot is not running'; end if;
  return jsonb_build_object(
    'allowed', p_release_group_id = any(pilot.approved_release_group_ids),
    'cap_reached', pilot.albums_imported >= pilot.pilot_album_limit,
    'albums_imported', pilot.albums_imported,
    'pilot_album_limit', pilot.pilot_album_limit
  );
end;
$$;

revoke all on function public.automated_album_pilot_guard(uuid,uuid) from public,anon,authenticated;
grant execute on function public.automated_album_pilot_guard(uuid,uuid) to service_role;

create or replace function public.enforce_automated_album_pilot()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
set statement_timeout = '5s'
as $$
declare
  pilot public.automated_album_import_runs;
begin
  if new.automated_import_run_id is null then return new; end if;

  select * into pilot from public.automated_album_import_runs
    where id=new.automated_import_run_id for update;
  if pilot.id is null then raise exception 'Unknown automated album pilot run'; end if;
  if pilot.status <> 'running' then raise exception 'Automated album pilot is not running'; end if;
  if new.musicbrainz_release_group_id is null
     or not (new.musicbrainz_release_group_id::uuid = any(pilot.approved_release_group_ids)) then
    raise exception 'MusicBrainz release group is not approved for this pilot' using errcode='42501';
  end if;
  if pilot.albums_imported >= pilot.pilot_album_limit then
    raise exception 'Automated album pilot cap reached' using errcode='54000';
  end if;

  update public.automated_album_import_runs
    set albums_imported=albums_imported+1
    where id=pilot.id;
  return new;
end;
$$;

revoke all on function public.enforce_automated_album_pilot() from public,anon,authenticated;

create trigger enforce_automated_album_pilot_before_insert
before insert on public.albums
for each row execute function public.enforce_automated_album_pilot();

commit;
