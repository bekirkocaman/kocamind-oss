export type AnsiSegment = {
  text: string;
  fg?: string;
  bold?: boolean;
};

const FG_COLORS: Record<number, string> = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white',
  90: 'bright-black',
  91: 'bright-red',
  92: 'bright-green',
  93: 'bright-yellow',
  94: 'bright-blue',
  95: 'bright-magenta',
  96: 'bright-cyan',
  97: 'bright-white',
};

export function parseAnsi(text: string): AnsiSegment[] {
  if (!text) return [];

  const segments: AnsiSegment[] = [];
  let fg: string | undefined;
  let bold = false;
  let buf = '';

  const flush = () => {
    if (!buf) return;
    const seg: AnsiSegment = { text: buf };
    if (fg) seg.fg = fg;
    if (bold) seg.bold = true;
    segments.push(seg);
    buf = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text.charCodeAt(i);
    if (ch !== 0x1b) {
      const nextEsc = text.indexOf('\x1b', i);
      if (nextEsc === -1) {
        buf += text.slice(i);
        break;
      }
      buf += text.slice(i, nextEsc);
      i = nextEsc;
      continue;
    }

    // ESC karakteri
    if (i + 1 >= text.length) {
      // Metnin sonunda yarim kalmis ESC
      break;
    }

    const next = text[i + 1];

    if (next === '[') {
      // CSI dizisi: \x1b[ <params> <final byte 0x40..0x7E>
      let j = i + 2;
      while (j < text.length) {
        const code = text.charCodeAt(j);
        if (code >= 0x40 && code <= 0x7e) {
          break;
        }
        j++;
      }
      if (j >= text.length) {
        // Yarim kalmis CSI dizisi
        break;
      }
      const finalChar = text[j];
      const paramsStr = text.slice(i + 2, j);
      if (finalChar === 'm') {
        flush();
        const parts = paramsStr === '' ? [0] : paramsStr.split(';').map((p) => (p === '' ? 0 : Number(p)));
        for (const p of parts) {
          if (Number.isNaN(p)) continue;
          if (p === 0) {
            fg = undefined;
            bold = false;
          } else if (p === 1) {
            bold = true;
          } else if (p === 22) {
            bold = false;
          } else if (p === 39) {
            fg = undefined;
          } else if (p in FG_COLORS) {
            fg = FG_COLORS[p];
          }
        }
      }
      // m disindaki CSI dizileri silinir
      i = j + 1;
      continue;
    }

    if (next === ']') {
      // OSC dizisi: \x1b] ... (\x07 veya \x1b\\)
      let j = i + 2;
      let closed = false;
      while (j < text.length) {
        if (text.charCodeAt(j) === 0x07) {
          j += 1;
          closed = true;
          break;
        }
        if (text[j] === '\x1b' && j + 1 < text.length && text[j + 1] === '\\') {
          j += 2;
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) {
        // Yarim kalmis OSC dizisi
        break;
      }
      i = j;
      continue;
    }

    // Diger 2 karakterli ESC dizileri
    i += 2;
  }

  flush();
  return segments;
}
