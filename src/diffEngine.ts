import * as Diff from 'diff';

/** A half-open character range [start, end) used for word-level highlights. */
export type CharRange = [number, number];

export interface DiffRow {
  /** ctx = unchanged, add = right-only, del = left-only, mod = paired change */
  t: 'ctx' | 'add' | 'del' | 'mod';
  /** left line number (1-based) */
  ln?: number;
  /** right line number (1-based) */
  rn?: number;
  /** left text (also the right text for ctx rows unless `r` is set) */
  l?: string;
  /** right text (set on mod rows, and on ctx rows whose sides differ in whitespace) */
  r?: string;
  /** word-level highlight ranges on the left/right text */
  lh?: CharRange[];
  rh?: CharRange[];
  /** moved-block group id: this del/add pair is code relocated, not changed */
  mv?: number;
}

export interface DiffOptions {
  /** Treat lines differing only in whitespace as equal. */
  ignoreWhitespace?: boolean;
}

export interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
}

const MAX_WORD_DIFF_LINE = 5_000;

/** Compute an aligned, row-oriented diff suitable for split or inline rendering. */
export function computeDiff(
  leftRaw: string,
  rightRaw: string,
  options: DiffOptions = {}
): DiffResult {
  const left = leftRaw.replace(/\r\n/g, '\n');
  const right = rightRaw.replace(/\r\n/g, '\n');
  const leftLines = toLines(left);
  const rightLines = toLines(right);

  const parts = Diff.diffLines(left, right, {
    ignoreWhitespace: options.ignoreWhitespace ?? false,
  });

  const rows: DiffRow[] = [];
  let li = 0; // index into leftLines
  let ri = 0; // index into rightLines
  let added = 0;
  let removed = 0;

  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    const next = parts[i + 1];
    const n = toLines(part.value).length;

    if (part.removed && next?.added) {
      const m = toLines(next.value).length;
      const paired = Math.max(n, m);
      for (let k = 0; k < paired; k++) {
        const l = k < n ? leftLines[li + k] : undefined;
        const r = k < m ? rightLines[ri + k] : undefined;
        if (l !== undefined && r !== undefined) {
          const [lh, rh] = charRanges(l, r);
          rows.push({ t: 'mod', ln: li + k + 1, rn: ri + k + 1, l, r, lh, rh });
          removed++;
          added++;
        } else if (l !== undefined) {
          rows.push({ t: 'del', ln: li + k + 1, l });
          removed++;
        } else if (r !== undefined) {
          rows.push({ t: 'add', rn: ri + k + 1, r });
          added++;
        }
      }
      li += n;
      ri += m;
      i += 2;
    } else if (part.removed) {
      for (let k = 0; k < n; k++) {
        rows.push({ t: 'del', ln: li + k + 1, l: leftLines[li + k] });
        removed++;
      }
      li += n;
      i++;
    } else if (part.added) {
      for (let k = 0; k < n; k++) {
        rows.push({ t: 'add', rn: ri + k + 1, r: rightLines[ri + k] });
        added++;
      }
      ri += n;
      i++;
    } else {
      for (let k = 0; k < n; k++) {
        const l = leftLines[li + k];
        const r = rightLines[ri + k];
        const row: DiffRow = { t: 'ctx', ln: li + k + 1, rn: ri + k + 1, l };
        if (r !== l) {
          row.r = r; // whitespace-only difference kept visible per side
        }
        rows.push(row);
      }
      li += n;
      ri += n;
      i++;
    }
  }

  detectMoves(rows);
  return { rows, added, removed };
}

function toLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Word-level ranges for a modified line pair. Returns empty ranges when the
 * lines are so different that highlighting everything would just be noise.
 */
function charRanges(l: string, r: string): [CharRange[], CharRange[]] {
  if (l.length > MAX_WORD_DIFF_LINE || r.length > MAX_WORD_DIFF_LINE) {
    return [[], []];
  }
  const parts = Diff.diffWordsWithSpace(l, r);
  const lh: CharRange[] = [];
  const rh: CharRange[] = [];
  let lo = 0;
  let ro = 0;
  for (const p of parts) {
    if (p.removed) {
      lh.push([lo, lo + p.value.length]);
      lo += p.value.length;
    } else if (p.added) {
      rh.push([ro, ro + p.value.length]);
      ro += p.value.length;
    } else {
      lo += p.value.length;
      ro += p.value.length;
    }
  }
  // Coverage over significant (non-whitespace) characters: if nearly the whole
  // line changed, per-word highlights are just noise — drop them.
  const significant = (s: string) => s.replace(/\s/g, '').length;
  const covered = (text: string, ranges: CharRange[]) =>
    ranges.reduce((sum, [a, b]) => sum + significant(text.slice(a, b)), 0);
  const lSig = Math.max(significant(l), 1);
  const rSig = Math.max(significant(r), 1);
  if (covered(l, lh) / lSig > 0.9 && covered(r, rh) / rSig > 0.9) {
    return [[], []];
  }
  return [merge(lh), merge(rh)];
}

/** Merge adjacent/overlapping ranges to minimize DOM spans. */
function merge(ranges: CharRange[]): CharRange[] {
  if (ranges.length < 2) {
    return ranges;
  }
  const out: CharRange[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = out[out.length - 1];
    const cur = ranges[i];
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      out.push(cur);
    }
  }
  return out;
}

// ------------------------------------------------------- moved-block marks

/**
 * Mark pure del/add rows whose content merely moved elsewhere in the file.
 * Conservative: a match must span >= 2 consecutive lines, or a single line
 * with >= 30 significant characters, to avoid tagging braces and blanks.
 */
function detectMoves(rows: DiffRow[]): void {
  const addIndexByText = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].t === 'add') {
      const key = (rows[i].r ?? '').trim();
      if (key.length > 0) {
        const list = addIndexByText.get(key);
        if (list) {
          list.push(i);
        } else {
          addIndexByText.set(key, [i]);
        }
      }
    }
  }
  if (addIndexByText.size === 0) {
    return;
  }

  const claimed = new Set<number>();
  let group = 0;

  let i = 0;
  while (i < rows.length) {
    if (rows[i].t !== 'del' || rows[i].mv !== undefined) {
      i++;
      continue;
    }
    const firstKey = (rows[i].l ?? '').trim();
    const candidates = addIndexByText.get(firstKey) ?? [];
    let bestStart = -1;
    let bestLen = 0;

    for (const start of candidates) {
      if (claimed.has(start)) {
        continue;
      }
      let len = 0;
      while (
        rows[i + len]?.t === 'del' &&
        rows[start + len]?.t === 'add' &&
        !claimed.has(start + len) &&
        (rows[i + len].l ?? '').trim() === (rows[start + len].r ?? '').trim()
      ) {
        len++;
      }
      if (len > bestLen) {
        bestLen = len;
        bestStart = start;
      }
    }

    const significant =
      bestLen >= 2 || (bestLen === 1 && firstKey.length >= 30);
    if (bestStart >= 0 && significant) {
      group++;
      for (let k = 0; k < bestLen; k++) {
        rows[i + k].mv = group;
        rows[bestStart + k].mv = group;
        claimed.add(bestStart + k);
      }
      i += bestLen;
    } else {
      i++;
    }
  }
}
