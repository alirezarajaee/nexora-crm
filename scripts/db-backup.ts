/**
 * NEXORA CRM — SQLite online backup script.
 *
 * Uses `VACUUM INTO` (SQLite >= 3.27) which:
 *   - takes a consistent snapshot of the whole database,
 *   - is safe to run against a LIVE database with writers active
 *     (uses a short shared lock; never corrupts the source),
 *   - produces a compact, defragmented copy.
 *
 * Usage:
 *   bun run db:backup                # one snapshot into ./backups
 *   bun scripts/db-backup.ts --dir /path/to/backups --keep 14
 *
 * The backup directory must live on persistent storage. It is NOT exposed
 * through any web route (it sits outside `public/` and Next.js never serves
 * arbitrary project files).
 */
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? "";
  const m = url.match(/^file:(.+)$/);
  if (!m) {
    console.error("DATABASE_URL must be set and start with 'file:' (see .env)");
    process.exit(1);
  }
  return resolve(m[1].replace(/^\/\//, "/"));
}

const dbPath = resolveDbPath();
const outDir = resolve(
  process.argv.includes("--dir")
    ? process.argv[process.argv.indexOf("--dir") + 1]
    : join(process.cwd(), "backups")
);
const keep = Number(
  process.argv.includes("--keep") ? process.argv[process.argv.indexOf("--keep") + 1] : 10
);

mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = join(outDir, `nexora-${stamp}.db`);

const src = new Database(dbPath);
try {
  // Consistent, live-safe snapshot:
  src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  src.close();
}

// Verify the snapshot is a healthy, complete database
const check = new Database(target, { readonly: true });
const integrity = check.query("PRAGMA integrity_check").get() as { integrity_check: string };
const counts = {
  users: (check.query("SELECT COUNT(*) c FROM User").get() as { c: number }).c,
  workspaces: (check.query("SELECT COUNT(*) c FROM Workspace").get() as { c: number }).c,
  leads: (check.query("SELECT COUNT(*) c FROM Lead").get() as { c: number }).c,
  contacts: (check.query("SELECT COUNT(*) c FROM Contact").get() as { c: number }).c,
  deals: (check.query("SELECT COUNT(*) c FROM Deal").get() as { c: number }).c,
};
check.close();

if (integrity.integrity_check !== "ok") {
  console.error(`BACKUP FAILED integrity check: ${integrity.integrity_check}`);
  process.exit(1);
}

// Retention: prune oldest snapshots beyond `keep`
const backups = readdirSync(outDir)
  .filter((f) => f.startsWith("nexora-") && f.endsWith(".db"))
  .sort()
  .reverse();
for (const old of backups.slice(keep)) {
  unlinkSync(join(outDir, old));
}

const sizeMb = (statSync(target).size / (1024 * 1024)).toFixed(2);
console.log(`Backup OK: ${target} (${sizeMb} MB, integrity: ok)`);
console.log(`Row counts: ${JSON.stringify(counts)}`);
console.log(`Retention: kept ${Math.min(backups.length, keep)} newest snapshot(s) in ${outDir}`);
