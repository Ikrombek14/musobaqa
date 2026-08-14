-- Robofutbolda roʻyxatdagi ishtirokchilar soni yorliqlardan oshib ketdi:
-- 2026-avgust roʻyxatida 51 ta, yorliq esa F1–F50 edi. Musobaqa kuni
-- yana qoʻshiladiganlar ham boʻladi, shuning uchun zaxira bilan F75 gacha.
--
-- Yorliqlar hech qachon oʻchirilmaydi — faqat qoʻshiladi. Chop etilgan
-- qogʻozlar oʻz kuchida qoladi, F51–F75 alohida varaq boʻlib chiqadi
-- (/admin/raqamlar).
insert into tags (category_code, code, number, copies)
select 'F', 'F' || n, n, 2 from generate_series(51, 75) n
on conflict (category_code, code) do nothing;
