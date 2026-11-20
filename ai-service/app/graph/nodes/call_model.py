import logging
from typing import Any, Dict, Optional
from langchain_core.runnables import RunnableConfig
from app.graph.state import AgentState
from app.graph.tools import get_all_tools
from app.prompts.system import get_system_message
from app.services.llm_provider import get_llm_provider

logger = logging.getLogger(__name__)


def get_llm(temperature: float = 0.7) -> Any:
    """
    Return the active LLM instance from the failover provider.
    Provided for backward compatibility.
    """
    return get_llm_provider().get_llm(temperature=temperature, with_tools=False)


def get_llm_with_tools() -> Any:
    """
    Return the active LLM instance bound with all registered agent tools.
    Provided for backward compatibility.
    """
    provider = get_llm_provider()
    provider.bind_tools(get_all_tools())
    return provider.get_llm(temperature=0.7, with_tools=True)


async def call_model(
    state: AgentState,
    config: Optional[RunnableConfig] = None,
) -> Dict[str, Any]:
    """
    Main LangGraph node: invoke Gemini with tool bindings and automatic failover.

    If a quota limit (429) or model unavailability (503/404) occurs, the LLMProvider
    automatically switches to the next API key or fallback model without crashing.

    The LLM may return:
    - An AIMessage with tool_calls -> route_after_model sends to tool_executor
    - A plain text AIMessage (final answer) -> route_after_model sends to END
    """
    configurable = (config or {}).get("configurable", {})
    society_name = configurable.get("society_name", "the Society")
    secretary_name = configurable.get("secretary_name", "Secretary")

    # 1. Build the system message with rolling summary injected
    system_msg = get_system_message(
        state=state,
        society_name=society_name,
        secretary_name=secretary_name,
    )

    # 2. Prepend system prompt to the messages in the sliding window
    messages_to_send = [system_msg, *state["messages"]]

    # 3. Obtain LLM provider, register tools, and invoke with automatic failover
    provider = get_llm_provider()
    provider.bind_tools(get_all_tools())

    logger.info(
        "Invoking LLM for %s (%s) [model=%s, key=%s]...",
        secretary_name,
        society_name,
        provider.current_model,
        provider.current_key_masked,
    )

    response = await provider.ainvoke_with_failover(
        messages=messages_to_send,
        temperature=0.7,
        with_tools=True,
        config=config,
    )

    tool_calls = getattr(response, "tool_calls", None)
    if tool_calls:
        logger.info(
            "LLM requested %d tool call(s) [%s]: %s",
            len(tool_calls),
            provider.current_model,
            [tc.get("name") for tc in tool_calls],
        )
    else:
        logger.info(
            "LLM responded with final text (%d chars) [%s].",
            len(str(response.content or "")),
            provider.current_model,
        )

    # 4. Return update dict - LangGraph appends this AIMessage to state['messages']
    return {"messages": [response]}
