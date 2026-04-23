// Smoke test for the GolfCourseAPI integration.
//
//   GOLF_COURSE_API_KEY=xxx pnpm --filter scripts exec tsx src/test-golf-course-api.ts pinehurst
//
// Prints the healthcheck, the first few /search hits, and then the first tee
// on the first course. Good for validating the Authorization header format
// and the overall shape before using the UI.

const BASE = "https://api.golfcourseapi.com/v1";
const AUTH_SCHEME = "Key"; // change if your dashboard shows a different scheme

async function request<T>(path: string, requireAuth: boolean): Promise<T> {
  const key = process.env["GOLF_COURSE_API_KEY"];
  if (requireAuth && !key) {
    throw new Error("GOLF_COURSE_API_KEY is not set in the environment.");
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (requireAuth && key) headers["Authorization"] = `${AUTH_SCHEME} ${key}`;

  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function main() {
  const query = process.argv[2] ?? "pinehurst";

  console.log(`\n[1] /v1/healthcheck`);
  const health = await request<{ status: string }>("/healthcheck", false);
  console.log("   ", health);

  console.log(`\n[2] /v1/search?search_query=${query}`);
  const search = await request<{ courses: Array<Record<string, unknown>> }>(
    `/search?search_query=${encodeURIComponent(query)}`,
    true,
  );
  const hits = search.courses ?? [];
  console.log(`    ${hits.length} hits, first 5:`);
  for (const c of hits.slice(0, 5)) {
    console.log("    -", c["id"], c["club_name"], "—", c["course_name"]);
  }

  const first = hits[0];
  if (!first) return;

  console.log(`\n[3] /v1/courses/${first["id"]}`);
  const detail = await request<{
    id: number;
    club_name: string;
    course_name: string;
    tees: { male?: unknown[]; female?: unknown[] };
  }>(`/courses/${first["id"]}`, true);
  const maleTees = detail.tees?.male ?? [];
  const femaleTees = detail.tees?.female ?? [];
  console.log(`    ${detail.club_name} — ${detail.course_name}`);
  console.log(`    tees: male=${maleTees.length}, female=${femaleTees.length}`);
  const sample = (maleTees[0] ?? femaleTees[0]) as Record<string, unknown> | undefined;
  if (sample) {
    console.log(`    first tee:`, {
      name: sample["tee_name"],
      rating: sample["course_rating"],
      slope: sample["slope_rating"],
      totalPar: sample["par_total"],
      holes: Array.isArray(sample["holes"]) ? (sample["holes"] as unknown[]).length : 0,
    });
  }
}

main().catch(err => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
