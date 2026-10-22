/**
 * NEXORA CRM — SQLite restore script.
 *
 * SAFETY RULES:
 *   1. The candidate backup is FIRST integrity-checked and row-counted.
 *   2. The restore is written to a TEMP file, checked again, and only then
 *      moved over the target — a failed restore can never leave a
 *      half-written database behind.
 *   3. The live target is NEVER overwritten without `--force`. Without it,
 *      the script restores to `<target>.restored` for inspection.
 *   4. Stop the application before using --force (SQLite must not be written
 *      while the file is swapped).
 *
 * Usage:
 *   bun scripts/db-restore.ts backups/nexora-XXXX.db                    # inspect-restores to db/custom.db.restored
 *   bun scripts/db-restore.ts backups/nexora-XXXX.db --target db/custom.db --force --i-know-the-app-is-stopped
 */
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const backupArg = process.argv[2];
const force = process.argv.includes("--force");
const targetIdx = process.argv.indexOf("--target");
const target = resolve(
  targetIdx > -1 ? process.argv[targetIdx + 1] : resolve(process.cwd(), "db/custom.db")
);

if (!backupArg || !existsSync(backupArg)) {
  console.error("Usage: bun scripts/db-restore.ts <backup.db> [--target db/custom.db] [--force]");
  process.exit(1);
}

// 1) Verify the backup BEFORE touching anything
const probe = new Database(resolve(backupArg), { readonly: true });
const integrity = probe.query("PRAGMA integrity_check").get() as { integrity_check: string };
const users = (probe.query("SELECT COUNT(*) c FROM User").get() as { c: number }).c;
const workspaces = (probe.query("SELECT COUNT(*) c FROM Workspace").get() as { c: number }).c;
probe.close();

if (integrity.integrity_check !== "ok") {
  console.error(`ABORT: backup file is corrupt (integrity_check: ${integrity.integrity_check})`);
  process.exit(1);
}
console.log(`Backup OK: ${resolve(backupArg)} (${(statSync(backupArg).size / 1048576).toFixed(2)} MB, integrity ok)`);
console.log(`Contains: ${users} users, ${workspaces} workspaces`);

if (!force) {
  const inspectTarget = `${target}.restored`;
  copyFileSync(resolve(backupArg), inspectTarget);
  console.log(`Non-destructive restore complete → ${inspectTarget}`);
  console.log("Inspect it, then promote with:  bun scripts/db-restore.ts <backup> --target db/custom.db --force --i-know-the-app-is-stopped");
  process.exit(0);
}

// 2) Forced restore via temp file swap
if (!process.argv.includes("--i-know-the-app-is-stopped")) {
  console.error(
    "ABORT: --force requires the app to be STOPPED. Re-run with --i-know-the-app-is-stopped to confirm."
  );
  process.exit(1);
}

const tmp = `${target}.restore-tmp`;
copyFileSync(resolve(backupArg), tmp);

const verify = new Database(tmp, { readonly: true });
const v = verify.query("PRAGMA integrity_check").get() as { integrity_check: string };
verify.close();
if (v.integrity_check !== "ok") {
  unlinkSync(tmp);
  console.error("ABORT: temp copy failed verification — original untouched.");
  process.exit(1);
}

if (existsSync(target)) renameSync(target, `${target}.pre-restore`);
renameSync(tmp, target);
console.log(`RESTORED ${resolve(backupArg)} → ${target}`);
console.log(`Previous database kept at ${target}.pre-restore (delete it after verification).`);
