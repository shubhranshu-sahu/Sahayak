import logging
from typing import Optional
from pymongo import MongoClient, ASCENDING
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase, AsyncIOMotorCollection
from langgraph.checkpoint.mongodb import MongoDBSaver
from app.config import settings

logger = logging.getLogger(__name__)

# Singletons for database connections and checkpointer
_async_client: Optional[AsyncIOMotorClient] = None
_sync_client: Optional[MongoClient] = None
_checkpointer: Optional[MongoDBSaver] = None


def get_sync_client() -> MongoClient:
    """Return the singleton PyMongo synchronous client (used by MongoDBSaver)."""
    global _sync_client
    if _sync_client is None:
        _sync_client = MongoClient(settings.MONGODB_URI)
    return _sync_client


def get_async_client() -> AsyncIOMotorClient:
    """Return the singleton Motor asynchronous client (used by FastAPI services)."""
    global _async_client
    if _async_client is None:
        _async_client = AsyncIOMotorClient(settings.MONGODB_URI)
    return _async_client


def get_async_db() -> AsyncIOMotorDatabase:
    """Return the asynchronous MongoDB database instance."""
    client = get_async_client()
    return client[settings.MONGODB_DB_NAME]


def get_chat_messages_collection() -> AsyncIOMotorCollection:
    """
    Return the asynchronous collection for permanent full chat history.
    This collection is managed entirely by our app and is read by the UI.
    """
    db = get_async_db()
    return db[settings.CHAT_MESSAGES_COLLECTION]


def get_checkpointer() -> MongoDBSaver:
    """
    Return the LangGraph MongoDBSaver checkpointer instance.
    This manages the sliding window agent state in the 'agent_threads' collection.
    It supports both synchronous (invoke) and asynchronous (ainvoke / astream) execution.
    """
    global _checkpointer
    if _checkpointer is None:
        client = get_sync_client()
        _checkpointer = MongoDBSaver(
            client=client,
            db_name=settings.MONGODB_DB_NAME,
            checkpoint_collection_name=settings.AGENT_THREADS_COLLECTION,
        )
    return _checkpointer


async def init_db() -> None:
    """
    Initialize database connections, verify connectivity, and ensure indexes exist.
    Called once during FastAPI application startup lifespan.
    """
    logger.info("Connecting to MongoDB Atlas...")

    # 1. Verify connection with a ping command
    async_client = get_async_client()
    await async_client.admin.command("ping")
    logger.info("Successfully connected to MongoDB Atlas.")

    # 2. Ensure indexes on chat_messages collection
    messages_col = get_chat_messages_collection()

    # Compound index on (thread_id, timestamp) for efficient chronological history queries
    await messages_col.create_index(
        [("thread_id", ASCENDING), ("timestamp", ASCENDING)],
        name="idx_thread_timestamp",
    )

    # Unique index on message_id for deduplication
    await messages_col.create_index(
        [("message_id", ASCENDING)],
        unique=True,
        name="idx_message_id_unique",
    )
    logger.info("MongoDB indexes verified on '%s' collection.", settings.CHAT_MESSAGES_COLLECTION)

    # 3. Pre-initialize checkpointer
    get_checkpointer()
    logger.info("LangGraph MongoDBSaver checkpointer initialized on '%s'.", settings.AGENT_THREADS_COLLECTION)


async def close_db() -> None:
    """
    Close MongoDB client connections gracefully on application shutdown.
    """
    global _async_client, _sync_client, _checkpointer
    if _async_client:
        _async_client.close()
        _async_client = None
    if _sync_client:
        _sync_client.close()
        _sync_client = None
    _checkpointer = None
    logger.info("MongoDB client connections closed.")
