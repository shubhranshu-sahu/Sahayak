import logging
from typing import Optional
from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode

from app.graph.state import AgentState
from app.graph.nodes.call_model import call_model
from app.graph.nodes.summarize import summarize_node
from app.graph.edges.routers import route_start, route_after_model
from app.graph.tools import get_all_tools
from app.database.mongodb import get_checkpointer

logger = logging.getLogger(__name__)

# Singleton compiled graph instance
_graph: Optional[CompiledStateGraph] = None


def build_graph() -> CompiledStateGraph:
    """
    Construct, wire, and compile the Sahayak LangGraph agent graph with tool calling.

    Phase 2 Graph Topology:
    1. START -> route_start (conditional edge)
       - If len(messages) > 30 -> summarize_node -> call_model
       - Else -> call_model
    2. call_model -> route_after_model (conditional edge)
       - If AIMessage has tool_calls -> tool_executor (ToolNode)
       - Else -> END (final text response)
    3. tool_executor -> call_model (circular loop edge)
       - Feeds tool execution results (ToolMessages) back to Gemini
         so it can reason further or form the final response.

    Persistence:
    State (sliding window + summary) is automatically checkpointed to MongoDB
    in the 'agent_threads' collection via MongoDBSaver.
    """
    logger.info("Building Sahayak LangGraph agent graph (Phase 2: with tools)...")
    builder = StateGraph(AgentState)

    # 1. Collect all registered agent tools
    tools = get_all_tools()
    logger.info("Registered %d agent tools for LangGraph ToolNode.", len(tools))

    # 2. Register Nodes
    builder.add_node("call_model", call_model)
    builder.add_node("summarize_node", summarize_node)
    builder.add_node("tool_executor", ToolNode(tools))

    # 3. START -> route_start (Summarization threshold check)
    builder.add_conditional_edges(
        START,
        route_start,
        {
            "call_model": "call_model",
            "summarize_node": "summarize_node",
        },
    )

    # 4. summarize_node -> call_model
    builder.add_edge("summarize_node", "call_model")

    # 5. call_model -> route_after_model (Tool calling loop check)
    builder.add_conditional_edges(
        "call_model",
        route_after_model,
        {
            "tool_executor": "tool_executor",
            "end": END,
        },
    )

    # 6. tool_executor -> call_model (Loop edge for multi-step reasoning)
    builder.add_edge("tool_executor", "call_model")

    # 7. Compile with MongoDB checkpointer persistence
    checkpointer = get_checkpointer()
    compiled_graph = builder.compile(checkpointer=checkpointer)

    logger.info("Sahayak LangGraph agent compiled successfully with tool loop.")
    return compiled_graph


def get_graph() -> CompiledStateGraph:
    """
    Return the singleton compiled LangGraph agent instance.
    """
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph
