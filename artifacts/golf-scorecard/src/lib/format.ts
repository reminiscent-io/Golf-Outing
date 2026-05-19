/**
 * Return the first whitespace-delimited token of a person's full name.
 * Empty / whitespace-only input returns the empty string.
 */
export function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  return space === -1 ? trimmed : trimmed.slice(0, space);
}
