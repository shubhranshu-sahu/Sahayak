import logging
from typing import Any, Dict, List, Sequence
from langchain_core.messages import BaseMessage, HumanMessage, RemoveMessage
from app.config import settings
from app.graph.nodes.call_model import get_llm
from app.graph.state import AgentState

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


async def summarize_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph node to summarize earlier conversation messages and trim the sliding window.

    Steps:
    1. Partitions messages into:
       - messages_to_summarize: All messages except the last OVERLAP_MESSAGES (e.g. messages[:-5])
       - keep_messages: The last OVERLAP_MESSAGES (e.g. messages[-5:]) preserved for continuity.
    2. Builds an update prompt folding in the existing summary (if present).
    3. Asynchronously invokes Gemini to produce a consolidated summary string.
    4. Creates RemoveMessage operations for all messages being summarized.
    5. Returns {'summary': new_summary, 'messages': delete_ops}.
    """
    messages = state.get("messages", [])
    old_summary = state.get("summary", "").strip()
    overlap_count = settings.OVERLAP_MESSAGES  # Default: 5

    # Safety check: if messages are fewer than overlap, nothing to trim
    if len(messages) <= overlap_count:
        logger.warning("summarize_node invoked but message count (%d) <= overlap (%d). Skipping.", len(messages), overlap_count)
        return {}

    messages_to_summarize = messages[:-overlap_count]
    formatted_transcript = format_messages_for_summary(messages_to_summarize)

    logger.info(
        "Summarizing %d messages (preserving %d overlap messages)...",
        len(messages_to_summarize),
        overlap_count,
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

    # Call Gemini to get updated summary
    llm = get_llm(temperature=0.3)  # Lower temperature for accurate summarization
    response = await llm.ainvoke([HumanMessage(content=prompt_text)])

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
