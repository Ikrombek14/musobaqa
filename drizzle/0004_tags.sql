CREATE TABLE "tags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category_code" text NOT NULL,
	"code" text NOT NULL,
	"number" integer NOT NULL,
	"copies" integer DEFAULT 1 NOT NULL,
	"team_id" bigint,
	"assigned_at" timestamp with time zone,
	"assigned_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_category_code_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."categories"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_code_key" ON "tags" USING btree ("category_code","code");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_team_key" ON "tags" USING btree ("team_id") WHERE "tags"."team_id" is not null;--> statement-breakpoint
CREATE INDEX "tags_category_idx" ON "tags" USING btree ("category_code","number");