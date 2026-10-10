-- Invitation-only Early Access registration. The singleton starts PUBLIC so
-- applying this migration cannot close production registration unexpectedly.
create type public.registration_mode as enum ('PUBLIC', 'INVITATION_ONLY');
create type public.early_access_request_status as enum ('PENDING', 'APPROVED', 'DECLINED');
create type public.invitation_status as enum ('PENDING', 'SENT', 'ACCEPTED', 'EXPIRED', 'REVOKED');

create table public.registration_settings (
  singleton boolean primary key default true check (singleton),
  mode public.registration_mode not null default 'PUBLIC',
  early_access_started_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.registration_settings (singleton, mode) values (true, 'PUBLIC');

create table public.early_access_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null,
  normalized_email text generated always as (lower(btrim(email))) stored,
  status public.early_access_request_status not null default 'PENDING',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  constraint early_access_requests_email_unique unique (normalized_email)
);

create table public.early_access_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalized_email text generated always as (lower(btrim(email))) stored,
  token_hash text not null unique,
  status public.invitation_status not null default 'PENDING',
  request_id uuid references public.early_access_requests(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id),
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  check (expires_at > created_at)
);

create unique index early_access_one_live_invite_per_email
  on public.early_access_invitations (normalized_email)
  where status in ('PENDING', 'SENT');

alter table public.registration_settings enable row level security;
alter table public.early_access_requests enable row level security;
alter table public.early_access_invitations enable row level security;

-- The client only needs the current mode. The underlying table remains closed.
create view public.registration_public_state
with (security_invoker = true)
as select mode from public.registration_settings where singleton is true;

grant select on public.registration_public_state to anon, authenticated;
grant all on public.registration_settings, public.early_access_requests,
  public.early_access_invitations to service_role;
revoke all on public.registration_settings, public.early_access_requests,
  public.early_access_invitations from anon, authenticated;

-- Permit the invoker view to read just the mode column, without exposing any
-- mutation path. RLS allows this one singleton read only.
grant select (singleton, mode) on public.registration_settings to anon, authenticated;
create policy "Registration mode is publicly readable"
  on public.registration_settings for select to anon, authenticated
  using (singleton is true);

alter table public.profiles add column is_founding_member boolean not null default false;

-- Ensure every legitimate pre-existing Auth account has a profile marker. This
-- inserts only missing profile rows and never rewrites Auth or existing profile
-- attributes. A missing handle remains editable through the normal profile UI.
insert into public.profiles (id, created_at, is_founding_member)
select users.id, users.created_at::timestamp, true
from auth.users users
left join public.profiles profiles on profiles.id = users.id
where profiles.id is null
  and users.deleted_at is null
  and users.is_anonymous is false;

-- Every existing profile is permanently marked without changing other fields.
update public.profiles set is_founding_member = true where is_founding_member is false;

create or replace function public.admin_set_registration_mode(
  p_mode public.registration_mode,
  p_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_started_at timestamptz;
begin
  select early_access_started_at into v_started_at
  from public.registration_settings where singleton is true for update;

  if p_mode = 'INVITATION_ONLY' and v_started_at is null then
    -- This backfill and the first mode switch share one transaction, preventing
    -- a last-moment PUBLIC signup from missing permanent founder status.
    update public.profiles set is_founding_member = true
    where is_founding_member is false;
    v_started_at := now();
  end if;

  update public.registration_settings
  set mode = p_mode,
      early_access_started_at = v_started_at,
      updated_at = now(),
      updated_by = p_admin_id
  where singleton is true;
end;
$$;

revoke all on function public.admin_set_registration_mode(public.registration_mode, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_set_registration_mode(public.registration_mode, uuid)
  to service_role;

create or replace function public.early_access_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_mode public.registration_mode;
  v_email text := lower(btrim(event->'user'->>'email'));
  v_token text := coalesce(event->'user'->'user_metadata'->>'invitation_token', '');
  v_user_id uuid := (event->'user'->>'id')::uuid;
  v_invitation_id uuid;
begin
  select mode into v_mode from public.registration_settings where singleton is true;
  if v_mode = 'PUBLIC' then return '{}'::jsonb; end if;

  if v_token = '' or v_email = '' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Registration currently requires a valid invitation.'));
  end if;

  update public.early_access_invitations
  set status = 'ACCEPTED', accepted_at = now(), accepted_user_id = v_user_id
  where token_hash = encode(digest(v_token, 'sha256'), 'hex')
    and normalized_email = v_email
    and status in ('PENDING', 'SENT')
    and revoked_at is null
    and accepted_at is null
    and expires_at > now()
  returning id into v_invitation_id;

  if v_invitation_id is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'This invitation is invalid or has expired.'));
  end if;

  return '{}'::jsonb;
end;
$$;

revoke all on function public.early_access_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.early_access_before_user_created(jsonb) to supabase_auth_admin;
grant select on public.registration_settings to supabase_auth_admin;
grant select, update on public.early_access_invitations to supabase_auth_admin;

create or replace function public.assign_early_access_profile_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_founding boolean;
begin
  select case
    when settings.mode = 'INVITATION_ONLY' then true
    when settings.early_access_started_at is not null and new.created_at < settings.early_access_started_at then true
    else exists (
      select 1 from public.early_access_invitations invitation
      where invitation.accepted_user_id = new.id and invitation.status = 'ACCEPTED'
    )
  end into v_is_founding
  from public.registration_settings settings where settings.singleton is true;

  insert into public.profiles (id, handle, birth_year, is_founding_member)
  values (
    new.id,
    nullif(regexp_replace(lower(coalesce(new.raw_user_meta_data->>'handle', '')), '[^a-z0-9_]', '', 'g'), ''),
    nullif(new.raw_user_meta_data->>'birth_year', '')::integer,
    coalesce(v_is_founding, false)
  )
  on conflict (id) do update set
    is_founding_member = public.profiles.is_founding_member or excluded.is_founding_member;
  return new;
end;
$$;

revoke all on function public.assign_early_access_profile_status() from public, anon, authenticated;
create trigger assign_early_access_profile_after_auth_user
after insert on auth.users
for each row execute function public.assign_early_access_profile_status();

-- Users may update profile fields but can never grant themselves the badge.
create or replace function public.prevent_founding_member_self_change()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.is_founding_member is distinct from old.is_founding_member
     and current_user not in ('service_role', 'postgres') then
    raise exception 'Founding Member status is managed by The Bank of Music';
  end if;
  return new;
end;
$$;
create trigger prevent_founding_member_self_change
before update on public.profiles
for each row execute function public.prevent_founding_member_self_change();

revoke all on function public.prevent_founding_member_self_change() from public, anon;
