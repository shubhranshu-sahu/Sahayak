# Sahayak — AI Service Guide

> This document covers the architecture, design decisions, and folder structure for the
> Sahayak AI service — a Python-based FastAPI + LangGraph service that powers the
> secretary's AI assistant.
>
> Companion files: [BACKEND_GUIDE.md](./BACKEND_GUIDE.md), [COMPLAINTS_DB.md](./COMPLAINTS_DB.md)

---

## Table of Contents

1. [Service Overview](#1-service-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [MongoDB — Two Collections](#4-mongodb--two-collections)
5. [LangGraph State Design](#5-langgraph-state-design)
6. [Graph Architecture](#6-graph-architecture)
7. [Summarization Strategy](#7-summarization-strategy)
8. [Thread & Persistence Strategy](#8-thread--persistence-strategy)
9. [File Upload Support](#9-file-upload-support)
10. [System Prompt Design](#10-system-prompt-design)
11. [Folder Structure](#11-folder-structure)
12. [Phase 1 Scope vs Phase 2 Plans](#12-phase-1-scope-vs-phase-2-plans)
13. [Design Decisions Log](#13-design-decisions-log)

---

## 1. Service Overview

The AI service is a **standalone Python microservice** that runs separately from the Node.js
backend. The Node.js backend handles all operational data (users, societies, complaints,
maintenance, payments). The AI service handles only the AI assistant layer:

- Receives messages from the secretary via a chat interface
- Maintains persistent, context-aware conversation state
- (Phase 2) Uses tools to query/modify MySQL operational data
- (Phase 2) Drafts replies, announcements, and summaries on behalf of the secretary
- (Phase 2) Executes approved actions with human-in-the-loop confirmation

The two services communicate when needed (AI service calls Node.js APIs for data, or
directly queries MySQL for read operations via agent tools).

**Who uses the AI service?**
Only the **secretary**. Residents do not interact with the AI agent.

---

## 2. Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Service framework** | Python 3.11+ + FastAPI | REST API, async request handling |
| **Agent framework** | LangGraph | Stateful agent graph — nodes, edges, checkpointing |
| **LLM** | Google Gemini (via `langchain-google-genai`) | Language model for reasoning and generation |
| **Conversation state** | MongoDB + `langgraph-checkpoint-mongodb` | Persists sliding window state per thread |
| **Full chat history** | MongoDB (separate collection, managed by us) | Permanent record of all messages for UI display |
| **Operational data** | MySQL (read via agent tools in Phase 2) | Complaints, maintenance, residents — queried by agent tools |
| **File storage** | Local disk (dev) → Cloudflare R2 / Supabase Storage (prod) | Uploaded files (Excel, PDF, text) |

### Key packages (requirements.txt)

```
fastapi
uvicorn
langgraph
langchain-google-genai
langgraph-checkpoint-mongodb
pymongo
mysql-connector-python   # for Phase 2 agent tools
python-dotenv
pydantic
pydantic-settings
python-multipart          # for file upload handling
```

---

## 3. Architecture Overview

```
Secretary (Browser)
        │
        │  HTTP
        ▼
┌─────────────────────────────────────────────────────────┐
│                   FastAPI (AI Service)                   │
│                                                         │
│  POST /chat/message  ──→  chat_service                  │
│  GET  /chat/history  ──→  history_service               │
│  POST /chat/upload   ──→  upload_service (Phase 2)      │
│                              │                          │
│                    ┌─────────▼──────────┐               │
│                    │   LangGraph Graph  │               │
│                    │   (agent logic)    │               │
│                    └─────────┬──────────┘               │
└──────────────────────────────│──────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
         MongoDB           MongoDB           MySQL
      (agent_threads)   (chat_messages)   (Phase 2 tools)
       Sliding window     Full history     Operational data
```

**Flow for every message:**
1. Message received by FastAPI
2. Saved permanently to `chat_messages` collection (MongoDB)
3. LangGraph graph invoked — loads thread state from `agent_threads`, runs, saves updated state
4. AI response returned to FastAPI
5. Response saved to `chat_messages` (permanent)
6. Response returned to secretary ✅
7. (At start of next invocation) Summarization runs if needed — see Section 7

---

## 4. MongoDB — Two Collections

This is the most important architectural decision in the AI service.
**Two separate MongoDB collections serve two completely different purposes.**

### Why two? Why not one?

LangGraph's checkpointer trims old messages from the state (the sliding window). If the UI
reads from the same state, the secretary would see messages disappearing from their chat
history — unacceptable. The two collections solve this cleanly:

- `agent_threads` — LangGraph's concern. Gets trimmed. Secretary never sees this directly.
- `chat_messages` — Our concern. Never trimmed. Secretary always sees their full history.

---

### Collection 1: `agent_threads`

**Managed by**: `langgraph-checkpoint-mongodb` (automatically, zero manual work)

**Purpose**: Stores the LangGraph thread state — the sliding message window, rolling summary,
interrupt state (for Phase 2 human-in-the-loop), and any custom state fields.

**Do not manually read or write this collection.** Let LangGraph handle it entirely.
Access it only via `graph.invoke()` / `graph.astream()` with the correct `thread_id`.

**Structure** (LangGraph internal, for reference only):
```json
{
  "thread_id": "secretary_12",
  "checkpoint_id": "uuid",
  "state": {
    "messages": ["...last 30 messages..."],
    "summary": "Running summary of earlier conversation...",
    "pending_action": null
  },
  "created_at": "...",
  "updated_at": "..."
}
```

---

### Collection 2: `chat_messages`

**Managed by**: Us (the AI service code)

**Purpose**: Permanent, complete record of every message ever sent in a thread.
The UI reads only from this collection. It is **never trimmed or modified**.

**Document schema:**

```json
{
  "_id": "ObjectId",
  "thread_id": "secretary_12",
  "message_id": "uuid-v4",
  "role": "human | assistant | system",
  "content": "How many open complaints do we have?",
  "timestamp": "2026-09-15T22:30:00Z",
  "attachments": []
}
```

**With a file attachment** (Phase 2):
```json
{
  "thread_id": "secretary_12",
  "message_id": "uuid-v4",
  "role": "human",
  "content": "Here is the April maintenance sheet",
  "timestamp": "2026-09-15T22:30:00Z",
  "attachments": [
    {
      "type": "excel",
      "filename": "april_maintenance.xlsx",
      "stored_path": "/uploads/society_12/april_maintenance.xlsx",
      "size_bytes": 45000,
      "processed": true,
      "processing_summary": "Imported 120 rows into maintenance_bills"
    }
  ]
}
```

**Indexes on `chat_messages`:**
```
{ thread_id: 1, timestamp: 1 }   ← primary UI query (get history, chronological)
{ message_id: 1 }                ← unique, for deduplication
```

**`attachments` field notes:**
- Always present as `[]` (empty array) for text-only messages — UI ignores it
- `type` can be: `excel`, `csv`, `pdf`, `txt` — extensible as new file types are added
- `stored_path` points to file on disk (dev) or object storage URL (prod)
- `processed` and `processing_summary` are filled after the agent processes the file
- Files are **not stored in MongoDB** — only the reference/metadata is

---

## 5. LangGraph State Design

The `AgentState` is the TypedDict that defines everything the graph remembers between nodes.

```python
from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    # The sliding message window (≤ ~30 messages at any time).
    # add_messages reducer handles append and RemoveMessage operations.
    messages: Annotated[list, add_messages]

    # Rolling summary of all conversation history before the current window.
    # Empty string ("") when no summarization has happened yet.
    # Injected into the system prompt on every model call — never stored as a chat message.
    summary: str

    # ── Phase 2 additions (do not implement in Phase 1) ──────────────────────
    # pending_action: dict | None     ← stores interrupt state for HITL approval
    # society_context: dict           ← live society stats injected dynamically
```

### Why `summary` is injected via system prompt, not as a message:

If summary were stored as a `HumanMessage` or `AIMessage`, it would:
- Confuse the LLM about who said what
- Get re-summarized recursively in future summarizations
- Pollute the message history that gets trimmed

Keeping it as a separate string in state and injecting via `SystemMessage` is clean —
the LLM sees it as background context, not as part of the conversation.

---

## 6. Graph Architecture

### Phase 1 — Chat Foundation (No Tools)

```
              ┌──────────────┐
              │    START     │
              └──────┬───────┘
                     │
          ┌──────────▼──────────┐
          │    call_model       │
          │                     │
          │  1. Build system    │
          │     prompt with     │
          │     summary         │
          │  2. Call Gemini     │
          │  3. Return response │
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │  should_summarize?  │  ← conditional edge
          │  len(msgs) > 30?    │
          └──────────┬──────────┘
               No ↙       ↘ Yes
              END     ┌────▼────────────┐
                      │ summarize_node  │
                      │                 │
                      │ 1. Build prompt │
                      │    with old     │
                      │    summary +    │
                      │    msgs 1–25    │
                      │ 2. Call Gemini  │
                      │ 3. Update       │
                      │    summary str  │
                      │ 4. RemoveMessage│
                      │    msgs 1–25   │
                      └────┬────────────┘
                           │
                          END
```

**Important**: The `should_summarize` check and `summarize_node` run at the **START of the
next message invocation**, not after the current response. See Section 7 for details.

### Phase 2 — With Tools (Future)

```
    START → [check_summarize?] → [call_model] → [tools?] → [tools_node] → [call_model]
                                      │                                         │
                                  (no tools)                            (loop until done)
                                      │
                               [interrupt?] → YES → [human_approval_node] → END (wait)
                                      │
                                     NO
                                      │
                                     END
```

---

## 7. Summarization Strategy

### When does it trigger?

At the **start of every graph invocation**, before calling the LLM:

```python
def route_start(state: AgentState) -> str:
    if len(state["messages"]) > 30:
        return "summarize_node"
    return "call_model"
```

This means:
- Messages 1–30: go straight to `call_model` (zero overhead)
- Message 31: summarize first (slight latency, once every 30 messages), then respond
- Messages 32–61: go straight to `call_model`
- Message 62: summarize again, then respond
- And so on...

### What gets summarized vs kept?

```
At message 31 (trigger):
  Summarize: messages 1–26   (first 26)
  Keep:      messages 27–31  (last 5 = overlap)
  Overlap keeps context continuity across the boundary.

At message 62 (trigger):
  Current state: [summary of 1–26] + messages 27–61 (35 messages)
  Summarize: messages 27–56  (fold into existing summary)
  Keep:      messages 57–62  (last 5 = overlap)
```

### The rolling summary (single accumulating string):

Each summarization updates the same `summary` field — it never grows into multiple chunks.
The new summarization prompt always folds the old summary in:

```python
def summarize_node(state: AgentState) -> dict:
    messages = state["messages"]
    old_summary = state.get("summary", "")

    # Keep last 5 as overlap
    messages_to_summarize = messages[:-5]
    keep_messages = messages[-5:]

    if old_summary:
        prompt = (
            f"Here is a summary of the conversation so far:\n{old_summary}\n\n"
            f"Now incorporate the following new messages into an updated summary:\n"
            f"{format_messages(messages_to_summarize)}\n\n"
            f"Write a concise updated summary that captures all important context."
        )
    else:
        prompt = (
            f"Summarize the following conversation concisely:\n"
            f"{format_messages(messages_to_summarize)}"
        )

    response = llm.invoke([HumanMessage(content=prompt)])

    # Remove the summarized messages from state
    delete_ops = [RemoveMessage(id=m.id) for m in messages_to_summarize]

    return {
        "summary": response.content,
        "messages": delete_ops,  # add_messages reducer processes RemoveMessage ops
    }
```

### Why not FastAPI BackgroundTask for summarization?

LangGraph's checkpointer uses **thread-level locking** — only one graph invocation can
write to a thread's state at a time. Running summarization as a background task risks
a race condition if the secretary sends the next message before the background task
finishes. Using the "start of next invocation" approach eliminates this entirely — the
summarization always completes before the LLM is called, within the same locked graph run.

### Why not LangGraph parallel branches?

LangGraph's parallel execution (`Send` API) is designed for fan-out tool calls — running
multiple tools simultaneously. Parallel branches still block the graph from reaching `END`
until all branches complete. True fire-and-forget is not possible within a single LangGraph
graph run. The "start of next invocation" approach is the official LangGraph pattern for
conversation summarization (used in their own tutorials).

---

## 8. Thread & Persistence Strategy

### Thread ID

Each secretary gets **one dedicated thread** (for Phase 1):

```python
thread_id = f"secretary_{secretary_id}"
```

This thread persists forever in MongoDB. The secretary's conversation history survives:
- Logging out and back in
- Server restarts
- Deployments

### Injecting the thread config into LangGraph:

```python
config = {"configurable": {"thread_id": f"secretary_{secretary_id}"}}
response = graph.invoke({"messages": [HumanMessage(content=user_message)]}, config)
```

### Migrating to multiple threads later (ChatGPT-style):

This is **trivially easy** — zero LangGraph graph code changes needed.

Steps when adding multiple threads in the future:
1. Add a `chat_sessions` table to MySQL:
   ```sql
   CREATE TABLE chat_sessions (
       id           INT PRIMARY KEY AUTO_INCREMENT,
       secretary_id INT NOT NULL,
       title        VARCHAR(200),
       created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   ```
2. Generate a unique `thread_id` per session:
   ```python
   thread_id = f"session_{session_id}"
   ```
3. Pass that `thread_id` in the LangGraph config — graph code is identical.
4. `chat_messages` already has a `thread_id` field — UI filters by it automatically.

The graph itself is completely agnostic to what the `thread_id` value is.

---

## 9. File Upload Support

### Phase 2 feature — documented here for schema completeness.

When the secretary uploads a file (Excel, CSV, PDF, text):

**Upload flow:**
1. `POST /chat/upload` — file received by FastAPI
2. File saved to disk (dev) or object storage (prod)
3. A `chat_messages` document is created with the file reference in `attachments[]`
4. LangGraph is invoked with the file path as context
5. Agent tool processes the file (reads Excel rows, extracts text, etc.)
6. Tool result updates `attachments[].processed = true` and fills `processing_summary`

**File storage:**
- **Development**: local disk at `uploads/{society_id}/{timestamp}_{filename}`
- **Production**: Cloudflare R2 or Supabase Storage (both have free tiers suitable for demo)
- **Not Cloudinary** — Cloudinary is for image transformation, not arbitrary file storage

**Supported file types (Phase 2):**

| Type | Use case | Agent action |
|---|---|---|
| `excel` / `csv` | Bulk maintenance data, resident import | Parse rows, insert into MySQL via tool |
| `pdf` / `txt` | Society bylaws, notices, circulars | Extract text, make available for RAG (Phase 3) |

**`attachments` field in `chat_messages`:**
```json
{
  "type": "excel",
  "filename": "april_dues.xlsx",
  "stored_path": "/uploads/society_12/1726432800_april_dues.xlsx",
  "size_bytes": 48200,
  "processed": false,
  "processing_summary": null
}
```
After agent processes:
```json
{
  "processed": true,
  "processing_summary": "Imported 118 rows. 2 rows skipped (missing unit_id)."
}
```

---

## 10. System Prompt Design

The system prompt is built fresh on every `call_model` invocation — it is never stored
in the message history. It includes:

```python
def build_system_prompt(state: AgentState, society_name: str, secretary_name: str) -> str:
    today = datetime.now().strftime("%d %B %Y")
    base = f"""You are Sahayak, the AI management assistant for {society_name}.
You are helping {secretary_name}, the society secretary.
Today is {today}.

Your role is to help manage the society — answering questions, analyzing data,
drafting communications, and executing approved actions.
Always be professional, helpful, and concise.
Never take actions that affect residents without explicit secretary approval."""

    summary = state.get("summary", "")
    if summary:
        base += f"\n\n[Conversation history summary]\n{summary}"

    return base
```

**Note**: Detailed prompt engineering (tone, examples, tool descriptions) will be done
separately once tools are being implemented. The above is the Phase 1 skeleton.

---

## 11. Folder Structure

```
Sahayak/
│
├── backend/                        # Node.js + Express (Purvi's work)
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── middlewares/
│   │   ├── routes/
│   │   └── utils/
│   ├── package.json
│   └── .env.example
│
├── ai-service/                     # Python + FastAPI + LangGraph (Shubhranshu's work)
│   │
│   ├── app/
│   │   ├── main.py                 # FastAPI app entry point, mounts routers
│   │   ├── config.py               # Env vars (Gemini key, MongoDB URI, MySQL URI etc.)
│   │   │
│   │   ├── database/
│   │   │   ├── __init__.py
│   │   │   ├── mongodb.py          # MongoDB client init (used for chat_messages + checkpointer)
│   │   │   └── mysql.py            # MySQL connection pool (Phase 2 — for agent tools)
│   │   │
│   │   ├── graph/                  # Everything LangGraph
│   │   │   ├── __init__.py
│   │   │   ├── state.py            # AgentState TypedDict definition
│   │   │   ├── builder.py          # Assembles and compiles the graph
│   │   │   │
│   │   │   ├── nodes/              # One file per graph node
│   │   │   │   ├── __init__.py
│   │   │   │   ├── call_model.py   # Main LLM call — builds prompt, calls Gemini
│   │   │   │   └── summarize.py    # Summarization node — folds history, trims messages
│   │   │   │
│   │   │   ├── edges/              # Conditional routing functions
│   │   │   │   ├── __init__.py
│   │   │   │   └── routers.py      # should_summarize(), should_use_tools() (Phase 2)
│   │   │   │
│   │   │   └── tools/              # Phase 2 — agent tools (one file per domain)
│   │   │       ├── __init__.py
│   │   │       ├── complaints.py   # get_open_complaints(), update_complaint_status() etc.
│   │   │       ├── maintenance.py  # get_pending_dues(), get_defaulters() etc.
│   │   │       └── residents.py    # get_resident_info(), get_unit_info() etc.
│   │   │
│   │   ├── routers/                # FastAPI route handlers
│   │   │   ├── __init__.py
│   │   │   └── chat.py             # POST /chat/message, GET /chat/history, POST /chat/upload
│   │   │
│   │   ├── services/               # Business logic (keeps routers thin)
│   │   │   ├── __init__.py
│   │   │   ├── chat_service.py     # Orchestrates: save msg → invoke graph → save response
│   │   │   └── history_service.py  # CRUD on chat_messages MongoDB collection
│   │   │
│   │   ├── models/                 # Pydantic request/response schemas
│   │   │   ├── __init__.py
│   │   │   └── chat.py             # ChatRequest, ChatResponse, MessageHistory etc.
│   │   │
│   │   └── prompts/                # Prompt templates (separate from node logic)
│   │       └── system.py           # build_system_prompt() function
│   │
│   ├── requirements.txt
│   ├── .env.example
│   └── README.md
│
├── frontend/                       # HTML + CSS + JS (Samia's work)
│   ├── pages/
│   ├── assets/
│   └── index.html
│
└── DOCS/                           # All documentation
    ├── USER_DB.md
    ├── SOCIETY_STRUCTURE_DB.md
    ├── COMPLAINTS_DB.md
    ├── BACKEND_GUIDE.md
    └── AI_SERVICE_GUIDE.md         ← this file
```

### Why this structure scales well

- **`graph/nodes/`** — adding a new node = adding one file. No changes to other files.
- **`graph/tools/`** — adding a new tool domain = adding one file. Imported into `builder.py`.
- **`graph/edges/`** — routing logic is isolated, not buried in node code.
- **`services/`** — FastAPI routers stay thin, all logic is in services.
- **`prompts/`** — prompt text is separate from execution logic, easy to iterate.
- **`database/`** — connection management is centralized, not scattered across files.

---

## 12. Phase 1 Scope vs Phase 2 Plans

### Phase 1 — What we build first

- [ ] FastAPI service skeleton (`main.py`, `config.py`, `database/mongodb.py`)
- [ ] `AgentState` TypedDict (`state.py`)
- [ ] `call_model` node with system prompt injection + summary injection
- [ ] `summarize_node` with rolling summary + RemoveMessage trimming
- [ ] `should_summarize` conditional edge
- [ ] Graph builder and compiler (`builder.py`)
- [ ] `POST /chat/message` endpoint — full flow (save → invoke → save → return)
- [ ] `GET /chat/history` endpoint — paginated `chat_messages` query
- [ ] MongoDB `chat_messages` collection with proper indexes
- [ ] One dedicated thread per secretary (hardcoded `thread_id` strategy)

**Goal**: A fully functional, persistent, context-aware chat that the secretary can use.

### Phase 2 — Agent Powers (After Phase 1 is working)

- [ ] Agent tools: `complaints.py`, `maintenance.py`, `residents.py`
- [ ] `tools_node` (LangGraph `ToolNode`) integrated into graph
- [ ] Human-in-the-loop interrupt node for approval flows
- [ ] File upload: `POST /chat/upload` + file processing tools
- [ ] Society context injection (live stats in system prompt)
- [ ] Multiple chat threads (ChatGPT-style session list)
- [ ] MongoDB RAG (Phase 3 — if implemented)

---

## 13. Design Decisions Log

This section records every significant architectural decision made and the reasoning behind it,
so context is never lost between sessions.

---

**Decision: One dedicated thread per secretary (for Phase 1)**
- Each secretary gets a permanent `thread_id = f"secretary_{secretary_id}"`
- Conversation persists across sessions, restarts, and deployments
- Rationale: Continuity matters — secretary should remember past context without starting fresh
- Future: Shifting to multiple threads (ChatGPT-style) requires zero LangGraph code changes.
  Only the `thread_id` value changes and a `chat_sessions` MySQL table is added.

---

**Decision: Two MongoDB collections — `agent_threads` and `chat_messages`**
- `agent_threads`: LangGraph's internal state (sliding window, summary, interrupt state).
  Managed entirely by the LangGraph checkpointer. Gets trimmed as conversation grows.
- `chat_messages`: Our collection. Full permanent history of every message. Never trimmed.
  UI always reads from here. Supports file attachment metadata.
- Rationale: If the UI read from LangGraph state, messages would visibly disappear from the
  chat as the sliding window trims them — unacceptable UX. Decoupling solves this cleanly.

---

**Decision: Summarize at start of next invocation (not in background, not in parallel)**
- Background task via FastAPI `BackgroundTasks` risks state corruption — LangGraph's
  checkpointer locks the thread per run. A background task could collide with the next
  user message's invocation.
- LangGraph parallel branches still block `END` until all branches complete — not
  truly fire-and-forget. Parallel execution is designed for simultaneous tool calls, not
  background tasks.
- Start-of-invocation approach: official LangGraph pattern (their own tutorials use this).
  Latency hit only on messages 31, 61, 91... — imperceptible in real conversation pacing.

---

**Decision: Rolling single summary (not multiple chunk summaries)**
- Each summarization folds the old summary + new messages into one updated summary string
- Simpler than maintaining a growing list of chunks
- LLM gets one clean "here is what happened before" context block
- Avoids recursive summary-of-summaries complexity

---

**Decision: 30-message window with 5-message overlap**
- Trigger: when `len(messages) > 30`, summarize at start of next invocation
- Summarize messages `[:-5]` (first 25+), keep messages `[-5:]` as overlap
- Overlap maintains conversational continuity across the boundary
- 30 messages chosen as a balance between token budget and context retention

---

**Decision: Summary injected via SystemMessage, not stored as a chat message**
- Summary stored as a separate `str` field in `AgentState`, not as `HumanMessage`/`AIMessage`
- On every `call_model` invocation, summary is appended to the system prompt text
- Rationale: Avoids confusing the LLM about who said what, prevents recursive
  re-summarization of the summary itself in future passes, keeps message history clean

---

**Decision: File references in `chat_messages.attachments[]`, not LangGraph state**
- File metadata (path, type, processed status) stored in `chat_messages` alongside the message
- LangGraph state does not store file references — it processes files via tools
- UI displays file cards by reading `attachments[]` from `chat_messages`
- Processed status and summary updated in-place when agent finishes processing

---

**Decision: Stateless JWT Authentication via Shared Secret with Node.js Backend**
- The AI service verifies JWTs issued by the Node.js backend using a shared `JWT_SECRET` (HMAC-SHA256).
- Zero inter-service HTTP calls or MySQL lookups needed for authentication (verified in < 0.1ms).
- Endpoints (`POST /chat/message`, `GET /chat/history`) require `Authorization: Bearer <jwt>`.
- Token payload (`userId`, `role`, `societyId`, `status`) is enforced:
  - `role` must be `'secretary'` or `'super_admin'` — residents are rejected with `403 Forbidden`.
  - `status` must be `'active'` — inactive accounts are rejected with `403 Forbidden`.
  - `thread_id` is automatically bound to `secretary_{userId}` — prevents user spoofing.
