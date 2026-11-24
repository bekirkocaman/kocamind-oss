function isWordBoundary(str: string, idx: number): boolean {
  if (idx === 0) return true;
  const prev = str[idx - 1];
  const curr = str[idx];
  if (prev === '/' || prev === '.' || prev === '-' || prev === '_' || prev === ' ') {
    return true;
  }
  // camelCase gecisi
  return prev >= 'a' && prev <= 'z' && curr >= 'A' && curr <= 'Z';
}

function scoreSubsequence(target: string, queryLower: string): number | null {
  const targetLower = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let prevMatchIdx = -2;

  for (let ti = 0; ti < targetLower.length && qi < queryLower.length; ti++) {
    if (targetLower[ti] === queryLower[qi]) {
      if (ti === prevMatchIdx + 1) {
        score += 15;
      }
      if (isWordBoundary(target, ti)) {
        score += 20;
      }
      if (prevMatchIdx >= 0 && ti > prevMatchIdx + 1) {
        score -= Math.min(5, ti - prevMatchIdx - 1);
      }
      prevMatchIdx = ti;
      qi++;
    }
  }

  if (qi < queryLower.length) return null;
  if (targetLower.startsWith(queryLower)) score += 50;
  if (targetLower === queryLower) score += 100;
  return score;
}

export function fuzzyFilter(files: string[], query: string, limit = 50): string[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [...files].sort((a, b) => a.localeCompare(b)).slice(0, limit);
  }

  const queryLower = trimmed.toLowerCase();
  const scored: { path: string; score: number }[] = [];

  for (const filePath of files) {
    const lastSlash = filePath.lastIndexOf('/');
    const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;

    const nameScore = scoreSubsequence(fileName, queryLower);
    if (nameScore !== null) {
      scored.push({ path: filePath, score: 10000 + nameScore });
      continue;
    }

    const pathScore = scoreSubsequence(filePath, queryLower);
    if (pathScore !== null) {
      scored.push({ path: filePath, score: pathScore });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    return a.path.localeCompare(b.path);
  });

  return scored.slice(0, limit).map((item) => item.path);
}
