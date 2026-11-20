import json
import logging
import uuid
from typing import Any, AsyncIterator
from langchain_core.messages import HumanMessage
from app.graph.builder import get_graph
from app.models.chat import ChatRequest
from app.services import history_service

logger = logging.getLogger(__name__)


def extract_chunk_text(content: Any) -> str:
    """
    Extract pure text string from a stream message chunk.
    Handles both direct strings and structured block lists.
    """
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and "text" in part:
                parts.append(part["text"])
            elif isinstance(part, str):
                parts.append(part)
        return "".join(parts)
    return ""


async def stream_chat(request: ChatRequest) -> AsyncIterator[str]:
    """
    Orchestrate the streaming agentic chat interaction:
    1. Resolve permanent thread_id (e.g. 'secretary_12').
    2. Save incoming user message to MongoDB permanent 'chat_messages' collection.
    3. Yield SSE 'start' event with message and thread IDs.
    4. Stream LangGraph execution via Server-Sent Events (SSE):
       - 'tool_start': Emitted when LLM calls an agent tool
       - 'tool_result': Emitted when ToolNode completes execution
       - 'token': Emitted for real-time text chunk streaming
    5. Accumulate the final text response.
    6. Save full assistant message to MongoDB permanent collection upon completion.
    7. Yield SSE 'done' event with the complete response.
    """
    thread_id = request.thread_id or f"secretary_{request.secretary_id}"
    user_msg_id = str(uuid.uuid4())
    ai_msg_id = str(uuid.uuid4())

    logger.info(
        "Processing chat stream for thread: %s (society_id: %s)",
        thread_id,
        request.society_id,
    )

    # 1. Save user message immediately to permanent chat history
    try:
        await history_service.save_message(
            thread_id=thread_id,
            role="human",
            content=request.message,
            message_id=user_msg_id,
        )
    except Exception as e:
        logger.error("Failed to persist user message: %s", e, exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'message': 'Failed to save message to database.'})}\n\n"
        return

    # 2. Emit SSE initial 'start' event
    start_payload = {
        "type": "start",
        "message_id": ai_msg_id,
        "thread_id": thread_id,
    }
    yield f"data: {json.dumps(start_payload)}\n\n"

    # 3. Stream LangGraph execution with society_id in RunnableConfig
    graph = get_graph()
    config = {
        "configurable": {
            "thread_id": thread_id,
            "society_id": request.society_id,
            "society_name": request.society_name or "the Society",
            "secretary_name": request.secretary_name or "Secretary",
        }
    }
    input_state = {
        "messages": [HumanMessage(content=request.message, id=user_msg_id)]
    }

    accumulated_parts = []

    try:
        async for chunk, metadata in graph.astream(
            input_state,
            config=config,
            stream_mode="messages",
        ):
            node = metadata.get("langgraph_node", "")

            # A. Model output node: handles tokens and tool call emissions
            if node == "call_model":
                # Detect tool calls in the chunk
                if hasattr(chunk, "tool_calls") and chunk.tool_calls:
                    for tc in chunk.tool_calls:
                        yield f"data: {json.dumps({'type': 'tool_start', 'tool': tc.get('name'), 'args': tc.get('args', {})})}\n\n"

                # Stream text content
                token = extract_chunk_text(chunk.content)
                if token:
                    accumulated_parts.append(token)
                    yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

            # B. Tool executor node: emits tool execution progress
            elif node == "tool_executor":
                tool_content = getattr(chunk, "content", "")
                if tool_content:
                    yield f"data: {json.dumps({'type': 'tool_result', 'content': str(tool_content)[:500]})}\n\n"

    except Exception as e:
        logger.error("Error during LangGraph stream execution: %s", e, exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        return

    # 4. Stream finished: combine full text
    full_response = "".join(accumulated_parts).strip()

    # 5. Save complete AI message to permanent chat history in MongoDB
    try:
        await history_service.save_message(
            thread_id=thread_id,
            role="assistant",
            content=full_response,
            message_id=ai_msg_id,
        )
        logger.info(
            "Successfully persisted completed AI response (%s) for thread %s.",
            ai_msg_id,
            thread_id,
        )
    except Exception as e:
        logger.error("Failed to persist AI response: %s", e, exc_info=True)

    # 6. Emit SSE 'done' event
    done_payload = {
        "type": "done",
        "message_id": ai_msg_id,
        "thread_id": thread_id,
        "content": full_response,
    }
    yield f"data: {json.dumps(done_payload)}\n\n"
