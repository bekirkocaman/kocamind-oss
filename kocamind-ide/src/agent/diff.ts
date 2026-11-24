// Satir tabanli metin farki (diff) hesaplama ve baglam daraltma

export type DiffLine = {
  type: 'same' | 'add' | 'del';
  text: string;
  oldNo: number | null;
  newNo: number | null;
};

export type DiffContextItem = DiffLine | { type: 'skip'; count: number };

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

export function diffLines(
  before: string | null,
  after: string
): { lines: DiffLine[]; tooLarge: boolean } {
  // Yeni dosya durumu: butun satirlar add
  if (before === null) {
    const afterLines = splitLines(after);
    if (afterLines.length > 2000) {
      return { lines: [], tooLarge: true };
    }
    const lines: DiffLine[] = afterLines.map((text, idx) => ({
      type: 'add',
      text,
      oldNo: null,
      newNo: idx + 1,
    }));
    return { lines, tooLarge: false };
  }

  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  if (beforeLines.length > 2000 || afterLines.length > 2000) {
    return { lines: [], tooLarge: true };
  }

  const n = beforeLines.length;
  const m = afterLines.length;

  const stride = m + 1;
  const dp = new Int32Array((n + 1) * (m + 1));

  for (let i = 0; i < n; i++) {
    const bText = beforeLines[i];
    const rowOffset = i * stride;
    const nextRowOffset = (i + 1) * stride;
    for (let j = 0; j < m; j++) {
      if (bText === afterLines[j]) {
        dp[nextRowOffset + (j + 1)] = dp[rowOffset + j] + 1;
      } else {
        const up = dp[rowOffset + (j + 1)];
        const left = dp[nextRowOffset + j];
        dp[nextRowOffset + (j + 1)] = up > left ? up : left;
      }
    }
  }

  const revLines: DiffLine[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      revLines.push({
        type: 'same',
        text: beforeLines[i - 1],
        oldNo: i,
        newNo: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i * stride + (j - 1)] >= dp[(i - 1) * stride + j])) {
      revLines.push({
        type: 'add',
        text: afterLines[j - 1],
        oldNo: null,
        newNo: j,
      });
      j--;
    } else if (i > 0) {
      revLines.push({
        type: 'del',
        text: beforeLines[i - 1],
        oldNo: i,
        newNo: null,
      });
      i--;
    }
  }

  revLines.reverse();
  return { lines: revLines, tooLarge: false };
}

export function collapseContext(
  lines: DiffLine[],
  context = 3
): DiffContextItem[] {
  if (lines.length === 0) return [];

  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'same') {
      const start = Math.max(0, i - context);
      const end = Math.min(lines.length - 1, i + context);
      for (let k = start; k <= end; k++) {
        keep[k] = true;
      }
    }
  }

  const result: DiffContextItem[] = [];
  let skipCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      if (skipCount > 0) {
        result.push({ type: 'skip', count: skipCount });
        skipCount = 0;
      }
      result.push(lines[i]);
    } else {
      skipCount++;
    }
  }

  if (skipCount > 0) {
    result.push({ type: 'skip', count: skipCount });
  }

  return result;
}
