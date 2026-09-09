


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."artist_import_queue" (
    "id" bigint NOT NULL,
    "artist_name" "text" NOT NULL,
    "musicbrainz_artist_id" "text",
    "priority" integer DEFAULT 100 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "studio_albums_imported" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "next_album_index" integer DEFAULT 0 NOT NULL,
    "total_studio_albums" integer DEFAULT 0 NOT NULL,
    "last_heartbeat_at" timestamp with time zone,
    CONSTRAINT "artist_import_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'complete'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."artist_import_queue" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_artist_import"() RETURNS "public"."artist_import_queue"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  claimed public.artist_import_queue;
begin
  select *
  into claimed
  from public.artist_import_queue
  where
    (
      status = 'pending'
      or (
        status = 'failed'
        and attempts < 3
      )
    )
  order by priority asc, id asc
  for update skip locked
  limit 1;

  if claimed.id is null then
    return null;
  end if;

  update public.artist_import_queue
  set
    status = 'processing',
    attempts = attempts + 1,
    started_at = now(),
    updated_at = now(),
    last_error = null
  where id = claimed.id
  returning *
  into claimed;

  return claimed;
end;
$$;


ALTER FUNCTION "public"."claim_next_artist_import"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_music_provider_click"("p_provider" "text", "p_item_type" "text", "p_item_key" "text", "p_title" "text", "p_artist" "text", "p_album" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  updated_total bigint;
begin
  if p_provider not in ('spotify', 'apple_music') then
    raise exception 'Unsupported music provider';
  end if;

  if p_item_type not in ('song', 'album') then
    raise exception 'Unsupported item type';
  end if;

  if nullif(trim(p_item_key), '') is null
     or char_length(p_item_key) > 500 then
    raise exception 'Invalid item key';
  end if;

  if nullif(trim(p_title), '') is null
     or char_length(p_title) > 300 then
    raise exception 'Invalid title';
  end if;

  if nullif(trim(p_artist), '') is null
     or char_length(p_artist) > 300 then
    raise exception 'Invalid artist';
  end if;

  insert into public.music_provider_click_counts (
    provider,
    item_type,
    item_key,
    title,
    artist,
    album,
    total_clicks,
    first_clicked_at,
    last_clicked_at
  )
  values (
    p_provider,
    p_item_type,
    p_item_key,
    trim(p_title),
    trim(p_artist),
    nullif(trim(coalesce(p_album, '')), ''),
    1,
    now(),
    now()
  )
  on conflict (provider, item_type, item_key)
  do update set
    title = excluded.title,
    artist = excluded.artist,
    album = coalesce(
      excluded.album,
      public.music_provider_click_counts.album
    ),
    total_clicks =
      public.music_provider_click_counts.total_clicks + 1,
    last_clicked_at = now()
  returning total_clicks
  into updated_total;

  return updated_total;
end;
$$;


ALTER FUNCTION "public"."record_music_provider_click"("p_provider" "text", "p_item_type" "text", "p_item_key" "text", "p_title" "text", "p_artist" "text", "p_album" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_tracked_artist_from_album"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.artist is not null and trim(new.artist) <> '' then
    insert into public.tracked_artists (artist_name)
    values (trim(new.artist))
    on conflict (artist_name) do nothing;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_tracked_artist_from_album"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."albums" (
    "id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "artist" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "external_source" "text",
    "external_id" "text",
    "cover_art_url" "text",
    "release_date" "date",
    "custom_cover" "text",
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."albums" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ratings" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "album_title" "text",
    "artist_name" "text",
    "rating" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "album_id" bigint
);


ALTER TABLE "public"."ratings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."album_rating_charts" AS
 SELECT "a"."id" AS "item_id",
    'album'::"text" AS "item_type",
    "a"."title",
    "a"."artist",
    "a"."cover_art_url",
    "round"("avg"("r"."rating"), 1) AS "average_rating",
    "count"("r"."rating") AS "rating_count"
   FROM ("public"."ratings" "r"
     JOIN "public"."albums" "a" ON (("a"."id" = "r"."album_id")))
  GROUP BY "a"."id", "a"."title", "a"."artist", "a"."cover_art_url";


ALTER VIEW "public"."album_rating_charts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."album_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "album_id" bigint NOT NULL,
    "review_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "album_reviews_review_text_check" CHECK (("char_length"("review_text") <= 500))
);


