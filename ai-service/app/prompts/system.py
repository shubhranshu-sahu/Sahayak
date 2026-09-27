from datetime import datetime
from typing import Optional
from langchain_core.messages import SystemMessage
from app.graph.state import AgentState


def build_system_prompt(
    state: Optional[AgentState] = None,
    society_name: str = "the Society",
    secretary_name: str = "Secretary",
) -> str:
    """
    Build the system prompt for the Sahayak AI assistant.

    Dynamically incorporates:
    - Current date
    - Society name and Secretary name
    - Rolling conversation summary from AgentState (if available)
    """
    today = datetime.now().strftime("%d %B %Y")

    base = f"""You are Sahayak, the intelligent management assistant for {society_name}.
You are assisting {secretary_name}, the society secretary.
Today is {today}.

Your core responsibilities:
- Answer questions and provide insights on society management and operations.
- Analyze complaints, maintenance records, and resident data.
- Draft professional announcements, circulars, and replies.
- Assist in decision-making and administrative workflows.

Guidelines:
- Maintain a professional, courteous, and efficient tone.
- Be concise, clear, and structured in your explanations.
- Never take unilateral actions affecting residents without explicit secretary confirmation."""

    # Inject rolling conversation summary if it exists
    if state:
        summary = state.get("summary", "")
        if summary and summary.strip():
            base += f"\n\n[Previous conversation summary]\n{summary.strip()}"

    return base


def get_system_message(
    state: Optional[AgentState] = None,
    society_name: str = "the Society",
    secretary_name: str = "Secretary",
) -> SystemMessage:
    """
    Return a LangChain SystemMessage instance containing the dynamically built system prompt.
    """
    return SystemMessage(content=build_system_prompt(state, society_name, secretary_name))
