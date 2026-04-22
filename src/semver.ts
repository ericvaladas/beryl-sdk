export function parseSemver(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) return 0;
  for (let i = 0; i < 3; i++) {
    if (parsedA[i] !== parsedB[i]) return parsedA[i] < parsedB[i] ? -1 : 1;
  }
  return 0;
}
