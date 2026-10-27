import logging
from typing import Any, Dict, List, Sequence
from langchain_core.messages import BaseMessage, HumanMessage, RemoveMessage
from app.config import settings
from app.graph.state import AgentState
from app.services.llm_provider import get_llm_provider

logger = logging.getLogger(__name__)


def format_messages_for_summary(messages: Sequence[BaseMessage]) -> str:
    """
    Format a sequence of messages into a readable conversation transcript for the summarizer.
    """
    lines: List[str] = []
    for msg in messages:
        role = "Secretary" if msg.type == "human" else "Sahayak (AI)"
        content = msg.content
        if isinstance(content, list):
            # Handle structured content blocks if present
            text_parts = [part.get("text", "") for part in content if isinstance(part, dict)]
            content = " ".join(text_parts)
        lines.append(f"{role}: {content}")
    return "\n".join(lines)


def find_safe_overlap_index(messages: Sequence[BaseMessage], target_overlap: int = 5) -> int:
    """
    Find a clean turn boundary for sliding window overlap.
    Guarantees that the retained overlap messages (messages[split_idx:])
    always begin with a HumanMessage, never splitting an indivisible tool call turn
    (HumanMessage -> AIMessage[tool_calls] -> ToolMessage -> AIMessage).
    """
    total = len(messages)
    if total <= target_overlap:
        return 0

    cutoff = total - target_overlap

    # Walk backwards from cutoff to find the nearest HumanMessage
    for idx in range(cutoff, -1, -1):
        if getattr(messages[idx], "type", "") == "human":
            return idx

    # If no HumanMessage found going backwards, walk forward
    for idx in range(cutoff + 1, total):
        if getattr(messages[idx], "type", "") == "human":
            return idx

    return cutoff


async def summarize_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph node to summarize earlier conversation messages and trim the sliding window.

    Steps:
    1. Uses find_safe_overlap_index to partition messages cleanly on a user turn boundary:
       - messages_to_summarize: All messages before the safe turn boundary.
       - keep_messages: The retained overlap messages, always starting on a HumanMessage.
    2. Builds an update prompt folding in the existing summary (if present).
    3. Asynchronously invokes Gemini to produce a consolidated summary string.
    4. Creates RemoveMessage operations for all messages being summarized.
    5. Returns {'summary': new_summary, 'messages': delete_ops}.
    """
    messages = state.get("messages", [])
    old_summary = state.get("summary", "").strip()
    overlap_count = settings.OVERLAP_MESSAGES  # Default: 5

    # Find safe split index that preserves turn integrity
    split_idx = find_safe_overlap_index(messages, target_overlap=overlap_count)

    # Safety check: if no earlier messages can be cleanly summarized, skip
    if split_idx <= 0:
        logger.warning(
            "summarize_node invoked but no clean user-turn split found (total=%d). Skipping.",
            len(messages),
        )
        return {}

    messages_to_summarize = messages[:split_idx]
    formatted_transcript = format_messages_for_summary(messages_to_summarize)

    logger.info(
        "Summarizing %d messages (preserving %d clean overlap messages)...",
        len(messages_to_summarize),
        len(messages) - split_idx,
    )

    # Build prompt: either fold into existing summary or create a fresh one
    if old_summary:
        prompt_text = (
            f"Here is a summary of the conversation history so far:\n"
            f"\"{old_summary}\"\n\n"
            f"Now incorporate the following subsequent conversation into an updated summary:\n"
            f"{formatted_transcript}\n\n"
            f"Write a concise, comprehensive updated summary that preserves all key facts, "
            f"complaints, decisions, unit numbers, names, and action items. Do not lose critical details."
        )
    else:
        prompt_text = (
            f"Summarize the following conversation concisely:\n"
            f"{formatted_transcript}\n\n"
            f"Capture all key facts, complaints, resident names, unit numbers, decisions, and action items."
        )

    # Call Gemini to get updated summary with automatic failover
    provider = get_llm_provider()
    response = await provider.ainvoke_with_failover(
        messages=[HumanMessage(content=prompt_text)],
        temperature=0.3,
        with_tools=False,
    )

    # Extract clean text whether content is a string or structured block list
    raw_content = response.content
    if isinstance(raw_content, str):
        new_summary = raw_content
    elif isinstance(raw_content, list):
        text_parts = [
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in raw_content
        ]
        new_summary = " ".join(filter(None, text_parts))
    else:
        new_summary = str(raw_content)

    # Create RemoveMessage operations for every message being pruned
    # LangGraph's add_messages reducer deletes any message whose ID matches RemoveMessage.id
    delete_ops: List[RemoveMessage] = []
    for msg in messages_to_summarize:
        if msg.id:
            delete_ops.append(RemoveMessage(id=msg.id))
        else:
            logger.debug("Message without id encountered during summarization trimming.")

    logger.info(
        "Summarization complete. Generated %d chars summary. Created %d RemoveMessage operations.",
        len(new_summary),
        len(delete_ops),
    )

    return {
        "summary": new_summary,
        "messages": delete_ops,
    }
