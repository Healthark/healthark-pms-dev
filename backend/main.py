import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import (
    admin_routes,
    annual_review_routes,
    auth_routes,
    dashboard_routes,
    export_routes,
    feedback_360_routes,
    goal_routes,
    mentee_routes,
    notification_routes,
    project_review_routes,
    project_routes,
    support_routes,
    system_settings_routes,
    user_routes,
)
from app.core.config import settings
from app.core.csrf import CSRFMiddleware

logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Multi-Tenant Performance Management API",
    # Explicit: never let FastAPI/Starlette render a traceback into a response,
    # even if an environment accidentally flips this on. Unhandled errors are
    # sanitized by the handler below and the detail is logged server-side only.
    debug=False,
)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """Catch-all for uncaught (non-HTTP) errors so a raw exception — which for
    DB-layer failures embeds the connection string, SQL, and parameters — can
    never reach the client. FastAPI still handles HTTPException/validation
    errors with their own responses; this only covers 500s.

    The full detail (with traceback) goes to the server log; the client gets a
    generic message.
    """
    logger.exception(
        "Unhandled error on %s %s", request.method, request.url.path
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

_default_origins = [
    "http://localhost",
    "http://localhost:4173",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "https://healthark-pms-dev.vercel.app"
]

# Merge in any production origins set via env var (comma-separated).
# Example Render env var:
#   CORS_ALLOWED_ORIGINS=https://your-app.vercel.app,https://www.yourapp.com
_extra_origins = [
    o.strip()
    for o in settings.CORS_ALLOWED_ORIGINS.split(",")
    if o.strip()
]

origins = _default_origins + _extra_origins

# Starlette executes middleware in reverse registration order on the request
# phase — the LAST add_middleware call is the outermost layer. CORS must be
# outermost so browser preflight OPTIONS requests are answered before the
# CSRF check runs (an OPTIONS without X-CSRF-Token would otherwise 403).
# GZip is registered first so it's the innermost layer — it compresses the
# response body on the way out, then CSRF and CORS append their headers
# around the already-compressed payload. minimum_size=500 skips compression
# for tiny responses where the overhead would dominate.
app.add_middleware(GZipMiddleware, minimum_size=500)

app.add_middleware(CSRFMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router,  prefix=f"{settings.API_V1_STR}/auth",  tags=["Authentication"])
app.include_router(goal_routes.router,  prefix=f"{settings.API_V1_STR}/goals", tags=["Goals"])
app.include_router(admin_routes.router,     prefix=f"{settings.API_V1_STR}/admin",     tags=["Admin"])
app.include_router(dashboard_routes.router,      prefix=f"{settings.API_V1_STR}/dashboard",      tags=["Dashboard"])
app.include_router(notification_routes.router,   prefix=f"{settings.API_V1_STR}/notifications",  tags=["Notifications"])
app.include_router(user_routes.router,           prefix=f"{settings.API_V1_STR}/users",           tags=["Users"])
app.include_router(system_settings_routes.router, prefix=f"{settings.API_V1_STR}/settings", tags=["System Settings"],)
app.include_router(annual_review_routes.router,prefix=f"{settings.API_V1_STR}/annual-reviews",tags=["Annual Reviews"],)
app.include_router(project_routes.router,        prefix=f"{settings.API_V1_STR}/projects",        tags=["Projects"])
app.include_router(project_review_routes.router, prefix=f"{settings.API_V1_STR}/project-reviews", tags=["Project Reviews"])
app.include_router(mentee_routes.router,         prefix=f"{settings.API_V1_STR}/mentees",         tags=["Mentees"])
app.include_router(feedback_360_routes.router,   prefix=f"{settings.API_V1_STR}/feedback-360",    tags=["360 Feedback"])
app.include_router(export_routes.router,         prefix=f"{settings.API_V1_STR}/exports",         tags=["Exports"])
app.include_router(support_routes.router,        prefix=f"{settings.API_V1_STR}/support",         tags=["Support"])

@app.get("/")
def root():
    return {"message": "Welcome to the Healthark PMS API. Visit /docs for the Swagger UI."}
