import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { INVARIANT_CATALOG } from "@/modules/financial/invariant-catalog";

const outputPath = join(process.cwd(), "context", "reviews", "invariant-catalog.md");

async function main(): Promise<void> {
  const rows = INVARIANT_CATALOG.map((invariant) =>
    [
      invariant.id,
      invariant.name,
      invariant.phase,
      invariant.scope,
      invariant.description,
    ]
      .map(escapeMarkdownTableCell)
      .join(" | ")
  );

  const content = [
    "# Invariant Catalog",
    "",
    "| ID | Name | Phase | Scope | Description |",
    "|----|------|-------|-------|-------------|",
    ...rows.map((row) => `| ${row} |`),
    "",
  ].join("\n");

  await writeFile(outputPath, content, "utf8");
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
