/** Limits for anything a player imports (E-DATA-03). */
export const IMPORT_LIMITS = { maxBytes: 5 * 1024 * 1024, maxDepth: 64 } as const;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class ImportError extends Error {
  override name = 'ImportError';
}

/**
 * Parse untrusted JSON text with size and depth limits, stripping prototype keys.
 * The result still needs schema validation.
 */
export function parseUntrustedJson(text: string): unknown {
  if (new TextEncoder().encode(text).length > IMPORT_LIMITS.maxBytes) {
    throw new ImportError('File is larger than 5 MB.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('File is not valid JSON.');
  }
  return clean(raw, 0);
}

function clean(value: unknown, depth: number): unknown {
  if (depth > IMPORT_LIMITS.maxDepth) throw new ImportError('File is nested too deeply.');
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = clean(v, depth + 1);
    }
    return out;
  }
  return value;
}
