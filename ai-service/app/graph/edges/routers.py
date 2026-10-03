import logging
from app.config import settings
from app.graph.state import AgentState

logger = logging.getLogger(__name__)


def route_start(state: AgentState) -> str:
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
