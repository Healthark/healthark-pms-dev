"""
Outbound email service.

Transport is plain SMTP-with-STARTTLS (works for Gmail, O365, Mailgun, SES). All
credentials read from `settings`; if SMTP_USERNAME or SMTP_PASSWORD is missing we
log a warning and skip sending — callers should treat send failures as
non-fatal because the admin reveal-modal still shows the reset link in-app
as a manual-relay fallback.

Templates live in this file as inline f-strings (no Jinja yet) since we
currently have a single email type. When a second template is added, extract
them into `backend/app/services/email_templates/` with one function per
template.

Design notes:
    * All user-supplied fields (`full_name`, recipient address, etc.) are
      escaped via `html.escape(quote=True)` at the template boundary so a
      malicious or imported value like ``<img onerror=...>`` cannot inject
      HTML/JS into the rendered email body.
    * Theming uses the Healthark palette (single-tenant deployment). The
      `_ORG_THEMES` lookup is preserved keyed by org_id for parity with
      the frontend's `THEME_MAP` / `BRAND_META`, but only the Healthark
      entry is populated.
    * The From: address is decoupled from SMTP_USERNAME via SMTP_FROM_EMAIL
      so production can send from `noreply@<your-domain>` while still
      authenticating against a transactional-provider mailbox. See the
      DNS checklist in `app/core/config.py`.
"""

from __future__ import annotations

import json
import logging
import smtplib
import socket
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from html import escape as _html_escape
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Per-org theming (mirror of frontend THEME_MAP / BRAND_META) ─────


@dataclass(frozen=True)
class EmailTheme:
    """Color + display-name palette for outbound mail.

    Mirrors `--brand` / `--brand-light` in `frontend/src/index.css` and the
    title in `BRAND_META` from `frontend/src/contexts/AuthProvider.tsx`."""

    brand_name: str
    brand: str
    brand_light: str


_DEFAULT_THEME = EmailTheme(
    brand_name="Healthark PMS",
    brand="#315C84",
    brand_light="#EBF1F6",
)

# org_id → theme. Single-tenant deployment: only Healthark is populated.
# Kept as a lookup table so the public API surface (`org_id` argument)
# stays stable for callers built before the tenancy collapse, and so a
# future second tenant could be added with a one-line change.
_ORG_THEMES: dict[int, EmailTheme] = {
    1: _DEFAULT_THEME,
}


def _resolve_theme(org_id: int | None) -> EmailTheme:
    """Look up the per-org theme. Unknown / None org_id → default."""
    if org_id is None:
        return _DEFAULT_THEME
    return _ORG_THEMES.get(org_id, _DEFAULT_THEME)


def _resolve_from_name(theme: EmailTheme) -> str:
    """Display name in the From: header. SMTP_FROM_NAME (env) wins as a
    global override; otherwise we use the brand name from the theme."""
    return settings.SMTP_FROM_NAME or theme.brand_name


def _resolve_from_address() -> str:
    """The mailbox in From:. Falls back to SMTP_USERNAME for dev/Gmail
    where the auth account and the visible sender must match."""
    return settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME or ""


# ── Escaping helper ─────────────────────────────────────────────────


def _esc(value: object) -> str:
    """HTML-escape a value for safe interpolation into both HTML attribute
    and text contexts. `quote=True` flips `"` → `&quot;` and `&` → `&amp;`,
    so a user with `full_name='Bobby <img onerror=x>'` lands in the email
    body as harmless text rather than a rendered tag."""
    return _html_escape(str(value), quote=True)


# ── Transport ───────────────────────────────────────────────────────


class _IPv4SMTP(smtplib.SMTP):
    """SMTP that resolves and connects via IPv4 only.

    Render Free/Starter tiers don't have working IPv6 outbound. `smtp.gmail.com`
    (and most managed mail providers) resolve to both AAAA and A records, so
    Python's default `socket.create_connection` tries IPv6 first and fails
    with `OSError: [Errno 101] Network is unreachable` before it ever attempts
    IPv4. Asking `getaddrinfo` for `AF_INET` only sidesteps that.
    """

    def _get_socket(self, host, port, timeout):
        if self.debuglevel > 0:
            self._print_debug("connect: to", (host, port), self.source_address)
        last_err: Exception | None = None
        for af, socktype, proto, _canon, sa in socket.getaddrinfo(
            host, port, socket.AF_INET, socket.SOCK_STREAM,
        ):
            sock: socket.socket | None = None
            try:
                sock = socket.socket(af, socktype, proto)
                sock.settimeout(timeout)
                if self.source_address is not None:
                    sock.bind(self.source_address)
                sock.connect(sa)
                return sock
            except OSError as exc:
                last_err = exc
                if sock is not None:
                    sock.close()
        if last_err is not None:
            raise last_err
        raise OSError(f"No IPv4 address found for {host}")


