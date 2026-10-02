import logging
from typing import Any, Dict, Optional
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from app.config import settings
from app.graph.state import AgentState
from app.prompts.system import get_system_message

logger = logging.getLogger(__name__)

# Cached model instances by temperature
_models: Dict[float, ChatGoogleGenerativeAI] = {}


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
            timeout=30.0,
        )
    return _models[temperature]


async def call_model(
    state: AgentState,
    config: Optional[RunnableConfig] = None,
) -> Dict[str, Any]:
    """
    Main LangGraph node to invoke the Gemini LLM.

    Steps:
    1. Reads runtime metadata (society_name, secretary_name) from config['configurable'].
    2. Builds a fresh SystemMessage containing persona and the rolling conversation summary.
    3. Prepends the SystemMessage to the current sliding window messages.
    4. Calls Gemini asynchronously (non-blocking).
    5. Returns {'messages': [response]} which LangGraph's add_messages reducer appends to state.
    """
    configurable = (config or {}).get("configurable", {})
    society_name = configurable.get("society_name", "the Society")
    secretary_name = configurable.get("secretary_name", "Secretary")

    logger.info("Invoking Gemini (%s) for %s...", settings.GEMINI_MODEL, secretary_name)

    # 1. Build the system message with rolling summary injected
    system_msg = get_system_message(
        state=state,
        society_name=society_name,
        secretary_name=secretary_name,
    )

    # 2. Prepend system prompt to the messages in the sliding window
    messages_to_send = [system_msg, *state["messages"]]

    # 3. Asynchronously invoke Gemini
    llm = get_llm()
    response = await llm.ainvoke(messages_to_send)

    logger.info("Received response from Gemini (%d chars).", len(response.content or ""))

    # 4. Return update dict - LangGraph appends this AIMessage to state['messages']
    return {"messages": [response]}
