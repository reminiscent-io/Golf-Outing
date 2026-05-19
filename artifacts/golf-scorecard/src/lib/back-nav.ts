/**
 * Pop the browser history. Falls back to `fallback` when there's no entry to
 * pop (direct link, fresh tab, or app entry). The fallback uses Wouter's
 * `navigate` so it stays inside the SPA.
 */
export function goBackOr(
  fallback: string,
  navigate: (to: string) => void,
): void {
  if (globalThis.history.length > 1) {
    globalThis.history.back();
    return;
  }
  navigate(fallback);
}
