from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.routes import auth_routes
from app.api.routes import goal_routes
from app.api.routes import admin_routes
from app.api.routes import dashboard_routes
from app.api.routes import notification_routes
from app.api.routes import user_routes
from app.api.routes import system_settings_routes
from app.api.routes import annual_review_routes
from app.api.routes import project_routes
from app.api.routes import project_review_routes

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Multi-Tenant Performance Management API"
)

origins = [
    "http://localhost",
    "http://localhost:5173",
    "http://localhost:3000",
]

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

@app.get("/")
def root():
    return {"message": "Welcome to the Healthark PMS API. Visit /docs for the Swagger UI."}