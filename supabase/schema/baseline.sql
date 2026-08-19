


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








ALTER SCHEMA "public" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."admin_update_participant"("target_id" "uuid", "new_display_name" "text", "new_phone" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'not authorised';
  end if;
  update profiles set
    display_name = coalesce(nullif(new_display_name, ''), display_name),
    phone_number  = coalesce(nullif(new_phone, ''), phone_number)
  where id = target_id;
end; $$;


ALTER FUNCTION "public"."admin_update_participant"("target_id" "uuid", "new_display_name" "text", "new_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_join_new_profile_to_competitions"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into participants (competition_id, user_id, role)
  select id, new.id, 'player' from competitions
  on conflict (competition_id, user_id) do nothing;
  return new;
end; $$;


ALTER FUNCTION "public"."auto_join_new_profile_to_competitions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_join_profiles_to_new_competition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into participants (competition_id, user_id, role)
  select new.id, id, 'player' from profiles
  on conflict (competition_id, user_id) do nothing;
  return new;
end; $$;


ALTER FUNCTION "public"."auto_join_profiles_to_new_competition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_admin_participant"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into participants (competition_id, user_id, role)
  values (NEW.id, NEW.created_by, 'admin')
  on conflict (competition_id, user_id) do update set role = 'admin';
  return NEW;
end;
$$;


ALTER FUNCTION "public"."create_admin_participant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_default_rules"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin insert into point_rules (competition_id) values (new.id); return new; end; $$;


ALTER FUNCTION "public"."create_default_rules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_triple_points_complete_predictions"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  fixture_count   int;
  predicted_count int;
begin
  select count(*) into fixture_count
  from fixtures
  where gameweek_id = new.gameweek_id
    and status <> 'void';

  -- count(distinct) rather than count(*): a duplicate prediction row would
  -- otherwise let a participant reach the target without covering every fixture.
  select count(distinct p.fixture_id) into predicted_count
  from predictions p
  join fixtures f on f.id = p.fixture_id
  where f.gameweek_id = new.gameweek_id
    and f.status <> 'void'
    and p.user_id = new.user_id;

  if fixture_count = 0 then
    raise exception 'Triple Points cannot be played on a gameweek with no fixtures';
  end if;

  if predicted_count < fixture_count then
    raise exception 'Triple Points requires a prediction for every fixture in the gameweek (% of % predicted)',
      predicted_count, fixture_count;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_triple_points_complete_predictions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into profiles (id, display_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)), new.email);

  update invitations set accepted_at = now()
  where email = new.email and accepted_at is null;

  return new;
end; $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_prediction_submitted_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.submitted_at = now();
  return new;
end; $$;


ALTER FUNCTION "public"."touch_prediction_submitted_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."bracket_matches" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "round" "text" NOT NULL,
    "round_order" integer DEFAULT 0 NOT NULL,
    "home_team" "text",
    "away_team" "text",
    "home_score" integer,
    "away_score" integer,
    "winner_team" "text",
    "status" "text" DEFAULT 'upcoming'::"text" NOT NULL,
    "kickoff_time" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "home_user_id" "uuid",
    "away_user_id" "uuid",
    "winner_user_id" "uuid",
    "home_points" integer,
    "away_points" integer,
    "feeds_into_match_id" "uuid",
    "feeds_into_side" "text",
    "gameweek_id" "uuid",
    "is_replay" boolean DEFAULT false NOT NULL,
    CONSTRAINT "bracket_matches_feeds_into_side_check" CHECK (("feeds_into_side" = ANY (ARRAY['home'::"text", 'away'::"text"]))),
    CONSTRAINT "bracket_matches_status_check" CHECK (("status" = ANY (ARRAY['upcoming'::"text", 'completed'::"text", 'replay_scheduled'::"text"])))
);


ALTER TABLE "public"."bracket_matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bracket_predictions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "match_id" "uuid" NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "predicted_winner" "text" NOT NULL,
    "points_earned" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bracket_predictions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bracket_round_gameweeks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "round" "text" NOT NULL,
    "gameweek_id" "uuid" NOT NULL
);