ALTER TABLE "public"."album_reviews" OWNER TO "postgres";


ALTER TABLE "public"."albums" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."albums_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."artist_catalog" (
    "artist_name" "text" NOT NULL,
    "musicbrainz_artist_id" "text",
    "studio_album_count" integer DEFAULT 0 NOT NULL,
    "catalog_complete" boolean DEFAULT false NOT NULL,
    "last_synced_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."artist_catalog" OWNER TO "postgres";


ALTER TABLE "public"."artist_import_queue" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."artist_import_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."artist_release_group_debug" (
    "artist_name" "text" NOT NULL,
    "musicbrainz_artist_id" "text" NOT NULL,
    "release_group_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "first_release_date" "text",
    "primary_type" "text",
    "secondary_types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "inspected_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."artist_release_group_debug" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."followed_artists" (
    "id" bigint NOT NULL,
    "artist_name" "text"
);


ALTER TABLE "public"."followed_artists" OWNER TO "postgres";


ALTER TABLE "public"."followed_artists" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."followed_artists_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."music_provider_click_counts" (
    "provider" "text" NOT NULL,
    "item_type" "text" NOT NULL,
    "item_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "artist" "text" NOT NULL,
    "album" "text",
    "total_clicks" bigint DEFAULT 0 NOT NULL,
    "first_clicked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_clicked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "music_provider_click_counts_artist_length" CHECK ((("char_length"("artist") >= 1) AND ("char_length"("artist") <= 300))),
    CONSTRAINT "music_provider_click_counts_item_key_length" CHECK ((("char_length"("item_key") >= 1) AND ("char_length"("item_key") <= 500))),
    CONSTRAINT "music_provider_click_counts_item_type_check" CHECK (("item_type" = ANY (ARRAY['song'::"text", 'album'::"text"]))),
    CONSTRAINT "music_provider_click_counts_provider_check" CHECK (("provider" = ANY (ARRAY['spotify'::"text", 'apple_music'::"text"]))),
    CONSTRAINT "music_provider_click_counts_title_length" CHECK ((("char_length"("title") >= 1) AND ("char_length"("title") <= 300)))
);


