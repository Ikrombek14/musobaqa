-- Realtime yadro va yordamchi triggerlar.
-- Drizzle schema'da ifodalab bo'lmaydigan qism: NOTIFY, updated_at, fuzzy qidiruv.

-- ============================================================
-- 1. Fuzzy qidiruv (check-in: 2-3 harfdan ishlashi kerak)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS teams_search_trgm_idx
  ON teams USING gin (search_text gin_trgm_ops);
--> statement-breakpoint

-- ============================================================
-- 2. updated_at — baza darajasida, ilova unutmasin
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER teams_set_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER matches_set_updated_at BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- ============================================================
-- 3. Realtime: events jadvaliga qator qo'shilsa NOTIFY
--
-- Payload'da FAQAT id va kanal ketadi (NOTIFY limiti 8000 bayt —
-- to'liq natijani yuborsak katta o'yin ro'yxatida uzilib qolishi mumkin).
-- Node protsessi id'ni ko'rib, yo'qolgan qatorlarni bitta SELECT bilan oladi.
-- ============================================================
CREATE OR REPLACE FUNCTION notify_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'qara_events',
    json_build_object('id', NEW.id, 'channel', NEW.channel)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER events_notify AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION notify_event();
--> statement-breakpoint

-- ============================================================
-- 4. Raqam berish — bitta tranzaksiya ichida, poyga holatisiz.
--
-- Ikki registratsiya stoli ayni soniyada check-in qilsa ham
-- FOR UPDATE navbatga qo'yadi: R12 ikki marta berilmaydi.
-- ============================================================
CREATE OR REPLACE FUNCTION allocate_team_number(
  p_team_id bigint,
  p_actor text
) RETURNS text AS $$
DECLARE
  v_category text;
  v_prefix   text;
  v_seq      integer;
  v_number   text;
  v_existing text;
BEGIN
  -- Allaqachon raqam berilgan bo'lsa — o'shani qaytaramiz (idempotent).
  SELECT category_code, number INTO v_category, v_existing
    FROM teams WHERE id = p_team_id FOR UPDATE;

  IF v_category IS NULL THEN
    RAISE EXCEPTION 'Jamoa topilmadi: %', p_team_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Yo'nalish qatorini qulflaymiz — hisoblagich shu yerda.
  UPDATE categories
     SET last_number = last_number + 1
   WHERE code = v_category
  RETURNING last_number INTO v_seq;

  v_prefix := v_category;
  -- 99 gacha ikki xonali (R01), keyin tabiiy o'sadi (R100)
  v_number := v_prefix || lpad(v_seq::text, 2, '0');

  UPDATE teams
     SET number = v_number,
         number_seq = v_seq,
         checked_in_at = COALESCE(checked_in_at, now()),
         checked_in_by = COALESCE(checked_in_by, p_actor)
   WHERE id = p_team_id;

  RETURN v_number;
END;
$$ LANGUAGE plpgsql;