ALTER TABLE "public"."bracket_round_gameweeks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."closed_months" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "month_key" "text" NOT NULL,
    "closed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."closed_months" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competition_gameweeks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "gameweek_id" "uuid" NOT NULL
);


ALTER TABLE "public"."competition_gameweeks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competitions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "emoji" "text" DEFAULT '⚽'::"text",
    "format" "text" DEFAULT 'league'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "group_auto_qualify_count" integer,
    "group_eliminated_count" integer,
    "group_target_round" "text",
    "rules_source_competition_id" "uuid",
    "triple_points_blocked" boolean DEFAULT false NOT NULL,
    CONSTRAINT "competitions_format_check" CHECK (("format" = ANY (ARRAY['league'::"text", 'knockout'::"text", 'group_knockout'::"text"]))),
    CONSTRAINT "competitions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."competitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fixtures" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "gameweek_id" "uuid" NOT NULL,
    "home_team" "text" NOT NULL,
    "away_team" "text" NOT NULL,
    "kickoff_time" timestamp with time zone NOT NULL,
    "venue" "text",
    "home_score" integer,
    "away_score" integer,
    "status" "text" DEFAULT 'upcoming'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "void_reason" "text",
    CONSTRAINT "fixtures_status_check" CHECK (("status" = ANY (ARRAY['upcoming'::"text", 'active'::"text", 'completed'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."fixtures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gameweek_scores" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "gameweek_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "exact_scores" integer DEFAULT 0 NOT NULL,
    "correct_results" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "full_house_results" boolean DEFAULT false NOT NULL,
    "full_house_scores" boolean DEFAULT false NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "triple_points" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."gameweek_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gameweeks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "number" "text" NOT NULL,
    "status" "text" DEFAULT 'upcoming'::"text" NOT NULL,
    "month_key" "text",
    "deadline" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "triple_points_blocked" boolean DEFAULT false NOT NULL,
    CONSTRAINT "gameweeks_status_check" CHECK (("status" = ANY (ARRAY['upcoming'::"text", 'active'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."gameweeks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_fixtures" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "round_number" integer DEFAULT 1 NOT NULL,
    "home_user_id" "uuid" NOT NULL,
    "away_user_id" "uuid" NOT NULL,
    "gameweek_id" "uuid",
    "home_points" integer,
    "away_points" integer,
    "result" "text",
    "status" "text" DEFAULT 'upcoming'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_fixtures_result_check" CHECK (("result" = ANY (ARRAY['home'::"text", 'away'::"text", 'draw'::"text"]))),
    CONSTRAINT "group_fixtures_status_check" CHECK (("status" = ANY (ARRAY['upcoming'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."group_fixtures" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."group_standings" AS
 SELECT "competition_id",
    "user_id",
    "count"(*) AS "played",
    "sum"("points_for") AS "points_for",
    "sum"("points_against") AS "points_against",
    ("sum"("points_for") - "sum"("points_against")) AS "points_diff",
    "sum"("league_points") AS "league_points",
    "sum"(
        CASE
            WHEN ("outcome" = 'win'::"text") THEN 1
            ELSE 0
        END) AS "wins",
    "sum"(
        CASE
            WHEN ("outcome" = 'draw'::"text") THEN 1
            ELSE 0
        END) AS "draws",
    "sum"(
        CASE
            WHEN ("outcome" = 'loss'::"text") THEN 1
            ELSE 0
        END) AS "losses"
   FROM ( SELECT "group_fixtures"."competition_id",
            "group_fixtures"."home_user_id" AS "user_id",
            "group_fixtures"."home_points" AS "points_for",
            "group_fixtures"."away_points" AS "points_against",
                CASE
                    WHEN ("group_fixtures"."result" = 'home'::"text") THEN 3
                    WHEN ("group_fixtures"."result" = 'draw'::"text") THEN 1
                    ELSE 0
                END AS "league_points",
                CASE
                    WHEN ("group_fixtures"."result" = 'home'::"text") THEN 'win'::"text"
                    WHEN ("group_fixtures"."result" = 'draw'::"text") THEN 'draw'::"text"
                    ELSE 'loss'::"text"
                END AS "outcome"
           FROM "public"."group_fixtures"
          WHERE ("group_fixtures"."status" = 'completed'::"text")
        UNION ALL
         SELECT "group_fixtures"."competition_id",
            "group_fixtures"."away_user_id" AS "user_id",
            "group_fixtures"."away_points" AS "points_for",
            "group_fixtures"."home_points" AS "points_against",
                CASE
                    WHEN ("group_fixtures"."result" = 'away'::"text") THEN 3
                    WHEN ("group_fixtures"."result" = 'draw'::"text") THEN 1
                    ELSE 0
                END AS "league_points",
                CASE
                    WHEN ("group_fixtures"."result" = 'away'::"text") THEN 'win'::"text"
                    WHEN ("group_fixtures"."result" = 'draw'::"text") THEN 'draw'::"text"
                    ELSE 'loss'::"text"
                END AS "outcome"
           FROM "public"."group_fixtures"
          WHERE ("group_fixtures"."status" = 'completed'::"text")) "combined"
  GROUP BY "competition_id", "user_id";


ALTER VIEW "public"."group_standings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "email" "text",
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "display_name" "text",
    "phone_number" "text"
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "avatar_initials" "text" GENERATED ALWAYS AS ("upper"("left"("display_name", 2))) STORED,
    "email" "text",
    "role" "text" DEFAULT 'player'::"text" NOT NULL,
    "phone_number" "text",
    "notify_whatsapp" boolean DEFAULT true,
    "notify_sms" boolean DEFAULT false,
    "wa_opted_in" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notify_push" boolean DEFAULT true NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['player'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."triple_points_plays" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "gameweek_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "half" "text" NOT NULL,
    "played_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "triple_points_plays_half_check" CHECK (("half" = ANY (ARRAY['first'::"text", 'second'::"text"])))
);


ALTER TABLE "public"."triple_points_plays" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."leaderboard_overall" AS
 SELECT "gs"."competition_id",
    "gs"."user_id",
    "pr"."display_name",
    "pr"."avatar_initials",
    "sum"("gs"."points") AS "total_points",
    "sum"("gs"."exact_scores") AS "exact_scores",
    "sum"("gs"."correct_results") AS "correct_results",
    "sum"(
        CASE
            WHEN "gs"."full_house_results" THEN 1
            ELSE 0
        END) AS "full_house_results_count",
    "sum"(
        CASE
            WHEN "gs"."full_house_scores" THEN 1
            ELSE 0
        END) AS "full_house_scores_count",
    "count"("gs"."gameweek_id") AS "games_played",
    ( SELECT "tpp"."gameweek_id"
           FROM "public"."triple_points_plays" "tpp"
          WHERE (("tpp"."competition_id" = "gs"."competition_id") AND ("tpp"."user_id" = "gs"."user_id") AND ("tpp"."half" = 'first'::"text"))
         LIMIT 1) AS "tp1_gameweek_id",
    ( SELECT "tpp"."gameweek_id"
           FROM "public"."triple_points_plays" "tpp"
          WHERE (("tpp"."competition_id" = "gs"."competition_id") AND ("tpp"."user_id" = "gs"."user_id") AND ("tpp"."half" = 'second'::"text"))
         LIMIT 1) AS "tp2_gameweek_id",
    ( SELECT "gws"."points"
           FROM ("public"."gameweek_scores" "gws"
             JOIN "public"."triple_points_plays" "tpp" ON (("tpp"."gameweek_id" = "gws"."gameweek_id")))
          WHERE (("tpp"."competition_id" = "gs"."competition_id") AND ("tpp"."user_id" = "gs"."user_id") AND ("tpp"."half" = 'first'::"text") AND ("gws"."user_id" = "gs"."user_id") AND ("gws"."competition_id" = "gs"."competition_id"))
         LIMIT 1) AS "tp1_points",
    ( SELECT "gws"."points"
           FROM ("public"."gameweek_scores" "gws"
             JOIN "public"."triple_points_plays" "tpp" ON (("tpp"."gameweek_id" = "gws"."gameweek_id")))
          WHERE (("tpp"."competition_id" = "gs"."competition_id") AND ("tpp"."user_id" = "gs"."user_id") AND ("tpp"."half" = 'second'::"text") AND ("gws"."user_id" = "gs"."user_id") AND ("gws"."competition_id" = "gs"."competition_id"))
         LIMIT 1) AS "tp2_points"
   FROM ("public"."gameweek_scores" "gs"
     JOIN "public"."profiles" "pr" ON (("pr"."id" = "gs"."user_id")))
  GROUP BY "gs"."competition_id", "gs"."user_id", "pr"."display_name", "pr"."avatar_initials";


ALTER VIEW "public"."leaderboard_overall" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "gameweek_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "channel" "text" DEFAULT 'push'::"text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_log_channel_check" CHECK (("channel" = ANY (ARRAY['push'::"text", 'whatsapp'::"text", 'sms'::"text"]))),
    CONSTRAINT "notification_log_kind_check" CHECK (("kind" = ANY (ARRAY['gameweek_open'::"text", 'deadline_24h'::"text", 'deadline_1h'::"text"])))
);


ALTER TABLE "public"."notification_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."participants" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'player'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "participants_role_check" CHECK (("role" = ANY (ARRAY['player'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."point_rules" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "exact_score_points" integer DEFAULT 5 NOT NULL,
    "correct_result_points" integer DEFAULT 2 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "full_house_results_bonus" integer DEFAULT 0 NOT NULL,
    "full_house_scores_bonus" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."point_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."predictions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fixture_id" "uuid" NOT NULL,
    "gameweek_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "predicted_home" integer NOT NULL,
    "predicted_away" integer NOT NULL,
    "points_earned" integer DEFAULT 0 NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."predictions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_tokens" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "platform" "text" DEFAULT 'web'::"text" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_tokens_platform_check" CHECK (("platform" = ANY (ARRAY['web'::"text", 'ios'::"text", 'android'::"text"])))
);


ALTER TABLE "public"."push_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "fixture_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "reminder_type" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reminder_log" OWNER TO "postgres";


ALTER TABLE ONLY "public"."bracket_matches"
    ADD CONSTRAINT "bracket_matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bracket_predictions"
    ADD CONSTRAINT "bracket_predictions_match_id_user_id_key" UNIQUE ("match_id", "user_id");



ALTER TABLE ONLY "public"."bracket_predictions"
    ADD CONSTRAINT "bracket_predictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bracket_round_gameweeks"
    ADD CONSTRAINT "bracket_round_gameweeks_competition_id_round_gameweek_id_key" UNIQUE ("competition_id", "round", "gameweek_id");



ALTER TABLE ONLY "public"."bracket_round_gameweeks"
    ADD CONSTRAINT "bracket_round_gameweeks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."closed_months"
    ADD CONSTRAINT "closed_months_competition_id_month_key_key" UNIQUE ("competition_id", "month_key");



ALTER TABLE ONLY "public"."closed_months"
    ADD CONSTRAINT "closed_months_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competition_gameweeks"
    ADD CONSTRAINT "competition_gameweeks_competition_id_gameweek_id_key" UNIQUE ("competition_id", "gameweek_id");



ALTER TABLE ONLY "public"."competition_gameweeks"
    ADD CONSTRAINT "competition_gameweeks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competitions"
    ADD CONSTRAINT "competitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fixtures"
    ADD CONSTRAINT "fixtures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gameweek_scores"
    ADD CONSTRAINT "gameweek_scores_comp_gw_user_key" UNIQUE ("competition_id", "gameweek_id", "user_id");



ALTER TABLE ONLY "public"."gameweek_scores"
    ADD CONSTRAINT "gameweek_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gameweeks"
    ADD CONSTRAINT "gameweeks_competition_id_number_key" UNIQUE ("competition_id", "number");



ALTER TABLE ONLY "public"."gameweeks"
    ADD CONSTRAINT "gameweeks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_fixtures"
    ADD CONSTRAINT "group_fixtures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_competition_id_email_key" UNIQUE ("competition_id", "email");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_user_id_gameweek_id_kind_channel_key" UNIQUE ("user_id", "gameweek_id", "kind", "channel");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_competition_id_user_id_key" UNIQUE ("competition_id", "user_id");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."point_rules"
    ADD CONSTRAINT "point_rules_competition_id_key" UNIQUE ("competition_id");



ALTER TABLE ONLY "public"."point_rules"
    ADD CONSTRAINT "point_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_fixture_id_user_id_key" UNIQUE ("fixture_id", "user_id");



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_fixture_id_user_id_reminder_type_channel_key" UNIQUE ("fixture_id", "user_id", "reminder_type", "channel");



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."triple_points_plays"
    ADD CONSTRAINT "triple_points_plays_competition_id_user_id_half_key" UNIQUE ("competition_id", "user_id", "half");



ALTER TABLE ONLY "public"."triple_points_plays"
    ADD CONSTRAINT "triple_points_plays_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_bracket_comp" ON "public"."bracket_matches" USING "btree" ("competition_id");



CREATE INDEX "idx_fx_gw" ON "public"."fixtures" USING "btree" ("gameweek_id");



CREATE INDEX "idx_gw_comp" ON "public"."gameweeks" USING "btree" ("competition_id");



CREATE INDEX "idx_gw_month" ON "public"."gameweeks" USING "btree" ("month_key");



CREATE INDEX "idx_gws_gw" ON "public"."gameweek_scores" USING "btree" ("gameweek_id");



CREATE INDEX "idx_gws_user" ON "public"."gameweek_scores" USING "btree" ("user_id");



CREATE INDEX "idx_notification_log_user" ON "public"."notification_log" USING "btree" ("user_id");



CREATE INDEX "idx_part_comp" ON "public"."participants" USING "btree" ("competition_id");



CREATE INDEX "idx_pred_gw" ON "public"."predictions" USING "btree" ("gameweek_id");



CREATE INDEX "idx_pred_user" ON "public"."predictions" USING "btree" ("user_id");



CREATE INDEX "idx_push_tokens_user" ON "public"."push_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_reminder_fx" ON "public"."reminder_log" USING "btree" ("fixture_id");



CREATE INDEX "idx_reminder_user" ON "public"."reminder_log" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "on_competition_created" AFTER INSERT ON "public"."competitions" FOR EACH ROW EXECUTE FUNCTION "public"."create_default_rules"();



CREATE OR REPLACE TRIGGER "on_competition_created_add_admin" AFTER INSERT ON "public"."competitions" FOR EACH ROW EXECUTE FUNCTION "public"."create_admin_participant"();



CREATE OR REPLACE TRIGGER "trg_auto_join_new_profile" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."auto_join_new_profile_to_competitions"();



CREATE OR REPLACE TRIGGER "trg_auto_join_profiles_to_new_competition" AFTER INSERT ON "public"."competitions" FOR EACH ROW EXECUTE FUNCTION "public"."auto_join_profiles_to_new_competition"();



CREATE OR REPLACE TRIGGER "trg_touch_prediction_submitted_at" BEFORE UPDATE ON "public"."predictions" FOR EACH ROW EXECUTE FUNCTION "public"."touch_prediction_submitted_at"();



CREATE OR REPLACE TRIGGER "trg_tp_complete_predictions" BEFORE INSERT ON "public"."triple_points_plays" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_triple_points_complete_predictions"();



ALTER TABLE ONLY "public"."bracket_matches"
    ADD CONSTRAINT "bracket_matches_away_user_id_fkey" FOREIGN KEY ("away_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bracket_matches"
    ADD CONSTRAINT "bracket_matches_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bracket_matches"
    ADD CONSTRAINT "bracket_matches_feeds_into_match_id_fkey" FOREIGN KEY ("feeds_into_match_id") REFERENCES "public"."bracket_matches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bracket_matches"
    ADD CONSTRAINT "bracket_matches_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bracket_matches"
    ADD CONSTRAINT "bracket_matches_home_user_id_fkey" FOREIGN KEY ("home_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bracket_matches"
    ADD CONSTRAINT "bracket_matches_winner_user_id_fkey" FOREIGN KEY ("winner_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bracket_predictions"
    ADD CONSTRAINT "bracket_predictions_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bracket_predictions"
    ADD CONSTRAINT "bracket_predictions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."bracket_matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bracket_predictions"
    ADD CONSTRAINT "bracket_predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bracket_round_gameweeks"
    ADD CONSTRAINT "bracket_round_gameweeks_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bracket_round_gameweeks"
    ADD CONSTRAINT "bracket_round_gameweeks_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."closed_months"
    ADD CONSTRAINT "closed_months_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."competition_gameweeks"
    ADD CONSTRAINT "competition_gameweeks_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."competition_gameweeks"
    ADD CONSTRAINT "competition_gameweeks_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."competitions"
    ADD CONSTRAINT "competitions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."competitions"
    ADD CONSTRAINT "competitions_rules_source_competition_id_fkey" FOREIGN KEY ("rules_source_competition_id") REFERENCES "public"."competitions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fixtures"
    ADD CONSTRAINT "fixtures_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gameweek_scores"
    ADD CONSTRAINT "gameweek_scores_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gameweek_scores"
    ADD CONSTRAINT "gameweek_scores_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gameweek_scores"
    ADD CONSTRAINT "gameweek_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gameweeks"
    ADD CONSTRAINT "gameweeks_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_fixtures"
    ADD CONSTRAINT "group_fixtures_away_user_id_fkey" FOREIGN KEY ("away_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_fixtures"
    ADD CONSTRAINT "group_fixtures_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_fixtures"
    ADD CONSTRAINT "group_fixtures_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."group_fixtures"
    ADD CONSTRAINT "group_fixtures_home_user_id_fkey" FOREIGN KEY ("home_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."point_rules"
    ADD CONSTRAINT "point_rules_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."triple_points_plays"
    ADD CONSTRAINT "triple_points_plays_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."triple_points_plays"
    ADD CONSTRAINT "triple_points_plays_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."triple_points_plays"
    ADD CONSTRAINT "triple_points_plays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "bpred_select" ON "public"."bracket_predictions" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "bpred_write" ON "public"."bracket_predictions" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "bracket_admin" ON "public"."bracket_matches" USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "bracket_matches"."competition_id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



ALTER TABLE "public"."bracket_matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bracket_predictions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bracket_predictions_admin_update" ON "public"."bracket_predictions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "bracket_predictions"."competition_id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



ALTER TABLE "public"."bracket_round_gameweeks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bracket_round_gws_admin" ON "public"."bracket_round_gameweeks" USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "bracket_round_gameweeks"."competition_id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



CREATE POLICY "bracket_round_gws_select" ON "public"."bracket_round_gameweeks" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "bracket_select" ON "public"."bracket_matches" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."closed_months" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "closed_months_admin" ON "public"."closed_months" USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "closed_months"."competition_id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



CREATE POLICY "closed_months_select" ON "public"."closed_months" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."competition_gameweeks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "competition_gameweeks_admin" ON "public"."competition_gameweeks" USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



CREATE POLICY "competition_gameweeks_select" ON "public"."competition_gameweeks" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."competitions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "competitions_admin_delete" ON "public"."competitions" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "competitions"."id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



CREATE POLICY "competitions_admin_update" ON "public"."competitions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "competitions"."id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



CREATE POLICY "competitions_insert" ON "public"."competitions" FOR INSERT WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "competitions_select" ON "public"."competitions" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."fixtures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fixtures_admin" ON "public"."fixtures" USING ((EXISTS ( SELECT 1
   FROM ("public"."participants" "pa"
     JOIN "public"."gameweeks" "gw" ON (("gw"."competition_id" = "pa"."competition_id")))
  WHERE (("gw"."id" = "fixtures"."gameweek_id") AND ("pa"."user_id" = "auth"."uid"()) AND ("pa"."role" = 'admin'::"text")))));



CREATE POLICY "fixtures_select" ON "public"."fixtures" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."gameweek_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gameweeks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gameweeks_admin" ON "public"."gameweeks" USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "gameweeks"."competition_id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



CREATE POLICY "gameweeks_select" ON "public"."gameweeks" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."group_fixtures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "group_fixtures_admin" ON "public"."group_fixtures" USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "group_fixtures"."competition_id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



CREATE POLICY "group_fixtures_select" ON "public"."group_fixtures" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "gw_scores_admin" ON "public"."gameweek_scores" USING ((EXISTS ( SELECT 1
   FROM ("public"."participants" "pa"
     JOIN "public"."gameweeks" "gw" ON (("gw"."competition_id" = "pa"."competition_id")))
  WHERE (("gw"."id" = "gameweek_scores"."gameweek_id") AND ("pa"."user_id" = "auth"."uid"()) AND ("pa"."role" = 'admin'::"text")))));



CREATE POLICY "gw_scores_select" ON "public"."gameweek_scores" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_admin" ON "public"."invitations" USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "invitations"."competition_id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



CREATE POLICY "invitations_select" ON "public"."invitations" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."notification_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_log_own" ON "public"."notification_log" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."participants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "participants_delete" ON "public"."participants" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."participants" "p2"
  WHERE (("p2"."competition_id" = "p2"."competition_id") AND ("p2"."user_id" = "auth"."uid"()) AND ("p2"."role" = 'admin'::"text")))));



CREATE POLICY "participants_insert" ON "public"."participants" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."participants" "p2"
  WHERE (("p2"."competition_id" = "participants"."competition_id") AND ("p2"."user_id" = "auth"."uid"()) AND ("p2"."role" = 'admin'::"text"))))));



CREATE POLICY "participants_select" ON "public"."participants" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."point_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."predictions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "predictions_admin_update" ON "public"."predictions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."participants" "pa"
     JOIN "public"."gameweeks" "gw" ON (("gw"."competition_id" = "pa"."competition_id")))
  WHERE (("gw"."id" = "predictions"."gameweek_id") AND ("pa"."user_id" = "auth"."uid"()) AND ("pa"."role" = 'admin'::"text")))));



CREATE POLICY "predictions_insert" ON "public"."predictions" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."fixtures" "f"
  WHERE (("f"."id" = "predictions"."fixture_id") AND ("f"."kickoff_time" > "now"()))))));



