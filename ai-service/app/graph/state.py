from typing import Annotated, Sequence, TypedDict
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    """
    LangGraph state schema for the Sahayak AI Assistant.

    This state is persisted in MongoDB ('agent_threads' collection)
    by the checkpointer across conversation turns.
    """

    # 1. The sliding window of conversation messages.
    # Annotated with `add_messages` reducer:
    # - Appending: returns [AIMessage(...)] -> appends to list
    # - Trimming: returns [RemoveMessage(id=...)] -> deletes specified messages from state
    messages: Annotated[Sequence[BaseMessage], add_messages]

    # 2. Rolling summary string of past conversation.
    # Starts as empty string ("").
    # When messages exceed 30, earlier messages are folded into this string.
    # Injected dynamically into the system prompt on each LLM call.
    summary: str

    # -------------------------------------------------------------------------
    # Phase 2 Fields (Documented for schema completeness, used in Phase 2):
    # pending_action: dict | None      # Stores interrupt state for secretary approval
    # society_context: dict            # Dynamic society stats (complaints, dues)
    # -------------------------------------------------------------------------