def is_smtp_configured() -> bool:
    """True iff outbound mail can leave the building. Callers use this to
    decide synchronously whether to bother enqueuing a background send."""
    return bool(settings.SMTP_USERNAME and settings.SMTP_PASSWORD)


def _send(
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
    from_name: str,
) -> bool:
    """Send a multipart/alternative email. Returns True on success, False on
    any SMTP/auth/connection failure (callers log + continue).

    Intentionally synchronous — the SMTP handshake is ~200–800 ms and can
    spike to multi-seconds on transient errors. API endpoints should run
    this via FastAPI BackgroundTasks (or a real queue in prod) so the
    request thread isn't held hostage by Gmail's TLS handshake."""
    if not is_smtp_configured():
        logger.warning(
            "SMTP not configured (set SMTP_USERNAME / SMTP_PASSWORD in .env). "
            "Skipping email to %s — subject=%r.",
            to_email,
            subject,
        )
        return False

    from_address = _resolve_from_address()
    if not from_address:
        logger.error("SMTP_FROM_EMAIL / SMTP_USERNAME both unset; cannot build From:")
        return False

    message = EmailMessage()
    message["From"] = formataddr((from_name, from_address))
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    try:
        with _IPv4SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.send_message(message)
    except smtplib.SMTPAuthenticationError:
        logger.exception("SMTP auth failed sending to %s — check app password.", to_email)
        return False
    except (smtplib.SMTPException, OSError):
        logger.exception("SMTP transport error sending to %s.", to_email)
        return False

    logger.info("Sent email to %s — subject=%r.", to_email, subject)
    return True


# ── Templates ───────────────────────────────────────────────────────


def _password_reset_html(
    full_name: str,
    reset_link: str,
    expires_in_minutes: int,
    theme: EmailTheme,
) -> str:
    """Inline-styled HTML for the admin-initiated password reset email.

    Uses table-based layout + inline CSS for broad email-client support
    (Gmail web, Outlook, Apple Mail). No web fonts, no external CSS, no
    background images.

    The body header and footer brand name come from `theme.brand_name`
    directly, independent of the SMTP_FROM_NAME env override — that
    override only steers the visible From: address. User-supplied fields
    are escaped via `_esc()` before interpolation."""

    # Escape every interpolation that could plausibly carry user-controlled
    # content. Defense-in-depth — even fields like `theme.brand_name`
    # (config-driven) are escaped because configs can rotate and we'd
    # rather be paranoid than ship an HTML-injection sink that's
    # "currently fine".
    full_name_e = _esc(full_name)
    reset_link_e = _esc(reset_link)
    expires_e = _esc(expires_in_minutes)
    brand_name_e = _esc(theme.brand_name)
    brand_e = _esc(theme.brand)
    brand_light_e = _esc(theme.brand_light)

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0F172A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
          <!-- Header band (brand) -->
          <tr>
            <td style="background-color:{brand_e};padding:24px 32px;">
              <p style="margin:0;color:#FFFFFF;font-size:18px;font-weight:600;letter-spacing:0.2px;">
                {brand_name_e}
              </p>
              <p style="margin:4px 0 0 0;color:{brand_light_e};font-size:13px;">
                Account security notification
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0F172A;">
                Reset your password
              </h1>
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#0F172A;">
                Hi {full_name_e},
              </p>
              <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#0F172A;">
                An administrator has initiated a password reset for your
                account. Click the button below to choose a new password.
                This link expires in <strong>{expires_e} minutes</strong>
                and can only be used once.
              </p>

              <!-- CTA button (brand) -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                <tr>
                  <td align="center" style="background-color:{brand_e};border-radius:8px;">
                    <a href="{reset_link_e}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                      Set new password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Plain-link fallback -->
              <p style="margin:0 0 8px 0;font-size:12px;color:#64748B;">
                If the button doesn't work, copy and paste this URL into your
                browser:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;">
                    <a href="{reset_link_e}" target="_blank" rel="noopener" style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12px;color:{brand_e};word-break:break-all;text-decoration:none;">
                      {reset_link_e}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security warning -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
                <tr>
                  <td style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:14px 16px;">
                    <p style="margin:0;font-size:13px;line-height:1.5;color:#92400E;">
                      <strong>Security tip:</strong> this link is one-time-use
                      and expires in {expires_e} minutes. Your previous
                      password is no longer valid. If you did not expect a
                      password reset, contact your HR administrator
                      immediately and do not click the link.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid #E2E8F0;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748B;">
                This is an automated message from {brand_name_e}.
                Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def _password_reset_text(
    full_name: str,
    reset_link: str,
    expires_in_minutes: int,
    from_name: str,
) -> str:
    """Plain-text fallback. No HTML, so no escape needed — user-controlled
    text in plaintext can't break out of any markup."""
    return (
        f"Hi {full_name},\n\n"
        "An administrator has initiated a password reset for your account. "
        "Open the link below to choose a new password. This link expires in "
        f"{expires_in_minutes} minutes and can only be used once.\n\n"
        f"{reset_link}\n\n"
        f"Security tip: this link is one-time-use and expires in "
        f"{expires_in_minutes} minutes. Your previous password is no longer "
        "valid. If you did not expect a password reset, contact your HR "
        "administrator immediately and do not click the link.\n\n"
        f"— {from_name}\n"
    )


