import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ============================================================
   Yo'nalish sozlamalari — admin panelda o'zgaradi
   ============================================================ */
export const categories = pgTable("categories", {
  code: text("code").primaryKey(), // R | S | L | RR
  name: text("name").notNull(),
  format: text("format").notNull(), // group_playoff | single_elim | time_trial
  groupSize: integer("group_size").notNull().default(4),
  matchMinutes: integer("match_minutes").notNull().default(5),
  fieldCount: integer("field_count").notNull().default(3),
  /** Raqam berish hisoblagichi. Check-in shu qatorni FOR UPDATE bilan qulflaydi. */
  lastNumber: integer("last_number").notNull().default(0),
  drawLocked: boolean("draw_locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ============================================================
   Jamoalar
   Raqam (number) check-in paytida beriladi — importda NULL.
   ============================================================ */
export const teams = pgTable(
  "teams",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    categoryCode: text("category_code")
      .notNull()
      .references(() => categories.code, { onDelete: "restrict" }),
    /** "R12" — faqat check-in'dan keyin to'ladi */
    number: text("number"),
    numberSeq: integer("number_seq"),
    name: text("name").notNull(),
    school: text("school"),
    region: text("region"),
    coach: text("coach"),
    phone: text("phone"),
    /** Qidiruv uchun normallashtirilgan matn (kichik harf, apostrofsiz) */
    searchText: text("search_text").notNull().default(""),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedInBy: text("checked_in_by"),
    /** Ro'yxatda bo'lmagan, check-in'da qo'shilgan jamoa */
    walkIn: boolean("walk_in").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("teams_category_number_key")
      .on(t.categoryCode, t.number)
      .where(sql`${t.number} is not null`),
    index("teams_category_idx").on(t.categoryCode),
    index("teams_search_idx").on(t.searchText),
    index("teams_checked_in_idx").on(t.categoryCode, t.checkedInAt),
  ],
);

export const participants = pgTable(
  "participants",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    birthYear: integer("birth_year"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("participants_team_idx").on(t.teamId)],
);

export const robots = pgTable(
  "robots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    photoPath: text("photo_path").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    capturedBy: text("captured_by"),
  },
  (t) => [index("robots_team_idx").on(t.teamId)],
);

/* ============================================================
   Guruhlar — faqat robofutbol
   ============================================================ */
export const groups = pgTable(
  "groups",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    categoryCode: text("category_code")
      .notNull()
      .references(() => categories.code, { onDelete: "restrict" }),
    name: text("name").notNull(), // "A", "B", ...
    /** Guruh qaysi maydonda o'ynaydi. null = avtomatik taqsimlanadi. */
    fieldNo: integer("field_no"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("groups_category_name_key").on(t.categoryCode, t.name)],
);

export const groupTeams = pgTable(
  "group_teams",
  {
    groupId: bigint("group_id", { mode: "number" })
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("group_teams_pk").on(t.groupId, t.teamId),
    uniqueIndex("group_teams_team_key").on(t.teamId),
  ],
);

/* ============================================================
   O'yinlar — robofutbol, sumo, robrace
   ============================================================ */
export const matches = pgTable(
  "matches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    categoryCode: text("category_code")
      .notNull()
      .references(() => categories.code, { onDelete: "restrict" }),
    stage: text("stage").notNull(), // group | playoff
    groupId: bigint("group_id", { mode: "number" }).references(() => groups.id, {
      onDelete: "cascade",
    }),
    /** Pleyoffda: 0 = final, 1 = yarim final, 2 = chorak... (teskari sanoq) */
    round: integer("round").notNull().default(0),
    slot: integer("slot").notNull().default(0),
    fieldNo: integer("field_no"),
    orderNo: integer("order_no").notNull().default(0),

    teamAId: bigint("team_a_id", { mode: "number" }).references(() => teams.id, {
      onDelete: "set null",
    }),
    teamBId: bigint("team_b_id", { mode: "number" }).references(() => teams.id, {
      onDelete: "set null",
    }),

    scoreA: integer("score_a").notNull().default(0),
    scoreB: integer("score_b").notNull().default(0),
    /** Sumo best-of-3: [{round:1, winner:"a"}, ...] · Robrace: {timeA, timeB} */
    roundsJson: jsonb("rounds_json").$type<unknown>(),

    winnerId: bigint("winner_id", { mode: "number" }).references(() => teams.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"), // pending | live | done
    /** Bay (raqibsiz o'tish) — avtomatik yopiladi */
    isBye: boolean("is_bye").notNull().default(false),

    /** Pleyoff simlari: g'olib qayerga ketadi */
    nextMatchId: bigint("next_match_id", { mode: "number" }),
    nextSlot: text("next_slot"), // a | b

    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    judgeId: bigint("judge_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("matches_category_stage_idx").on(t.categoryCode, t.stage, t.round),
    index("matches_group_idx").on(t.groupId),
    index("matches_field_idx").on(t.categoryCode, t.fieldNo, t.status),
    index("matches_status_idx").on(t.status),
  ],
);

/* ============================================================
   Urinishlar — linefollower
   ============================================================ */
export const runs = pgTable(
  "runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(), // 1 | 2
    rawMs: integer("raw_ms").notNull().default(0),
    penalties: integer("penalties").notNull().default(0),
    /** rawMs + penalties * 5000 */
    finalMs: integer("final_ms").notNull().default(0),
    status: text("status").notNull().default("ok"), // ok | dnf
    judgeId: bigint("judge_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("runs_team_attempt_key").on(t.teamId, t.attemptNo),
    index("runs_team_idx").on(t.teamId),
  ],
);

/* ============================================================
   Jerebyovka — seed saqlanadi, natija qayta hisoblab isbotlanadi
   ============================================================ */
export const draws = pgTable(
  "draws",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    categoryCode: text("category_code")
      .notNull()
      .references(() => categories.code, { onDelete: "restrict" }),
    seed: text("seed").notNull(),
    teamIds: jsonb("team_ids").$type<number[]>().notNull(),
    resultJson: jsonb("result_json").$type<unknown>().notNull(),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("draws_category_idx").on(t.categoryCode, t.createdAt)],
);

/* ============================================================
   Hakamlar
   ============================================================ */
export const judges = pgTable(
  "judges",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    pinHash: text("pin_hash").notNull(),
    categoryCode: text("category_code")
      .notNull()
      .references(() => categories.code, { onDelete: "restrict" }),
    fieldNo: integer("field_no"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("judges_category_idx").on(t.categoryCode, t.active)],
);

/* ============================================================
   Audit — kim, qachon, nima qildi
   ============================================================ */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_at_idx").on(t.at)],
);

/* ============================================================
   Realtime hodisalar oqimi
   Har bir yozuv o'zgarishi shu jadvalga qator qo'shadi.
   Trigger NOTIFY yuboradi → Node eshitadi → SSE orqali tarqatadi.
   id monotonik: uzilgan mijoz Last-Event-ID bilan yo'qolganini so'raydi.
   ============================================================ */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Kanal: yo'nalish kodi yoki "all" */
    channel: text("channel").notNull(),
    type: text("type").notNull(), // match.updated | run.saved | team.checked_in | draw.completed
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("events_channel_id_idx").on(t.channel, t.id)],
);
