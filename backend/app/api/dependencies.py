from typing import Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.user_models import User

# 1. The Swagger UI Connector
# This tells FastAPI exactly where to send the username/password when you 
# click the green "Authorize" padlock button in the Swagger UI.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")

# Reusable Database Session (same as we used in auth.py)
DbSession = Annotated[Session, Depends(get_db)]

def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: DbSession) -> User:
    """
    Intercepts the request, decodes the JWT, and returns the Database User object.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        # 2. Decode the Token
        # If the token is expired, or if a hacker tampered with it, 
        # jwt.decode will immediately throw a JWTError and crash the request.
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        
        # We stored user_id in the payload earlier in auth.py
        user_id: int = payload.get("user_id")
        if user_id is None:
            raise credentials_exception
            
    except JWTError:
        raise credentials_exception
        
    # 3. Look up the user in the database
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
        
    # 4. The Last Line of Defense
    # What if a user was fired and soft-deleted 5 minutes ago, but their token 
    # is still valid for another hour? We catch them here.
    if user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated."
        )
        
    return user

# --- The Architect's Trick: The Golden Dependency ---
# Anytime you want to lock down an endpoint, you will simply add: `current_user: CurrentUser`
CurrentUser = Annotated[User, Depends(get_current_user)]