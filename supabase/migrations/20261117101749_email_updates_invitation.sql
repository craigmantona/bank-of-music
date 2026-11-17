-- One-time invitation state is deliberately separate from marketing consent.
-- A row here never makes an account eligible for promotional email.
create table public.email_updates_invitations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  invited_at timestamptz not null default now(),
  dismissed_at timestamptz,
  responded_at timestamptz,
  check (dismissed_at is null or responded_at is not null)
);

alter table public.email_updates_invitations enable row level security;
revoke all on public.email_updates_invitations from public, anon, authenticated;
grant select, insert, update on public.email_updates_invitations to service_role;

comment on table public.email_updates_invitations is
  'One-time invitation state for accounts that predate the invitation. This is not evidence of email consent.';

-- Only users without an existing explicit preference need the invitation.
insert into public.email_updates_invitations (user_id)
select users.id
from auth.users as users
where not exists (
  select 1
  from public.marketing_email_preferences as preferences
  where preferences.user_id = users.id
);
