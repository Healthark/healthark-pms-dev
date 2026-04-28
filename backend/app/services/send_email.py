"""
Outbound email service.

Transport is plain SMTP-with-STARTTLS (works for Gmail, O365, Mailgun, SES). All
credentials read from `settings`; if SMTP_USERNAME or SMTP_PASSWORD is missing we
log a warning and skip sending — callers should treat send failures as
non-fatal because the admin reveal-modal still shows the temp password
in-app as a manual-relay fallback.

Templates live in this file as inline f-strings (no Jinja yet) since we currently
have a single email type. When a second template is added, extract them into
`backend/app/services/email_templates/` with one function per template.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Transport ───────────────────────────────────────────────────────


def _smtp_configured() -> bool:
    return bool(settings.SMTP_USERNAME and settings.SMTP_PASSWORD)


def _send(
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> bool:
    """Send a multipart/alternative email. Returns True on success, False on
    any SMTP/auth/connection failure (callers log + continue)."""
    if not _smtp_configured():
        logger.warning(
            "SMTP not configured (set SMTP_USERNAME / SMTP_PASSWORD in .env). "
            "Skipping email to %s — subject=%r.",
            to_email,
            subject,
        )
        return False

    message = EmailMessage()
    message["From"] = formataddr((settings.SMTP_FROM_NAME, settings.SMTP_USERNAME))
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
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


def _password_reset_html(full_name: str, temp_password: str, login_url: str) -> str:
    """Inline-styled HTML for the admin-initiated password reset email.

    Uses table-based layout + inline CSS for broad email-client support
    (Gmail web, Outlook, Apple Mail). No web fonts, no external CSS, no
    background images.
    """
    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your password has been reset</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
          <!-- Header band -->
          <tr>
            <td style="background-color:#0f172a;padding:24px 32px;">
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:600;letter-spacing:0.2px;">
                {settings.SMTP_FROM_NAME}
              </p>
              <p style="margin:4px 0 0 0;color:#94a3b8;font-size:13px;">
                Account security notification
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0f172a;">
                Your password has been reset
              </h1>
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#334155;">
                Hi {full_name},
              </p>
              <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#334155;">
                An administrator has reset your account password. Use the temporary
                password below to sign in. You will be prompted to set a new password
                immediately.
              </p>

              <!-- Password card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;">
                    <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;">
                      Temporary password
                    </p>
                    <p style="margin:0;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:18px;font-weight:600;color:#0f172a;letter-spacing:0.5px;word-break:break-all;">
                      {temp_password}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td align="center" style="background-color:#0f172a;border-radius:8px;">
                    <a href="{login_url}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Sign in
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security warning -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
                <tr>
                  <td style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;">
                    <p style="margin:0;font-size:13px;line-height:1.5;color:#92400e;">
                      <strong>Security tip:</strong> this temporary password is
                      intended for one-time use. If you did not expect a password
                      reset, contact your HR administrator immediately.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                This is an automated message from {settings.SMTP_FROM_NAME}.
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


def _password_reset_text(full_name: str, temp_password: str, login_url: str) -> str:
    """Plain-text fallback. Same content as HTML, no formatting."""
    return (
        f"Hi {full_name},\n\n"
        "An administrator has reset your account password. Use the temporary "
        "password below to sign in. You will be prompted to set a new password "
        "immediately.\n\n"
        f"Temporary password: {temp_password}\n\n"
        f"Sign in: {login_url}\n\n"
        "Security tip: this temporary password is intended for one-time use. If "
        "you did not expect a password reset, contact your HR administrator "
        "immediately.\n\n"
        f"— {settings.SMTP_FROM_NAME}\n"
    )


# ── Public API ──────────────────────────────────────────────────────


def send_password_reset_email(
    to_email: str,
    full_name: str,
    temp_password: str,
) -> bool:
    """Email a freshly minted temporary password to the user. Returns True if
    the message was handed off to the SMTP server, False otherwise. The caller
    must NOT make the password reset depend on this return value — the admin
    reveal modal is the authoritative fallback."""
    login_url = f"{settings.APP_BASE_URL.rstrip('/')}/login"
    return _send(
        to_email=to_email,
        subject=f"Your {settings.SMTP_FROM_NAME} password has been reset",
        html_body=_password_reset_html(full_name, temp_password, login_url),
        text_body=_password_reset_text(full_name, temp_password, login_url),
    )
