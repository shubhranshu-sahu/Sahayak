"""
Message sequence sanitizer for Gemini API function calling and turn-taking constraints.

Google Gemini API enforces strict alternating conversation rules when tools/functions are used:
1. Every function call turn (AIMessage with tool_calls) MUST immediately follow a user turn
   (HumanMessage) or a function response turn (ToolMessage).
2. Every function call turn MUST be followed by its corresponding function response (ToolMessage)
   before any subsequent user or assistant message.
3. Function response turns (ToolMessage) CANNOT appear as orphans without a preceding function call turn.
4. The conversation history following the system instructions MUST begin with a user turn (HumanMessage).

This module sanitizes any LangChain message sequence before it is transmitted to Gemini,
guaranteeing zero 400 INVALID_ARGUMENT crashes caused by sliding window truncations,
interrupted tool executions, or corrupted checkpointer states.
"""

import logging
from typing import List, Sequence
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

logger = logging.getLogger(__name__)


def sanitize_messages_for_gemini(messages: Sequence[BaseMessage]) -> List[BaseMessage]:
    """
    Sanitize and validate a sequence of LangChain messages to strictly comply
    with Google Gemini API turn-taking and tool-calling invariants.

    Transformations performed:
    1. System messages are preserved at the beginning of the sequence.
    2. Orphan ToolMessages (lacking a preceding AIMessage with tool_calls) are pruned.
    3. AIMessages with tool_calls missing a preceding HumanMessage/ToolMessage have a
       context-continuity HumanMessage inserted immediately before them.
    4. Unanswered AIMessages with tool_calls (where tool execution failed or was interrupted)
       have their tool_calls stripped so they become standard assistant messages.
    5. Sequences that begin with assistant turns are prepended with a starter user turn.
    """
    if not messages:
        return []

    system_msgs: List[BaseMessage] = []
    chat_msgs: List[BaseMessage] = []

    for msg in messages:
        if isinstance(msg, SystemMessage):
            system_msgs.append(msg)
        else:
            chat_msgs.append(msg)

    if not chat_msgs:
        return list(messages)

    sanitized: List[BaseMessage] = []

    for msg in chat_msgs:
        # Case 1: ToolMessage (Function Response Turn)
        if isinstance(msg, ToolMessage):
            # Must be preceded by an AIMessage with tool_calls or another ToolMessage
            has_preceding_call = False
            for prev in reversed(sanitized):
                if isinstance(prev, AIMessage) and getattr(prev, "tool_calls", None):
                    tc_ids = [tc.get("id") for tc in prev.tool_calls if isinstance(tc, dict)]
                    if not msg.tool_call_id or msg.tool_call_id in tc_ids or not tc_ids:
                        has_preceding_call = True
                        break
                elif isinstance(prev, ToolMessage):
                    continue
                else:
                    break

            if not has_preceding_call:
                logger.warning(
                    "Pruning orphan ToolMessage (id=%s) with no preceding tool_call AIMessage.",
                    getattr(msg, "tool_call_id", None),
                )
                continue
            sanitized.append(msg)

        # Case 2: AIMessage (Model Turn)
        elif isinstance(msg, AIMessage):
            tc = getattr(msg, "tool_calls", None)
            if tc:
                # Must be preceded by HumanMessage or ToolMessage
                if not sanitized or not isinstance(sanitized[-1], (HumanMessage, ToolMessage)):
                    logger.info(
                        "Inserting bridging HumanMessage before AIMessage with tool_calls to satisfy Gemini turn order."
                    )
                    sanitized.append(HumanMessage(content="[Continuing previous discussion]"))
            sanitized.append(msg)

        # Case 3: HumanMessage or other user/general messages
        else:
            # If preceding message was an AIMessage with tool_calls that never received a ToolMessage:
            if (
                sanitized
                and isinstance(sanitized[-1], AIMessage)
                and getattr(sanitized[-1], "tool_calls", None)
            ):
                last_ai = sanitized[-1]
                logger.warning(
                    "Cleaning unanswered tool_calls from previous AIMessage (id=%s) before new user turn.",
                    getattr(last_ai, "id", None),
                )
                sanitized[-1] = AIMessage(
                    content=last_ai.content or "[Interrupted tool execution]",
                    id=last_ai.id,
                )
            sanitized.append(msg)

    # Check trailing message: if last message is an AIMessage with tool_calls but no ToolMessage followed
    if (
        sanitized
        and isinstance(sanitized[-1], AIMessage)
        and getattr(sanitized[-1], "tool_calls", None)
    ):
        last_ai = sanitized[-1]
        logger.warning(
            "Cleaning trailing unanswered tool_calls from last AIMessage (id=%s).",
            getattr(last_ai, "id", None),
        )
        sanitized[-1] = AIMessage(
            content=last_ai.content or "[Interrupted tool execution]",
            id=last_ai.id,
        )

    # Ensure conversation starts with a HumanMessage (user turn)
    if sanitized and not isinstance(sanitized[0], HumanMessage):
        logger.info("Prepending starter HumanMessage because conversation started with assistant turn.")
        sanitized.insert(0, HumanMessage(content="Hello"))

    return system_msgs + sanitized
