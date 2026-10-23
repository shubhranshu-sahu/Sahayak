import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings
from app.database.mongodb import init_db, close_db, get_async_client
from app.database.mysql import init_mysql, close_mysql, get_mysql_pool
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
    Handles startup (MongoDB & MySQL connection pool initialization) and graceful shutdown.
    """
    logger.info("Starting Sahayak AI Service (%s mode)...", settings.ENVIRONMENT)

    # 1. Initialize MongoDB
    try:
        await init_db()
        logger.info("MongoDB initialized successfully.")
    except Exception as e:
        logger.error("Failed to initialize MongoDB during startup: %s", e, exc_info=True)

    # 2. Initialize MySQL (for direct tool execution)
    try:
        await init_mysql()
        logger.info("MySQL connection pool initialized successfully.")
    except Exception as e:
        logger.warning(
            "Could not connect to MySQL during startup: %s. "
            "(Tools requiring MySQL will fail until valid MYSQL_* credentials are provided in .env)",
            e,
        )

    yield

    # Graceful Shutdown
    logger.info("Shutting down Sahayak AI Service...")
    await close_db()
    await close_mysql()
    logger.info("Shutdown complete.")


# Initialize FastAPI application
app = FastAPI(
    title="Sahayak AI Service",
    description="LangGraph + Gemini powered AI management assistant for society secretaries",
    version="0.2.0",
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
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Routers
app.include_router(chat_router)


@app.api_route("/", methods=["GET", "HEAD"], tags=["General"])
async def root():
    """Root endpoint welcoming the caller and pointing to API documentation."""
    return {
        "service": "Sahayak AI Service",
        "status": "running",
        "version": "0.2.0",
        "docs_url": "/docs",
        "health_url": "/health",
    }


@app.api_route("/health", methods=["GET", "HEAD"], tags=["Monitoring"])
async def health_check():
    """
    Health check endpoint.
    Verifies service status, database connectivity to MongoDB and MySQL, and Gemini configuration.
    """
    # 1. Check MongoDB
    mongo_status = "unknown"
    try:
        client = get_async_client()
        await client.admin.command("ping")
        mongo_status = "connected"
    except Exception as e:
        mongo_status = f"unhealthy: {str(e)}"

    # 2. Check MySQL
    mysql_status = "unknown"
    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT 1 AS ping")
        mysql_status = "connected"
    except Exception as e:
        mysql_status = f"unhealthy: {str(e)}"

    is_healthy = mongo_status == "connected"
    response_payload = {
        "status": "healthy" if is_healthy else "degraded",
        "service": "sahayak-ai",
        "version": "0.2.0",
        "environment": settings.ENVIRONMENT,
        "database": {
            "mongodb": {
                "status": mongo_status,
                "name": settings.MONGODB_DB_NAME,
            },
            "mysql": {
                "status": mysql_status,
                "database": settings.MYSQL_DATABASE,
                "host": settings.MYSQL_HOST,
            },
        },
        "gemini": {
            "configured": settings.is_gemini_configured,
            "model": settings.GEMINI_MODEL,
        },
    }

    status_code = status.HTTP_200_OK if is_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=status_code, content=response_payload)