CREATE POLICY "predictions_select" ON "public"."predictions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."participants" "pa"
     JOIN "public"."gameweeks" "gw" ON (("gw"."competition_id" = "pa"."competition_id")))
  WHERE (("gw"."id" = "predictions"."gameweek_id") AND ("pa"."user_id" = "auth"."uid"()) AND ("pa"."role" = 'admin'::"text")))) OR (EXISTS ( SELECT 1
   FROM (("public"."fixtures" "f"
     JOIN "public"."gameweeks" "gw" ON (("gw"."id" = "f"."gameweek_id")))
     JOIN "public"."participants" "pa" ON (("pa"."competition_id" = "gw"."competition_id")))
  WHERE (("f"."id" = "predictions"."fixture_id") AND ("f"."kickoff_time" <= "now"()) AND ("pa"."user_id" = "auth"."uid"()))))));



CREATE POLICY "predictions_update" ON "public"."predictions" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."fixtures" "f"
  WHERE (("f"."id" = "predictions"."fixture_id") AND ("f"."kickoff_time" > "now"()))))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "profiles_update" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK ((("auth"."uid"() = "id") AND (("role" <> 'admin'::"text") OR (NOT (EXISTS ( SELECT 1
   FROM "public"."profiles" "profiles_1"
  WHERE (("profiles_1"."role" = 'admin'::"text") AND ("profiles_1"."id" <> "auth"."uid"()))))))));



