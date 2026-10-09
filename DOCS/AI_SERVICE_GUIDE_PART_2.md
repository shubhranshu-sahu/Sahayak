# Sahayak — AI Service Guide Part 2 (Phase 2: Society Setup Agent Tools)

> **For AI Developer (Shubhranshu)**:
> This guide transforms the existing "chat-only" AI agent into an **agentic tool-calling assistant**
> capable of fully automating every Society Setup operation via natural language conversation.
>
> **Prerequisites**:
> - Phase 1 chat foundation is **already working** (see [AI_SERVICE_GUIDE.md](./AI_SERVICE_GUIDE.md))
> - Society & Structure backend is **already deployed** by Purvi (see [BACKEND_GUIDE.md](./BACKEND_GUIDE.md))
> - Database schemas: [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md), [USER_DB.md](./USER_DB.md)

---

## Table of Contents

1. [Phase 1 Recap — What We Have Now](#1-phase-1-recap--what-we-have-now)
2. [Phase 2 Goal — What We're Building](#2-phase-2-goal--what-were-building)
3. [Architecture Decision: Direct MySQL vs Node.js API Proxy](#3-architecture-decision-direct-mysql-vs-nodejs-api-proxy)
4. [MySQL Integration for AI Service](#4-mysql-integration-for-ai-service)
5. [New Graph Architecture — From Chat to Agentic](#5-new-graph-architecture--from-chat-to-agentic)
6. [Updated AgentState Schema](#6-updated-agentstate-schema)
7. [Tool Design Philosophy](#7-tool-design-philosophy)
8. [Complete Tool Catalog — Society Setup](#8-complete-tool-catalog--society-setup)
   - [Tool 1: `get_society_info`](#tool-1-get_society_info)
   - [Tool 2: `update_society_info`](#tool-2-update_society_info)
   - [Tool 3: `get_society_structure`](#tool-3-get_society_structure)
   - [Tool 4: `add_blocks`](#tool-4-add_blocks)
   - [Tool 5: `rename_block`](#tool-5-rename_block)
   - [Tool 6: `delete_block`](#tool-6-delete_block)
   - [Tool 7: `add_floors`](#tool-7-add_floors)
   - [Tool 8: `delete_floor`](#tool-8-delete_floor)
   - [Tool 9: `add_units`](#tool-9-add_units)
   - [Tool 10: `edit_unit`](#tool-10-edit_unit)
   - [Tool 11: `delete_unit`](#tool-11-delete_unit)
   - [Tool 12: `get_dashboard_stats`](#tool-12-get_dashboard_stats)
   - [Tool 13: `get_residents_list`](#tool-13-get_residents_list)
   - [Tool 14: `approve_resident`](#tool-14-approve_resident)
   - [Tool 15: `reject_resident`](#tool-15-reject_resident)
   - [Tool 16: `revoke_resident`](#tool-16-revoke_resident)
   - [Tool 17: `reactivate_resident`](#tool-17-reactivate_resident)
9. [Updated System Prompt — Tool-Aware Agent Persona](#9-updated-system-prompt--tool-aware-agent-persona)
10. [Updated Graph Builder — Wiring Tools Into the Graph](#10-updated-graph-builder--wiring-tools-into-the-graph)
11. [Updated `call_model` Node — Binding Tools to LLM](#11-updated-call_model-node--binding-tools-to-llm)
12. [New `tool_executor` Node](#12-new-tool_executor-node)
13. [Updated Edge Router — Tool Loop Detection](#13-updated-edge-router--tool-loop-detection)
14. [Streaming SSE with Tool Call Events](#14-streaming-sse-with-tool-call-events)
15. [File & Folder Structure After Phase 2](#15-file--folder-structure-after-phase-2)
16. [Implementation Order — Step by Step](#16-implementation-order--step-by-step)
17. [Design Decisions Log (Phase 2)](#17-design-decisions-log-phase-2)

---

## 1. Phase 1 Recap — What We Have Now

### Current Graph (No Tools)

```
              ┌──────────────┐
              │    START     │
              └──────┬───────┘
                     │
          ┌─────────▼──────────┐
          │   route_start()    │ ← conditional edge
          │                    │
          │ len(msgs) > 30?    │
          └─────────┬──────────┘
            No ↙         ↘ Yes
   ┌────────▼────┐  ┌────▼────────────┐
   │ call_model  │  │ summarize_node  │
   │ (Gemini)    │  │ (fold + trim)   │
   └────────┬────┘  └────┬────────────┘
            │             │
            ▼        call_model
           END            │
                          ▼
                         END
```

### Current Components

| File | Role |
|---|---|
| [`state.py`](file:///d:/Codes/MAJOR%20PROJECT/Sahayak/ai-service/app/graph/state.py) | `AgentState` — `messages` + `summary` |
| [`call_model.py`](file:///d:/Codes/MAJOR%20PROJECT/Sahayak/ai-service/app/graph/nodes/call_model.py) | Builds system prompt, calls Gemini, returns `AIMessage` |
| [`summarize.py`](file:///d:/Codes/MAJOR%20PROJECT/Sahayak/ai-service/app/graph/nodes/summarize.py) | Folds old messages into rolling summary, trims window |
| [`routers.py`](file:///d:/Codes/MAJOR%20PROJECT/Sahayak/ai-service/app/graph/edges/routers.py) | `route_start()` — checks message count threshold |
| [`builder.py`](file:///d:/Codes/MAJOR%20PROJECT/Sahayak/ai-service/app/graph/builder.py) | Assembles and compiles the StateGraph |
| [`system.py`](file:///d:/Codes/MAJOR%20PROJECT/Sahayak/ai-service/app/prompts/system.py) | `build_system_prompt()` — persona + summary injection |
| [`chat_service.py`](file:///d:/Codes/MAJOR%20PROJECT/Sahayak/ai-service/app/services/chat_service.py) | SSE streaming orchestration |

### What's Missing

- ❌ No tools — LLM cannot read or modify any data
- ❌ No MySQL connection — cannot query societies, blocks, floors, units, users
- ❌ No tool loop — `call_model → END` is a single shot, no re-entry after tool execution
- ❌ No tool-aware system prompt — LLM doesn't know it has capabilities

---

## 2. Phase 2 Goal — What We're Building

**The secretary says in natural language:**
> *"Create a new block called D, add 5 floors to it, and put 4 units on each floor."*

**The agent:**
1. Understands the intent (LLM reasoning).
2. Calls `add_blocks(block_names=["D"])` → gets `blockId`.
3. Calls `add_floors(block_id=<id>, total_floors=5)` → gets floor IDs.
4. Calls `add_units(...)` for each floor → units created.
5. Reports back: *"Done! Block D created with 5 floors × 4 units = 20 units total. All units are currently vacant."*

**Every operation the secretary can do on the manual UI, the AI agent can also do via tools.**

### Scope of Phase 2A (This Guide)

| Domain | Operations |
|---|---|
| **Society Config** | View/update society name, address, code, metadata |
| **Blocks** | Add (single or multiple), rename, delete |
| **Floors** | Add (bulk to a block), delete |
| **Units** | Add (bulk to a floor), edit (type, area), delete |
| **Residents** | List (all/filtered), approve, reject, revoke, reactivate |
| **Dashboard** | View summary statistics |

### NOT in Phase 2A (Deferred)

- Complaints management tools (Phase 2B — after Purvi implements complaint APIs)
- Human-in-the-loop interrupt/approval nodes (Phase 2C)
- File upload processing (Phase 3)

---

## 3. Architecture Decision: Direct MySQL vs Node.js API Proxy

### Option A: AI Service calls Purvi's Node.js REST APIs
```
Secretary → AI Service → HTTP → Node.js Backend → MySQL
```

### Option B: AI Service queries MySQL directly from Python ✅ CHOSEN
```
Secretary → AI Service → MySQL (direct via aiomysql)
```

### Why Direct MySQL (Option B)?

| Factor | Direct MySQL | Node.js Proxy |
|---|---|---|
| **Latency** | ~2ms per query | ~50-100ms per HTTP call (network + JSON parse) |
| **Multi-tool chains** | 5 tools = 5 × 2ms = 10ms | 5 tools = 5 × 80ms = 400ms |
| **Error handling** | Python exceptions, full control | Parse HTTP responses, map error codes |
| **Transaction support** | Native `async with connection` | No cross-request transactions |
| **Dependency** | Only MySQL credentials | Node.js backend must be running |
| **Code reuse** | Write our own SQL (matching Purvi's logic) | Reuse Purvi's validation |
| **Validation** | Must replicate in Python | Free (Node.js handles it) |

**Verdict**: For an AI agent that may chain 5-10 tool calls in a single turn, the latency multiplication of HTTP proxying is unacceptable. Direct MySQL gives us sub-10ms tool execution, native transactions, and zero external dependency on the Node.js backend being up.

**Key rule**: We replicate the same business logic and validation that Purvi's Node.js service has (same CHECK constraints, same status rules). The MySQL schema constraints (FKs, CHECKs, UNIQUEs) are our safety net — even if Python validation misses something, the database will reject it.

---

## 4. MySQL Integration for AI Service

### 4.1 New Package: `aiomysql`

Add to `requirements.txt`:
```
# MySQL async driver for agent tools
aiomysql>=0.2.0
```

**Why `aiomysql` instead of `mysql-connector-python`?**
- `mysql-connector-python` is synchronous — would block FastAPI's async event loop.
- `aiomysql` is fully async, integrates natively with `asyncio` and FastAPI.
- Connection pooling built-in via `aiomysql.create_pool()`.

### 4.2 New Config Variables

Add to `config.py`:
```python
# MySQL Settings (for agent tools — direct DB access)
MYSQL_HOST: str = Field(default="localhost", description="MySQL host")
MYSQL_PORT: int = Field(default=3306, description="MySQL port")
MYSQL_USER: str = Field(default="root", description="MySQL user")
MYSQL_PASSWORD: str = Field(default="", description="MySQL password")
MYSQL_DATABASE: str = Field(default="sahayak", description="MySQL database name")
MYSQL_POOL_SIZE: int = Field(default=5, description="MySQL connection pool size")
```

And in `.env`:
```env
MYSQL_HOST=mysql-sahayak.alwaysdata.net
MYSQL_PORT=3306
MYSQL_USER=sahayak
MYSQL_PASSWORD=<password>
MYSQL_DATABASE=sahayak_db
```

### 4.3 New File: `database/mysql.py`

```python
import logging
from typing import Optional
import aiomysql
from app.config import settings

logger = logging.getLogger(__name__)

_pool: Optional[aiomysql.Pool] = None


async def get_mysql_pool() -> aiomysql.Pool:
    """Return the singleton async MySQL connection pool."""
    global _pool
    if _pool is None:
        _pool = await aiomysql.create_pool(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=settings.MYSQL_USER,
            password=settings.MYSQL_PASSWORD,
            db=settings.MYSQL_DATABASE,
            minsize=1,
            maxsize=settings.MYSQL_POOL_SIZE,
            autocommit=True,
            charset="utf8mb4",
            cursorclass=aiomysql.DictCursor,
        )
        logger.info("MySQL connection pool created (pool_size=%d).", settings.MYSQL_POOL_SIZE)
    return _pool


async def init_mysql() -> None:
    """Initialize MySQL pool and verify connectivity. Called during FastAPI startup."""
    pool = await get_mysql_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT 1")
    logger.info("MySQL connection verified successfully.")


async def close_mysql() -> None:
    """Close MySQL pool gracefully. Called during FastAPI shutdown."""
    global _pool
    if _pool:
        _pool.close()
        await _pool.wait_closed()
        _pool = None
        logger.info("MySQL connection pool closed.")
```

### 4.4 Update `main.py` Lifespan

```python
from app.database.mysql import init_mysql, close_mysql

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()       # MongoDB
    await init_mysql()    # MySQL
    yield
    # Shutdown
    await close_db()      # MongoDB
    await close_mysql()   # MySQL
```

---

## 5. New Graph Architecture — From Chat to Agentic

### Phase 2 Graph (With Tool Loop)

```
                  ┌──────────────┐
                  │    START     │
                  └──────┬───────┘
                         │
              ┌──────────▼──────────┐
              │   route_start()     │  ← same as Phase 1
              │   len(msgs) > 30?   │
              └──────────┬──────────┘
                No ↙         ↘ Yes
    ┌──────────▼─────┐  ┌────▼────────────┐
    │                │  │ summarize_node   │
    │                │  └────┬────────────┘
    │                │       │
    │   call_model   │◀──────┘
    │   (Gemini +    │
    │    tool bindings)│
    └───────┬────────┘
            │
   ┌────────▼────────┐
   │  route_after_    │ ← NEW conditional edge
   │  model()         │
   │                  │
   │  Has tool_calls? │
   └────────┬────────┘
     No ↙        ↘ Yes
    END    ┌──────▼──────────┐
           │ tool_executor   │ ← NEW node
           │                 │
           │ Execute tools   │
           │ Return results  │
           │ as ToolMessages │
           └──────┬──────────┘
                  │
                  │ Always loops back
                  ▼
            call_model  ← re-enter with tool results
            (decide: more tools? or final answer?)
```

### Key Changes from Phase 1

| Aspect | Phase 1 | Phase 2 |
|---|---|---|
| **`call_model` output** | Always `AIMessage` (text only) | `AIMessage` which may contain `tool_calls` |
| **After `call_model`** | → `END` always | → `route_after_model()` conditional check |
| **Tool execution** | None | New `tool_executor` node |
| **Tool loop** | None | `call_model ↔ tool_executor` loop until LLM decides no more tools |
| **LLM binding** | `llm.ainvoke(messages)` | `llm.bind_tools(tools).ainvoke(messages)` |

### How the Tool Loop Works

1. **Secretary asks**: *"How many vacant units are in Block A?"*
2. **`call_model`**: LLM sees it has `get_society_structure` tool → emits `AIMessage` with `tool_calls=[{name: "get_society_structure", args: {}}]`
3. **`route_after_model`**: Detects `tool_calls` → routes to `tool_executor`
4. **`tool_executor`**: Executes `get_society_structure()`, returns `ToolMessage` with results
5. **Back to `call_model`**: LLM now has the data, composes final text answer → `AIMessage` (no `tool_calls`)
6. **`route_after_model`**: No `tool_calls` → routes to `END`

The loop supports **multi-step reasoning**:
- LLM calls tool 1 → gets result → realizes it needs tool 2 → calls tool 2 → gets result → final answer
- Example: *"Delete Block C"* → LLM first calls `get_society_structure` to verify Block C exists and is empty → then calls `delete_block(block_id=...)` → confirms to secretary

---

## 6. Updated AgentState Schema

```python
from typing import Annotated, Sequence, TypedDict
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    """
    LangGraph state schema for the Sahayak AI Assistant.
    Phase 2: Now supports tool calling loop via standard message flow.
    """

    # 1. The sliding window of conversation messages.
    #    Now includes: HumanMessage, AIMessage (with optional tool_calls), ToolMessage
    messages: Annotated[Sequence[BaseMessage], add_messages]

    # 2. Rolling summary of past conversation (unchanged from Phase 1)
    summary: str
```

**Why no new state fields?**

LangGraph's tool calling pattern uses the **message sequence itself** to carry tool state:
- `AIMessage.tool_calls` = the LLM's request to call tools
- `ToolMessage` = the tool execution results, keyed by `tool_call_id`

No separate `pending_action` or `tool_results` fields are needed — everything flows through `messages`. This is the official LangGraph pattern and keeps the state clean.

---

## 7. Tool Design Philosophy

### 7.1 Tools are Python Functions with `@tool` Decorator

LangChain's `@tool` decorator automatically generates the JSON schema that Gemini uses
to understand what arguments the tool accepts and what it returns.

```python
from langchain_core.tools import tool

@tool
async def get_society_info(society_id: int) -> dict:
    """Get the full configuration and details of a society including name, code, address, and active status."""
    # ... MySQL query ...
    return {...}
```

The docstring becomes the tool's **description** — this is what the LLM reads to decide when to use it.

### 7.2 Society Context Injection

The AI agent always operates within a **specific secretary's society**. The `society_id`
comes from the JWT token via `req.user.societyId`, passed through the LangGraph config:

```python
config = {
    "configurable": {
        "thread_id": f"secretary_{secretary_id}",
        "society_id": society_id,        # ← NEW
        "society_name": "Sunrise Apartments",
        "secretary_name": "Rajesh Kumar",
    }
}
```

**Every tool reads `society_id` from the LangGraph `RunnableConfig`** — the LLM never
needs to guess or ask for the society ID. This is a critical security boundary:
a secretary's agent can only ever operate on their own society.

```python
from langchain_core.runnables import RunnableConfig

@tool
async def get_society_structure(config: RunnableConfig) -> dict:
    """..."""
    society_id = config["configurable"]["society_id"]
    # All queries scoped to this society_id
```

### 7.3 Tool Return Format

All tools return a **structured dict** that the LLM can reason about:
```python
# Success
return {
    "success": True,
    "message": "Block D created successfully.",
    "data": {"blockId": 15, "blockName": "D"}
}

# Error
return {
    "success": False,
    "error": "Block name 'A' already exists in this society."
}
```

**Why structured dicts instead of plain strings?**
- LLM can check `success` to decide if it needs to retry or inform the secretary of an error.
- `data` provides IDs that the LLM may need for chained tool calls (e.g., `blockId` for `add_floors`).
- Error messages are human-readable — LLM can relay them directly to the secretary.

### 7.4 Async Tools

All tools use `async def` because they perform async MySQL queries via `aiomysql`.
LangGraph's `ToolNode` supports async tools natively.

---

## 8. Complete Tool Catalog — Society Setup

### File: `graph/tools/society_setup.py`

All 17 tools live in one file because they all query the same domain
(society structure + residents). When we add complaints tools later,
they'll go in a separate `graph/tools/complaints.py`.

---

### Tool 1: `get_society_info`

**Purpose**: Fetch the full society configuration (name, code, address, city, state, active status, metadata).

**When LLM Uses It**: Secretary asks *"What's our society code?"*, *"Show me society details"*, *"Is our society active?"*

```python
@tool
async def get_society_info(config: RunnableConfig) -> dict:
    """Get the full configuration of the current society including name, society_code,
    address, city, state, pincode, active status, and metadata."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """SELECT id, name, society_code, address, city, state, pincode,
                          is_active, metadata, created_at, updated_at
                   FROM societies WHERE id = %s""",
                (society_id,)
            )
            row = await cur.fetchone()

    if not row:
        return {"success": False, "error": "Society not found."}

    return {
        "success": True,
        "data": {
            "id": row["id"],
            "name": row["name"],
            "societyCode": row["society_code"],
            "address": row["address"],
            "city": row["city"],
            "state": row["state"],
            "pincode": row["pincode"],
            "isActive": bool(row["is_active"]),
            "metadata": row["metadata"],
            "createdAt": str(row["created_at"]),
            "updatedAt": str(row["updated_at"]),
        }
    }
```

---

### Tool 2: `update_society_info`

**Purpose**: Update one or more society fields (name, address, city, state, pincode, metadata).

**When LLM Uses It**: *"Change our society name to Sunrise Heights"*, *"Update the address"*

**Cannot update**: `society_code` (too critical — must be done manually) and `is_active` (admin-only).

```python
@tool
async def update_society_info(
    config: RunnableConfig,
    name: str | None = None,
    address: str | None = None,
    city: str | None = None,
    state: str | None = None,
    pincode: str | None = None,
) -> dict:
    """Update society configuration fields. Pass only the fields you want to change.
    Cannot update society_code or is_active through this tool."""

    society_id = config["configurable"]["society_id"]

    updates = []
    values = []
    if name is not None:
        updates.append("name = %s"); values.append(name.strip())
    if address is not None:
        updates.append("address = %s"); values.append(address.strip())
    if city is not None:
        updates.append("city = %s"); values.append(city.strip())
    if state is not None:
        updates.append("state = %s"); values.append(state.strip())
    if pincode is not None:
        updates.append("pincode = %s"); values.append(pincode.strip())

    if not updates:
        return {"success": False, "error": "No fields provided to update."}

    values.append(society_id)
    pool = await get_mysql_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"UPDATE societies SET {', '.join(updates)} WHERE id = %s",
                tuple(values)
            )
            await conn.commit()

    return {"success": True, "message": "Society information updated successfully."}
```

---

### Tool 3: `get_society_structure`

**Purpose**: Fetch the complete hierarchical structure: society → blocks → floors → units (with status, area, type).

**When LLM Uses It**: Almost always — LLM needs this to reason about the structure before any modification. *"Show me the full structure"*, *"How many vacant units in Block A?"*, *"Which floors exist in Block B?"*

```python
@tool
async def get_society_structure(config: RunnableConfig) -> dict:
    """Get the complete hierarchical structure of the society: all blocks, their floors,
    and all units on each floor including unit status (vacant/occupied), type, and area.
    Use this tool whenever you need to understand the current building layout."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Blocks
            await cur.execute(
                "SELECT id, block_name FROM blocks WHERE society_id = %s ORDER BY block_name",
                (society_id,)
            )
            blocks = await cur.fetchall()

            # Floors
            await cur.execute(
                "SELECT id, block_id, floor_number FROM floors WHERE society_id = %s ORDER BY floor_number",
                (society_id,)
            )
            floors = await cur.fetchall()

            # Units
            await cur.execute(
                """SELECT id, floor_id, unit_number, display_label, status, unit_type, area_sqft
                   FROM units WHERE society_id = %s ORDER BY unit_number""",
                (society_id,)
            )
            units = await cur.fetchall()

    # Assemble tree
    floor_map = {}
    for f in floors:
        floor_map.setdefault(f["block_id"], []).append({
            "id": f["id"],
            "floorNumber": f["floor_number"],
            "units": []
        })

    unit_map = {}
    for u in units:
        unit_map.setdefault(u["floor_id"], []).append({
            "id": u["id"],
            "unitNumber": u["unit_number"],
            "displayLabel": u["display_label"],
            "status": u["status"],
            "unitType": u["unit_type"],
            "areaSqft": u["area_sqft"],
        })

    structure = []
    for b in blocks:
        block_floors = floor_map.get(b["id"], [])
        for fl in block_floors:
            fl["units"] = unit_map.get(fl["id"], [])
        structure.append({
            "id": b["id"],
            "blockName": b["block_name"],
            "totalFloors": len(block_floors),
            "totalUnits": sum(len(fl["units"]) for fl in block_floors),
            "floors": block_floors,
        })

    return {
        "success": True,
        "data": {
            "totalBlocks": len(structure),
            "totalFloors": sum(b["totalFloors"] for b in structure),
            "totalUnits": sum(b["totalUnits"] for b in structure),
            "blocks": structure,
        }
    }
```

---

### Tool 4: `add_blocks`

**Purpose**: Add one or more new blocks to the society.

**When LLM Uses It**: *"Add blocks D, E, and F"*, *"Create a new block called G"*

```python
@tool
async def add_blocks(
    config: RunnableConfig,
    block_names: list[str],
) -> dict:
    """Add one or more new blocks to the society. Each block_name must be
    uppercase letters only (e.g., 'A', 'B', 'AA'). Duplicates are rejected."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    created = []
    errors = []

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for name in block_names:
                name_upper = name.strip().upper()
                if not name_upper.isalpha():
                    errors.append(f"'{name}': Invalid format. Must be uppercase letters only.")
                    continue
                try:
                    await cur.execute(
                        "INSERT INTO blocks (society_id, block_name) VALUES (%s, %s)",
                        (society_id, name_upper)
                    )
                    await conn.commit()
                    created.append({"blockId": cur.lastrowid, "blockName": name_upper})
                except Exception as e:
                    if "Duplicate" in str(e) or "uq_" in str(e).lower():
                        errors.append(f"'{name_upper}': Block already exists.")
                    else:
                        errors.append(f"'{name_upper}': {str(e)}")

    result = {"success": True, "created": created}
    if errors:
        result["errors"] = errors
    if not created:
        result["success"] = False
        result["error"] = "No blocks were created."
    return result
```

---

### Tool 5: `rename_block`

**Purpose**: Rename an existing block.

```python
@tool
async def rename_block(
    config: RunnableConfig,
    block_id: int,
    new_name: str,
) -> dict:
    """Rename an existing block. The new_name must be uppercase letters only."""

    society_id = config["configurable"]["society_id"]
    new_name_upper = new_name.strip().upper()
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Verify block belongs to society
            await cur.execute(
                "SELECT id, block_name FROM blocks WHERE id = %s AND society_id = %s",
                (block_id, society_id)
            )
            block = await cur.fetchone()
            if not block:
                return {"success": False, "error": f"Block with id {block_id} not found."}

            # Check new name doesn't conflict
            await cur.execute(
                "SELECT id FROM blocks WHERE society_id = %s AND block_name = %s AND id != %s",
                (society_id, new_name_upper, block_id)
            )
            if await cur.fetchone():
                return {"success": False, "error": f"Block '{new_name_upper}' already exists."}

            old_name = block["block_name"]
            await cur.execute("UPDATE blocks SET block_name = %s WHERE id = %s", (new_name_upper, block_id))

            # Update denormalized block_name in units
            await cur.execute(
                "UPDATE units SET block_name = %s WHERE block_id = %s",
                (new_name_upper, block_id)
            )
            await conn.commit()

    return {
        "success": True,
        "message": f"Block renamed from '{old_name}' to '{new_name_upper}'."
    }
```

---

### Tool 6: `delete_block`

**Purpose**: Delete an empty block (no floors, no units).

```python
@tool
async def delete_block(
    config: RunnableConfig,
    block_id: int,
) -> dict:
    """Delete a block from the society. The block must have zero floors and zero units.
    If it has floors or units, they must be deleted first."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, block_name FROM blocks WHERE id = %s AND society_id = %s",
                (block_id, society_id)
            )
            block = await cur.fetchone()
            if not block:
                return {"success": False, "error": f"Block with id {block_id} not found."}

            # Check for floors
            await cur.execute("SELECT COUNT(*) as cnt FROM floors WHERE block_id = %s", (block_id,))
            floor_count = (await cur.fetchone())["cnt"]
            if floor_count > 0:
                return {"success": False, "error": f"Block '{block['block_name']}' has {floor_count} floor(s). Delete floors first."}

            await cur.execute("DELETE FROM blocks WHERE id = %s", (block_id,))
            await conn.commit()

    return {"success": True, "message": f"Block '{block['block_name']}' deleted successfully."}
```

---

### Tool 7: `add_floors`

**Purpose**: Add N floors to a block, auto-numbered from the current max + 1.

```python
@tool
async def add_floors(
    config: RunnableConfig,
    block_id: int,
    total_floors: int,
) -> dict:
    """Add multiple floors to a block. Floors are auto-numbered starting from the
    next available floor number. For example, if Block A has floors 1-3, adding 2 floors
    creates floors 4 and 5."""

    society_id = config["configurable"]["society_id"]
    if total_floors < 1 or total_floors > 50:
        return {"success": False, "error": "total_floors must be between 1 and 50."}

    pool = await get_mysql_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Verify block
            await cur.execute(
                "SELECT id, block_name FROM blocks WHERE id = %s AND society_id = %s",
                (block_id, society_id)
            )
            block = await cur.fetchone()
            if not block:
                return {"success": False, "error": f"Block with id {block_id} not found."}

            # Get current max floor
            await cur.execute(
                "SELECT IFNULL(MAX(floor_number), 0) AS max_floor FROM floors WHERE block_id = %s",
                (block_id,)
            )
            current_max = (await cur.fetchone())["max_floor"]
            start_floor = current_max + 1

            for i in range(total_floors):
                await cur.execute(
                    "INSERT INTO floors (block_id, society_id, floor_number) VALUES (%s, %s, %s)",
                    (block_id, society_id, start_floor + i)
                )
            await conn.commit()

    return {
        "success": True,
        "message": f"Added {total_floors} floor(s) to Block {block['block_name']} (floors {start_floor}-{start_floor + total_floors - 1}).",
        "data": {
            "blockId": block_id,
            "blockName": block["block_name"],
            "floorsCreated": total_floors,
            "floorRange": f"{start_floor}-{start_floor + total_floors - 1}",
        }
    }
```

---

### Tool 8: `delete_floor`

**Purpose**: Delete a floor only if it has no units.

```python
@tool
async def delete_floor(
    config: RunnableConfig,
    floor_id: int,
) -> dict:
    """Delete a floor. The floor must have zero units. If it has units, they must be
    deleted first."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, block_id, floor_number FROM floors WHERE id = %s AND society_id = %s",
                (floor_id, society_id)
            )
            floor = await cur.fetchone()
            if not floor:
                return {"success": False, "error": f"Floor with id {floor_id} not found."}

            await cur.execute("SELECT COUNT(*) as cnt FROM units WHERE floor_id = %s", (floor_id,))
            unit_count = (await cur.fetchone())["cnt"]
            if unit_count > 0:
                return {"success": False, "error": f"Floor {floor['floor_number']} has {unit_count} unit(s). Delete units first."}

            await cur.execute("DELETE FROM floors WHERE id = %s", (floor_id,))
            await conn.commit()

    return {"success": True, "message": f"Floor {floor['floor_number']} deleted successfully."}
```

---

### Tool 9: `add_units`

**Purpose**: Bulk-add units to a floor (matching Purvi's `bulkAddUnits` logic).

```python
@tool
async def add_units(
    config: RunnableConfig,
    floor_id: int,
    start_unit: int,
    end_unit: int,
    unit_type: str = "apartment",
    area_sqft: int | None = None,
) -> dict:
    """Add units to a floor in bulk. Units are numbered from start_unit to end_unit
    (inclusive). Unit numbers must be between 1 and 99. Display labels are auto-generated
    as 'BlockName-FloorUnit' (e.g., A-101, B-203). unit_type defaults to 'apartment'.
    Existing unit numbers on the floor are skipped (not duplicated)."""

    society_id = config["configurable"]["society_id"]
    if start_unit < 1 or end_unit > 99 or start_unit > end_unit:
        return {"success": False, "error": "Unit numbers must be 1-99 and start_unit <= end_unit."}

    pool = await get_mysql_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Fetch floor + block info
            await cur.execute(
                """SELECT f.id, f.block_id, f.floor_number, b.block_name
                   FROM floors f JOIN blocks b ON f.block_id = b.id
                   WHERE f.id = %s AND f.society_id = %s""",
                (floor_id, society_id)
            )
            floor = await cur.fetchone()
            if not floor:
                return {"success": False, "error": f"Floor with id {floor_id} not found."}

            created = 0
            skipped = 0
            for i in range(start_unit, end_unit + 1):
                # Check existing
                await cur.execute(
                    "SELECT id FROM units WHERE floor_id = %s AND unit_number = %s",
                    (floor_id, i)
                )
                if await cur.fetchone():
                    skipped += 1
                    continue

                floor_str = "G" if floor["floor_number"] == 0 else str(floor["floor_number"])
                unit_str = str(i).zfill(2)
                display_label = f"{floor['block_name']}-{floor_str}{unit_str}"

                await cur.execute(
                    """INSERT INTO units
                       (floor_id, block_id, society_id, block_name, floor_number,
                        unit_number, display_label, unit_type, area_sqft, status)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'vacant')""",
                    (floor_id, floor["block_id"], society_id, floor["block_name"],
                     floor["floor_number"], i, display_label, unit_type, area_sqft)
                )
                created += 1

            await conn.commit()

    msg = f"Created {created} unit(s) on Floor {floor['floor_number']} of Block {floor['block_name']}."
    if skipped > 0:
        msg += f" {skipped} existing unit(s) were skipped."

    return {"success": True, "message": msg, "data": {"created": created, "skipped": skipped}}
```

---

### Tool 10: `edit_unit`

**Purpose**: Edit a unit's type or area (not its number or label).

```python
@tool
async def edit_unit(
    config: RunnableConfig,
    unit_id: int,
    unit_type: str | None = None,
    area_sqft: int | None = None,
) -> dict:
    """Edit a unit's details (unit_type or area_sqft). Pass only the fields to change.
    Unit number and display label cannot be changed."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, display_label FROM units WHERE id = %s AND society_id = %s",
                (unit_id, society_id)
            )
            unit = await cur.fetchone()
            if not unit:
                return {"success": False, "error": f"Unit with id {unit_id} not found."}

            updates, values = [], []
            if unit_type is not None:
                updates.append("unit_type = %s"); values.append(unit_type)
            if area_sqft is not None:
                updates.append("area_sqft = %s"); values.append(area_sqft)

            if not updates:
                return {"success": False, "error": "No fields provided to update."}

            values.append(unit_id)
            await cur.execute(f"UPDATE units SET {', '.join(updates)} WHERE id = %s", tuple(values))
            await conn.commit()

    return {"success": True, "message": f"Unit {unit['display_label']} updated."}
```

---

### Tool 11: `delete_unit`

**Purpose**: Delete a unit. Must be `vacant` (no resident assigned).

```python
@tool
async def delete_unit(
    config: RunnableConfig,
    unit_id: int,
) -> dict:
    """Delete a unit from the society. The unit must be 'vacant' (no resident assigned).
    Occupied units cannot be deleted — the resident must be removed first."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, display_label, status FROM units WHERE id = %s AND society_id = %s",
                (unit_id, society_id)
            )
            unit = await cur.fetchone()
            if not unit:
                return {"success": False, "error": f"Unit with id {unit_id} not found."}

            if unit["status"] != "vacant":
                return {
                    "success": False,
                    "error": f"Unit {unit['display_label']} is '{unit['status']}'. Only vacant units can be deleted."
                }

            await cur.execute("DELETE FROM units WHERE id = %s", (unit_id,))
            await conn.commit()

    return {"success": True, "message": f"Unit {unit['display_label']} deleted."}
```

---

### Tool 12: `get_dashboard_stats`

**Purpose**: Fetch dashboard statistics (matching Purvi's `getDashboardStats`).

```python
@tool
async def get_dashboard_stats(config: RunnableConfig) -> dict:
    """Get dashboard summary statistics: block/floor/unit counts, occupancy rate,
    resident counts by status, and recent registrations."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Unit stats
            await cur.execute(
                """SELECT COUNT(*) as total,
                   SUM(status='occupied') as occupied,
                   SUM(status='vacant') as vacant
                   FROM units WHERE society_id = %s""",
                (society_id,)
            )
            units = await cur.fetchone()

            # Block + Floor counts
            await cur.execute("SELECT COUNT(*) as cnt FROM blocks WHERE society_id = %s", (society_id,))
            block_count = (await cur.fetchone())["cnt"]
            await cur.execute("SELECT COUNT(*) as cnt FROM floors WHERE society_id = %s", (society_id,))
            floor_count = (await cur.fetchone())["cnt"]

            # Resident stats
            await cur.execute(
                """SELECT COUNT(*) as total,
                   SUM(status='pending') as pending,
                   SUM(status='active') as active,
                   SUM(status='inactive') as inactive,
                   SUM(status='rejected') as rejected
                   FROM users WHERE society_id = %s AND role = 'resident'""",
                (society_id,)
            )
            residents = await cur.fetchone()

    total_units = int(units["total"] or 0)
    occupied = int(units["occupied"] or 0)
    vacant = int(units["vacant"] or 0)
    rate = round((occupied / total_units * 100), 1) if total_units > 0 else 0

    return {
        "success": True,
        "data": {
            "structure": {
                "totalBlocks": int(block_count),
                "totalFloors": int(floor_count),
                "totalUnits": total_units,
                "occupiedUnits": occupied,
                "vacantUnits": vacant,
                "occupancyRate": rate,
            },
            "residents": {
                "total": int(residents["total"] or 0),
                "pending": int(residents["pending"] or 0),
                "active": int(residents["active"] or 0),
                "inactive": int(residents["inactive"] or 0),
                "rejected": int(residents["rejected"] or 0),
            }
        }
    }
```

---

### Tool 13: `get_residents_list`

**Purpose**: Fetch residents with optional status filter.

```python
@tool
async def get_residents_list(
    config: RunnableConfig,
    status_filter: str | None = None,
) -> dict:
    """Get a list of residents in the society. Optionally filter by status:
    'pending', 'active', 'inactive', 'rejected'. Returns name, email, phone,
    status, and unit info for each resident."""

    society_id = config["configurable"]["society_id"]
    valid = ["pending", "active", "inactive", "rejected"]
    if status_filter and status_filter not in valid:
        return {"success": False, "error": f"Invalid status. Must be one of: {', '.join(valid)}"}

    pool = await get_mysql_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            query = """SELECT u.id, u.name, u.email, u.phone, u.status, u.created_at,
                              un.id as unit_id, un.display_label, un.block_name, un.floor_number
                       FROM users u
                       LEFT JOIN units un ON u.unit_id = un.id
                       WHERE u.society_id = %s AND u.role = 'resident'"""
            params = [society_id]
            if status_filter:
                query += " AND u.status = %s"
                params.append(status_filter)
            query += " ORDER BY u.created_at DESC"

            await cur.execute(query, tuple(params))
            rows = await cur.fetchall()

    residents = [{
        "userId": r["id"], "name": r["name"], "email": r["email"],
        "phone": r["phone"], "status": r["status"],
        "registeredAt": str(r["created_at"]),
        "unit": {"id": r["unit_id"], "displayLabel": r["display_label"],
                 "block": r["block_name"], "floor": r["floor_number"]} if r["unit_id"] else None
    } for r in rows]

    return {"success": True, "data": {"count": len(residents), "residents": residents}}
```

---

### Tool 14: `approve_resident`

```python
@tool
async def approve_resident(config: RunnableConfig, resident_id: int) -> dict:
    """Approve a pending resident registration. Only residents with status 'pending'
    can be approved. Their status changes to 'active'."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, status FROM users WHERE id = %s AND society_id = %s AND role = 'resident'",
                (resident_id, society_id)
            )
            user = await cur.fetchone()
            if not user:
                return {"success": False, "error": "Resident not found in your society."}
            if user["status"] != "pending":
                return {"success": False, "error": f"Cannot approve: status is '{user['status']}', must be 'pending'."}

            await cur.execute("UPDATE users SET status = 'active' WHERE id = %s", (resident_id,))
            await conn.commit()

    return {"success": True, "message": f"Resident '{user['name']}' approved. They can now log in."}
```

---

### Tool 15: `reject_resident`

```python
@tool
async def reject_resident(config: RunnableConfig, resident_id: int) -> dict:
    """Reject a pending resident registration. Sets status to 'rejected' and releases
    their claimed unit back to 'vacant'. Only 'pending' residents can be rejected."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, unit_id, status FROM users WHERE id = %s AND society_id = %s AND role = 'resident'",
                (resident_id, society_id)
            )
            user = await cur.fetchone()
            if not user:
                return {"success": False, "error": "Resident not found in your society."}
            if user["status"] != "pending":
                return {"success": False, "error": f"Cannot reject: status is '{user['status']}', must be 'pending'."}

            await cur.execute("UPDATE users SET status = 'rejected' WHERE id = %s", (resident_id,))
            if user["unit_id"]:
                await cur.execute("UPDATE units SET status = 'vacant' WHERE id = %s", (user["unit_id"],))
            await conn.commit()

    return {"success": True, "message": f"Resident '{user['name']}' rejected. Unit released to vacant."}
```

---

### Tool 16: `revoke_resident`

```python
@tool
async def revoke_resident(config: RunnableConfig, resident_id: int) -> dict:
    """Revoke access for an active resident. Sets status to 'inactive', clears unit_id,
    and releases their unit to 'vacant'. Only 'active' residents can be revoked."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, unit_id, status FROM users WHERE id = %s AND society_id = %s AND role = 'resident'",
                (resident_id, society_id)
            )
            user = await cur.fetchone()
            if not user:
                return {"success": False, "error": "Resident not found in your society."}
            if user["status"] != "active":
                return {"success": False, "error": f"Cannot revoke: status is '{user['status']}', must be 'active'."}

            await cur.execute("UPDATE users SET status = 'inactive', unit_id = NULL WHERE id = %s", (resident_id,))
            if user["unit_id"]:
                await cur.execute("UPDATE units SET status = 'vacant' WHERE id = %s", (user["unit_id"],))
            await conn.commit()

    return {"success": True, "message": f"Resident '{user['name']}' revoked. Unit released to vacant."}
```

---

### Tool 17: `reactivate_resident`

```python
@tool
async def reactivate_resident(
    config: RunnableConfig,
    resident_id: int,
    unit_id: int,
) -> dict:
    """Reactivate an inactive (revoked) or rejected resident and assign them a vacant unit.
    The target unit must be 'vacant' and belong to this society."""

    society_id = config["configurable"]["society_id"]
    pool = await get_mysql_pool()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Check resident
            await cur.execute(
                "SELECT id, name, status FROM users WHERE id = %s AND society_id = %s AND role = 'resident'",
                (resident_id, society_id)
            )
            user = await cur.fetchone()
            if not user:
                return {"success": False, "error": "Resident not found."}
            if user["status"] == "active":
                return {"success": False, "error": "Resident is already active."}
            if user["status"] == "pending":
                return {"success": False, "error": "Resident is pending. Use approve_resident instead."}

            # Check unit
            await cur.execute(
                "SELECT id, display_label, status FROM units WHERE id = %s AND society_id = %s",
                (unit_id, society_id)
            )
            unit = await cur.fetchone()
            if not unit:
                return {"success": False, "error": f"Unit with id {unit_id} not found."}
            if unit["status"] != "vacant":
                return {"success": False, "error": f"Unit {unit['display_label']} is not vacant."}

            await cur.execute("UPDATE users SET status = 'active', unit_id = %s WHERE id = %s", (unit_id, resident_id))
            await cur.execute("UPDATE units SET status = 'occupied' WHERE id = %s", (unit_id,))
            await conn.commit()

    return {
        "success": True,
        "message": f"Resident '{user['name']}' reactivated and assigned to {unit['display_label']}."
    }
```

---

## 9. Updated System Prompt — Tool-Aware Agent Persona

The system prompt must now inform the LLM about its capabilities. This is critical —
without tool context in the system prompt, the LLM won't know when to use tools vs
when to answer from general knowledge.

### Updated `prompts/system.py`

```python
def build_system_prompt(state=None, society_name="the Society", secretary_name="Secretary") -> str:
    today = datetime.now().strftime("%d %B %Y")

    base = f"""You are Sahayak, the intelligent management assistant for {society_name}.
You are assisting {secretary_name}, the society secretary.
Today is {today}.

## Your Capabilities

You have access to tools that let you directly read and modify the society's data:

### Society & Structure Tools
- **get_society_info**: View society details (name, code, address, etc.)
- **update_society_info**: Update society name, address, city, state, or pincode
- **get_society_structure**: View the full block → floor → unit hierarchy with statuses
- **add_blocks**: Create new blocks (single or multiple at once)
- **rename_block**: Rename an existing block
- **delete_block**: Delete an empty block (must have no floors)
- **add_floors**: Add floors to a block (auto-numbered)
- **delete_floor**: Delete an empty floor (must have no units)
- **add_units**: Bulk-create units on a floor with auto-generated labels
- **edit_unit**: Change a unit's type or area
- **delete_unit**: Delete a vacant unit (must have no resident)

### Resident Management Tools
- **get_dashboard_stats**: View occupancy rates, resident counts, structure summary
- **get_residents_list**: List residents with optional status filter
- **approve_resident**: Approve a pending registration
- **reject_resident**: Reject a pending registration (releases unit)
- **revoke_resident**: Revoke an active resident's access (releases unit)
- **reactivate_resident**: Restore a revoked/rejected resident with a new unit

## Behavioral Guidelines

1. **Always use tools for factual queries** — never guess about the society's structure or residents.
   If the secretary asks "how many units in Block A?", call `get_society_structure` first.

2. **Chain tools intelligently** — if the secretary says "Add block E with 3 floors and 4 units each",
   call `add_blocks` → `add_floors` → `add_units` for each floor, in sequence.

3. **Confirm destructive actions before executing** — if the secretary says "delete Block B",
   first check the structure to verify it's empty, then warn about any consequences before deleting.

4. **Report results clearly** — after tool execution, summarize what was done in a clean,
   human-readable format. Include relevant numbers and labels.

5. **Handle errors gracefully** — if a tool returns an error, explain what went wrong and
   suggest alternatives. Never make up data.

6. **Never fabricate data** — if you don't have information, say so and offer to fetch it.

7. **Stay within scope** — you manage {society_name} only. You cannot access other societies.

8. **Be professional and concise** — respond in clear, well-structured messages."""

    # Inject rolling summary if present
    if state:
        summary = state.get("summary", "")
        if summary and summary.strip():
            base += f"\n\n[Previous conversation summary]\n{summary.strip()}"

    return base
```

---

## 10. Updated Graph Builder — Wiring Tools Into the Graph

### Updated `builder.py`

```python
import logging
from typing import Optional
from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode

from app.graph.state import AgentState
from app.graph.nodes.call_model import call_model
from app.graph.nodes.summarize import summarize_node
from app.graph.edges.routers import route_start, route_after_model
from app.graph.tools.society_setup import get_all_tools
from app.database.mongodb import get_checkpointer

logger = logging.getLogger(__name__)

_graph: Optional[CompiledStateGraph] = None


def build_graph() -> CompiledStateGraph:
    """
    Construct, wire, and compile the Sahayak LangGraph agent graph.

    Phase 2 Graph Architecture:
    1. START → route_start (conditional: summarize check)
       - If len(messages) > 30 → summarize_node → call_model
       - Else → call_model
    2. call_model → route_after_model (conditional: tool check)
       - If AIMessage has tool_calls → tool_executor
       - Else → END
    3. tool_executor → call_model (loop back for LLM to process results)
    """
    logger.info("Building Sahayak LangGraph agent graph (Phase 2: with tools)...")
    builder = StateGraph(AgentState)

    # 1. Collect all tools
    tools = get_all_tools()
    logger.info("Registered %d agent tools.", len(tools))

    # 2. Register Nodes
    builder.add_node("call_model", call_model)
    builder.add_node("summarize_node", summarize_node)
    builder.add_node("tool_executor", ToolNode(tools))  # ← NEW

    # 3. START → route_start (summarization check, unchanged)
    builder.add_conditional_edges(
        START,
        route_start,
        {
            "call_model": "call_model",
            "summarize_node": "summarize_node",
        },
    )

    # 4. summarize_node → call_model (unchanged)
    builder.add_edge("summarize_node", "call_model")

    # 5. call_model → route_after_model (NEW: tool loop check)
    builder.add_conditional_edges(
        "call_model",
        route_after_model,
        {
            "tool_executor": "tool_executor",
            "end": END,
        },
    )

    # 6. tool_executor → call_model (loop back)
    builder.add_edge("tool_executor", "call_model")

    # 7. Compile
    checkpointer = get_checkpointer()
    compiled_graph = builder.compile(checkpointer=checkpointer)

    logger.info("Sahayak LangGraph agent compiled successfully (Phase 2).")
    return compiled_graph


def get_graph() -> CompiledStateGraph:
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph
```

---

## 11. Updated `call_model` Node — Binding Tools to LLM

The critical change: we now call `llm.bind_tools(tools)` so that Gemini knows
what tools are available and can emit `tool_calls` in its response.

### Updated `nodes/call_model.py`

```python
import logging
from typing import Any, Dict, Optional
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from app.config import settings
from app.graph.state import AgentState
from app.graph.tools.society_setup import get_all_tools
from app.prompts.system import get_system_message

logger = logging.getLogger(__name__)

_models: Dict[float, ChatGoogleGenerativeAI] = {}
_llm_with_tools = None  # Cached LLM with tools bound


def get_llm(temperature: float = 0.7) -> ChatGoogleGenerativeAI:
    if temperature not in _models:
        _models[temperature] = ChatGoogleGenerativeAI(
            model=settings.GEMINI_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=temperature,
            max_retries=2,
            timeout=60.0,   # Increased for tool-heavy conversations
        )
    return _models[temperature]


def get_llm_with_tools():
    """Return LLM with tools bound (cached singleton)."""
    global _llm_with_tools
    if _llm_with_tools is None:
        llm = get_llm()
        tools = get_all_tools()
        _llm_with_tools = llm.bind_tools(tools)
        logger.info("LLM bound with %d tools.", len(tools))
    return _llm_with_tools


async def call_model(
    state: AgentState,
    config: Optional[RunnableConfig] = None,
) -> Dict[str, Any]:
    """
    Main LangGraph node: invoke Gemini with tool bindings.

    The LLM may return:
    - A pure text AIMessage (final answer) → route_after_model sends to END
    - An AIMessage with tool_calls → route_after_model sends to tool_executor
    """
    configurable = (config or {}).get("configurable", {})
    society_name = configurable.get("society_name", "the Society")
    secretary_name = configurable.get("secretary_name", "Secretary")

    logger.info("Invoking Gemini with tools for %s...", secretary_name)

    system_msg = get_system_message(state=state, society_name=society_name, secretary_name=secretary_name)
    messages_to_send = [system_msg, *state["messages"]]

    # Use tool-bound LLM
    llm = get_llm_with_tools()
    response = await llm.ainvoke(messages_to_send)

    tool_calls = getattr(response, "tool_calls", None)
    if tool_calls:
        logger.info("LLM requested %d tool call(s): %s",
                     len(tool_calls), [tc["name"] for tc in tool_calls])
    else:
        logger.info("LLM responded with text (%d chars).", len(response.content or ""))

    return {"messages": [response]}
```

---

## 12. New `tool_executor` Node

We use LangGraph's built-in `ToolNode` from `langgraph.prebuilt`. It:
1. Reads `AIMessage.tool_calls` from the last message in state
2. Executes each tool function (async) with the provided arguments
3. Returns `ToolMessage` objects (one per tool call) keyed by `tool_call_id`

**No custom code needed** — `ToolNode(tools)` handles everything. It is registered in `builder.py`.

### How `ToolNode` Works Internally

```python
# Pseudocode — this is what ToolNode does automatically:
for tool_call in last_message.tool_calls:
    tool_fn = tools_by_name[tool_call["name"]]
    result = await tool_fn.ainvoke(tool_call["args"], config=config)
    yield ToolMessage(content=str(result), tool_call_id=tool_call["id"])
```

**Important**: `ToolNode` automatically passes the `RunnableConfig` to each tool function.
This is how tools receive `config["configurable"]["society_id"]` — no manual plumbing needed.

---

## 13. Updated Edge Router — Tool Loop Detection

### Updated `edges/routers.py`

```python
import logging
from langchain_core.messages import AIMessage
from app.config import settings
from app.graph.state import AgentState

logger = logging.getLogger(__name__)


def route_start(state: AgentState) -> str:
    """Phase 1 routing (unchanged): check summarization threshold."""
    messages = state.get("messages", [])
    if len(messages) > settings.MAX_WINDOW_MESSAGES:
        logger.info("Routing to summarize_node (%d messages).", len(messages))
        return "summarize_node"
    return "call_model"


def route_after_model(state: AgentState) -> str:
    """
    NEW Phase 2 routing: check if LLM requested tool calls.

    After call_model produces an AIMessage:
    - If AIMessage has tool_calls → route to 'tool_executor'
    - If AIMessage is plain text → route to 'end'
    """
    messages = state.get("messages", [])
    if not messages:
        return "end"

    last_message = messages[-1]

    # Check if it's an AIMessage with tool calls
    if isinstance(last_message, AIMessage) and getattr(last_message, "tool_calls", None):
        logger.info(
            "LLM requested %d tool call(s). Routing to tool_executor.",
            len(last_message.tool_calls)
        )
        return "tool_executor"

    logger.debug("No tool calls. Routing to END.")
    return "end"
```

---

## 14. Streaming SSE with Tool Call Events

### Updated `chat_service.py` SSE Events

When tools are being called, the frontend should show a "thinking" or "working" indicator.
We emit additional SSE event types:

```python
# During streaming, detect tool-related events
async for chunk, metadata in graph.astream(input_state, config=config, stream_mode="messages"):
    node = metadata.get("langgraph_node", "")

    if node == "call_model":
        token = extract_chunk_text(chunk.content)
        if token:
            accumulated_parts.append(token)
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        # Detect tool calls in the chunk
        if hasattr(chunk, "tool_calls") and chunk.tool_calls:
            for tc in chunk.tool_calls:
                yield f"data: {json.dumps({'type': 'tool_start', 'tool': tc['name'], 'args': tc.get('args', {})})}\\n\\n"

    elif node == "tool_executor":
        # Tool result — emit for frontend "step" display
        if hasattr(chunk, "content"):
            yield f"data: {json.dumps({'type': 'tool_result', 'content': str(chunk.content)[:500]})}\\n\\n"
```

### SSE Event Types (Complete)

| Event Type | When Emitted | Frontend Action |
|---|---|---|
| `start` | Stream begins | Show "typing..." indicator |
| `token` | Each text chunk from LLM | Append to response bubble |
| `tool_start` | LLM requests a tool call | Show "🔧 Calling `add_blocks`..." |
| `tool_result` | Tool execution complete | Show "✅ Tool complete" (optional debug) |
| `done` | Stream finished | Stop typing indicator, finalize message |
| `error` | Any error | Show error toast |

---

## 15. File & Folder Structure After Phase 2

```
ai-service/
├── app/
│   ├── main.py                         # Updated: init_mysql/close_mysql
│   ├── config.py                       # Updated: MySQL config fields
│   │
│   ├── database/
│   │   ├── mongodb.py                  # Unchanged
│   │   └── mysql.py                    # NEW: aiomysql pool
│   │
│   ├── graph/
│   │   ├── state.py                    # Unchanged (messages + summary)
│   │   ├── builder.py                  # UPDATED: ToolNode, route_after_model
│   │   │
│   │   ├── nodes/
│   │   │   ├── call_model.py           # UPDATED: bind_tools(), tool awareness
│   │   │   └── summarize.py            # Unchanged
│   │   │
│   │   ├── edges/
│   │   │   └── routers.py              # UPDATED: route_after_model() added
│   │   │
│   │   └── tools/                      # NEW directory
│   │       ├── __init__.py
│   │       └── society_setup.py        # 17 tools: get/update society, blocks,
│   │                                   #   floors, units, residents, dashboard
│   │
│   ├── routers/
│   │   └── chat.py                     # Unchanged (SSE streaming)
│   │
│   ├── services/
│   │   ├── chat_service.py             # UPDATED: tool SSE events
│   │   └── history_service.py          # Unchanged
│   │
│   ├── models/
│   │   └── chat.py                     # UPDATED: society_id in ChatRequest
│   │
│   └── prompts/
│       └── system.py                   # UPDATED: tool-aware system prompt
│
├── requirements.txt                    # UPDATED: + aiomysql
└── .env                                # UPDATED: + MySQL credentials
```

---

## 16. Implementation Order — Step by Step

Follow this exact order. Each step is a testable milestone.

### Step 1: MySQL Integration
- [ ] Add `aiomysql` to `requirements.txt` and install
- [ ] Add MySQL config fields to `config.py`
- [ ] Create `database/mysql.py` with pool, init, close
- [ ] Update `main.py` lifespan to init/close MySQL
- [ ] **Test**: Health endpoint verifies MySQL connectivity

### Step 2: Create Tool Functions
- [ ] Create `graph/tools/__init__.py`
- [ ] Create `graph/tools/society_setup.py`
- [ ] Implement read-only tools first: `get_society_info`, `get_society_structure`, `get_dashboard_stats`, `get_residents_list`
- [ ] **Test**: Call tools directly from a scratch script to verify SQL queries work

### Step 3: Update Edge Router
- [ ] Add `route_after_model()` to `edges/routers.py`
- [ ] **Test**: Router correctly identifies `AIMessage` with and without `tool_calls`

### Step 4: Update `call_model` — Bind Tools
- [ ] Update `call_model.py` to use `llm.bind_tools(tools)`
- [ ] Cache the tool-bound LLM as a singleton
- [ ] **Test**: Send a message that should trigger a tool call, verify `AIMessage.tool_calls` is populated

### Step 5: Wire Up Graph Builder
- [ ] Update `builder.py` to add `ToolNode`, `route_after_model`, and the tool loop edge
- [ ] **Test**: Full graph compilation succeeds, graph visualization shows the loop

### Step 6: Update System Prompt
- [ ] Update `prompts/system.py` with tool-aware persona and behavioral guidelines
- [ ] **Test**: Ask the agent *"How many blocks do we have?"* — it should call `get_society_structure`

### Step 7: Add Write Tools
- [ ] Implement `add_blocks`, `rename_block`, `delete_block`
- [ ] Implement `add_floors`, `delete_floor`
- [ ] Implement `add_units`, `edit_unit`, `delete_unit`
- [ ] **Test**: *"Add a block called E with 3 floors and 4 units per floor"* — full chain execution

### Step 8: Add Resident Management Tools
- [ ] Implement `approve_resident`, `reject_resident`, `revoke_resident`, `reactivate_resident`
- [ ] **Test**: *"Approve all pending residents"* — LLM fetches list, then approves each

### Step 9: Update SSE Streaming
- [ ] Update `chat_service.py` to emit `tool_start` and `tool_result` SSE events
- [ ] Update `ChatRequest` model to accept `society_id`
- [ ] **Test**: Frontend receives tool progress events during agent execution

### Step 10: End-to-End Testing
- [ ] Test multi-tool chains: *"Create block F, add 5 floors, 6 units per floor"*
- [ ] Test error handling: *"Delete Block A"* (when A has floors with occupied units)
- [ ] Test conversation memory: tool results are part of the sliding window
- [ ] Test summarization: tool-heavy conversations trigger summarization correctly

---

## 17. Design Decisions Log (Phase 2)

---

**Decision: Direct MySQL from Python instead of calling Node.js REST APIs**
- AI agent chains 5-10 tools per turn. HTTP proxy latency (~80ms per call) multiplies to unacceptable 400-800ms.
- Direct MySQL queries complete in ~2ms each. 10 tools = 20ms total.
- Trade-off: We must replicate Purvi's validation logic in Python. MySQL schema constraints (FKs, CHECKs, UNIQUEs) are our safety net.
- Node.js backend and AI service are independent — neither requires the other to be running.

---

**Decision: `aiomysql` for async MySQL instead of synchronous `mysql-connector-python`**
- FastAPI is async. A synchronous MySQL driver would block the event loop, degrading concurrent request performance.
- `aiomysql` provides native `async/await` support and connection pooling via `create_pool()`.
- Pool size of 5 is sufficient — the AI service handles at most 1-2 concurrent secretary sessions.

---

**Decision: All tools in one file (`society_setup.py`) for Phase 2A**
- 17 tools all operate on the same domain (society structure + residents).
- Splitting into `blocks.py`, `floors.py`, `units.py`, `residents.py` would scatter related logic.
- When complaints tools arrive (Phase 2B), they go in a separate `complaints.py`.
- A `get_all_tools()` function in the file collects and exports all tools as a flat list.

---

**Decision: `society_id` injected via `RunnableConfig`, not as a tool argument**
- Security: The LLM cannot hallucinate or guess a different society's ID.
- UX: The secretary never has to specify their society — it's auto-resolved from JWT.
- Implementation: `config["configurable"]["society_id"]` is set once in `chat_service.py` and flows to every tool automatically via LangGraph's config propagation.

---

**Decision: `ToolNode` from `langgraph.prebuilt` instead of custom tool execution**
- `ToolNode` handles: argument parsing, async execution, error wrapping, `ToolMessage` creation, `tool_call_id` matching — all automatically.
- No custom code needed for the execution layer.
- If we need custom pre/post-processing (e.g., human-in-the-loop approval), we can wrap `ToolNode` later.

---

**Decision: No human-in-the-loop (HITL) interrupt in Phase 2A**
- HITL adds significant complexity: interrupt state, resume flow, frontend approval UI.
- For Phase 2A, the LLM is instructed via system prompt to verbally confirm destructive actions before executing them (soft HITL).
- Hard HITL with `graph.interrupt()` is deferred to Phase 2C.

---

**Decision: Tool results flow through the `messages` list, not separate state fields**
- LangGraph's native pattern: `AIMessage(tool_calls=[...])` → `ToolMessage(content=..., tool_call_id=...)`.
- The LLM sees tool results as messages in context, can reason about them, and decide next steps.
- No separate `tool_results` or `pending_action` state fields needed.
- Summarization treats tool messages like any other message — they get folded into the rolling summary.

---

**Decision: `get_all_tools()` function returns a flat list for `bind_tools()` and `ToolNode()`**
- Both `llm.bind_tools(tools)` and `ToolNode(tools)` expect the same list.
- A single `get_all_tools()` function ensures consistency — add a tool once, it appears everywhere.
- Pattern:
  ```python
  def get_all_tools():
      return [
          get_society_info, update_society_info, get_society_structure,
          add_blocks, rename_block, delete_block,
          add_floors, delete_floor,
          add_units, edit_unit, delete_unit,
          get_dashboard_stats, get_residents_list,
          approve_resident, reject_resident, revoke_resident, reactivate_resident,
      ]
  ```

---

> **Ready for Implementation!**
> Follow Section 16 step by step. Each step is independently testable.
> Start with Step 1 (MySQL integration) and work forward.
