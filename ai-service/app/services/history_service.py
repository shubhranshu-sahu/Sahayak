import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pymongo import ASCENDING
from app.database.mongodb import get_chat_messages_collection
from app.models.chat import ChatMessageItem

logger = logging.getLogger(__name__)


async def save_message(
    thread_id: str,
    role: str,
    content: str,
    message_id: Optional[str] = None,
    attachments: Optional[List[Dict[str, Any]]] = None,
    timestamp: Optional[datetime] = None,
) -> ChatMessageItem:
    """
    Save a message permanently to the 'chat_messages' collection.
    This collection is never trimmed by LangGraph and preserves full UI history.

    Args:
        thread_id: The thread identifier (e.g., 'secretary_12')
        role: Message role ('human', 'assistant', or 'system')
        content: Text content of the message
        message_id: Optional UUID string; generated automatically if not provided
        attachments: Optional list of attachment metadata dicts
        timestamp: Optional UTC timestamp; defaults to now()

    Returns:
        ChatMessageItem: The saved message record
    """
    msg_id = message_id or str(uuid.uuid4())
    msg_timestamp = timestamp or datetime.utcnow()
    msg_attachments = attachments or []

    document = {
        "message_id": msg_id,
        "thread_id": thread_id,
        "role": role,
        "content": content,
        "timestamp": msg_timestamp,
        "attachments": msg_attachments,
    }

    collection = get_chat_messages_collection()
    await collection.insert_one(document)

    logger.info("Saved %s message (%s) to thread %s.", role, msg_id, thread_id)

    return ChatMessageItem(
        message_id=msg_id,
        thread_id=thread_id,
        role=role,
        content=content,
        timestamp=msg_timestamp,
        attachments=msg_attachments,
    )


async def get_history(
    thread_id: str,
    limit: int = 50,
    skip: int = 0,
) -> List[ChatMessageItem]:
    """
    Fetch the chronological permanent chat history for a thread.

    Args:
        thread_id: The thread identifier
        limit: Maximum number of messages to return
        skip: Number of messages to skip for pagination

    Returns:
        List[ChatMessageItem]: Chronological list of past messages
    """
    collection = get_chat_messages_collection()

    # Query uses compound index on (thread_id, timestamp)
    cursor = (
        collection.find({"thread_id": thread_id})
        .sort("timestamp", ASCENDING)
        .skip(skip)
        .limit(limit)
    )

    documents = await cursor.to_list(length=limit)

    return [
        ChatMessageItem(
            message_id=doc["message_id"],
            thread_id=doc["thread_id"],
            role=doc["role"],
            content=doc["content"],
            timestamp=doc["timestamp"],
            attachments=doc.get("attachments", []),
        )
        for doc in documents
    ]


async def get_message_count(thread_id: str) -> int:
    """
    Return the total number of messages in a thread's permanent history.
    """
    collection = get_chat_messages_collection()
    return await collection.count_documents({"thread_id": thread_id})
