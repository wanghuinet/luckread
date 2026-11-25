export function parseGroupMemberIds(input: string): string[] {
  return input
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}
