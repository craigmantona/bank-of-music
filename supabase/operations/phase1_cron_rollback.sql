-- SAFE ROLLBACK: stop the schedule without restoring unauthenticated calls.
-- The Vault and Edge Function secret may remain in place while the incident is
-- investigated; leaving an unused secret is safer than exposing it in SQL.

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobid = 1
      and jobname = 'daily-artist-import'
  ) then
    raise exception 'Expected daily-artist-import cron job 1 was not found';
  end if;
end
$$;

select cron.alter_job(
  job_id := 1,
  active := false
);

-- Re-enable only after either:
--   1. the authenticated cron command is fixed and verified, or
--   2. the previously deployed daily-artist-import version is restored and
--      the security implications of unauthenticated scheduling are accepted.
