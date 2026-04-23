/** Convert Date objects to ISO strings so Zod output schemas (which expect string) don't reject them. */
export function ser<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}
