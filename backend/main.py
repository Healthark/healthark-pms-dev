from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.routes import auth_routes

# Initialize the FastAPI application
app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Multi-Tenant Performance Management API"
)

# --- SECURITY: CORS (Cross-Origin Resource Sharing) ---
# Architect Note: Because your React frontend will run on a different port 
# (like localhost:5173), browsers will block it from talking to this API (localhost:8000) 
# unless we explicitly allow it here.
origins = [
    "http://localhost",
    "http://localhost:5173", # Vite React default port
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"], # Allow GET, POST, PUT, DELETE
    allow_headers=["*"],
)

# --- ROUTER REGISTRATION ---
# We attach our Auth router under the /api/v1/auth prefix
app.include_router(auth_routes.router, prefix=f"{settings.API_V1_STR}/auth", tags=["Authentication"])

@app.get("/")
def root():
    return {"message": "Welcome to the Healthark PMS API. Visit /docs for the Swagger UI."}