import logging
from typing import Any, Dict, Optional
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from app.config import settings
from app.graph.state import AgentState
from app.graph.tools import get_all_tools
from app.prompts.system import get_system_message

logger = logging.getLogger(__name__)

# Cached model instances by temperature
_models: Dict[float, ChatGoogleGenerativeAI] = {}
_llm_with_tools = None  # Cached singleton with tools bound


def get_llm(temperature: float = 0.7) -> ChatGoogleGenerativeAI:
    """
    Return a configured Gemini LLM instance.
    Caches models by temperature.
    """
    if temperature not in _models:
        _models[temperature] = ChatGoogleGenerativeAI(
            model=settings.GEMINI_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=temperature,
            max_retries=2,
            timeout=60.0,  # 60s timeout for multi-step reasoning
        )
    return _models[temperature]


def get_llm_with_tools():
    """
    Return the Gemini LLM bound with all registered agent tools.
    Cached as a singleton to avoid re-binding on every node invocation.
    """
    global _llm_with_tools
    if _llm_with_tools is None:
        llm = get_llm()
        tools = get_all_tools()
        _llm_with_tools = llm.bind_tools(tools)
        logger.info("Gemini LLM bound with %d tools successfully.", len(tools))
    return _llm_with_tools


async def call_model(
    state: AgentState,
    config: Optional[RunnableConfig] = None,
) -> Dict[str, Any]:
    """
    Main LangGraph node: invoke Gemini with tool bindings.

    The LLM may return:
    - An AIMessage with tool_calls → route_after_model sends to tool_executor
    - A plain text AIMessage (final answer) → route_after_model sends to END
    """
    configurable = (config or {}).get("configurable", {})
    society_name = configurable.get("society_name", "the Society")
    secretary_name = configurable.get("secretary_name", "Secretary")

    logger.info("Invoking Gemini with tools for %s (%s)...", secretary_name, society_name)

    # 1. Build the system message with rolling summary injected
    system_msg = get_system_message(
        state=state,
        society_name=society_name,
        secretary_name=secretary_name,
    )

    # 2. Prepend system prompt to the messages in the sliding window
    messages_to_send = [system_msg, *state["messages"]]

    # 3. Asynchronously invoke Gemini with tools bound
    llm = get_llm_with_tools()
    response = await llm.ainvoke(messages_to_send)

    tool_calls = getattr(response, "tool_calls", None)
    if tool_calls:
        logger.info(
            "LLM requested %d tool call(s): %s",
            len(tool_calls),
            [tc.get("name") for tc in tool_calls],
        )
    else:
        logger.info("LLM responded with final text (%d chars).", len(response.content or ""))

    # 4. Return update dict - LangGraph appends this AIMessage to state['messages']
    return {"messages": [response]}