# ── Public API ──────────────────────────────────────────────────────


def _welcome_user_html(
    full_name: str,
    email: str,
    password: str,
    login_url: str,
    theme: EmailTheme,
) -> str:
    """Inline-styled HTML for the new-user welcome email. Same table-based
    layout / inline CSS contract as `_password_reset_html` so both renders
    look consistent in restrictive clients (Gmail, Outlook, Apple Mail).

    Every interpolation is escaped via `_esc()` because the credentials
    box renders user-controlled values (full_name, email) directly into
    the HTML body."""
    full_name_e = _esc(full_name)
    email_e = _esc(email)
    password_e = _esc(password)
    login_url_e = _esc(login_url)
    brand_name_e = _esc(theme.brand_name)
    brand_e = _esc(theme.brand)
    brand_light_e = _esc(theme.brand_light)

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Welcome to {brand_name_e}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0F172A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
          <!-- Header band (brand) -->
          <tr>
            <td style="background-color:{brand_e};padding:24px 32px;">
              <p style="margin:0;color:#FFFFFF;font-size:18px;font-weight:600;letter-spacing:0.2px;">
                {brand_name_e}
              </p>
              <p style="margin:4px 0 0 0;color:{brand_light_e};font-size:13px;">
                Account created
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0F172A;">
                Welcome to {brand_name_e}
              </h1>
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#0F172A;">
                Hi {full_name_e},
              </p>
              <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#0F172A;">
                Your {brand_name_e} account has been created by your
                administrator. Use the credentials below to sign in.
              </p>

              <!-- Credentials box -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px 20px;">
                    <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#64748B;">
                      Email
                    </p>
                    <p style="margin:0 0 14px 0;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;color:#0F172A;word-break:break-all;">
                      {email_e}
                    </p>
                    <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#64748B;">
                      Temporary password
                    </p>
                    <p style="margin:0;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;color:#0F172A;word-break:break-all;">
                      {password_e}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA button (brand) -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                <tr>
                  <td align="center" style="background-color:{brand_e};border-radius:8px;">
                    <a href="{login_url_e}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                      Sign in
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Plain-link fallback -->
              <p style="margin:0 0 8px 0;font-size:12px;color:#64748B;">
                If the button doesn't work, copy and paste this URL into your
                browser:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;">
                    <a href="{login_url_e}" target="_blank" rel="noopener" style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12px;color:{brand_e};word-break:break-all;text-decoration:none;">
                      {login_url_e}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security note -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
                <tr>
                  <td style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:14px 16px;">
                    <p style="margin:0;font-size:13px;line-height:1.5;color:#92400E;">
                      <strong>Security tip:</strong> change your password after
                      signing in for the first time. You can do this from the
                      Profile page. If you did not expect this account, please
                      contact your HR administrator.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid #E2E8F0;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748B;">
                This is an automated message from {brand_name_e}.
                Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def _welcome_user_text(
    full_name: str,
    email: str,
    password: str,
    login_url: str,
    from_name: str,
) -> str:
    """Plain-text fallback for the welcome email."""
    return (
        f"Hi {full_name},\n\n"
        f"Your {from_name} account has been created by your administrator. "
        "Use the credentials below to sign in.\n\n"
        f"  Email:    {email}\n"
        f"  Password: {password}\n\n"
        f"Sign in: {login_url}\n\n"
        "Security tip: change your password after signing in for the first "
        "time. You can do this from the Profile page. If you did not expect "
        "this account, please contact your HR administrator.\n\n"
        f"— {from_name}\n"
    )


