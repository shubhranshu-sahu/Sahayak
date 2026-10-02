import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings
from app.database.mongodb import init_db, close_db, get_async_client
from app.routers.chat import router as chat_router

# Setup structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("sahayak-ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager.
    Handles startup (DB connection, index initialization) and graceful shutdown.
    """
    logger.info("Starting Sahayak AI Service (%s mode)...", settings.ENVIRONMENT)
    try:
        await init_db()
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.error("Failed to initialize database during startup: %s", e, exc_info=True)
        # Note: In development we allow startup to proceed so health endpoint can report the error

    yield

    logger.info("Shutting down Sahayak AI Service...")
    await close_db()
    logger.info("Shutdown complete.")


# Initialize FastAPI application
app = FastAPI(
    title="Sahayak AI Service",
    description="LangGraph + Gemini powered AI management assistant for society secretaries",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure CORS for local development and frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://sahayak-yhn6.onrender.com",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Routers
app.include_router(chat_router)


@app.get("/", tags=["General"])
async def root():
    """Root endpoint welcoming the caller and pointing to API documentation."""
    return {
        "service": "Sahayak AI Service",
        "status": "running",
        "docs_url": "/docs",
        "health_url": "/health",
    }


@app.get("/health", tags=["Monitoring"])
async def health_check():
    """
    Health check endpoint.
    Verifies service status, database connectivity to MongoDB, and Gemini configuration.
    """
    db_status = "unknown"
    try:
        client = get_async_client()
        await client.admin.command("ping")
        db_status = "connected"
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"

    is_healthy = db_status == "connected"
    response_payload = {
        "status": "healthy" if is_healthy else "degraded",
        "service": "sahayak-ai",
        "version": "0.1.0",
        "environment": settings.ENVIRONMENT,
        "database": {
            "status": db_status,
            "name": settings.MONGODB_DB_NAME,
        },
        "gemini": {
            "configured": settings.is_gemini_configured, 
            "model": settings.GEMINI_MODEL,
        },
    }

    status_code = status.HTTP_200_OK if is_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=status_code, content=response_payload)
