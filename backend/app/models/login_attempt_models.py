"""
LoginAttempt — failed-login ledger for brute-force throttling.

`/auth/login` has no per-account or per-IP throttle on its own, so an
attacker can hammer credentials indefinitely. We record one row per failed
attempt (keyed by the *submitted* email, lowercased — so attempts against
non-existent accounts are throttled too) and refuse further attempts for an
account once the count in a sliding window exceeds the cap.

Only FAILED attempts are recorded; a successful login is not written (and the
throttle is windowed, so it self-heals — no explicit "clear on success" is
needed). `ip` is captured for forensic attribution, not used in the count, so
an office sharing one NAT IP isn't collectively locked out.

This mirrors the DB-backed rate-limit ledger already used for password resets
(see PasswordResetToken) — durable across restarts and shared across workers,
unlike an in-process counter.
"""

from sqlalchemy import Column, Integer, String, DateTime, Index
from sqlalchemy.sql import func

from app.core.database import Base


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True, index=True)

    # The submitted email, normalized to lowercase. NOT a FK — we record
    # attempts against unknown addresses too (enumeration / spray defense).
    email = Column(String(255), nullable=False)

    # Best-effort client IP for forensics. May be a proxy hop on PaaS hosts.
    ip = Column(String(64), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        # Hot path: "how many failed attempts for this email since T?".
        Index("ix_login_attempts_email_created", "email", "created_at"),
    )
