-- Private, auditable email announcement preferences and delivery history.
-- Existing accounts are deliberately not opted in: account registration is not
-- evidence of consent to promotional email under PECR.
create type public.marketing_email_status as enum ('OPTED_IN', 'UNSUBSCRIBED');
create type public.email_announcement_status as enum ('SENDING', 'SENT', 'PARTIAL', 'FAILED');
create type public.email_delivery_status as enum ('SENT', 'FAILED', 'SUPPRESSED');

create table public.marketing_email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status public.marketing_email_status not null,
  consented_at timestamptz,
  consent_source text,
  consent_wording text,
  unsubscribed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (status = 'OPTED_IN' and consented_at is not null and consent_source is not null and consent_wording is not null and unsubscribed_at is null)
    or (status = 'UNSUBSCRIBED' and unsubscribed_at is not null)
  )
);

create table public.email_announcements (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  audience text not null check (audience = 'MARKETING_OPT_IN'),
  subject text not null check (char_length(subject) between 1 and 200),
  message text not null check (char_length(message) between 1 and 20000),
  status public.email_announcement_status not null default 'SENDING',
  eligible_count integer not null check (eligible_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_summary text
);

create table public.email_announcement_deliveries (
  announcement_id uuid not null references public.email_announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.email_delivery_status not null,
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create table public.email_announcement_test_sends (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  provider_message_id text not null,
  sent_at timestamptz not null default now()
);

alter table public.marketing_email_preferences enable row level security;
alter table public.email_announcements enable row level security;
alter table public.email_announcement_deliveries enable row level security;
alter table public.email_announcement_test_sends enable row level security;

revoke all on public.marketing_email_preferences, public.email_announcements,
  public.email_announcement_deliveries from public, anon, authenticated;
revoke all on public.email_announcement_test_sends from public, anon, authenticated;
grant select, insert, update on public.marketing_email_preferences to service_role;
grant select, insert, update on public.email_announcements to service_role;
grant select, insert, update on public.email_announcement_deliveries to service_role;
grant select, insert on public.email_announcement_test_sends to service_role;
grant usage, select on sequence public.email_announcement_test_sends_id_seq to service_role;

comment on table public.marketing_email_preferences is
  'Explicit email marketing consent and durable unsubscribe suppression. No row means not eligible.';
comment on table public.email_announcements is
  'Administrator-created promotional email campaigns; fingerprint prevents duplicate bulk sends.';

-- Capture the optional, unticked signup choice at account creation. The server
-- supplies both the timestamp and the exact wording; client metadata only carries
-- the boolean choice and is never used for authorization.
create function public.capture_signup_marketing_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Treat only the exact JSON boolean/string representation emitted by Auth as
  -- consent. Never cast arbitrary user-editable metadata, which could make a
  -- malformed value abort account creation.
  if coalesce(new.raw_user_meta_data ->> 'marketing_email_consent', 'false') = 'true' then
    insert into public.marketing_email_preferences
      (user_id, status, consented_at, consent_source, consent_wording, updated_at)
    values
      (new.id, 'OPTED_IN', now(), 'SIGNUP_CHECKBOX',
       'Yes, email me occasional Bank of Music news, feature announcements and special releases. I can unsubscribe or change this at any time.', now());
  end if;
  return new;
end;
$$;

revoke all on function public.capture_signup_marketing_consent() from public, anon, authenticated;
create trigger capture_signup_marketing_consent
  after insert on auth.users
  for each row execute function public.capture_signup_marketing_consent();
