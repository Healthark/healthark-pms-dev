from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.routes import auth_routes
from app.api.routes import goal_routes
from app.api.routes import admin_routes

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
app.include_router(admin_routes.router, prefix=f"{settings.API_V1_STR}/admin", tags=["Admin"])

@app.get("/")
def root():
    return {"message": "Welcome to the Healthark PMS API. Visit /docs for the Swagger UI."}