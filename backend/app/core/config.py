from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "Healthark PMS"
    API_V1_STR: str = "/api/v1"

    # Security
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 7 days

    # Database
    DATABASE_URL: str

    # ── Cookie auth ─────────────────────────────────────────────────
    # Whether frontend and backend share an origin in this deployment.
    # - True  (default, prod behind a reverse proxy): SameSite=Lax is fine,
    #   Secure can be False on http dev and must be True on https prod.
    # - False (dev vite↔fastapi, or prod on separate domains): SameSite=None
    #   is required for cookies to cross the boundary, which in turn forces
    #   Secure=True (browsers reject SameSite=None over http in prod; on
    #   http://localhost Chrome is lenient so dev still works).
    SAME_ORIGIN: bool = True
    COOKIE_SECURE: bool = False
    # Only set for cross-origin across subdomains (e.g. ".example.com").
    COOKIE_DOMAIN: str | None = None
    ACCESS_COOKIE_NAME: str = "access_token"
    CSRF_COOKIE_NAME: str = "csrf_token"
    CSRF_HEADER_NAME: str = "X-CSRF-Token"

    # ── Outbound email (admin password reset, future notifications) ─
    # Leave SMTP_USERNAME / SMTP_PASSWORD unset to disable email sending —
    # the password-reset endpoint will still succeed and the admin can
    # relay the temp password manually via the reveal modal.
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM_NAME: str = "Healthark PMS"
    # Used to render the "Sign in" CTA link inside outbound emails.
    APP_BASE_URL: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    FISCAL_START_MONTH: int = 4

    def cookie_kwargs(self) -> dict:
        """Shared cookie attributes for set_cookie / delete_cookie. SameSite=None
        requires Secure=True per browser spec, so we enforce that when the
        deployment is cross-origin regardless of COOKIE_SECURE."""
        samesite = "lax" if self.SAME_ORIGIN else "none"
        return {
            "secure": self.COOKIE_SECURE or not self.SAME_ORIGIN,
            "samesite": samesite,
            "domain": self.COOKIE_DOMAIN,
            "path": "/",
        }


settings = Settings()