ALTER TABLE "public"."push_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_tokens_own" ON "public"."push_tokens" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."reminder_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reminder_log_admin" ON "public"."reminder_log" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "rules_all" ON "public"."point_rules" USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "point_rules"."competition_id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



CREATE POLICY "rules_select" ON "public"."point_rules" FOR SELECT USING (true);



CREATE POLICY "tpp_admin" ON "public"."triple_points_plays" USING ((EXISTS ( SELECT 1
   FROM "public"."participants"
  WHERE (("participants"."competition_id" = "triple_points_plays"."competition_id") AND ("participants"."user_id" = "auth"."uid"()) AND ("participants"."role" = 'admin'::"text")))));



CREATE POLICY "tpp_insert" ON "public"."triple_points_plays" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."competitions" "c"
  WHERE (("c"."id" = "triple_points_plays"."competition_id") AND ("c"."format" = 'league'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."gameweeks" "gw"
  WHERE (("gw"."id" = "triple_points_plays"."gameweek_id") AND ("gw"."triple_points_blocked" = false)))) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."fixtures" "f"
  WHERE (("f"."gameweek_id" = "triple_points_plays"."gameweek_id") AND ("f"."kickoff_time" <= "now"())))))));



CREATE POLICY "tpp_select" ON "public"."triple_points_plays" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."triple_points_plays" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT ALL ON SCHEMA "public" TO PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
































































































































































































