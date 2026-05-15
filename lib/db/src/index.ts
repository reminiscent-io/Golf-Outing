import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// pg v9 / pg-connection-string v3 will adopt libpq semantics for the SSL modes
// `prefer`, `require`, and `verify-ca` — none of which verify the server cert.
// Today these modes are silently treated as `verify-full`. Pin `verify-full`
// explicitly so the security guarantee survives the upgrade.
function withStrictSslMode(url: string): string {
  const u = new URL(url);
  const mode = u.searchParams.get("sslmode");
  if (!mode || mode === "prefer" || mode === "require" || mode === "verify-ca") {
    u.searchParams.set("sslmode", "verify-full");
  }
  return u.toString();
}

export const pool = new Pool({
  connectionString: withStrictSslMode(process.env.DATABASE_URL),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
