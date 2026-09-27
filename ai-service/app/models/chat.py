from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class AttachmentItem(BaseModel):
    """
    Metadata for uploaded files attached to a chat message.
    Designed for forward compatibility with Phase 2 file processing.
    """
    type: str = Field(default="other", description="File type: excel, csv, pdf, txt, etc.")
    filename: str = Field(..., description="Original filename")
    stored_path: str = Field(..., description="File path on disk or storage URL")
    size_bytes: int = Field(default=0, description="File size in bytes")
    processed: bool = Field(default=False, description="Whether agent has processed the file")
    processing_summary: Optional[str] = Field(
        default=None,
        description="Summary of processing results (e.g. rows imported)"
    )


class ChatMessageItem(BaseModel):
    """
    Standard message record representation in the permanent 'chat_messages' collection.
    Used for reading chat history in the UI.
    """
    message_id: str = Field(..., description="Unique message UUID")
    thread_id: str = Field(..., description="Thread identifier (e.g., secretary_12)")
    role: str = Field(..., pattern="^(human|assistant|system)$", description="Sender role")
    content: str = Field(..., description="Message text content")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="UTC timestamp")
    attachments: List[AttachmentItem] = Field(
        default_factory=list,
        description="List of file attachments (empty for standard text messages)"
    )


class ChatRequest(BaseModel):
    """
    Incoming request payload for POST /chat/message.
    """
    message: str = Field(..., min_length=1, description="Message sent by the secretary")
    secretary_id: int = Field(default=1, description="ID of the secretary sending the message")
    society_name: Optional[str] = Field(default="the Society", description="Name of the society for context")
    secretary_name: Optional[str] = Field(default="Secretary", description="Name of the secretary for greeting")
    thread_id: Optional[str] = Field(
        default=None,
        description="Optional custom thread ID. If omitted, defaults to 'secretary_{secretary_id}'"
    )


class ChatResponse(BaseModel):
    """
    Response returned to secretary from POST /chat/message.
    """
    message_id: str = Field(..., description="UUID of the AI response message")
    thread_id: str = Field(..., description="Thread identifier")
    role: str = Field(default="assistant", description="Role (always assistant)")
    content: str = Field(..., description="AI generated answer")
    timestamp: datetime = Field(..., description="Timestamp of the generated reply")
    attachments: List[AttachmentItem] = Field(
        default_factory=list,
        description="Any attachments produced by the assistant"
    )


class HistoryResponse(BaseModel):
    """
    Paginated or full conversation history for GET /chat/history.
    """
    thread_id: str = Field(..., description="Thread identifier")
    messages: List[ChatMessageItem] = Field(
        default_factory=list,
        description="Chronological list of all messages in this thread"
    )
    total_count: int = Field(..., description="Total message count in this thread")