def send_welcome_user_email(
    to_email: str,
    full_name: str,
    password: str,
    login_url: str,
    org_id: int | None = None,
) -> bool:
    """Email a newly-created user their sign-in credentials.

    Called from `POST /admin/users` after the row is committed. Returns
    True if the message was handed off to the SMTP server, False
    otherwise. Caller must NOT make user creation depend on the return —
    the user is already in the database; failed delivery just means the
    admin has to relay the credentials manually.

    `org_id` selects the per-org theme. Should be invoked via
    BackgroundTasks so the SMTP handshake doesn't block the API response."""
    theme = _resolve_theme(org_id)
    sender_display_name = _resolve_from_name(theme)
    return _send(
        to_email=to_email,
        subject=f"Welcome to {theme.brand_name} — your account is ready",
        html_body=_welcome_user_html(
            full_name, to_email, password, login_url, theme
        ),
        text_body=_welcome_user_text(
            full_name, to_email, password, login_url, theme.brand_name
        ),
        from_name=sender_display_name,
    )


def send_password_reset_email(
    to_email: str,
    full_name: str,
    reset_link: str,
    expires_in_minutes: int,
    org_id: int | None = None,
) -> bool:
    """Email a one-time, time-limited password-reset link to the user.

    Returns True if the message was handed off to the SMTP server, False
    otherwise. The caller must NOT make the reset flow depend on this
    return value — the admin reveal modal is the authoritative fallback
    (the link is also returned in the API response so it can be relayed
    out-of-band when delivery fails).

    `org_id` selects the per-org theme (brand color + display name). When
    `None` or unmapped, falls back to the HealthArk palette.

    This function is intended to be called from `BackgroundTasks` so the
    blocking SMTP handshake doesn't sit on the API request thread."""
    theme = _resolve_theme(org_id)
    # The body always uses the org's brand name; the From: line uses the
    # env override when set so the visible sender can stay consistent
    # across orgs even when the body re-brands per recipient.
    sender_display_name = _resolve_from_name(theme)
    return _send(
        to_email=to_email,
        subject=f"Reset your {theme.brand_name} password",
        html_body=_password_reset_html(
            full_name, reset_link, expires_in_minutes, theme
        ),
        text_body=_password_reset_text(
            full_name, reset_link, expires_in_minutes, theme.brand_name
        ),
        from_name=sender_display_name,
    )


# ── Generic notification / announcement template ─────────────────────


