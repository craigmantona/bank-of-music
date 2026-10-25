begin;

alter table public.artist_hero_overrides
  add column image_credit text,
  add column image_source_url text,
  add column image_license_name text,
  add column image_license_url text,
  add column image_modification_note text,
  add constraint artist_hero_overrides_attribution_complete check (
    (
      image_credit is null
      and image_source_url is null
      and image_license_name is null
      and image_license_url is null
    )
    or
    (
      nullif(btrim(image_credit), '') is not null
      and nullif(btrim(image_source_url), '') is not null
      and nullif(btrim(image_license_name), '') is not null
      and nullif(btrim(image_license_url), '') is not null
    )
  );

commit;
