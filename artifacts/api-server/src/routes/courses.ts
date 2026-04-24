import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

// Server-side proxy for GolfCourseAPI. Keeps the API key off the browser,
// normalises the upstream shape to what our round/scorecard schema needs,
// and translates upstream 401/404/429 into friendly messages for the UI.

const UPSTREAM_BASE = "https://api.golfcourseapi.com/v1";
// GolfCourseAPI's docs show "Authorization: Key <token>" on the dashboard;
// if your account shows a different scheme just change this string.
const AUTH_SCHEME = "Key";

// ---------------------------------------------------------------------------
// Upstream response types (from https://api.golfcourseapi.com/docs/api)
// ---------------------------------------------------------------------------

type UpstreamLocation = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type UpstreamHole = {
  par?: number | null;
  yardage?: number | null;
  handicap?: number | null;
};

type UpstreamTee = {
  tee_name?: string | null;
  course_rating?: number | null;
  slope_rating?: number | null;
  bogey_rating?: number | null;
  total_yards?: number | null;
  number_of_holes?: number | null;
  par_total?: number | null;
  front_course_rating?: number | null;
  front_slope_rating?: number | null;
  back_course_rating?: number | null;
  back_slope_rating?: number | null;
  holes?: UpstreamHole[] | null;
};

type UpstreamCourse = {
  id?: number | null;
  club_name?: string | null;
  course_name?: string | null;
  location?: UpstreamLocation | null;
  tees?: { female?: UpstreamTee[] | null; male?: UpstreamTee[] | null } | null;
};

type UpstreamSearchResponse = { courses?: UpstreamCourse[] | null };
type UpstreamCourseDetailResponse = { course?: UpstreamCourse | null };

// ---------------------------------------------------------------------------
// Normalised shapes returned to our client
// ---------------------------------------------------------------------------

type CourseSearchResult = {
  id: string;
  clubName: string;
  courseName: string | null;
  location: string | null;
};

type CourseTee = {
  id: string;
  name: string;
  gender: "male" | "female" | "other" | null;
  rating: number | null;
  slope: number | null;
  totalYards: number | null;
  totalPar: number | null;
  par: number[];       // always length 18
  holeHcp: number[];   // always length 18
};

type CourseDetail = {
  id: string;
  clubName: string;
  courseName: string | null;
  tees: CourseTee[];
};

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

function formatLocation(loc: UpstreamLocation | null | undefined): string | null {
  if (!loc) return null;
  const parts = [loc.city, loc.state, loc.country].filter((s): s is string => !!s && s.trim() !== "");
  return parts.length > 0 ? parts.join(", ") : null;
}

function normalizeSearchHit(c: UpstreamCourse): CourseSearchResult | null {
  const id = c.id != null ? String(c.id) : null;
  const clubName = c.club_name?.trim() ?? null;
  if (!id || !clubName) return null;
  return {
    id,
    clubName,
    courseName: c.course_name?.trim() ?? null,
    location: formatLocation(c.location),
  };
}

function normalizeTee(t: UpstreamTee, gender: "male" | "female", courseId: string, idx: number): CourseTee | null {
  const name = t.tee_name?.trim();
  if (!name) return null;
  const id = `${courseId}:${gender}:${idx}`;
  const par: number[] = [];
  const holeHcp: number[] = [];
  const holes = Array.isArray(t.holes) ? t.holes : [];
  for (let i = 0; i < 18; i++) {
    const h = holes[i];
    par.push(typeof h?.par === "number" && h.par > 0 ? h.par : 4);
    holeHcp.push(typeof h?.handicap === "number" && h.handicap >= 1 && h.handicap <= 18 ? h.handicap : i + 1);
  }
  return {
    id,
    name,
    gender,
    rating: typeof t.course_rating === "number" ? t.course_rating : null,
    slope: typeof t.slope_rating === "number" ? t.slope_rating : null,
    totalYards: typeof t.total_yards === "number" ? t.total_yards : null,
    totalPar: typeof t.par_total === "number" ? t.par_total : null,
    par,
    holeHcp,
  };
}