GRANT ALL ON TABLE "public"."bracket_matches" TO "anon";
GRANT ALL ON TABLE "public"."bracket_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."bracket_matches" TO "service_role";



GRANT ALL ON TABLE "public"."bracket_predictions" TO "anon";
GRANT ALL ON TABLE "public"."bracket_predictions" TO "authenticated";
GRANT ALL ON TABLE "public"."bracket_predictions" TO "service_role";



GRANT ALL ON TABLE "public"."bracket_round_gameweeks" TO "anon";
GRANT ALL ON TABLE "public"."bracket_round_gameweeks" TO "authenticated";
GRANT ALL ON TABLE "public"."bracket_round_gameweeks" TO "service_role";



GRANT ALL ON TABLE "public"."closed_months" TO "anon";
GRANT ALL ON TABLE "public"."closed_months" TO "authenticated";
GRANT ALL ON TABLE "public"."closed_months" TO "service_role";



GRANT ALL ON TABLE "public"."competition_gameweeks" TO "anon";
GRANT ALL ON TABLE "public"."competition_gameweeks" TO "authenticated";
GRANT ALL ON TABLE "public"."competition_gameweeks" TO "service_role";



GRANT ALL ON TABLE "public"."competitions" TO "anon";
GRANT ALL ON TABLE "public"."competitions" TO "authenticated";
GRANT ALL ON TABLE "public"."competitions" TO "service_role";



