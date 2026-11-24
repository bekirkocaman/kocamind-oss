export function pushHistory(list: string[], cmd: string, max = 100): string[] {
  const trimmed = cmd.trim();
  if (!trimmed) return list;
  if (list.length > 0 && list[list.length - 1] === trimmed) {
    return list;
  }
  const next = [...list, trimmed];
  if (next.length > max) {
    return next.slice(next.length - max);
  }
  return next;
}

export function navigate(
  list: string[],
  index: number,
  dir: 'up' | 'down',
): { index: number; value: string } {
  if (list.length === 0) {
    return { index: -1, value: '' };
  }

  if (dir === 'up') {
    if (index === -1) {
      const nextIdx = list.length - 1;
      return { index: nextIdx, value: list[nextIdx] };
    }
    const nextIdx = Math.max(0, index - 1);
    return { index: nextIdx, value: list[nextIdx] };
  }

  // dir === 'down'
  if (index === -1) {
    return { index: -1, value: '' };
  }
  const nextIdx = index + 1;
  if (nextIdx >= list.length) {
    return { index: -1, value: '' };
  }
  return { index: nextIdx, value: list[nextIdx] };
}
