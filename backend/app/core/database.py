from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

# Enterprise Performance Note:
# pool_size: How many connections to keep open permanently.
# max_overflow: How many extra connections to open during traffic spikes.
# pool_pre_ping: Checks if the database connection is alive before using it (prevents "Server gone away" errors).

engine = create_engine(
    settings.DATABASE_URL,
    pool_size=10, 
    max_overflow=20,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency to inject the database session into our FastAPI routes
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()