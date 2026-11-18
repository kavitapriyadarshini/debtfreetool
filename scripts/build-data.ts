import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const outDir = join(root, "src", "data");

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;

/** Blank → null, True/False → boolean, numeric text → number, anything else stays a string. */
export function parseCell(raw: string): string | number | boolean | null {
  if (raw === "") return null;
  if (raw === "True") return true;
  if (raw === "False") return false;
  if (NUMBER.test(raw)) return Number(raw);
  return raw;
}

function parseFile(fileName: string): Record<string, string | number | boolean | null>[] {
  const csv = readFileSync(join(dataDir, fileName), "utf8");
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    const detail = result.errors
      .map((error) => `row ${error.row ?? "?"}: ${error.message}`)
      .join("; ");
    throw new Error(`Failed to parse ${fileName}: ${detail}`);
  }

  return result.data.map((row) => {
    const parsed: Record<string, string | number | boolean | null> = {};
    for (const [column, value] of Object.entries(row)) {
      if (column === "") continue;
      parsed[column] = parseCell(value ?? "");
    }
    return parsed;
  });
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(dataDir)
    .filter((name) => name.endsWith(".csv"))
    .sort();

  for (const fileName of files) {
    const rows = parseFile(fileName);
    const outName = `${basename(fileName, ".csv")}.json`;
    writeFileSync(join(outDir, outName), `${JSON.stringify(rows, null, 2)}\n`);
    console.log(`${fileName} → src/data/${outName} (${rows.length} rows)`);
  }
}

main();
