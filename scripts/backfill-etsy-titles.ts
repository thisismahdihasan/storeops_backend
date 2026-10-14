import prisma from "../src/lib/prisma.js";
import { fetchEtsyListingFromApi } from "../src/modules/research/research.etsy.js";

interface CliOptions {
  apply: boolean;
  workspaceId?: string;
}

interface EligibleResearchItem {
  id: string;
  etsyListingId: string;
  workspaceId: string;
  title: string | null;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function parseCliArgs(args: string[]): CliOptions {
  let apply = false;
  let workspaceId: string | undefined;
  const seenFlags = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--apply") {
      if (seenFlags.has("--apply")) {
        console.error("Error: Duplicate flag '--apply'");
        process.exit(1);
      }
      seenFlags.add("--apply");
      apply = true;
    } else if (arg === "--workspaceId") {
      if (seenFlags.has("--workspaceId")) {
        console.error("Error: Duplicate flag '--workspaceId'");
        process.exit(1);
      }
      seenFlags.add("--workspaceId");
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        console.error("Error: '--workspaceId' requires a non-empty string value");
        process.exit(1);
      }
      workspaceId = next.trim();
      if (!workspaceId) {
        console.error("Error: '--workspaceId' cannot be blank");
        process.exit(1);
      }
      i++; // consume value
    } else {
      console.error(`Error: Unknown or invalid argument '${arg}'`);
      console.error(
        "Usage: pnpm tsx scripts/backfill-etsy-titles.ts [--apply] [--workspaceId <id>]",
      );
      process.exit(1);
    }
  }

  return { apply, workspaceId };
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const { apply, workspaceId } = options;

  console.log("==================================================");
  console.log("STOREOPS — HISTORICAL ETSY TITLE BACKFILL");
  console.log("==================================================");
  console.log(`Execution Mode:  ${apply ? "LIVE APPLY (database updates enabled)" : "DRY RUN (zero database writes)"}`);
  console.log(`Workspace Scope: ${workspaceId ? workspaceId : "ALL WORKSPACES"}`);
  console.log("Request Delay:   350ms (concurrency: 1)");
  console.log("==================================================");

  try {
    const eligibleRows: EligibleResearchItem[] = workspaceId
      ? await prisma.$queryRaw<EligibleResearchItem[]>`
          SELECT id, "etsyListingId", "workspaceId", title
          FROM "ResearchItem"
          WHERE "workspaceId" = ${workspaceId}
            AND (title IS NULL OR TRIM(title) = '')
          ORDER BY "createdAt" ASC
        `
      : await prisma.$queryRaw<EligibleResearchItem[]>`
          SELECT id, "etsyListingId", "workspaceId", title
          FROM "ResearchItem"
          WHERE title IS NULL OR TRIM(title) = ''
          ORDER BY "createdAt" ASC
        `;

    const totalEligibleRows = eligibleRows.length;

    // Group eligible rows by etsyListingId to fetch each unique reference exactly once
    const rowsByListingId = new Map<string, EligibleResearchItem[]>();
    for (const row of eligibleRows) {
      const existing = rowsByListingId.get(row.etsyListingId) ?? [];
      existing.push(row);
      rowsByListingId.set(row.etsyListingId, existing);
    }

    const uniqueListings = Array.from(rowsByListingId.entries());
    const totalUniqueListings = uniqueListings.length;

    console.log(`Eligible Rows Found:  ${totalEligibleRows}`);
    console.log(`Unique Etsy Listings: ${totalUniqueListings}`);
    console.log("==================================================\n");

    if (totalUniqueListings === 0) {
      console.log("No eligible rows requiring title backfill. Nothing to do.");
      return;
    }

    let resolvedCount = 0;
    let unresolvedCount = 0;
    let rowsAffectedCount = 0;

    for (let i = 0; i < totalUniqueListings; i++) {
      const [etsyListingId, matchingRows] = uniqueListings[i];

      // Fetch Etsy listing metadata using the shared helper (only metadata.title is used)
      const metadata = await fetchEtsyListingFromApi(etsyListingId);
      const title = metadata.title;

      if (title === null) {
        console.log(`[SKIP] ${etsyListingId} — title could not be resolved`);
        unresolvedCount++;
      } else {
        resolvedCount++;

        if (!apply) {
          console.log(
            `[DRY-RUN] ${etsyListingId} -> "${title}" | eligible rows: ${matchingRows.length}`,
          );
          rowsAffectedCount += matchingRows.length;
        } else {
          let updatedForListing = 0;
          for (const row of matchingRows) {
            const affected = await prisma.$executeRaw`
              UPDATE "ResearchItem"
              SET "title" = ${title}
              WHERE "id" = ${row.id}
                AND ("title" IS NULL OR TRIM("title") = '')
            `;
            if (affected > 0) {
              updatedForListing += affected;
              rowsAffectedCount += affected;
            }
          }
          console.log(
            `[APPLY] ${etsyListingId} -> "${title}" | updated ${updatedForListing} row(s)`,
          );
        }
      }

      // Pace requests sequentially (350ms delay, skip after final item)
      if (i < totalUniqueListings - 1) {
        await sleep(350);
      }
    }

    console.log("\n==================================================");
    console.log("BACKFILL SUMMARY");
    console.log("==================================================");
    console.log(`Execution Mode:         ${apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Workspace Scope:        ${workspaceId ? workspaceId : "ALL"}`);
    console.log(`Eligible Rows Found:    ${totalEligibleRows}`);
    console.log(`Unique Listing IDs:     ${totalUniqueListings}`);
    console.log(`Titles Resolved:        ${resolvedCount}`);
    console.log(`Unresolved Listings:    ${unresolvedCount}`);
    if (!apply) {
      console.log(`Rows To Update:         ${rowsAffectedCount}`);
      console.log(`Database Writes:        0 (DRY RUN)`);
    } else {
      console.log(`Database Rows Updated:  ${rowsAffectedCount}`);
    }
    console.log("==================================================");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error("Fatal error during backfill execution:", err);
  process.exit(1);
});
