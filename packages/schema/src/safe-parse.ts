/** Limits for anything a player imports (E-DATA-03). */
export const IMPORT_LIMITS = { maxBytes: 5 * 1024 * 1024, maxDepth: 64 } as const;

/**
 * Whole-workspace files (every level's board, the chip library and progress)
 * may be up to 20 MB; single-board saves stay at 5 MB. Depth and prototype-key
 * protection are the same for both (E-DATA-03).
 */
export const WORKSPACE_LIMITS = { maxBytes: 20 * 1024 * 1024, maxDepth: 64 } as const;

export interface ParseLimits {
  maxBytes: number;
  maxDepth: number;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class ImportError extends Error {
  override name = 'ImportError';
}

/**
 * Parse untrusted JSON text with size and depth limits, stripping prototype keys.
 * The result still needs schema validation.
 */
export function parseUntrustedJson(text: string, limits: ParseLimits = IMPORT_LIMITS): unknown {
  if (new TextEncoder().encode(text).length > limits.maxBytes) {
    throw new ImportError(`File is larger than ${Math.round(limits.maxBytes / (1024 * 1024))} MB.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('File is not valid JSON.');
  }
  return clean(raw, 0, limits.maxDepth);
}

function clean(value: unknown, depth: number, maxDepth: number): unknown {
  if (depth > maxDepth) throw new ImportError('File is nested too deeply.');
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1, maxDepth));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = clean(v, depth + 1, maxDepth);
    }
    return out;
  }
  return value;
}