ALTER TABLE "public"."music_provider_click_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "handle" "text",
    "member_number" integer NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "is_admin" boolean DEFAULT false,
    "birth_year" integer,
    CONSTRAINT "birth_year_reasonable" CHECK ((("birth_year" IS NULL) OR (("birth_year" >= 1900) AND ("birth_year" <= (EXTRACT(year FROM "now"()))::integer))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."profiles_member_number_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."profiles_member_number_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."profiles_member_number_seq" OWNED BY "public"."profiles"."member_number";



ALTER TABLE "public"."ratings" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."ratings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."release_import_runs" (
    "id" bigint NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "imported_count" integer DEFAULT 0 NOT NULL,
    "checked_artists" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."release_import_runs" OWNER TO "postgres";


ALTER TABLE "public"."release_import_runs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."release_import_runs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."song_ratings" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "song_id" bigint,
    "rating" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."song_ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."songs" (
    "id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "artist" "text" NOT NULL,
    "album_id" bigint,
    "external_source" "text",
    "external_id" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "is_deleted" boolean DEFAULT false,
    "canonical_song_id" "uuid",
    "track_position" integer,
    "canonical_song_key" "text"
);


ALTER TABLE "public"."songs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."song_rating_charts" AS
 SELECT "s"."id" AS "item_id",
    'song'::"text" AS "item_type",
    "s"."title",
    "s"."artist",
    "s"."album_id",
    "round"("avg"("r"."rating"), 1) AS "average_rating",
    "count"("r"."rating") AS "rating_count"
   FROM ("public"."song_ratings" "r"
     JOIN "public"."songs" "s" ON (("s"."id" = "r"."song_id")))
  GROUP BY "s"."id", "s"."title", "s"."artist", "s"."album_id";


ALTER VIEW "public"."song_rating_charts" OWNER TO "postgres";


ALTER TABLE "public"."song_ratings" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."song_ratings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."songs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."songs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tracked_artists" (
    "id" bigint NOT NULL,
    "artist_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."tracked_artists" OWNER TO "postgres";


ALTER TABLE "public"."tracked_artists" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."tracked_artists_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."profiles" ALTER COLUMN "member_number" SET DEFAULT "nextval"('"public"."profiles_member_number_seq"'::"regclass");



ALTER TABLE ONLY "public"."album_reviews"
    ADD CONSTRAINT "album_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."album_reviews"
    ADD CONSTRAINT "album_reviews_user_id_album_id_key" UNIQUE ("user_id", "album_id");



ALTER TABLE ONLY "public"."albums"
    ADD CONSTRAINT "albums_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."artist_catalog"
    ADD CONSTRAINT "artist_catalog_pkey" PRIMARY KEY ("artist_name");



ALTER TABLE ONLY "public"."artist_import_queue"
    ADD CONSTRAINT "artist_import_queue_artist_name_key" UNIQUE ("artist_name");



ALTER TABLE ONLY "public"."artist_import_queue"
    ADD CONSTRAINT "artist_import_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."artist_release_group_debug"
    ADD CONSTRAINT "artist_release_group_debug_pkey" PRIMARY KEY ("artist_name", "release_group_id");



ALTER TABLE ONLY "public"."followed_artists"
    ADD CONSTRAINT "followed_artists_artist_name_key" UNIQUE ("artist_name");



ALTER TABLE ONLY "public"."followed_artists"
    ADD CONSTRAINT "followed_artists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."music_provider_click_counts"
    ADD CONSTRAINT "music_provider_click_counts_pkey" PRIMARY KEY ("provider", "item_type", "item_key");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_handle_key" UNIQUE ("handle");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_member_number_key" UNIQUE ("member_number");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."release_import_runs"
    ADD CONSTRAINT "release_import_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."song_ratings"
    ADD CONSTRAINT "song_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."songs"
    ADD CONSTRAINT "songs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tracked_artists"
    ADD CONSTRAINT "tracked_artists_artist_name_key" UNIQUE ("artist_name");



ALTER TABLE ONLY "public"."tracked_artists"
    ADD CONSTRAINT "tracked_artists_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "albums_external_source_external_id_unique" ON "public"."albums" USING "btree" ("external_source", "external_id");



CREATE UNIQUE INDEX "albums_external_unique" ON "public"."albums" USING "btree" ("external_source", "external_id") WHERE (("external_source" IS NOT NULL) AND ("external_id" IS NOT NULL));



CREATE UNIQUE INDEX "albums_source_external_id_unique" ON "public"."albums" USING "btree" ("external_source", "external_id");



CREATE UNIQUE INDEX "albums_title_artist_unique" ON "public"."albums" USING "btree" ("title", "artist");



CREATE UNIQUE INDEX "albums_unique_external" ON "public"."albums" USING "btree" ("external_source", "external_id");



CREATE INDEX "artist_import_queue_status_priority_idx" ON "public"."artist_import_queue" USING "btree" ("status", "priority", "id");



CREATE UNIQUE INDEX "followed_artists_artist_name_unique" ON "public"."followed_artists" USING "btree" ("artist_name");



CREATE INDEX "idx_albums_release_date" ON "public"."albums" USING "btree" ("release_date");



CREATE UNIQUE INDEX "profiles_handle_unique" ON "public"."profiles" USING "btree" ("handle");



CREATE UNIQUE INDEX "ratings_user_album_unique" ON "public"."ratings" USING "btree" ("user_id", "album_id");



CREATE UNIQUE INDEX "song_ratings_user_song_unique" ON "public"."song_ratings" USING "btree" ("user_id", "song_id");



CREATE INDEX "songs_canonical_idx" ON "public"."songs" USING "btree" ("canonical_song_id");



CREATE UNIQUE INDEX "songs_external_source_external_id_unique" ON "public"."songs" USING "btree" ("external_source", "external_id");



CREATE UNIQUE INDEX "songs_external_unique" ON "public"."songs" USING "btree" ("external_source", "external_id") WHERE (("external_source" IS NOT NULL) AND ("external_id" IS NOT NULL));



CREATE UNIQUE INDEX "songs_title_artist_album_unique" ON "public"."songs" USING "btree" ("title", "artist", "album_id");



CREATE UNIQUE INDEX "songs_unique_track" ON "public"."songs" USING "btree" ("album_id", "lower"("title"));



CREATE OR REPLACE TRIGGER "trg_sync_tracked_artist_from_album" AFTER INSERT ON "public"."albums" FOR EACH ROW EXECUTE FUNCTION "public"."sync_tracked_artist_from_album"();



ALTER TABLE ONLY "public"."album_reviews"
    ADD CONSTRAINT "album_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."song_ratings"
    ADD CONSTRAINT "song_ratings_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."song_ratings"
    ADD CONSTRAINT "song_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."songs"
    ADD CONSTRAINT "songs_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE SET NULL;



CREATE POLICY "Admins can do anything on albums" ON "public"."albums" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



CREATE POLICY "Admins can do anything on songs" ON "public"."songs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



CREATE POLICY "Admins can update profiles" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



CREATE POLICY "Anyone can insert albums" ON "public"."albums" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can insert songs" ON "public"."songs" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can read album reviews" ON "public"."album_reviews" FOR SELECT USING (true);



CREATE POLICY "Anyone can view albums" ON "public"."albums" FOR SELECT USING (true);



CREATE POLICY "Anyone can view songs" ON "public"."songs" FOR SELECT USING (true);



CREATE POLICY "Logged in users can follow artists" ON "public"."followed_artists" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Logged in users can insert albums" ON "public"."albums" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Logged in users can insert songs" ON "public"."songs" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Logged in users can unfollow artists" ON "public"."followed_artists" FOR DELETE TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Profiles are readable" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Public read albums" ON "public"."albums" FOR SELECT USING ((COALESCE("is_deleted", false) = false));



CREATE POLICY "Public read followed artists" ON "public"."followed_artists" FOR SELECT USING (true);



CREATE POLICY "Public read ratings" ON "public"."ratings" FOR SELECT USING (true);



CREATE POLICY "Public read song ratings" ON "public"."song_ratings" FOR SELECT USING (true);



CREATE POLICY "Public read songs" ON "public"."songs" FOR SELECT USING ((COALESCE("is_deleted", false) = false));



CREATE POLICY "Users can delete own album ratings" ON "public"."ratings" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own album review" ON "public"."album_reviews" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own song ratings" ON "public"."song_ratings" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own ratings" ON "public"."ratings" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own song ratings" ON "public"."song_ratings" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own album review" ON "public"."album_reviews" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users can insert song ratings" ON "public"."song_ratings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own ratings" ON "public"."ratings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can rate albums" ON "public"."ratings" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can rate songs" ON "public"."song_ratings" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own album ratings" ON "public"."ratings" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own album review" ON "public"."album_reviews" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users can update own song ratings" ON "public"."song_ratings" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own ratings" ON "public"."ratings" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own song ratings" ON "public"."song_ratings" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view profiles" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Users can view their own ratings" ON "public"."ratings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own song ratings" ON "public"."song_ratings" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."album_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."albums" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "artist catalog public read" ON "public"."artist_catalog" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."artist_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."artist_import_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."artist_release_group_debug" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."followed_artists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."music_provider_click_counts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ratings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."song_ratings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."songs" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































GRANT ALL ON TABLE "public"."artist_import_queue" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_next_artist_import"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_artist_import"() TO "anon";
GRANT ALL ON FUNCTION "public"."claim_next_artist_import"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_artist_import"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_music_provider_click"("p_provider" "text", "p_item_type" "text", "p_item_key" "text", "p_title" "text", "p_artist" "text", "p_album" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_music_provider_click"("p_provider" "text", "p_item_type" "text", "p_item_key" "text", "p_title" "text", "p_artist" "text", "p_album" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_music_provider_click"("p_provider" "text", "p_item_type" "text", "p_item_key" "text", "p_title" "text", "p_artist" "text", "p_album" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_music_provider_click"("p_provider" "text", "p_item_type" "text", "p_item_key" "text", "p_title" "text", "p_artist" "text", "p_album" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_tracked_artist_from_album"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_tracked_artist_from_album"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_tracked_artist_from_album"() TO "service_role";
























GRANT ALL ON TABLE "public"."albums" TO "anon";
GRANT ALL ON TABLE "public"."albums" TO "authenticated";
GRANT ALL ON TABLE "public"."albums" TO "service_role";



GRANT ALL ON TABLE "public"."ratings" TO "anon";
GRANT ALL ON TABLE "public"."ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."ratings" TO "service_role";



GRANT ALL ON TABLE "public"."album_rating_charts" TO "anon";
GRANT ALL ON TABLE "public"."album_rating_charts" TO "authenticated";
GRANT ALL ON TABLE "public"."album_rating_charts" TO "service_role";



GRANT ALL ON TABLE "public"."album_reviews" TO "anon";
GRANT ALL ON TABLE "public"."album_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."album_reviews" TO "service_role";



GRANT ALL ON SEQUENCE "public"."albums_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."albums_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."albums_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."artist_catalog" TO "anon";
GRANT ALL ON TABLE "public"."artist_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."artist_catalog" TO "service_role";



GRANT ALL ON SEQUENCE "public"."artist_import_queue_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."artist_import_queue_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."artist_import_queue_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."artist_release_group_debug" TO "service_role";



GRANT ALL ON TABLE "public"."followed_artists" TO "anon";
GRANT ALL ON TABLE "public"."followed_artists" TO "authenticated";
GRANT ALL ON TABLE "public"."followed_artists" TO "service_role";



GRANT ALL ON SEQUENCE "public"."followed_artists_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."followed_artists_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."followed_artists_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."music_provider_click_counts" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."profiles_member_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."profiles_member_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."profiles_member_number_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ratings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ratings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ratings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."release_import_runs" TO "anon";
GRANT ALL ON TABLE "public"."release_import_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."release_import_runs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."release_import_runs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."release_import_runs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."release_import_runs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."song_ratings" TO "anon";
GRANT ALL ON TABLE "public"."song_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."song_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."songs" TO "anon";
GRANT ALL ON TABLE "public"."songs" TO "authenticated";
GRANT ALL ON TABLE "public"."songs" TO "service_role";



GRANT ALL ON TABLE "public"."song_rating_charts" TO "anon";
GRANT ALL ON TABLE "public"."song_rating_charts" TO "authenticated";
GRANT ALL ON TABLE "public"."song_rating_charts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."song_ratings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."song_ratings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."song_ratings_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."songs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."songs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."songs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tracked_artists" TO "anon";
GRANT ALL ON TABLE "public"."tracked_artists" TO "authenticated";
GRANT ALL ON TABLE "public"."tracked_artists" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tracked_artists_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tracked_artists_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tracked_artists_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































