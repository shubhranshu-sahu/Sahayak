import logging
from typing import Any, Dict
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from app.config import settings

logger = logging.getLogger(__name__)

# Security scheme for Swagger UI and automatic Authorization header extraction
security = HTTPBearer(
    scheme_name="BearerAuth",
    description="Enter the JWT token issued by the Sahayak Node.js backend.",
    auto_error=True,
)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Dict[str, Any]:
    """
    Validate and decode the JWT issued by the Node.js backend.

    Checks:
    1. Signature validity using shared JWT_SECRET.
    2. Expiration timestamp (exp).
    3. Account status ('active').

    Returns:
        dict: The verified token payload containing user metadata.
    """
    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError:
        logger.warning("Rejected expired JWT token.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError as e:
        logger.warning("Rejected invalid JWT token: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token signature or format.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Validate essential fields
    user_id = payload.get("userId")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload is missing userId.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Verify user account status
    account_status = payload.get("status", "active")
    if account_status != "active":
        logger.warning("Blocked access for inactive user ID: %s (status=%s)", user_id, account_status)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is not active (status: {account_status}).",
        )

    return {
        "user_id": int(user_id),
        "role": payload.get("role", "resident"),
        "society_id": payload.get("societyId"),
        "status": account_status,
        "raw_payload": payload,
    }


async def get_current_secretary(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    FastAPI dependency ensuring that the authenticated caller has the 'secretary' role.
    Residents and unverified users are rejected with HTTP 403 Forbidden.
    """
    role = user.get("role")
    if role not in ["secretary", "super_admin"]:
        logger.warning(
            "Access forbidden: User %s with role '%s' attempted to access AI secretary endpoints.",
            user.get("user_id"),
            role,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden. Only society secretaries are authorized to use the AI service.",
        )

    return user
