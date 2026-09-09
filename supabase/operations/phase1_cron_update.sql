-- OPERATOR-RUN ONLY. This file is deliberately outside supabase/migrations.
-- Prerequisite: BOM_IMPORT_CRON_SECRET exists in both Edge Function secrets
-- and Supabase Vault with exactly the same random value.

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobid = 1
      and jobname = 'daily-artist-import'
      and schedule = '0 6 * * *'
      and command like '%/functions/v1/daily-artist-import%'
  ) then
    raise exception
      'Expected daily-artist-import cron job 1 was not found unchanged';
  end if;

  if (
    select count(*)
    from vault.decrypted_secrets
    where name = 'BOM_IMPORT_CRON_SECRET'
      and nullif(decrypted_secret, '') is not null
  ) <> 1 then
    raise exception
      'BOM_IMPORT_CRON_SECRET must exist exactly once in Supabase Vault';
  end if;
end
$$;

select cron.alter_job(
  job_id := 1,
  schedule := '0 6 * * *',
  command := $cron$
    select net.http_post(
      url := 'https://xevxjggauscyrvvtmftx.supabase.co/functions/v1/daily-artist-import',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-bom-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'BOM_IMPORT_CRON_SECRET'
        )
      ),
      body := jsonb_build_object('action', 'run'),
      timeout_milliseconds := 30000
    ) as request_id;
  $cron$,
  active := true
);
