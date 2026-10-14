import prisma from "../src/lib/prisma.js";
import { decodeEtsyTitleEntities } from "../src/modules/research/research.etsy.js";

type Row = { id: string; etsyListingId: string; title: string | null };
const apply = process.argv.slice(2).includes("--apply");

async function main(): Promise<void> {
  if (process.argv.slice(2).some((arg) => arg !== "--apply")) throw new Error("Usage: pnpm tsx scripts/repair-etsy-title-entities.ts [--apply]");
  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id, "etsyListingId", title FROM "ResearchItem"
      WHERE title LIKE ${"%&%"}
    `;
    const candidates = rows.flatMap((row) => {
      const decodedTitle = row.title === null ? null : decodeEtsyTitleEntities(row.title);
      return decodedTitle !== row.title && decodedTitle !== null ? [{ ...row, decodedTitle }] : [];
    });
    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Affected rows: ${candidates.length}`);
    for (const row of candidates.slice(0, 10)) console.log(`${row.etsyListingId}: ${row.title} -> ${row.decodedTitle}`);
    if (!apply) { console.log("Database writes: 0"); return; }
    let updated = 0;
    for (const row of candidates) {
      updated += await prisma.$executeRaw`
        UPDATE "ResearchItem" SET "title" = ${row.decodedTitle}
        WHERE "id" = ${row.id} AND "title" = ${row.title}
      `;
    }
    console.log(`Rows updated: ${updated}`);
  } finally { await prisma.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error); process.exit(1); });
