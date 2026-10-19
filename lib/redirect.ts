// ==============================================================================
// Safe post-login redirect handling
// Only same-site, path-only values are accepted. Anything that could leave the
// site (absolute URLs, protocol-relative //host, backslash tricks, javascript:,
// embedded whitespace/control characters) falls back to a safe default.
// ==============================================================================

const CONTROL_OR_WHITESPACE = /[\u0000-\u001F\u007F\s]/;

export function safeRedirectPath(value: string | null | undefined, fallback = '/'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return fallback;

  // Browsers strip tabs/newlines inside URLs, so "/\t/evil.com" becomes "//evil.com".
  if (CONTROL_OR_WHITESPACE.test(value)) return fallback;

  // Must be an absolute PATH: one leading slash, not "//" and not "/\".
  if (value[0] !== '/') return fallback;
  if (value[1] === '/' || value[1] === '\\') return fallback;
  if (value.includes('\\')) return fallback;

  // Check the percent-decoded form too.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (CONTROL_OR_WHITESPACE.test(decoded) || decoded.includes('\\')) return fallback;
  if (decoded.startsWith('//')) return fallback;

  // Final guard: resolving against a dummy origin must stay on that origin.
  try {
    const base = 'http://internal.invalid';
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return fallback;
  } catch {
    return fallback;
  }

  return value;
}
