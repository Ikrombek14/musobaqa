-- Yoʻnalishlar yangilandi: Sumo ikkiga boʻlindi (Arduino / Lego),
-- kodlar yorliq prefikslariga moslashtirildi.
--
--   R  → F   Robofutbol
--   S  → S   Arduino Robosumo (nomi oʻzgardi)
--   —  → LS  Lego Robosumo (yangi)
--   L  → LF  Linefollower
--   RR → RC  Roborace
--
-- Va har yoʻnalish uchun yorliqlar oldindan yaratiladi: chop etiladigan
-- raqam + QR. Musobaqa kunida raqam AVTOMATIK berilmaydi — admin bolaning
-- robotiga qogʻozni yopishtirib, oʻsha yorliqni jamoaga biriktiradi.

-- 1) Yangi yoʻnalishlar
insert into categories (code, name, format, group_size, match_minutes, field_count)
values
  ('F',  'Robofutbol',       'group_playoff', 4, 5, 3),
  ('LS', 'Lego Robosumo',    'single_elim',   4, 3, 2),
  ('LF', 'Linefollower',     'time_trial',    4, 3, 2),
  ('RC', 'Roborace',         'single_elim',   4, 3, 2)
on conflict (code) do nothing;
--> statement-breakpoint

update categories set name = 'Arduino Robosumo' where code = 'S';
--> statement-breakpoint

-- 2) Mavjud maʼlumotni yangi kodlarga koʻchiramiz
update teams      set category_code = 'F'  where category_code = 'R';
--> statement-breakpoint
update teams      set category_code = 'LF' where category_code = 'L';
--> statement-breakpoint
update teams      set category_code = 'RC' where category_code = 'RR';
--> statement-breakpoint
update groups     set category_code = 'F'  where category_code = 'R';
--> statement-breakpoint
update groups     set category_code = 'LF' where category_code = 'L';
--> statement-breakpoint
update groups     set category_code = 'RC' where category_code = 'RR';
--> statement-breakpoint
update matches    set category_code = 'F'  where category_code = 'R';
--> statement-breakpoint
update matches    set category_code = 'LF' where category_code = 'L';
--> statement-breakpoint
update matches    set category_code = 'RC' where category_code = 'RR';
--> statement-breakpoint
update draws      set category_code = 'F'  where category_code = 'R';
--> statement-breakpoint
update draws      set category_code = 'LF' where category_code = 'L';
--> statement-breakpoint
update draws      set category_code = 'RC' where category_code = 'RR';
--> statement-breakpoint
update judges     set category_code = 'F'  where category_code = 'R';
--> statement-breakpoint
update judges     set category_code = 'LF' where category_code = 'L';
--> statement-breakpoint
update judges     set category_code = 'RC' where category_code = 'RR';
--> statement-breakpoint

-- 3) Eski kodlar
delete from categories where code in ('R', 'L', 'RR');
--> statement-breakpoint

-- 4) Yorliqlarni yaratish. `on conflict do nothing` — migratsiya qayta
--    ishga tushsa biriktirilgan yorliqlar bosib ketilmaydi.
insert into tags (category_code, code, number, copies)
select 'F', 'F' || n, n, 2 from generate_series(1, 50) n
on conflict (category_code, code) do nothing;
--> statement-breakpoint

insert into tags (category_code, code, number, copies)
select 'S', 'S' || n, n, 1 from generate_series(1, 50) n
on conflict (category_code, code) do nothing;
--> statement-breakpoint

insert into tags (category_code, code, number, copies)
select 'LS', 'LS' || n, n, 1 from generate_series(1, 50) n
on conflict (category_code, code) do nothing;
--> statement-breakpoint

insert into tags (category_code, code, number, copies)
select 'LF', 'LF' || n, n, 1 from generate_series(1, 30) n
on conflict (category_code, code) do nothing;
--> statement-breakpoint

insert into tags (category_code, code, number, copies)
select 'RC', 'RC' || n, n, 1 from generate_series(1, 50) n
on conflict (category_code, code) do nothing;
--> statement-breakpoint

-- 5) Allaqachon raqam berilgan jamoalar boʻlsa (sinov maʼlumoti),
--    ularni mos yorliqqa bogʻlaymiz — yorliq band boʻlib qolmasin.
update tags t
   set team_id = x.id, assigned_at = x.checked_in_at, assigned_by = x.checked_in_by
  from (
    select id, category_code, number, checked_in_at, checked_in_by
      from teams
     where number is not null
  ) x
 where t.category_code = x.category_code
   and t.code = x.number
   and t.team_id is null;
