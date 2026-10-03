import logging
from typing import Optional
from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph
from app.graph.state import AgentState
from app.graph.nodes.call_model import call_model
from app.graph.nodes.summarize import summarize_node
from app.graph.edges.routers import route_start
from app.database.mongodb import get_checkpointer

logger = logging.getLogger(__name__)

# Singleton compiled graph instance
_graph: Optional[CompiledStateGraph] = None


def build_graph() -> CompiledStateGraph:
    """
    Construct, wire, and compile the Sahayak LangGraph agent graph.

    Graph Architecture:
    1. START -> route_start (conditional edge)
       - If len(messages) > 30 -> summarize_node
       - Else -> call_model
    2. summarize_node -> call_model (normal edge)
    3. call_model -> END (normal edge)

    Persistence:
    State is persisted automatically to the 'agent_threads' MongoDB collection
    via the MongoDBSaver checkpointer.
    """
    logger.info("Building Sahayak LangGraph agent graph...")
    builder = StateGraph(AgentState)

    # 1. Register Nodes
    builder.add_node("call_model", call_model)
    builder.add_node("summarize_node", summarize_node)

    # 2. Add Conditional Edge from START
    builder.add_conditional_edges(
        START,
        route_start,
        {
            "call_model": "call_model",
            "summarize_node": "summarize_node",
        },
    )

    # 3. Add Edges
    # After summarizing, immediately proceed to call_model to answer the user's message
    builder.add_edge("summarize_node", "call_model")

    # After model answers, the invocation turn is complete
    builder.add_edge("call_model", END)

    # 4. Compile with MongoDB checkpointer persistence
    checkpointer = get_checkpointer()
    compiled_graph = builder.compile(checkpointer=checkpointer)

    logger.info("Sahayak LangGraph agent compiled successfully.")
    return compiled_graph


def get_graph() -> CompiledStateGraph:
    """
    Return the singleton compiled LangGraph agent instance.
    """
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph
