-- 3-oʻrin uchun oʻyin (bronza).
--
-- Yarim finalda yutqazgan ikki jamoa oʻzaro oʻynaydi. Gʻolibni keyingi
-- bosqichga koʻchirish uchun `next_match_id` bor edi; endi YUTQAZGANNI
-- koʻchirish uchun ham juftlik kerak.
alter table matches
  add column if not exists third_place boolean not null default false,
  add column if not exists loser_match_id bigint references matches(id) on delete set null,
  add column if not exists loser_slot text;

-- Finalda ham, 3-oʻrin oʻyinida ham round bir xil (oxirgi bosqich),
-- shuning uchun ularni slot bilan ajratamiz. Indeks toʻrni chizishda
-- ishlatiladi.
create index if not exists matches_third_place_idx
  on matches (category_code, third_place)
  where third_place = true;
