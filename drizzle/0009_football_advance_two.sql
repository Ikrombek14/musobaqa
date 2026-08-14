-- Robofutbolda guruhdan IKKI jamoa chiqadi.
--
-- Tashkilotchi qarori: guruhlar 4 talik, gʻolib bilan birga ikkinchi
-- oʻrin ham pleyoffga oʻtadi — toʻr kattaroq va musobaqa qiziqroq
-- boʻladi. Boshqa yoʻnalishlarda guruh bosqichi yoʻq, ularda bu
-- qiymat ishlatilmaydi.
--
-- Tashkilotchi buni /admin/sozlamalar da istalgan vaqt (pleyoff
-- boshlanmagunicha) oʻzgartira oladi — bu faqat boshlangʻich qiymat.
update categories set advance_per_group = 2 where code = 'F';
