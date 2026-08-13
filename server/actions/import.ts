"use server";

import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { normalizeSearch } from "@/lib/format";
import { isCategoryCode } from "@/lib/categories";
import {
  dropEmptyRows,
  prepareRows,
  suggestMapping,
  type ImportRow,
  type Mapping,
} from "@/lib/import-mapping";

export type ParseResult =
  | {
      ok: true;
      headers: string[];
      rows: ImportRow[];
      mapping: Mapping;
      fileName: string;
      sheetName: string;
    }
  | { ok: false; error: string };

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 2000;

/**
 * Excel faylni oʻqiydi va ustunlarni taxmin qiladi.
 *
 * Bazaga HECH NARSA yozilmaydi — bu faqat oʻqish qadami. Admin ekranda
 * moslashni tuzatib, preview'ni koʻrgach tasdiqlaydi.
 *
 * SheetJS oʻrniga exceljs ishlatilgan: npm'dagi `xlsx` paketida maʼlum
 * zaifliklar bor, repozitoriy esa ochiq.
 */
export async function parseImportFile(formData: FormData): Promise<ParseResult> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Fayl tanlanmagan" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Fayl juda katta (8 MB dan oshmasin)" };
  }

  const isCsv = /\.csv$/i.test(file.name);
  const isXlsx = /\.xlsx$/i.test(file.name);
  if (!isCsv && !isXlsx) {
    return {
      ok: false,
      error:
        "Faqat .xlsx yoki .csv qabul qilinadi. Eski .xls boʻlsa Excelda «.xlsx» qilib saqlang.",
    };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = new ExcelJS.Workbook();

    if (isCsv) {
      const { Readable } = await import("node:stream");
      await workbook.csv.read(Readable.from(buffer));
    } else {
      // exceljs oʻz ichida eskiroq @types/node ga tayanadi va `Buffer`
      // tipi biznikidan farq qiladi. Qiymat aynan oʻsha Buffer —
      // faqat eʼlon boshqa, shuning uchun kutilgan tipga keltiramiz.
      type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
      await workbook.xlsx.load(buffer as unknown as XlsxInput);
    }

    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount === 0) {
      return { ok: false, error: "Faylda maʼlumot topilmadi" };
    }

    const table: ImportRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (table.length > MAX_ROWS + 1) return;
      const values: string[] = [];
      const count = Math.max(sheet.columnCount, row.cellCount);
      // exceljs kataklarni 1 dan sanaydi
      for (let c = 1; c <= count; c++) {
        values.push(cellText(row.getCell(c).value));
      }
      table.push(values);
    });

    const [headerRow, ...dataRows] = table;
    if (!headerRow) return { ok: false, error: "Sarlavha qatori topilmadi" };

    const rows = dropEmptyRows(dataRows).slice(0, MAX_ROWS);
    if (rows.length === 0) {
      return { ok: false, error: "Sarlavhadan keyin birorta qator yoʻq" };
    }

    const headers = headerRow.map((h, i) => h.trim() || `${i + 1}-ustun`);

    return {
      ok: true,
      headers,
      rows,
      mapping: suggestMapping(headers),
      fileName: file.name,
      sheetName: sheet.name,
    };
  } catch (err) {
    return { ok: false, error: `Faylni oʻqib boʻlmadi: ${(err as Error).message}` };
  }
}

/** Katakdagi qiymatni matnga aylantiradi: formula, sana, havola, rich text. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join("").trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  }
  return String(value).trim();
}

/* ============================================================
   Tasdiqlash — bazaga yozish
   ============================================================ */

export type CommitResult =
  | { ok: true; created: number; skipped: number; problems: number }
  | { ok: false; error: string };

/**
 * Jamoalarni bazaga qoʻshadi.
 *
 * MUHIM: import qilingan jamoaga RAQAM BERILMAYDI. Raqam check-in
 * paytida beriladi — kelmagan jamoa raqamni band qilmasligi kerak.
 *
 * Takror: bir yoʻnalishda bir xil nomli jamoa allaqachon boʻlsa
 * oʻtkazib yuboriladi. Shuning uchun importni ikki marta bosish
 * xavfsiz — dublikat yaratmaydi.
 */
export async function commitImport(
  rows: ImportRow[],
  mapping: Mapping,
): Promise<CommitResult> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "Import qilinadigan qator yoʻq" };
  }
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: `Bir vaqtda ${MAX_ROWS} tadan koʻp qator import qilinmaydi` };
  }

  const prepared = prepareRows(rows, mapping);
  const valid = prepared.filter(
    (t) => t.problem === null && t.categoryCode && isCategoryCode(t.categoryCode),
  );
  const problems = prepared.length - valid.length;

  if (valid.length === 0) {
    return { ok: false, error: "Birorta ham toʻgʻri qator topilmadi" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const codes = [...new Set(valid.map((t) => t.categoryCode!))];
      const existing = await tx
        .select({ name: schema.teams.name, categoryCode: schema.teams.categoryCode })
        .from(schema.teams)
        .where(inArray(schema.teams.categoryCode, codes));

      const seen = new Set(
        existing.map((t) => `${t.categoryCode}::${normalizeSearch(t.name)}`),
      );

      let created = 0;
      let skipped = 0;

      for (const team of valid) {
        const key = `${team.categoryCode}::${normalizeSearch(team.name)}`;
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);

        const [row] = await tx
          .insert(schema.teams)
          .values({
            categoryCode: team.categoryCode!,
            name: team.name,
            school: team.school,
            region: team.region,
            coach: team.coach,
            phone: team.phone,
            searchText: normalizeSearch(
              [team.name, team.school, team.coach, team.region, team.members.join(" ")]
                .filter(Boolean)
                .join(" "),
            ),
          })
          .returning({ id: schema.teams.id });

        for (const member of team.members) {
          await tx.insert(schema.participants).values({ teamId: row.id, fullName: member });
        }
        created++;
      }

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "teams.import",
        entity: "import",
        after: { created, skipped, problems, total: prepared.length },
      });

      return { created, skipped };
    });

    revalidatePath("/admin/jamoalar");
    revalidatePath("/admin");
    revalidatePath("/admin/import");
    revalidatePath("/");

    return { ok: true, created: result.created, skipped: result.skipped, problems };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
