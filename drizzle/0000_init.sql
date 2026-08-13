CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"group_size" integer DEFAULT 4 NOT NULL,
	"match_minutes" integer DEFAULT 5 NOT NULL,
	"field_count" integer DEFAULT 3 NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"draw_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draws" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category_code" text NOT NULL,
	"seed" text NOT NULL,
	"team_ids" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_teams" (
	"group_id" bigint NOT NULL,
	"team_id" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category_code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judges" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pin_hash" text NOT NULL,
	"category_code" text NOT NULL,
	"field_no" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category_code" text NOT NULL,
	"stage" text NOT NULL,
	"group_id" bigint,
	"round" integer DEFAULT 0 NOT NULL,
	"slot" integer DEFAULT 0 NOT NULL,
	"field_no" integer,
	"order_no" integer DEFAULT 0 NOT NULL,
	"team_a_id" bigint,
	"team_b_id" bigint,
	"score_a" integer DEFAULT 0 NOT NULL,
	"score_b" integer DEFAULT 0 NOT NULL,
	"rounds_json" jsonb,
	"winner_id" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_bye" boolean DEFAULT false NOT NULL,
	"next_match_id" bigint,
	"next_slot" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"judge_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"birth_year" integer,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "robots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" bigint NOT NULL,
	"photo_path" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_by" text
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" bigint NOT NULL,
	"attempt_no" integer NOT NULL,
	"raw_ms" integer DEFAULT 0 NOT NULL,
	"penalties" integer DEFAULT 0 NOT NULL,
	"final_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"judge_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category_code" text NOT NULL,
	"number" text,
	"number_seq" integer,
	"name" text NOT NULL,
	"school" text,
	"region" text,
	"coach" text,
	"phone" text,
	"search_text" text DEFAULT '' NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_in_by" text,
	"walk_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draws" ADD CONSTRAINT "draws_category_code_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."categories"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_teams" ADD CONSTRAINT "group_teams_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_teams" ADD CONSTRAINT "group_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_category_code_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."categories"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judges" ADD CONSTRAINT "judges_category_code_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."categories"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_category_code_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."categories"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_a_id_teams_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_b_id_teams_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_id_teams_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robots" ADD CONSTRAINT "robots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_category_code_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."categories"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "draws_category_idx" ON "draws" USING btree ("category_code","created_at");--> statement-breakpoint
CREATE INDEX "events_channel_id_idx" ON "events" USING btree ("channel","id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_teams_pk" ON "group_teams" USING btree ("group_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_teams_team_key" ON "group_teams" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_category_name_key" ON "groups" USING btree ("category_code","name");--> statement-breakpoint
CREATE INDEX "judges_category_idx" ON "judges" USING btree ("category_code","active");--> statement-breakpoint
CREATE INDEX "matches_category_stage_idx" ON "matches" USING btree ("category_code","stage","round");--> statement-breakpoint
CREATE INDEX "matches_group_idx" ON "matches" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "matches_field_idx" ON "matches" USING btree ("category_code","field_no","status");--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "participants_team_idx" ON "participants" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "robots_team_idx" ON "robots" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_team_attempt_key" ON "runs" USING btree ("team_id","attempt_no");--> statement-breakpoint
CREATE INDEX "runs_team_idx" ON "runs" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_category_number_key" ON "teams" USING btree ("category_code","number") WHERE "teams"."number" is not null;--> statement-breakpoint
CREATE INDEX "teams_category_idx" ON "teams" USING btree ("category_code");--> statement-breakpoint
CREATE INDEX "teams_search_idx" ON "teams" USING btree ("search_text");--> statement-breakpoint
CREATE INDEX "teams_checked_in_idx" ON "teams" USING btree ("category_code","checked_in_at");