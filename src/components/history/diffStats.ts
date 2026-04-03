export interface DiffStats {
  added: number;
  removed: number;
  changed: number;
}

function normalizeMarkdown(text: string): string {
  return text.replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
}

function splitLines(text: string): string[] {
  const normalized = normalizeMarkdown(text);
  return normalized === "" ? [] : normalized.split("\n");
}

export function computeDiffStats(oldText: string, newText: string): DiffStats {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  const n = oldLines.length;
  const m = newLines.length;

  let prev = new Uint32Array(m + 1);
  let curr = new Uint32Array(m + 1);

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  const lcsLength = prev[m];
  const removed = n - lcsLength;
  const added = m - lcsLength;
  const changed = Math.min(removed, added);

  return {
    added: added - changed,
    removed: removed - changed,
    changed,
  };
}
