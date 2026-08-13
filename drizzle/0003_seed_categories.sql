-- Yoʻnalishlar — maʼlumotnoma, foydalanuvchi maʼlumoti emas.
--
-- Ular boʻlmasa tizim umuman ishlamaydi: jamoa qoʻshib boʻlmaydi,
-- jerebyovka oʻtkazib boʻlmaydi, admin sahifalari boʻsh chiqadi.
-- Shuning uchun seed skriptiga emas, migratsiyaga qoʻyilgan:
-- har qanday yangi oʻrnatish darhol ishlaydigan holatda boʻladi.
--
-- Sozlamalar (guruh oʻlchami, oʻyin davomiyligi, maydonlar soni)
-- keyin admin panelida oʻzgartiriladi — shuning uchun `do nothing`:
-- qayta ishga tushirilsa tashkilotchi sozlamalarini bosib ketmaydi.

insert into categories (code, name, format, group_size, match_minutes, field_count)
values
  ('R',  'Robofutbol',   'group_playoff', 4, 5, 3),
  ('S',  'Sumo',         'single_elim',   4, 3, 2),
  ('L',  'Linefollower', 'time_trial',    4, 3, 2),
  ('RR', 'Robrace',      'single_elim',   4, 3, 2)
on conflict (code) do nothing;
