-- Guruhdan nechta jamoa pleyoffga chiqadi.
--
-- Standart — 1 (faqat gʻolib). Tashkilotchi musobaqa borishiga qarab
-- 2 ga oshirishi mumkin: guruhlar kam boʻlsa toʻr juda kichik chiqadi.
-- Oʻzgartirish pleyoff tuzilgunga qadar (yoki hali oʻyin boshlanmagan
-- boʻlsa toʻrni qayta tuzish orqali) kuchga kiradi.
alter table categories
  add column if not exists advance_per_group integer not null default 1;

alter table categories
  add constraint chk_categories_advance
  check (advance_per_group between 1 and 4);
