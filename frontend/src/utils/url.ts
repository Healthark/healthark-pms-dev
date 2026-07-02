/**
 * URL safety — the render-time mirror of the backend's http(s) allowlist
 * (see backend/app/core/url_safety.py). A goal's attachment_url is a
 * mentee-supplied reference link that we drop into an anchor `href`; a
 * `javascript:` / `data:` URL there would execute in the reviewer's session
 * (stored XSS). The backend rejects such values at write time, but we also
 * guard at render time so any legacy value already in the DB stays inert.
 *
 * Allowlist, not blocklist: only http/https pass; everything else is unsafe.
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    // Absolute URLs only (no base) — `new URL` rejects relative/protocol-
    // relative inputs, which we do not want to render as links anyway.
    const parsed = new URL(trimmed);
    return ALLOWED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}