GRANT ALL ON TABLE "public"."fixtures" TO "anon";
GRANT ALL ON TABLE "public"."fixtures" TO "authenticated";
GRANT ALL ON TABLE "public"."fixtures" TO "service_role";



GRANT ALL ON TABLE "public"."gameweek_scores" TO "anon";
GRANT ALL ON TABLE "public"."gameweek_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."gameweek_scores" TO "service_role";



GRANT ALL ON TABLE "public"."gameweeks" TO "anon";
GRANT ALL ON TABLE "public"."gameweeks" TO "authenticated";
GRANT ALL ON TABLE "public"."gameweeks" TO "service_role";



GRANT ALL ON TABLE "public"."group_fixtures" TO "anon";
GRANT ALL ON TABLE "public"."group_fixtures" TO "authenticated";
GRANT ALL ON TABLE "public"."group_fixtures" TO "service_role";



GRANT ALL ON TABLE "public"."group_standings" TO "anon";
GRANT ALL ON TABLE "public"."group_standings" TO "authenticated";
GRANT ALL ON TABLE "public"."group_standings" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."triple_points_plays" TO "anon";
GRANT ALL ON TABLE "public"."triple_points_plays" TO "authenticated";
GRANT ALL ON TABLE "public"."triple_points_plays" TO "service_role";



GRANT ALL ON TABLE "public"."leaderboard_overall" TO "anon";
GRANT ALL ON TABLE "public"."leaderboard_overall" TO "authenticated";
GRANT ALL ON TABLE "public"."leaderboard_overall" TO "service_role";



GRANT ALL ON TABLE "public"."notification_log" TO "anon";
GRANT ALL ON TABLE "public"."notification_log" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_log" TO "service_role";



GRANT ALL ON TABLE "public"."participants" TO "anon";
GRANT ALL ON TABLE "public"."participants" TO "authenticated";
GRANT ALL ON TABLE "public"."participants" TO "service_role";



GRANT ALL ON TABLE "public"."point_rules" TO "anon";
GRANT ALL ON TABLE "public"."point_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."point_rules" TO "service_role";



GRANT ALL ON TABLE "public"."predictions" TO "anon";
GRANT ALL ON TABLE "public"."predictions" TO "authenticated";
GRANT ALL ON TABLE "public"."predictions" TO "service_role";



GRANT ALL ON TABLE "public"."push_tokens" TO "anon";
GRANT ALL ON TABLE "public"."push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."push_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_log" TO "anon";
GRANT ALL ON TABLE "public"."reminder_log" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_log" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




























