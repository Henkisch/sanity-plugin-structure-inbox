/**
 * A plain field name — no `[index]`, no `.nested`, no `->`. The only shape
 * that is safe to interpolate directly into a GROQ query string.
 *
 * Every site that splices a field name into query text must gate on this.
 * There were three such sites and this pattern was copied into two of them;
 * the third (`projectDigest.ts`) went unguarded, which is why it now lives
 * in one place.
 */
export const SIMPLE_FIELD_PATH = /^[a-zA-Z0-9_]+$/
