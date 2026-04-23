import { customFetch } from "@workspace/api-client-react";

export type CourseSearchResult = {
  id: string;
  clubName: string;
  courseName: string | null;
  location: string | null;
};

export type CourseTee = {
  id: string;
  name: string;
  gender: "male" | "female" | "other" | null;
  rating: number | null;
  slope: number | null;
  totalYards: number | null;
  totalPar: number | null;
  par: number[];
  holeHcp: number[];
};

export type CourseDetail = {
  id: string;
  clubName: string;
  courseName: string | null;
  tees: CourseTee[];
};

// Course detail is effectively static — cache in memory so consecutive picks
// of the same course within a session don't re-hit the upstream quota.
const detailCache = new Map<string, CourseDetail>();

export function searchCourses(query: string, signal?: AbortSignal): Promise<{ results: CourseSearchResult[] }> {
  return customFetch<{ results: CourseSearchResult[] }>(
    `/api/course-lookup/search?q=${encodeURIComponent(query)}`,
    { method: "GET", signal },
  );
}

export async function getCourseDetail(externalId: string, signal?: AbortSignal): Promise<CourseDetail> {
  const cached = detailCache.get(externalId);
  if (cached) return cached;
  const detail = await customFetch<CourseDetail>(
    `/api/course-lookup/courses/${encodeURIComponent(externalId)}`,
    { method: "GET", signal },
  );
  detailCache.set(externalId, detail);
  return detail;
}

export function healthcheck(signal?: AbortSignal): Promise<{ status: string }> {
  return customFetch<{ status: string }>(
    `/api/course-lookup/health`,
    { method: "GET", signal },
  );
}