def _notification_html(
    title: str,
    body: str,
    cta_link: str | None,
    cta_label: str | None,
    theme: EmailTheme,
    *,
    recipient_name: str | None = None,
    intro: str | None = None,
    details: list[tuple[str, str]] | None = None,
    snapshot_title: str = "Snapshot",
) -> str:
    """Inline-styled HTML for a notification / announcement email.

    Same table-based layout + inline CSS contract as the reset/welcome
    templates (broad client support). Every interpolation is escaped via
    `_esc()`. The optional blocks make the formal, snapshot-style emails:
        * `recipient_name` → a "Hi {name}," greeting line.
        * `intro`          → the lead paragraph (falls back to `body`).
        * `details`        → a labelled "{snapshot_title}" key-value table.
    With none of them set it renders exactly like the original generic email
    (H1 + body paragraph + optional CTA), so existing callers are unaffected."""
    title_e = _esc(title)
    lead_e = _esc(intro if intro is not None else body).replace("\n", "<br>")
    brand_name_e = _esc(theme.brand_name)
    brand_e = _esc(theme.brand)
    brand_light_e = _esc(theme.brand_light)

    greeting_block = ""
    if recipient_name:
        greeting_block = (
            f'<p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#0F172A;">'
            f"Hi {_esc(recipient_name)},</p>"
        )

    details_block = ""
    if details:
        rows = "".join(
            f"""
                  <tr>
                    <td style="padding:6px 16px 6px 0;font-size:13px;color:#64748B;white-space:nowrap;vertical-align:top;">{_esc(label)}</td>
                    <td style="padding:6px 0;font-size:13px;color:#0F172A;font-weight:500;">{_esc(value)}</td>
                  </tr>"""
            for label, value in details
        )
        details_block = f"""
              <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#64748B;">
                {_esc(snapshot_title)}
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;">
                <tr><td style="padding:8px 16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">{rows}
                  </table>
                </td></tr>
              </table>"""

    cta_block = ""
    if cta_link:
        cta_link_e = _esc(cta_link)
        cta_label_e = _esc(cta_label or "Open in the app")
        cta_block = f"""
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px 0;">
                <tr>
                  <td align="center" style="background-color:{brand_e};border-radius:8px;">
                    <a href="{cta_link_e}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                      {cta_label_e}
                    </a>
                  </td>
                </tr>
              </table>"""

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{title_e}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0F172A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
          <!-- Header band (brand) -->
          <tr>
            <td style="background-color:{brand_e};padding:24px 32px;">
              <p style="margin:0;color:#FFFFFF;font-size:18px;font-weight:600;letter-spacing:0.2px;">
                {brand_name_e}
              </p>
              <p style="margin:4px 0 0 0;color:{brand_light_e};font-size:13px;">
                Notification
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0F172A;">
                {title_e}
              </h1>
              {greeting_block}
              <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#0F172A;">
                {lead_e}
              </p>
              {details_block}
              {cta_block}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid #E2E8F0;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748B;">
                This is an automated message from {brand_name_e}.
                Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def _notification_text(
    title: str,
    body: str,
    cta_link: str | None,
    from_name: str,
    *,
    recipient_name: str | None = None,
    intro: str | None = None,
    details: list[tuple[str, str]] | None = None,
    snapshot_title: str = "Snapshot",
) -> str:
    """Plain-text fallback for the notification email."""
    lines = [title, ""]
    if recipient_name:
        lines += [f"Hi {recipient_name},", ""]
    lines += [intro if intro is not None else body, ""]
    if details:
        lines.append(f"{snapshot_title}:")
        lines += [f"  {label}: {value}" for label, value in details]
        lines.append("")
    if cta_link:
        lines.append(f"Open: {cta_link}")
        lines.append("")
    lines.append(f"— {from_name}")
    return "\n".join(lines) + "\n"


def send_notification_email(
    to_email: str,
    title: str,
    body: str,
    cta_link: str | None = None,
    cta_label: str | None = None,
    org_id: int | None = None,
    *,
    subject: str | None = None,
    recipient_name: str | None = None,
    intro: str | None = None,
    details: list[tuple[str, str]] | None = None,
    snapshot_title: str = "Snapshot",
) -> bool:
    """Email a notification / announcement.

    Returns True if the message was handed to the SMTP server. Callers must
    NOT depend on the return — the in-app notification row is the source of
    truth; email is a best-effort secondary channel. Intended to be invoked
    via FastAPI BackgroundTasks so the SMTP handshake doesn't block the
    request thread. `org_id` selects the per-org theme.

    The optional keyword fields produce the formal, snapshot-style emails:
    `subject` overrides the Subject header + H1 (defaults to `title`),
    `recipient_name` adds a greeting, `intro` is the lead paragraph (falls back
    to `body`), and `details` renders a labelled "{snapshot_title}" table. Omit
    them all for the original generic look."""
    theme = _resolve_theme(org_id)
    sender_display_name = _resolve_from_name(theme)
    heading = subject or title
    return _send(
        to_email=to_email,
        subject=heading,
        html_body=_notification_html(
            heading,
            body,
            cta_link,
            cta_label,
            theme,
            recipient_name=recipient_name,
            intro=intro,
            details=details,
            snapshot_title=snapshot_title,
        ),
        text_body=_notification_text(
            heading,
            body,
            cta_link,
            sender_display_name,
            recipient_name=recipient_name,
            intro=intro,
            details=details,
            snapshot_title=snapshot_title,
        ),
        from_name=sender_display_name,
    )
