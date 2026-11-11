// Database tasks through the Supabase CLI.
//   npm run db:push   apply new migrations in supabase/migrations
//   npm run db:seed   WIPE demo data and reseed (supabase/seed.sql)
//
// Reads SUPABASE_DB_URL from .env.local (loaded by `node --env-file`).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const task = process.argv[2];
const url = process.env.SUPABASE_DB_URL;
const cli = fileURLToPath(new URL("../node_modules/supabase/dist/supabase.js", import.meta.url));

if (!url) {
  console.error("SUPABASE_DB_URL is not set in .env.local. See README, step 1.");
  process.exit(1);
}

const commands = {
  push: ["db", "push", `--remote=${url}`, "--yes"],
  seed: ["db", "query", `--remote=${url}`, "--file", "supabase/seed.sql", "--yes"],
};

if (!commands[task]) {
  console.error("Usage: node scripts/db.mjs <push|seed>");
  process.exit(1);
}

// Run the CLI's JS entry with node directly: no shell, so the URL is never re-parsed.
const result = spawnSync(process.execPath, [cli, ...commands[task]], { stdio: "inherit" });
process.exit(result.status ?? 1);