function normalizeCourseDetail(raw: UpstreamCourse): CourseDetail {
  const id = raw.id != null ? String(raw.id) : "unknown";
  const tees: CourseTee[] = [];
  const male = raw.tees?.male ?? [];
  const female = raw.tees?.female ?? [];
  male.forEach((t, i) => { const tee = normalizeTee(t, "male", id, i); if (tee) tees.push(tee); });
  female.forEach((t, i) => { const tee = normalizeTee(t, "female", id, i); if (tee) tees.push(tee); });
  return {
    id,
    clubName: raw.club_name?.trim() ?? "Unknown club",
    courseName: raw.course_name?.trim() ?? null,
    tees,
  };
}

// ---------------------------------------------------------------------------
// Upstream fetch + error translation
// ---------------------------------------------------------------------------

type UpstreamResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

async function upstreamFetch<T>(path: string, requireAuth = true): Promise<UpstreamResult<T>> {
  const key = process.env["GOLF_COURSE_API_KEY"];
  if (requireAuth && !key) {
    return { ok: false, status: 503, message: "GOLF_COURSE_API_KEY is not configured on the server." };
  }
  const url = `${UPSTREAM_BASE}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (requireAuth && key) headers["Authorization"] = `${AUTH_SCHEME} ${key}`;
  try {
    const res = await fetch(url, { headers });
    if (res.status === 401) {
      return { ok: false, status: 401, message: "GolfCourseAPI rejected the API key (401). Check GOLF_COURSE_API_KEY and the Authorization scheme." };
    }
    if (res.status === 404) {
      return { ok: false, status: 404, message: "GolfCourseAPI says this resource doesn't exist (404)." };
    }
    if (res.status === 429) {
      return { ok: false, status: 429, message: "GolfCourseAPI rate limit reached (429). Try again in a bit." };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body: body.slice(0, 300), url }, "GolfCourseAPI non-OK response");
      return { ok: false, status: res.status, message: `GolfCourseAPI error (${res.status}).` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    logger.error({ err, url }, "GolfCourseAPI upstream request failed");
    return { ok: false, status: 502, message: "Upstream request failed" };
  }
}

// ---------------------------------------------------------------------------
// Tiny in-memory cache for /courses/:id (course data is effectively static)
// ---------------------------------------------------------------------------

const COURSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const courseCache = new Map<string, { at: number; detail: CourseDetail }>();

function cacheGet(id: string): CourseDetail | null {
  const entry = courseCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.at > COURSE_CACHE_TTL_MS) { courseCache.delete(id); return null; }
  return entry.detail;
}

function cacheSet(id: string, detail: CourseDetail): void {
  courseCache.set(id, { at: Date.now(), detail });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router: IRouter = Router();

router.get("/course-lookup/health", async (_req, res): Promise<void> => {
  const result = await upstreamFetch<{ status: string }>("/healthcheck", false);
  if (!result.ok) { res.status(result.status).json({ error: result.message }); return; }
  res.json(result.data);
});

router.get("/course-lookup/search", async (req, res): Promise<void> => {
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  if (q.length < 3) { res.json({ results: [] }); return; }
  const result = await upstreamFetch<UpstreamSearchResponse>(
    `/search?search_query=${encodeURIComponent(q)}`,
  );
  if (!result.ok) { res.status(result.status).json({ error: result.message }); return; }
  const hits = Array.isArray(result.data.courses) ? result.data.courses : [];
  const results: CourseSearchResult[] = [];
  for (const h of hits) {
    const norm = normalizeSearchHit(h);
    if (norm) results.push(norm);
  }
  res.json({ results });
});

router.get("/course-lookup/courses/:externalId", async (req, res): Promise<void> => {
  const id = req.params["externalId"];
  if (!id) { res.status(400).json({ error: "externalId is required" }); return; }
  const cached = cacheGet(id);
  if (cached) { res.json(cached); return; }
  const result = await upstreamFetch<UpstreamCourseDetailResponse>(`/courses/${encodeURIComponent(id)}`);
  if (!result.ok) { res.status(result.status).json({ error: result.message }); return; }
  const raw = result.data.course;
  if (!raw) { res.status(502).json({ error: "GolfCourseAPI returned no course payload." }); return; }
  const course = normalizeCourseDetail(raw);
  cacheSet(id, course);
  res.json(course);
});

export default router;
