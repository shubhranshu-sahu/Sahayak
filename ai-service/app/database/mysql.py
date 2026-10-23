import logging
from typing import Optional
import aiomysql
from app.config import settings

logger = logging.getLogger(__name__)

_pool: Optional[aiomysql.Pool] = None


async def get_mysql_pool() -> aiomysql.Pool:
    """
    Return the singleton async MySQL connection pool.
    Configured with DictCursor so query results are returned as python dictionaries.
    """
    global _pool
    if _pool is None:
        _pool = await aiomysql.create_pool(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=settings.MYSQL_USER,
            password=settings.MYSQL_PASSWORD,
            db=settings.MYSQL_DATABASE,
            minsize=1,
            maxsize=settings.MYSQL_POOL_SIZE,
            autocommit=True,
            charset="utf8mb4",
            cursorclass=aiomysql.DictCursor,
        )
        logger.info(
            "MySQL connection pool created (host=%s, db=%s, pool_size=%d).",
            settings.MYSQL_HOST,
            settings.MYSQL_DATABASE,
            settings.MYSQL_POOL_SIZE,
        )
    return _pool


async def init_mysql() -> None:
    """
    Initialize MySQL pool and verify connectivity via ping query.
    Called once during FastAPI application startup lifespan.
    """
    pool = await get_mysql_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT 1 AS health")
            result = await cur.fetchone()
    logger.info("MySQL connection verified successfully: %s", result)


async def close_mysql() -> None:
    """
    Close MySQL pool gracefully on application shutdown.
    Waits for all active connections in the pool to close.
    """
    global _pool
    if _pool:
        _pool.close()
        await _pool.wait_closed()
        _pool = None
        logger.info("MySQL connection pool closed gracefully.")
