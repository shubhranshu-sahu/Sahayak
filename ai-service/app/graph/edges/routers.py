import logging
from typing import Literal
from langchain_core.messages import AIMessage
from app.config import settings
from app.graph.state import AgentState

logger = logging.getLogger(__name__)


def route_start(state: AgentState) -> Literal["summarize_node", "call_model"]:
    """
    Conditional routing edge executed at the START of every graph invocation.

    Determines whether the sliding window threshold has been exceeded:
    - If len(messages) > MAX_WINDOW_MESSAGES (e.g., > 30):
        Routes to 'summarize_node' to condense early messages before generating an answer.
    - Otherwise:
        Routes directly to 'call_model' with zero summarization latency.

    Returns:
        str: Name of the next node ('summarize_node' or 'call_model')
    """
    messages = state.get("messages", [])
    message_count = len(messages)

    if message_count > settings.MAX_WINDOW_MESSAGES:
        logger.info(
            "Message count (%d) exceeds max window threshold (%d). Routing to summarize_node.",
            message_count,
            settings.MAX_WINDOW_MESSAGES,
        )
        return "summarize_node"

    logger.debug(
        "Message count (%d) within window threshold (%d). Routing directly to call_model.",
        message_count,
        settings.MAX_WINDOW_MESSAGES,
    )
    return "call_model"


def route_after_model(state: AgentState) -> Literal["tool_executor", "end"]:
    """
    Conditional routing edge executed AFTER call_model produces an AIMessage.

    Inspects whether the model requested any tool calls:
    - If the last message is an AIMessage containing one or more tool_calls:
        Routes to 'tool_executor' (ToolNode) to execute the tools against MySQL.
    - If the last message is a plain text AIMessage (no tool calls):
        The agent has completed its task/reasoning, routes to 'end' (END).

    Returns:
        str: Name of the next step ('tool_executor' or 'end')
    """
    messages = state.get("messages", [])
    if not messages:
        return "end"

    last_message = messages[-1]

    # Check if the last message is an AIMessage with requested tool calls
    if isinstance(last_message, AIMessage) and getattr(last_message, "tool_calls", None):
        logger.info(
            "LLM requested %d tool call(s): %s. Routing to tool_executor.",
            len(last_message.tool_calls),
            [tc.get("name") for tc in last_message.tool_calls],
        )
        return "tool_executor"

    logger.debug("No tool calls in model response. Routing to END.")
    return "end"
