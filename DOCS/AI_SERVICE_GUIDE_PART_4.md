# Sahayak — AI Service Guide Part 4 (Phase 2C: Announcements Agent Tools)

> **For AI Developer (Shubhranshu)**:
> This guide is the complete, authoritative specification for integrating the
> **Announcements & Digital Notice Board** into the Sahayak AI agent (Phase 2C).
> It covers 7 new agent tools (tools #30–36), all graph integration points, system prompt
> changes, state schema considerations, and comprehensive edge cases.
>
> **Prerequisites**:
> - Phase 2A society setup tools (17 tools) are FULLY implemented.
> - Phase 2B complaints tools (12 tools, #18–29) are specified in [AI_SERVICE_GUIDE_PART_3.md](./AI_SERVICE_GUIDE_PART_3.md).
> - The backend Announcements API is fully specified in [BACKEND_GUIDE_PART_5.md](./BACKEND_GUIDE_PART_5.md).
> - Existing AI infra: multi-key failover (llm_provider.py), Gemini turn sanitizer (sanitizer.py), SSE streaming.

---

## Table of Contents

1. [Phase 2C Context — What Are We Adding?](#1-phase-2c-context--what-are-we-adding)
2. [Announcement Targeting Model Recap (AI Perspective)](#2-announcement-targeting-model-recap-ai-perspective)
3. [Tool Design Principles (Phase 2C)](#3-tool-design-principles-phase-2c)
4. [Complete Tool Catalog — 7 Announcement Tools](#4-complete-tool-catalog--7-announcement-tools)
   - [Tool 30: create_announcement](#tool-30-create_announcement)
   - [Tool 31: list_announcements](#tool-31-list_announcements)
   - [Tool 32: get_announcement_details](#tool-32-get_announcement_details)
   - [Tool 33: delete_announcement](#tool-33-delete_announcement)
   - [Tool 34: delete_expired_announcements](#tool-34-delete_expired_announcements)
   - [Tool 35: get_announcement_read_stats](#tool-35-get_announcement_read_stats)
   - [Tool 36: resolve_targeting_name](#tool-36-resolve_targeting_name)
5. [Tool Quick-Reference Table](#5-tool-quick-reference-table)
6. [Graph Architecture — Phase 2C](#6-graph-architecture--phase-2c)
7. [State Schema — No Changes Required](#7-state-schema--no-changes-required)
8. [File: graph/tools/announcements.py — Complete Implementation](#8-file-graphtoolsannouncementspy--complete-implementation)
9. [Updates to graph/tools/__init__.py](#9-updates-to-graphtools__initpy)
10. [Updated System Prompt — Announcement-Aware Agent Persona](#10-updated-system-prompt--announcement-aware-agent-persona)
11. [Targeting Resolution Helper in the AI Tools Layer](#11-targeting-resolution-helper-in-the-ai-tools-layer)
12. [Natural Language to Tool Mapping — Conversation Examples](#12-natural-language-to-tool-mapping--conversation-examples)
13. [Multi-Tool Chain Scenarios](#13-multi-tool-chain-scenarios)
14. [Edge Cases & Validation Matrix](#14-edge-cases--validation-matrix)
15. [Implementation Order — Step by Step](#15-implementation-order--step-by-step)
16. [File-by-File Change Summary](#16-file-by-file-change-summary)
17. [Design Decisions Log (Phase 2C)](#17-design-decisions-log-phase-2c)

---

## 1. Phase 2C Context — What Are We Adding?

### What the AI agent can do after Phase 2C

The secretary speaks naturally. The AI assistant handles the complexity:

| Secretary Says | AI Does |
|---|---|
| "Post a notice for all residents about the AGM on Saturday." | Calls `create_announcement` with `target_type='all'`, category=`event`, appropriate expiry |
| "Send an urgent water shutdown notice for Block B only — valid till Sunday." | `create_announcement` with `target_type='block'`, resolves block_id, priority=`urgent` |
| "Only tell the owners about the share certificate requirement." | `create_announcement` with `target_type='role'`, `target_role='owner'` |
| "Remind unit A-302 that their parking sticker is expiring." | `create_announcement` with `target_type='unit'`, resolves unit_id |
| "How many people read today's AGM notice?" | `get_announcement_read_stats` on announcement ID |
| "Show me all active announcements." | `list_announcements` with `status='active'` |
| "Delete all expired announcements to clean up the board." | `delete_expired_announcements` |
| "What did we post for Block B last week?" | `list_announcements` filtered by `target_type='block'` |

### Tool Count Summary

| Phase | Module | Tools | Total |
|---|---|---|---|
| 2A | Society Setup | 17 | 17 |
| 2B | Complaints Mgmt | 12 | 29 |
| **2C** | **Announcements** | **7** | **36** |

---

## 2. Announcement Targeting Model Recap (AI Perspective)

The backend supports 6 `target_type` values. The AI tool layer must understand and correctly
resolve names to IDs when the secretary uses natural language names.

| `target_type` | `target_id` needed? | `target_role` needed? | AI Resolution Needed |
|---|---|---|---|
| `all` | No (NULL) | No | None — simplest case |
| `block` | Yes — `blocks.id` | No | Resolve block name → ID from DB |
| `floor` | Yes — `floors.id` | No | Resolve "Block A Floor 2" → floor_id from DB |
| `unit` | Yes — `units.id` | No | Resolve "A-302" unit label → unit_id from DB |
| `user` | Yes — `users.id` | No | Resolve resident name → user_id from DB |
| `role` | No (NULL) | Yes — `owner`/`tenant` | Just pass the string |

**Key insight for tool design**: The secretary will say *"Block B"*, *"Floor 2 of Block A"*,
*"unit A-302"*, or *"Priya Sharma"* — not a database ID. The `resolve_targeting_name` helper
tool is the AI-accessible lookup to convert human names to IDs. However, the `create_announcement`
tool itself ALSO does this resolution internally — the LLM should always pass human-readable names
and let the tool resolve them.

---

## 3. Tool Design Principles (Phase 2C)

These build on the same principles from Phase 2A and 2B:

### 3.1 Same Consistent Return Structure

All tools return:
```python
# Success
{"success": True, "data": {...}}

# Error
{"success": False, "error": "Human-readable error message."}
```

### 3.2 Society Isolation is Mandatory
Every tool extracts `society_id` from `RunnableConfig.configurable`. The LLM CANNOT pass a
`society_id` parameter — it comes only from the verified JWT session context.

### 3.3 Name Resolution Built Into create_announcement
The `create_announcement` tool accepts human-readable names (block name, unit label like "A-302",
resident name) rather than IDs. The tool internally resolves names to IDs. This prevents the LLM
from hallucinating IDs and makes the conversation flow natural.

### 3.4 Immutability is Enforced at the AI Layer Too
There is no `edit_announcement` or `update_announcement` tool. If the secretary asks to edit an
announcement, the AI should explain: "Announcements are immutable once posted. Please delete the
old one and create a new one with the correction."

### 3.5 Expiry Date Handling
If the secretary says "valid till Sunday" or "expires in 3 days", the LLM should compute the
`expires_at` ISO datetime string using the `today` date from the system prompt. The tool validates
that `expires_at` is strictly in the future.

---

## 4. Complete Tool Catalog — 7 Announcement Tools

### File: `graph/tools/announcements.py`

---

### Tool 30: `create_announcement`

**Purpose**: Draft and publish a new announcement targeted at one of 6 audience scopes.
This is the most important announcement tool — the secretary's primary action.

**When LLM Uses It**: Any time the secretary wants to post, publish, send, or notify residents
about something. The LLM detects the audience scope from natural language.

**Tool Definition**:

```python
@tool
async def create_announcement(
    title: str,
    content: str,
    category: str,
    expires_at: str,
    target_type: str,
    config: RunnableConfig,
    priority: str = "normal",
    target_name: Optional[str] = None,
    target_role: Optional[str] = None,
) -> Dict[str, Any]:
    """Post a new announcement to one or more targeted residents.

    Parameters:
      title: Short headline (5-200 characters). Example: 'Water Shutdown — Block B'
      content: Full announcement body (10-5000 characters).
      category: One of 'general', 'maintenance', 'security', 'event', 'emergency', 'financial'.
      expires_at: ISO 8601 datetime string when this notice should expire. MUST be in the future.
                  Example: '2024-11-15T23:59:59'. Use the current date from context to compute this.
      target_type: Audience scope. Must be exactly one of:
                   'all' - every active resident in the society
                   'block' - all residents in a specific block (provide target_name = block name)
                   'floor' - all residents on a specific floor (provide target_name = 'Block A Floor 2')
                   'unit' - residents in a specific unit (provide target_name = 'A-302')
                   'user' - a single specific resident (provide target_name = resident full name)
                   'role' - all residents with a specific occupancy role (provide target_role = 'owner' or 'tenant')
      priority: 'low', 'normal' (default), or 'urgent'. Use 'urgent' for emergency notices.
      target_name: Human-readable name to resolve to a target_id.
                   For 'block': block name (e.g. 'B', 'Block B', 'A')
                   For 'floor': 'Block A Floor 2' or 'A-2'
                   For 'unit': unit label (e.g. 'A-302', 'B-101')
                   For 'user': resident's full name (e.g. 'Priya Sharma')
                   For 'all' and 'role': leave as None.
      target_role: Only for target_type='role'. Must be 'owner' or 'tenant'. Leave None for all other types.
    """
```

**Full Implementation**:

```python
@tool
async def create_announcement(
    title: str,
    content: str,
    category: str,
    expires_at: str,
    target_type: str,
    config: RunnableConfig,
    priority: str = "normal",
    target_name: Optional[str] = None,
    target_role: Optional[str] = None,
) -> Dict[str, Any]:
    """Post a new announcement... (docstring as above)"""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    VALID_CATEGORIES = ["general", "maintenance", "security", "event", "emergency", "financial"]
    VALID_PRIORITIES = ["low", "normal", "urgent"]
    VALID_TARGET_TYPES = ["all", "block", "floor", "unit", "user", "role"]

    if not title or len(title.strip()) < 5 or len(title.strip()) > 200:
        return {"success": False, "error": "Title must be between 5 and 200 characters."}
    if not content or len(content.strip()) < 10 or len(content.strip()) > 5000:
        return {"success": False, "error": "Content must be between 10 and 5000 characters."}
    if category not in VALID_CATEGORIES:
        return {"success": False, "error": f"Invalid category '{category}'. Must be one of: {', '.join(VALID_CATEGORIES)}."}
    if priority not in VALID_PRIORITIES:
        return {"success": False, "error": f"Invalid priority '{priority}'. Must be one of: {', '.join(VALID_PRIORITIES)}."}
    if target_type not in VALID_TARGET_TYPES:
        return {"success": False, "error": f"Invalid target_type '{target_type}'. Must be one of: {', '.join(VALID_TARGET_TYPES)}."}

    try:
        from datetime import datetime, timezone
        expiry_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if expiry_dt.tzinfo is None:
            expiry_dt = expiry_dt.replace(tzinfo=timezone.utc)
        if expiry_dt <= datetime.now(timezone.utc):
            return {"success": False, "error": "expires_at must be a future datetime. Please provide a date after today."}
    except ValueError:
        return {"success": False, "error": f"Invalid expires_at format: '{expires_at}'. Use ISO 8601 format like '2024-11-15T23:59:59'."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                target_id = None
                target_label = None

                if target_type == "all":
                    target_label = "All Residents"

                elif target_type == "role":
                    if not target_role or target_role not in ["owner", "tenant"]:
                        return {"success": False, "error": "target_role must be 'owner' or 'tenant' when target_type is 'role'."}
                    target_label = f"All {target_role.capitalize()}s"

                elif target_type == "block":
                    if not target_name:
                        return {"success": False, "error": "target_name (block name) is required when target_type is 'block'."}
                    # Normalize: strip "Block " prefix for DB lookup
                    block_search = target_name.strip().upper().replace("BLOCK ", "").replace("BLOCK", "").strip()
                    await cur.execute(
                        "SELECT id, name FROM blocks WHERE society_id = %s AND (UPPER(name) = %s OR UPPER(name) = %s)",
                        (society_id, target_name.strip().upper(), block_search),
                    )
                    row = await cur.fetchone()
                    if not row:
                        # Try partial match
                        await cur.execute(
                            "SELECT id, name FROM blocks WHERE society_id = %s AND UPPER(name) LIKE %s LIMIT 1",
                            (society_id, f"%{block_search}%"),
                        )
                        row = await cur.fetchone()
                    if not row:
                        return {"success": False, "error": f"Block '{target_name}' not found in this society. Use get_society_structure to check block names."}
                    target_id = row["id"]
                    target_label = f"Block {row['name']}"

                elif target_type == "floor":
                    if not target_name:
                        return {"success": False, "error": "target_name is required for floor targeting. Example: 'Block A Floor 2' or 'A-2'."}
                    # Parse formats like "Block A Floor 2", "A Floor 2", "A-2"
                    resolved = await _resolve_floor_name(cur, society_id, target_name)
                    if not resolved:
                        return {"success": False, "error": f"Could not resolve floor '{target_name}'. Try 'Block A Floor 2' or 'A-2'."}
                    target_id = resolved["floor_id"]
                    target_label = resolved["label"]

                elif target_type == "unit":
                    if not target_name:
                        return {"success": False, "error": "target_name (unit label e.g. 'A-302') is required when target_type is 'unit'."}
                    resolved = await _resolve_unit_label(cur, society_id, target_name)
                    if not resolved:
                        return {"success": False, "error": f"Unit '{target_name}' not found. Use the format 'A-302' (block-unit_number)."}
                    target_id = resolved["unit_id"]
                    target_label = resolved["label"]

                elif target_type == "user":
                    if not target_name:
                        return {"success": False, "error": "target_name (resident full name) is required when target_type is 'user'."}
                    await cur.execute(
                        """SELECT u.id, u.name, CONCAT(b.name, '-', un.unit_number) AS unit_label
                           FROM users u
                           LEFT JOIN units un ON un.id = u.unit_id
                           LEFT JOIN floors fl ON fl.id = un.floor_id
                           LEFT JOIN blocks b ON b.id = fl.block_id
                           WHERE u.society_id = %s AND u.role = 'resident' AND u.status = 'active'
                           AND UPPER(u.name) LIKE %s""",
                        (society_id, f"%{target_name.strip().upper()}%"),
                    )
                    rows = await cur.fetchall()
                    if not rows:
                        return {"success": False, "error": f"No active resident named '{target_name}' found. Check the name spelling."}
                    if len(rows) > 1:
                        matches = [f"{r['name']} ({r['unit_label']})" for r in rows]
                        return {"success": False, "error": f"Multiple residents match '{target_name}': {', '.join(matches)}. Please be more specific."}
                    target_id = rows[0]["id"]
                    target_label = f"{rows[0]['name']} (Personal)"

                # Insert announcement
                await cur.execute(
                    """INSERT INTO announcements
                       (society_id, created_by, title, content, category, priority, target_type, target_id, target_role, expires_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        society_id,
                        _extract_secretary_id(config),
                        title.strip(),
                        content.strip(),
                        category,
                        priority,
                        target_type,
                        target_id,
                        target_role if target_type == "role" else None,
                        expiry_dt,
                    ),
                )
                await conn.commit()
                new_id = cur.lastrowid

        return {
            "success": True,
            "data": {
                "id": new_id,
                "title": title.strip(),
                "category": category,
                "priority": priority,
                "target_type": target_type,
                "target_id": target_id,
                "target_label": target_label,
                "expires_at": expires_at,
                "message": f"Announcement posted successfully to {target_label}. ID: #{new_id}",
            },
        }
    except Exception as e:
        logger.error("Error in create_announcement: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error while creating announcement: {str(e)}"}
```

---

### Tool 31: `list_announcements`

**Purpose**: Fetch all announcements for the society with flexible filters. Secretary's dashboard view.

**When LLM Uses It**: *"Show active notices"*, *"List all expired announcements"*, *"Show maintenance notices"*, *"What did we post for Block B?"*

```python
@tool
async def list_announcements(
    config: RunnableConfig,
    status: str = "active",
    category: Optional[str] = None,
    priority: Optional[str] = None,
    target_type: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> Dict[str, Any]:
    """List society announcements with optional filters.

    Parameters:
      status: 'active' (default, expires_at > NOW), 'expired' (expires_at <= NOW), or 'all'.
      category: Optional filter — 'general', 'maintenance', 'security', 'event', 'emergency', 'financial'.
      priority: Optional filter — 'low', 'normal', 'urgent'.
      target_type: Optional filter — 'all', 'block', 'floor', 'unit', 'user', 'role'.
      page: Page number for pagination (default: 1).
      limit: Results per page (default: 20, max: 50).
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                conditions = ["a.society_id = %s", "a.is_deleted = FALSE"]
                params = [society_id]

                if status == "active":
                    conditions.append("a.expires_at > NOW()")
                elif status == "expired":
                    conditions.append("a.expires_at <= NOW()")

                VALID_CATEGORIES = ["general", "maintenance", "security", "event", "emergency", "financial"]
                VALID_TARGET_TYPES = ["all", "block", "floor", "unit", "user", "role"]

                if category and category in VALID_CATEGORIES:
                    conditions.append("a.category = %s")
                    params.append(category)
                if priority and priority in ["low", "normal", "urgent"]:
                    conditions.append("a.priority = %s")
                    params.append(priority)
                if target_type and target_type in VALID_TARGET_TYPES:
                    conditions.append("a.target_type = %s")
                    params.append(target_type)

                limit = min(50, max(1, limit))
                offset = (max(1, page) - 1) * limit
                where = " AND ".join(conditions)

                await cur.execute(
                    f"""SELECT a.id, a.title, a.category, a.priority, a.target_type,
                               a.target_id, a.target_role, a.expires_at, a.created_at,
                               (a.expires_at > NOW()) AS is_active,
                               (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count
                        FROM announcements a
                        WHERE {where}
                        ORDER BY a.created_at DESC
                        LIMIT %s OFFSET %s""",
                    params + [limit, offset],
                )
                rows = await cur.fetchall()

                # Summary counts
                await cur.execute(
                    """SELECT
                         SUM(expires_at > NOW() AND is_deleted = FALSE) AS total_active,
                         SUM(expires_at <= NOW() AND is_deleted = FALSE) AS total_expired
                       FROM announcements WHERE society_id = %s""",
                    (society_id,),
                )
                counts = await cur.fetchone()

                return {
                    "success": True,
                    "data": {
                        "summary": {
                            "total_active": int(counts["total_active"] or 0),
                            "total_expired": int(counts["total_expired"] or 0),
                        },
                        "announcements": [
                            {
                                "id": r["id"],
                                "title": r["title"],
                                "category": r["category"],
                                "priority": r["priority"],
                                "target_type": r["target_type"],
                                "target_role": r["target_role"],
                                "expires_at": str(r["expires_at"]),
                                "is_active": bool(r["is_active"]),
                                "read_count": int(r["read_count"]),
                                "created_at": str(r["created_at"]),
                            }
                            for r in rows
                        ],
                        "pagination": {
                            "page": page,
                            "limit": limit,
                            "returned": len(rows),
                        },
                    },
                }
    except Exception as e:
        logger.error("Error in list_announcements: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}
```

---

### Tool 32: `get_announcement_details`

**Purpose**: Fetch full details of a single announcement including its complete read receipt
statistics — total targeted, how many read, percentage, and list of readers.

**When LLM Uses It**: *"How many people read announcement #42?"*, *"Show me the details of the AGM notice"*, *"Who has read the water shutdown notice?"*

```python
@tool
async def get_announcement_details(
    announcement_id: int,
    config: RunnableConfig,
) -> Dict[str, Any]:
    """Get full details of a specific announcement including read receipt statistics.

    Parameters:
      announcement_id: The numeric ID of the announcement (from list_announcements results).
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """SELECT a.*, (a.expires_at > NOW()) AS is_active
                       FROM announcements a
                       WHERE a.id = %s AND a.society_id = %s AND a.is_deleted = FALSE""",
                    (announcement_id, society_id),
                )
                ann = await cur.fetchone()
                if not ann:
                    return {"success": False, "error": f"Announcement #{announcement_id} not found or belongs to a different society."}

                # Compute total_targeted
                total_targeted = 0
                if ann["target_type"] == "all":
                    await cur.execute(
                        "SELECT COUNT(*) AS c FROM users WHERE society_id = %s AND role = 'resident' AND status = 'active'",
                        (society_id,),
                    )
                    total_targeted = (await cur.fetchone())["c"]
                elif ann["target_type"] == "block":
                    await cur.execute(
                        """SELECT COUNT(DISTINCT u.id) AS c FROM users u
                           JOIN units un ON un.id = u.unit_id
                           JOIN floors fl ON fl.id = un.floor_id
                           WHERE fl.block_id = %s AND u.society_id = %s AND u.role = 'resident' AND u.status = 'active'""",
                        (ann["target_id"], society_id),
                    )
                    total_targeted = (await cur.fetchone())["c"]
                elif ann["target_type"] == "floor":
                    await cur.execute(
                        """SELECT COUNT(DISTINCT u.id) AS c FROM users u
                           JOIN units un ON un.id = u.unit_id
                           WHERE un.floor_id = %s AND u.society_id = %s AND u.role = 'resident' AND u.status = 'active'""",
                        (ann["target_id"], society_id),
                    )
                    total_targeted = (await cur.fetchone())["c"]
                elif ann["target_type"] == "unit":
                    await cur.execute(
                        "SELECT COUNT(*) AS c FROM users WHERE unit_id = %s AND society_id = %s AND role = 'resident' AND status = 'active'",
                        (ann["target_id"], society_id),
                    )
                    total_targeted = (await cur.fetchone())["c"]
                elif ann["target_type"] == "user":
                    total_targeted = 1
                elif ann["target_type"] == "role":
                    await cur.execute(
                        """SELECT COUNT(*) AS c FROM users u
                           JOIN units un ON un.id = u.unit_id
                           WHERE u.society_id = %s AND u.role = 'resident' AND u.status = 'active' AND un.occupant_type = %s""",
                        (society_id, ann["target_role"]),
                    )
                    total_targeted = (await cur.fetchone())["c"]

                await cur.execute(
                    "SELECT COUNT(*) AS rc FROM announcement_reads WHERE announcement_id = %s",
                    (announcement_id,),
                )
                read_count = (await cur.fetchone())["rc"]

                await cur.execute(
                    """SELECT ar.resident_id, u.name AS resident_name,
                              CONCAT(b.name, '-', un.unit_number) AS unit_label, ar.read_at
                       FROM announcement_reads ar
                       JOIN users u ON u.id = ar.resident_id
                       LEFT JOIN units un ON un.id = u.unit_id
                       LEFT JOIN floors fl ON fl.id = un.floor_id
                       LEFT JOIN blocks b ON b.id = fl.block_id
                       WHERE ar.announcement_id = %s ORDER BY ar.read_at DESC""",
                    (announcement_id,),
                )
                readers = await cur.fetchall()

                read_pct = round((read_count / total_targeted * 100), 2) if total_targeted > 0 else 0.0

                return {
                    "success": True,
                    "data": {
                        "id": ann["id"],
                        "title": ann["title"],
                        "content": ann["content"],
                        "category": ann["category"],
                        "priority": ann["priority"],
                        "target_type": ann["target_type"],
                        "target_role": ann["target_role"],
                        "expires_at": str(ann["expires_at"]),
                        "is_active": bool(ann["is_active"]),
                        "created_at": str(ann["created_at"]),
                        "read_stats": {
                            "total_targeted": int(total_targeted),
                            "read_count": int(read_count),
                            "unread_count": max(0, int(total_targeted) - int(read_count)),
                            "read_percentage": read_pct,
                        },
                        "readers": [
                            {
                                "resident_name": r["resident_name"],
                                "unit_label": r["unit_label"],
                                "read_at": str(r["read_at"]),
                            }
                            for r in readers
                        ],
                    },
                }
    except Exception as e:
        logger.error("Error in get_announcement_details: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}
```

---

### Tool 33: `delete_announcement`

**Purpose**: Soft-delete a single announcement (active or expired). Disappears from all feeds.

**When LLM Uses It**: *"Delete announcement #42"*, *"Remove the AGM notice"*, *"Take down the water shutdown notice"*

```python
@tool
async def delete_announcement(
    announcement_id: int,
    config: RunnableConfig,
) -> Dict[str, Any]:
    """Soft-delete a specific announcement. It disappears from all resident feeds and the secretary dashboard.
    The data is retained for audit but is no longer visible anywhere.

    Parameters:
      announcement_id: The numeric ID of the announcement to delete.
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, title FROM announcements WHERE id = %s AND society_id = %s AND is_deleted = FALSE",
                    (announcement_id, society_id),
                )
                ann = await cur.fetchone()
                if not ann:
                    return {"success": False, "error": f"Announcement #{announcement_id} not found or already deleted."}

                await cur.execute(
                    "UPDATE announcements SET is_deleted = TRUE, deleted_at = NOW() WHERE id = %s",
                    (announcement_id,),
                )
                await conn.commit()

        return {
            "success": True,
            "data": {
                "id": announcement_id,
                "title": ann["title"],
                "message": f"Announcement #{announcement_id} ('{ann['title']}') has been deleted successfully.",
            },
        }
    except Exception as e:
        logger.error("Error in delete_announcement: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}
```

---

### Tool 34: `delete_expired_announcements`

**Purpose**: Bulk soft-delete all expired announcements in one operation — the "clean up the board" tool.

**When LLM Uses It**: *"Delete all expired notices"*, *"Clean up the announcement board"*, *"Remove all old notices"*

```python
@tool
async def delete_expired_announcements(config: RunnableConfig) -> Dict[str, Any]:
    """Bulk soft-delete all expired announcements for this society in a single operation.
    This is a cleanup tool — it removes all announcements where the expiry date has passed.
    Returns the count of announcements that were deleted.
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """UPDATE announcements
                       SET is_deleted = TRUE, deleted_at = NOW()
                       WHERE society_id = %s AND is_deleted = FALSE AND expires_at <= NOW()""",
                    (society_id,),
                )
                deleted_count = cur.rowcount
                await conn.commit()

        if deleted_count == 0:
            return {
                "success": True,
                "data": {"deleted_count": 0, "message": "No expired announcements found to delete. The board is already clean."},
            }

        return {
            "success": True,
            "data": {
                "deleted_count": deleted_count,
                "message": f"Successfully deleted {deleted_count} expired announcement{'s' if deleted_count != 1 else ''}.",
            },
        }
    except Exception as e:
        logger.error("Error in delete_expired_announcements: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}
```

---

### Tool 35: `get_announcement_read_stats`

**Purpose**: Quick read receipt summary for a specific announcement — a lightweight alternative
to `get_announcement_details` when the secretary only wants the engagement numbers.

**When LLM Uses It**: *"How many people read the AGM notice?"*, *"What's the read rate for #42?"*

```python
@tool
async def get_announcement_read_stats(
    announcement_id: int,
    config: RunnableConfig,
) -> Dict[str, Any]:
    """Get read receipt statistics for a specific announcement:
    total targeted audience size, how many have read it, percentage, and unread count.
    Use this for a quick engagement check without fetching full announcement details.

    Parameters:
      announcement_id: The numeric ID of the announcement.
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, title, target_type, target_id, target_role FROM announcements WHERE id = %s AND society_id = %s AND is_deleted = FALSE",
                    (announcement_id, society_id),
                )
                ann = await cur.fetchone()
                if not ann:
                    return {"success": False, "error": f"Announcement #{announcement_id} not found."}

                await cur.execute(
                    "SELECT COUNT(*) AS rc FROM announcement_reads WHERE announcement_id = %s",
                    (announcement_id,),
                )
                read_count = (await cur.fetchone())["rc"]

                # Quick total_targeted calculation
                total_targeted = await _count_targeted_residents(cur, society_id, ann)
                read_pct = round((read_count / total_targeted * 100), 2) if total_targeted > 0 else 0.0

                return {
                    "success": True,
                    "data": {
                        "announcement_id": announcement_id,
                        "title": ann["title"],
                        "total_targeted": int(total_targeted),
                        "read_count": int(read_count),
                        "unread_count": max(0, int(total_targeted) - int(read_count)),
                        "read_percentage": read_pct,
                    },
                }
    except Exception as e:
        logger.error("Error in get_announcement_read_stats: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}
```

---

### Tool 36: `resolve_targeting_name`

**Purpose**: Helper lookup tool that the LLM can call when it needs to know the blocks, floors,
units, or resident names before creating an announcement. Helps the secretary confirm they're
targeting the right audience.

**When LLM Uses It**: *"What blocks do we have?"* (before creating an announcement), *"Is there a unit A-405?"*, *"What's the ID for Priya Sharma?"*

This tool is also implicitly used by `create_announcement` internally, but exposing it directly
allows the LLM to do a lookup-then-confirm flow for complex targeting scenarios.

```python
@tool
async def resolve_targeting_name(
    lookup_type: str,
    name: str,
    config: RunnableConfig,
) -> Dict[str, Any]:
    """Resolve a human-readable name to a database ID for announcement targeting.
    Use this to look up blocks, floors, units, or residents before creating an announcement.

    Parameters:
      lookup_type: What to look up — 'block', 'floor', 'unit', or 'resident'.
      name: The name or label to resolve.
            For 'block': block name (e.g. 'A', 'Block B').
            For 'floor': 'Block A Floor 2' or 'A-2'.
            For 'unit': unit label (e.g. 'A-302').
            For 'resident': resident full name or partial name.
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    if lookup_type not in ["block", "floor", "unit", "resident"]:
        return {"success": False, "error": "lookup_type must be 'block', 'floor', 'unit', or 'resident'."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                if lookup_type == "block":
                    search = name.strip().upper().replace("BLOCK ", "").strip()
                    await cur.execute(
                        "SELECT id, name FROM blocks WHERE society_id = %s AND (UPPER(name) = %s OR UPPER(name) LIKE %s)",
                        (society_id, search, f"%{search}%"),
                    )
                    rows = await cur.fetchall()
                    if not rows:
                        await cur.execute("SELECT id, name FROM blocks WHERE society_id = %s", (society_id,))
                        all_blocks = await cur.fetchall()
                        return {"success": False, "error": f"Block '{name}' not found.", "available_blocks": [r["name"] for r in all_blocks]}
                    return {"success": True, "data": {"results": [{"id": r["id"], "name": r["name"]} for r in rows]}}

                elif lookup_type == "unit":
                    await cur.execute(
                        """SELECT u.id, CONCAT(b.name, '-', u.unit_number) AS unit_label
                           FROM units u JOIN floors fl ON fl.id = u.floor_id JOIN blocks b ON b.id = fl.block_id
                           WHERE b.society_id = %s AND CONCAT(UPPER(b.name), '-', UPPER(u.unit_number)) = %s""",
                        (society_id, name.strip().upper()),
                    )
                    row = await cur.fetchone()
                    if not row:
                        return {"success": False, "error": f"Unit '{name}' not found. Use format 'A-302'."}
                    return {"success": True, "data": {"unit_id": row["id"], "unit_label": row["unit_label"]}}

                elif lookup_type == "resident":
                    await cur.execute(
                        """SELECT u.id, u.name, CONCAT(b.name, '-', un.unit_number) AS unit_label
                           FROM users u
                           LEFT JOIN units un ON un.id = u.unit_id
                           LEFT JOIN floors fl ON fl.id = un.floor_id
                           LEFT JOIN blocks b ON b.id = fl.block_id
                           WHERE u.society_id = %s AND u.role = 'resident' AND u.status = 'active'
                           AND UPPER(u.name) LIKE %s""",
                        (society_id, f"%{name.strip().upper()}%"),
                    )
                    rows = await cur.fetchall()
                    if not rows:
                        return {"success": False, "error": f"No active resident matching '{name}'."}
                    return {"success": True, "data": {"results": [{"id": r["id"], "name": r["name"], "unit": r["unit_label"]} for r in rows]}}

        return {"success": False, "error": "Lookup not completed."}
    except Exception as e:
        logger.error("Error in resolve_targeting_name: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}
```

---

## 5. Tool Quick-Reference Table

| # | Tool Name | Purpose | Key Parameters |
|---|---|---|---|
| 30 | `create_announcement` | Post a new announcement to targeted audience | `title`, `content`, `category`, `expires_at`, `target_type`, `priority`, `target_name`, `target_role` |
| 31 | `list_announcements` | List all society announcements with filters | `status`, `category`, `priority`, `target_type`, `page`, `limit` |
| 32 | `get_announcement_details` | Full details + reader list + read stats | `announcement_id` |
| 33 | `delete_announcement` | Soft-delete a single announcement | `announcement_id` |
| 34 | `delete_expired_announcements` | Bulk delete all expired announcements | (none — auto-selects based on expiry) |
| 35 | `get_announcement_read_stats` | Quick read receipt stats for one announcement | `announcement_id` |
| 36 | `resolve_targeting_name` | Lookup helper: name → ID for blocks/units/residents | `lookup_type`, `name` |

---

## 6. Graph Architecture — Phase 2C

### 6.1 Graph Topology — UNCHANGED

The core LangGraph graph topology does **NOT** change in Phase 2C. The existing 3-node architecture
handles announcement tools automatically:

```
START
  |
  v (route_start)
  ├── [if messages > 30] --> summarize_node --> call_model
  └── [otherwise]        --> call_model
                               |
                               v (route_after_model)
                               ├── [if tool_calls present] --> tool_executor (ToolNode)
                               |                                    |
                               |                                    v (loop back)
                               |                             call_model
                               └── [no tool_calls] --> END
```

### 6.2 Why No Graph Node Changes Are Required

The `tool_executor` (LangGraph `ToolNode`) is **dynamically loaded** via `get_all_tools()`.
When `announcements.py` is added and imported in `__init__.py`, the ToolNode automatically
discovers and registers all 7 new announcement tools without any graph wiring changes.

The `call_model` node calls `provider.bind_tools(get_all_tools())` on every invocation.
Adding announcement tools to `get_all_tools()` immediately makes them available to the LLM.

This is the key design strength: **zero graph changes, zero router changes, zero node changes**.
Only 3 files need to be modified/created:
1. CREATE `app/graph/tools/announcements.py` (new file)
2. MODIFY `app/graph/tools/__init__.py` (2 lines)
3. MODIFY `app/prompts/system.py` (add announcement tool catalog and behavioral rules)

### 6.3 Graph Flow for Announcement Scenarios

**Simple creation scenario** (1 tool call, 1 loop):
```
User: "Post AGM notice for all residents, expires Saturday."
  |
  v call_model
  AI -> tool_call: create_announcement(title="...", target_type="all", expires_at="2024-11-09T23:59:59")
  |
  v tool_executor (runs create_announcement)
  Returns: {"success": True, "data": {"id": 43, ...}}
  |
  v call_model (LLM formats final response)
  AI -> "Done! AGM notice has been posted to all 87 residents. Expires Saturday. Announcement ID: #43."
  |
  v END
```

**Multi-tool resolution + creation scenario** (2 tool calls, 2 loops):
```
User: "Tell Block B about water shutdown tomorrow 10 AM to 2 PM."
  |
  v call_model
  AI -> tool_call: create_announcement(title="Water Supply Interruption",
                                       content="...", target_type="block",
                                       target_name="B", expires_at="<tomorrow>",
                                       category="maintenance", priority="urgent")
  |
  v tool_executor (runs create_announcement which internally resolves "B" -> block_id=3)
  Returns: {"success": True, "data": {"id": 44, "target_label": "Block B"}}
  |
  v call_model (final response)
  AI -> "Urgent maintenance notice posted for Block B. 45 residents will see it. ID: #44."
  |
  v END
```

**Ambiguous resident name scenario** (1 tool call, error, 1 more tool call, 2 loops):
```
User: "Send a personal reminder to Priya about parking sticker."
  |
  v call_model
  AI -> tool_call: create_announcement(..., target_type="user", target_name="Priya")
  |
  v tool_executor
  Returns: {"success": False, "error": "Multiple residents match 'Priya': Priya Sharma (A-201), Priya Verma (B-305)."}
  |
  v call_model
  AI -> "I found two residents named Priya: Priya Sharma (A-201) and Priya Verma (B-305). Which one should I send this to?"
  |
  v END (waits for user clarification)
```

---

## 7. State Schema — No Changes Required

The current `AgentState` definition in `graph/state.py` requires **zero changes** for Phase 2C:

```python
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    summary: str
```

**Why no state changes?**

All announcement data flows through the standard tool call / tool result message pattern:
- Secretary's request → `HumanMessage`
- LLM's tool call → `AIMessage(tool_calls=[...])`
- Tool result → `ToolMessage(content="{...}")`
- LLM's final answer → `AIMessage(content="...")`

The `messages` list in `AgentState` carries all this context. No additional state fields
(like a `pending_action` for confirmation flows) are needed because announcement creation
is non-destructive and doesn't require a two-step confirmation workflow.

**Future consideration** (post-exams): If you want to implement an "AI drafts, secretary reviews
and approves before posting" flow, you would add a `pending_announcement` field to `AgentState`
with a LangGraph interrupt. That's Phase 3 territory — not needed now.

---

## 8. File: `graph/tools/announcements.py` — Complete Implementation

Create `ai-service/app/graph/tools/announcements.py`:

```python
"""
Sahayak AI Assistant — Announcements & Notice Board Tools (Phase 2C)

This module implements 7 agent tools for managing the society announcement system.
All tools enforce society isolation via society_id from RunnableConfig.

Tools:
  30. create_announcement        — Post targeted notices to residents
  31. list_announcements         — List with filters (status, category, priority, target_type)
  32. get_announcement_details   — Full details + read receipt breakdown
  33. delete_announcement        — Soft-delete a single announcement
  34. delete_expired_announcements — Bulk cleanup of all expired notices
  35. get_announcement_read_stats — Quick engagement metrics
  36. resolve_targeting_name     — Name-to-ID resolution helper (block/unit/resident)
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from app.database.mysql import get_mysql_pool

logger = logging.getLogger(__name__)


def _extract_society_id(config: Optional[RunnableConfig]) -> Optional[int]:
    """Helper to extract society_id from LangGraph RunnableConfig."""
    if not config:
        return None
    configurable = config.get("configurable", {})
    sid = configurable.get("society_id")
    if sid is not None:
        try:
            return int(sid)
        except (ValueError, TypeError):
            return None
    return None


def _extract_secretary_id(config: Optional[RunnableConfig]) -> Optional[int]:
    """Helper to extract the logged-in secretary's user_id from RunnableConfig."""
    if not config:
        return None
    configurable = config.get("configurable", {})
    uid = configurable.get("user_id")
    if uid is not None:
        try:
            return int(uid)
        except (ValueError, TypeError):
            return None
    return None


async def _resolve_floor_name(cur, society_id: int, name: str) -> Optional[Dict]:
    """
    Resolve a floor name like 'Block A Floor 2' or 'A-2' to a floor_id.
    Returns dict with floor_id and label, or None if not found.
    """
    import re
    name = name.strip().upper()

    # Try pattern "A-2" (block_name-floor_number)
    match = re.match(r'^([A-Z]+)-(\d+)$', name)
    if match:
        block_name, floor_num = match.group(1), int(match.group(2))
        await cur.execute(
            """SELECT f.id, f.floor_number, b.name AS block_name
               FROM floors f JOIN blocks b ON b.id = f.block_id
               WHERE b.society_id = %s AND UPPER(b.name) = %s AND f.floor_number = %s""",
            (society_id, block_name, floor_num),
        )
        row = await cur.fetchone()
        if row:
            return {"floor_id": row["id"], "label": f"Block {row['block_name']} Floor {row['floor_number']}"}

    # Try "Block A Floor 2" or "A Floor 2"
    match2 = re.search(r'(?:BLOCK\s+)?([A-Z]+)\s+FLOOR\s+(\d+)', name)
    if match2:
        block_name, floor_num = match2.group(1), int(match2.group(2))
        await cur.execute(
            """SELECT f.id, f.floor_number, b.name AS block_name
               FROM floors f JOIN blocks b ON b.id = f.block_id
               WHERE b.society_id = %s AND UPPER(b.name) = %s AND f.floor_number = %s""",
            (society_id, block_name, floor_num),
        )
        row = await cur.fetchone()
        if row:
            return {"floor_id": row["id"], "label": f"Block {row['block_name']} Floor {row['floor_number']}"}

    return None


async def _resolve_unit_label(cur, society_id: int, label: str) -> Optional[Dict]:
    """
    Resolve a unit label like 'A-302' to a unit_id.
    """
    label = label.strip().upper()
    parts = label.split("-")
    if len(parts) < 2:
        return None
    block_name = parts[0]
    unit_number = "-".join(parts[1:])  # Handle multi-segment like A-3-02

    await cur.execute(
        """SELECT u.id, CONCAT(b.name, '-', u.unit_number) AS unit_label
           FROM units u JOIN floors fl ON fl.id = u.floor_id JOIN blocks b ON b.id = fl.block_id
           WHERE b.society_id = %s AND UPPER(b.name) = %s AND UPPER(u.unit_number) = %s""",
        (society_id, block_name, unit_number),
    )
    row = await cur.fetchone()
    if row:
        return {"unit_id": row["id"], "label": row["unit_label"]}
    return None


async def _count_targeted_residents(cur, society_id: int, ann: Dict) -> int:
    """Count how many active residents are targeted by a given announcement."""
    target_type = ann["target_type"]
    if target_type == "all":
        await cur.execute(
            "SELECT COUNT(*) AS c FROM users WHERE society_id = %s AND role = 'resident' AND status = 'active'",
            (society_id,),
        )
    elif target_type == "block":
        await cur.execute(
            """SELECT COUNT(DISTINCT u.id) AS c FROM users u
               JOIN units un ON un.id = u.unit_id JOIN floors fl ON fl.id = un.floor_id
               WHERE fl.block_id = %s AND u.society_id = %s AND u.role = 'resident' AND u.status = 'active'""",
            (ann["target_id"], society_id),
        )
    elif target_type == "floor":
        await cur.execute(
            """SELECT COUNT(DISTINCT u.id) AS c FROM users u JOIN units un ON un.id = u.unit_id
               WHERE un.floor_id = %s AND u.society_id = %s AND u.role = 'resident' AND u.status = 'active'""",
            (ann["target_id"], society_id),
        )
    elif target_type == "unit":
        await cur.execute(
            "SELECT COUNT(*) AS c FROM users WHERE unit_id = %s AND society_id = %s AND role = 'resident' AND status = 'active'",
            (ann["target_id"], society_id),
        )
    elif target_type == "user":
        return 1
    elif target_type == "role":
        await cur.execute(
            """SELECT COUNT(*) AS c FROM users u JOIN units un ON un.id = u.unit_id
               WHERE u.society_id = %s AND u.role = 'resident' AND u.status = 'active' AND un.occupant_type = %s""",
            (society_id, ann["target_role"]),
        )
    else:
        return 0
    return (await cur.fetchone())["c"]


@tool
async def create_announcement(
    title: str,
    content: str,
    category: str,
    expires_at: str,
    target_type: str,
    config: RunnableConfig,
    priority: str = "normal",
    target_name: Optional[str] = None,
    target_role: Optional[str] = None,
) -> Dict[str, Any]:
    """Post a new announcement... (docstring as above)"""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    VALID_CATEGORIES = ["general", "maintenance", "security", "event", "emergency", "financial"]
    VALID_PRIORITIES = ["low", "normal", "urgent"]
    VALID_TARGET_TYPES = ["all", "block", "floor", "unit", "user", "role"]

    if not title or len(title.strip()) < 5 or len(title.strip()) > 200:
        return {"success": False, "error": "Title must be between 5 and 200 characters."}
    if not content or len(content.strip()) < 10 or len(content.strip()) > 5000:
        return {"success": False, "error": "Content must be between 10 and 5000 characters."}
    if category not in VALID_CATEGORIES:
        return {"success": False, "error": f"Invalid category '{category}'. Must be one of: {', '.join(VALID_CATEGORIES)}."}
    if priority not in VALID_PRIORITIES:
        return {"success": False, "error": f"Invalid priority '{priority}'. Must be one of: {', '.join(VALID_PRIORITIES)}."}
    if target_type not in VALID_TARGET_TYPES:
        return {"success": False, "error": f"Invalid target_type '{target_type}'. Must be one of: {', '.join(VALID_TARGET_TYPES)}."}

    try:
        from datetime import datetime, timezone
        expiry_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if expiry_dt.tzinfo is None:
            expiry_dt = expiry_dt.replace(tzinfo=timezone.utc)
        if expiry_dt <= datetime.now(timezone.utc):
            return {"success": False, "error": "expires_at must be a future datetime. Please provide a date after today."}
    except ValueError:
        return {"success": False, "error": f"Invalid expires_at format: '{expires_at}'. Use ISO 8601 format like '2024-11-15T23:59:59'."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                target_id = None
                target_label = None

                if target_type == "all":
                    target_label = "All Residents"

                elif target_type == "role":
                    if not target_role or target_role not in ["owner", "tenant"]:
                        return {"success": False, "error": "target_role must be 'owner' or 'tenant' when target_type is 'role'."}
                    target_label = f"All {target_role.capitalize()}s"

                elif target_type == "block":
                    if not target_name:
                        return {"success": False, "error": "target_name (block name) is required when target_type is 'block'."}
                    # Normalize: strip "Block " prefix for DB lookup
                    block_search = target_name.strip().upper().replace("BLOCK ", "").replace("BLOCK", "").strip()
                    await cur.execute(
                        "SELECT id, name FROM blocks WHERE society_id = %s AND (UPPER(name) = %s OR UPPER(name) = %s)",
                        (society_id, target_name.strip().upper(), block_search),
                    )
                    row = await cur.fetchone()
                    if not row:
                        # Try partial match
                        await cur.execute(
                            "SELECT id, name FROM blocks WHERE society_id = %s AND UPPER(name) LIKE %s LIMIT 1",
                            (society_id, f"%{block_search}%"),
                        )
                        row = await cur.fetchone()
                    if not row:
                        return {"success": False, "error": f"Block '{target_name}' not found in this society. Use get_society_structure to check block names."}
                    target_id = row["id"]
                    target_label = f"Block {row['name']}"

                elif target_type == "floor":
                    if not target_name:
                        return {"success": False, "error": "target_name is required for floor targeting. Example: 'Block A Floor 2' or 'A-2'."}
                    # Parse formats like "Block A Floor 2", "A Floor 2", "A-2"
                    resolved = await _resolve_floor_name(cur, society_id, target_name)
                    if not resolved:
                        return {"success": False, "error": f"Could not resolve floor '{target_name}'. Try 'Block A Floor 2' or 'A-2'."}
                    target_id = resolved["floor_id"]
                    target_label = resolved["label"]

                elif target_type == "unit":
                    if not target_name:
                        return {"success": False, "error": "target_name (unit label e.g. 'A-302') is required when target_type is 'unit'."}
                    resolved = await _resolve_unit_label(cur, society_id, target_name)
                    if not resolved:
                        return {"success": False, "error": f"Unit '{target_name}' not found. Use the format 'A-302' (block-unit_number)."}
                    target_id = resolved["unit_id"]
                    target_label = resolved["label"]

                elif target_type == "user":
                    if not target_name:
                        return {"success": False, "error": "target_name (resident full name) is required when target_type is 'user'."}
                    await cur.execute(
                        """SELECT u.id, u.name, CONCAT(b.name, '-', un.unit_number) AS unit_label
                           FROM users u
                           LEFT JOIN units un ON un.id = u.unit_id
                           LEFT JOIN floors fl ON fl.id = un.floor_id
                           LEFT JOIN blocks b ON b.id = fl.block_id
                           WHERE u.society_id = %s AND u.role = 'resident' AND u.status = 'active'
                           AND UPPER(u.name) LIKE %s""",
                        (society_id, f"%{target_name.strip().upper()}%"),
                    )
                    rows = await cur.fetchall()
                    if not rows:
                        return {"success": False, "error": f"No active resident named '{target_name}' found. Check the name spelling."}
                    if len(rows) > 1:
                        matches = [f"{r['name']} ({r['unit_label']})" for r in rows]
                        return {"success": False, "error": f"Multiple residents match '{target_name}': {', '.join(matches)}. Please be more specific."}
                    target_id = rows[0]["id"]
                    target_label = f"{rows[0]['name']} (Personal)"

                # Insert announcement
                await cur.execute(
                    """INSERT INTO announcements
                       (society_id, created_by, title, content, category, priority, target_type, target_id, target_role, expires_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        society_id,
                        _extract_secretary_id(config),
                        title.strip(),
                        content.strip(),
                        category,
                        priority,
                        target_type,
                        target_id,
                        target_role if target_type == "role" else None,
                        expiry_dt,
                    ),
                )
                await conn.commit()
                new_id = cur.lastrowid

        return {
            "success": True,
            "data": {
                "id": new_id,
                "title": title.strip(),
                "category": category,
                "priority": priority,
                "target_type": target_type,
                "target_id": target_id,
                "target_label": target_label,
                "expires_at": expires_at,
                "message": f"Announcement posted successfully to {target_label}. ID: #{new_id}",
            },
        }
    except Exception as e:
        logger.error("Error in create_announcement: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error while creating announcement: {str(e)}"}


@tool
async def list_announcements(
    config: RunnableConfig,
    status: str = "active",
    category: Optional[str] = None,
    priority: Optional[str] = None,
    target_type: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> Dict[str, Any]:
    """List society announcements with optional filters.

    Parameters:
      status: 'active' (default, expires_at > NOW), 'expired' (expires_at <= NOW), or 'all'.
      category: Optional filter — 'general', 'maintenance', 'security', 'event', 'emergency', 'financial'.
      priority: Optional filter — 'low', 'normal', 'urgent'.
      target_type: Optional filter — 'all', 'block', 'floor', 'unit', 'user', 'role'.
      page: Page number for pagination (default: 1).
      limit: Results per page (default: 20, max: 50).
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                conditions = ["a.society_id = %s", "a.is_deleted = FALSE"]
                params = [society_id]

                if status == "active":
                    conditions.append("a.expires_at > NOW()")
                elif status == "expired":
                    conditions.append("a.expires_at <= NOW()")

                VALID_CATEGORIES = ["general", "maintenance", "security", "event", "emergency", "financial"]
                VALID_TARGET_TYPES = ["all", "block", "floor", "unit", "user", "role"]

                if category and category in VALID_CATEGORIES:
                    conditions.append("a.category = %s")
                    params.append(category)
                if priority and priority in ["low", "normal", "urgent"]:
                    conditions.append("a.priority = %s")
                    params.append(priority)
                if target_type and target_type in VALID_TARGET_TYPES:
                    conditions.append("a.target_type = %s")
                    params.append(target_type)

                limit = min(50, max(1, limit))
                offset = (max(1, page) - 1) * limit
                where = " AND ".join(conditions)

                await cur.execute(
                    f"""SELECT a.id, a.title, a.category, a.priority, a.target_type,
                               a.target_id, a.target_role, a.expires_at, a.created_at,
                               (a.expires_at > NOW()) AS is_active,
                               (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count
                        FROM announcements a
                        WHERE {where}
                        ORDER BY a.created_at DESC
                        LIMIT %s OFFSET %s""",
                    params + [limit, offset],
                )
                rows = await cur.fetchall()

                # Summary counts
                await cur.execute(
                    """SELECT
                         SUM(expires_at > NOW() AND is_deleted = FALSE) AS total_active,
                         SUM(expires_at <= NOW() AND is_deleted = FALSE) AS total_expired
                       FROM announcements WHERE society_id = %s""",
                    (society_id,),
                )
                counts = await cur.fetchone()

                return {
                    "success": True,
                    "data": {
                        "summary": {
                            "total_active": int(counts["total_active"] or 0),
                            "total_expired": int(counts["total_expired"] or 0),
                        },
                        "announcements": [
                            {
                                "id": r["id"],
                                "title": r["title"],
                                "category": r["category"],
                                "priority": r["priority"],
                                "target_type": r["target_type"],
                                "target_role": r["target_role"],
                                "expires_at": str(r["expires_at"]),
                                "is_active": bool(r["is_active"]),
                                "read_count": int(r["read_count"]),
                                "created_at": str(r["created_at"]),
                            }
                            for r in rows
                        ],
                        "pagination": {
                            "page": page,
                            "limit": limit,
                            "returned": len(rows),
                        },
                    },
                }
    except Exception as e:
        logger.error("Error in list_announcements: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def get_announcement_details(
    announcement_id: int,
    config: RunnableConfig,
) -> Dict[str, Any]:
    """Get full details of a specific announcement including read receipt statistics.

    Parameters:
      announcement_id: The numeric ID of the announcement (from list_announcements results).
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """SELECT a.*, (a.expires_at > NOW()) AS is_active
                       FROM announcements a
                       WHERE a.id = %s AND a.society_id = %s AND a.is_deleted = FALSE""",
                    (announcement_id, society_id),
                )
                ann = await cur.fetchone()
                if not ann:
                    return {"success": False, "error": f"Announcement #{announcement_id} not found or belongs to a different society."}

                # Compute total_targeted
                total_targeted = 0
                if ann["target_type"] == "all":
                    await cur.execute(
                        "SELECT COUNT(*) AS c FROM users WHERE society_id = %s AND role = 'resident' AND status = 'active'",
                        (society_id,),
                    )
                    total_targeted = (await cur.fetchone())["c"]
                elif ann["target_type"] == "block":
                    await cur.execute(
                        """SELECT COUNT(DISTINCT u.id) AS c FROM users u
                           JOIN units un ON un.id = u.unit_id
                           JOIN floors fl ON fl.id = un.floor_id
                           WHERE fl.block_id = %s AND u.society_id = %s AND u.role = 'resident' AND u.status = 'active'""",
                        (ann["target_id"], society_id),
                    )
                    total_targeted = (await cur.fetchone())["c"]
                elif ann["target_type"] == "floor":
                    await cur.execute(
                        """SELECT COUNT(DISTINCT u.id) AS c FROM users u
                           JOIN units un ON un.id = u.unit_id
                           WHERE un.floor_id = %s AND u.society_id = %s AND u.role = 'resident' AND u.status = 'active'""",
                        (ann["target_id"], society_id),
                    )
                    total_targeted = (await cur.fetchone())["c"]
                elif ann["target_type"] == "unit":
                    await cur.execute(
                        "SELECT COUNT(*) AS c FROM users WHERE unit_id = %s AND society_id = %s AND role = 'resident' AND status = 'active'",
                        (ann["target_id"], society_id),
                    )
                    total_targeted = (await cur.fetchone())["c"]
                elif ann["target_type"] == "user":
                    total_targeted = 1
                elif ann["target_type"] == "role":
                    await cur.execute(
                        """SELECT COUNT(*) AS c FROM users u
                           JOIN units un ON un.id = u.unit_id
                           WHERE u.society_id = %s AND u.role = 'resident' AND u.status = 'active' AND un.occupant_type = %s""",
                        (society_id, ann["target_role"]),
                    )
                    total_targeted = (await cur.fetchone())["c"]

                await cur.execute(
                    "SELECT COUNT(*) AS rc FROM announcement_reads WHERE announcement_id = %s",
                    (announcement_id,),
                )
                read_count = (await cur.fetchone())["rc"]

                await cur.execute(
                    """SELECT ar.resident_id, u.name AS resident_name,
                              CONCAT(b.name, '-', un.unit_number) AS unit_label, ar.read_at
                       FROM announcement_reads ar
                       JOIN users u ON u.id = ar.resident_id
                       LEFT JOIN units un ON un.id = u.unit_id
                       LEFT JOIN floors fl ON fl.id = un.floor_id
                       LEFT JOIN blocks b ON b.id = fl.block_id
                       WHERE ar.announcement_id = %s ORDER BY ar.read_at DESC""",
                    (announcement_id,),
                )
                readers = await cur.fetchall()

                read_pct = round((read_count / total_targeted * 100), 2) if total_targeted > 0 else 0.0

                return {
                    "success": True,
                    "data": {
                        "id": ann["id"],
                        "title": ann["title"],
                        "content": ann["content"],
                        "category": ann["category"],
                        "priority": ann["priority"],
                        "target_type": ann["target_type"],
                        "target_role": ann["target_role"],
                        "expires_at": str(ann["expires_at"]),
                        "is_active": bool(ann["is_active"]),
                        "created_at": str(ann["created_at"]),
                        "read_stats": {
                            "total_targeted": int(total_targeted),
                            "read_count": int(read_count),
                            "unread_count": max(0, int(total_targeted) - int(read_count)),
                            "read_percentage": read_pct,
                        },
                        "readers": [
                            {
                                "resident_name": r["resident_name"],
                                "unit_label": r["unit_label"],
                                "read_at": str(r["read_at"]),
                            }
                            for r in readers
                        ],
                    },
                }
    except Exception as e:
        logger.error("Error in get_announcement_details: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def delete_announcement(
    announcement_id: int,
    config: RunnableConfig,
) -> Dict[str, Any]:
    """Soft-delete a specific announcement. It disappears from all resident feeds and the secretary dashboard.
    The data is retained for audit but is no longer visible anywhere.

    Parameters:
      announcement_id: The numeric ID of the announcement to delete.
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, title FROM announcements WHERE id = %s AND society_id = %s AND is_deleted = FALSE",
                    (announcement_id, society_id),
                )
                ann = await cur.fetchone()
                if not ann:
                    return {"success": False, "error": f"Announcement #{announcement_id} not found or already deleted."}

                await cur.execute(
                    "UPDATE announcements SET is_deleted = TRUE, deleted_at = NOW() WHERE id = %s",
                    (announcement_id,),
                )
                await conn.commit()

        return {
            "success": True,
            "data": {
                "id": announcement_id,
                "title": ann["title"],
                "message": f"Announcement #{announcement_id} ('{ann['title']}') has been deleted successfully.",
            },
        }
    except Exception as e:
        logger.error("Error in delete_announcement: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def delete_expired_announcements(config: RunnableConfig) -> Dict[str, Any]:
    """Bulk soft-delete all expired announcements for this society in a single operation.
    This is a cleanup tool — it removes all announcements where the expiry date has passed.
    Returns the count of announcements that were deleted.
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """UPDATE announcements
                       SET is_deleted = TRUE, deleted_at = NOW()
                       WHERE society_id = %s AND is_deleted = FALSE AND expires_at <= NOW()""",
                    (society_id,),
                )
                deleted_count = cur.rowcount
                await conn.commit()

        if deleted_count == 0:
            return {
                "success": True,
                "data": {"deleted_count": 0, "message": "No expired announcements found to delete. The board is already clean."},
            }

        return {
            "success": True,
            "data": {
                "deleted_count": deleted_count,
                "message": f"Successfully deleted {deleted_count} expired announcement{'s' if deleted_count != 1 else ''}.",
            },
        }
    except Exception as e:
        logger.error("Error in delete_expired_announcements: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def get_announcement_read_stats(
    announcement_id: int,
    config: RunnableConfig,
) -> Dict[str, Any]:
    """Get read receipt statistics for a specific announcement:
    total targeted audience size, how many have read it, percentage, and unread count.
    Use this for a quick engagement check without fetching full announcement details.

    Parameters:
      announcement_id: The numeric ID of the announcement.
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, title, target_type, target_id, target_role FROM announcements WHERE id = %s AND society_id = %s AND is_deleted = FALSE",
                    (announcement_id, society_id),
                )
                ann = await cur.fetchone()
                if not ann:
                    return {"success": False, "error": f"Announcement #{announcement_id} not found."}

                await cur.execute(
                    "SELECT COUNT(*) AS rc FROM announcement_reads WHERE announcement_id = %s",
                    (announcement_id,),
                )
                read_count = (await cur.fetchone())["rc"]

                # Quick total_targeted calculation
                total_targeted = await _count_targeted_residents(cur, society_id, ann)
                read_pct = round((read_count / total_targeted * 100), 2) if total_targeted > 0 else 0.0

                return {
                    "success": True,
                    "data": {
                        "announcement_id": announcement_id,
                        "title": ann["title"],
                        "total_targeted": int(total_targeted),
                        "read_count": int(read_count),
                        "unread_count": max(0, int(total_targeted) - int(read_count)),
                        "read_percentage": read_pct,
                    },
                }
    except Exception as e:
        logger.error("Error in get_announcement_read_stats: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def resolve_targeting_name(
    lookup_type: str,
    name: str,
    config: RunnableConfig,
) -> Dict[str, Any]:
    """Resolve a human-readable name to a database ID for announcement targeting.
    Use this to look up blocks, floors, units, or residents before creating an announcement.

    Parameters:
      lookup_type: What to look up — 'block', 'floor', 'unit', or 'resident'.
      name: The name or label to resolve.
            For 'block': block name (e.g. 'A', 'Block B').
            For 'floor': 'Block A Floor 2' or 'A-2'.
            For 'unit': unit label (e.g. 'A-302').
            For 'resident': resident full name or partial name.
    """
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    if lookup_type not in ["block", "floor", "unit", "resident"]:
        return {"success": False, "error": "lookup_type must be 'block', 'floor', 'unit', or 'resident'."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                if lookup_type == "block":
                    search = name.strip().upper().replace("BLOCK ", "").strip()
                    await cur.execute(
                        "SELECT id, name FROM blocks WHERE society_id = %s AND (UPPER(name) = %s OR UPPER(name) LIKE %s)",
                        (society_id, search, f"%{search}%"),
                    )
                    rows = await cur.fetchall()
                    if not rows:
                        await cur.execute("SELECT id, name FROM blocks WHERE society_id = %s", (society_id,))
                        all_blocks = await cur.fetchall()
                        return {"success": False, "error": f"Block '{name}' not found.", "available_blocks": [r["name"] for r in all_blocks]}
                    return {"success": True, "data": {"results": [{"id": r["id"], "name": r["name"]} for r in rows]}}

                elif lookup_type == "unit":
                    await cur.execute(
                        """SELECT u.id, CONCAT(b.name, '-', u.unit_number) AS unit_label
                           FROM units u JOIN floors fl ON fl.id = u.floor_id JOIN blocks b ON b.id = fl.block_id
                           WHERE b.society_id = %s AND CONCAT(UPPER(b.name), '-', UPPER(u.unit_number)) = %s""",
                        (society_id, name.strip().upper()),
                    )
                    row = await cur.fetchone()
                    if not row:
                        return {"success": False, "error": f"Unit '{name}' not found. Use format 'A-302'."}
                    return {"success": True, "data": {"unit_id": row["id"], "unit_label": row["unit_label"]}}

                elif lookup_type == "resident":
                    await cur.execute(
                        """SELECT u.id, u.name, CONCAT(b.name, '-', un.unit_number) AS unit_label
                           FROM users u
                           LEFT JOIN units un ON un.id = u.unit_id
                           LEFT JOIN floors fl ON fl.id = un.floor_id
                           LEFT JOIN blocks b ON b.id = fl.block_id
                           WHERE u.society_id = %s AND u.role = 'resident' AND u.status = 'active'
                           AND UPPER(u.name) LIKE %s""",
                        (society_id, f"%{name.strip().upper()}%"),
                    )
                    rows = await cur.fetchall()
                    if not rows:
                        return {"success": False, "error": f"No active resident matching '{name}'."}
                    return {"success": True, "data": {"results": [{"id": r["id"], "name": r["name"], "unit": r["unit_label"]} for r in rows]}}

        return {"success": False, "error": "Lookup not completed."}
    except Exception as e:
        logger.error("Error in resolve_targeting_name: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}




def get_announcement_tools() -> List[Any]:
    """Return all 7 announcement tools as a flat list for registration."""
    return [
        create_announcement,
        list_announcements,
        get_announcement_details,
        delete_announcement,
        delete_expired_announcements,
        get_announcement_read_stats,
        resolve_targeting_name,
    ]
```

---

## 9. Updates to `graph/tools/__init__.py`

The change is **4 lines** — import the new module and extend `get_all_tools()`:

```python
# ADD these imports after the existing society_setup import:
from app.graph.tools.complaints import get_complaint_tools      # Phase 2B (if implemented)
from app.graph.tools.announcements import get_announcement_tools  # Phase 2C (NEW)

# MODIFY get_all_tools() inside society_setup.py or define it here:
# Current get_all_tools() returns 17 tools (Phase 2A).
# Updated version should return 17 + 12 + 7 = 36 tools.
```

**Specifically**, update the `get_all_tools()` function in `society_setup.py` (where it currently lives):

```python
def get_all_tools():
    """Return all registered agent tools for Phase 2A + 2B + 2C."""
    from app.graph.tools.society_setup import _get_society_setup_tools
    from app.graph.tools.complaints import get_complaint_tools
    from app.graph.tools.announcements import get_announcement_tools
    return (
        _get_society_setup_tools()      # 17 tools (Phase 2A)
        + get_complaint_tools()          # 12 tools (Phase 2B)
        + get_announcement_tools()       # 7 tools  (Phase 2C)
    )
```

After this change, startup logs should show:
```
INFO: Registered 36 agent tools for LangGraph ToolNode.
```

---

## 10. Updated System Prompt — Announcement-Aware Agent Persona

Add the following section to `app/prompts/system.py` inside `build_system_prompt()`,
**after** the existing `### Resident Management Tools` block:

```python
### Complaint Management Tools
- **get_complaint_stats**: View complaint dashboard (counts by status/category, avg resolution time)
- **list_complaints**: List society complaints with filters and pagination
- **get_complaint_details**: View full complaint details + discussion thread
- **update_complaint_status**: Move complaint to 'in_progress' or 'pending_closure'
- **reply_to_complaint**: Post a secretary reply in the complaint thread
- **reject_complaint**: Reject a complaint with a mandatory reason (terminal, irreversible)
- **get_complaints_by_category**: Filter complaints by category
- **get_complaints_by_unit**: View complaints from a specific unit
- **get_complaints_by_resident**: View complaints by a specific resident
- **search_complaints**: Search complaints by keyword
- **get_complaint_thread**: View only the discussion thread for a complaint
- **get_resolution_metrics**: Resolution performance metrics with optional category filter

### Announcement & Notice Board Tools
- **create_announcement**: Post a new notice to targeted residents (all, block, floor, unit, user, role)
- **list_announcements**: List all announcements with status/category/priority/target filters
- **get_announcement_details**: Full announcement details including who has read it
- **delete_announcement**: Remove a specific announcement (soft-delete, data retained)
- **delete_expired_announcements**: Bulk-remove all expired announcements (notice board cleanup)
- **get_announcement_read_stats**: Quick read engagement stats for a specific announcement
- **resolve_targeting_name**: Look up block, unit, or resident IDs from human-readable names
```

Also add these **behavioral rules** to the guidelines section in `build_system_prompt()`:

```python
## Announcement-Specific Behavioral Guidelines

9. **Never hallucinate target IDs** — When creating announcements, always pass human-readable
   names (block names, unit labels like 'A-302', resident names) in `target_name`. The tool
   internally resolves names to IDs. Never guess or invent a database ID number.

10. **Compute expiry dates from context** — The system prompt includes today's date. When the
    secretary says "valid till Sunday" or "expires in 3 days", compute the ISO datetime string
    yourself using today's date. Example: if today is 2024-11-01 and they say "expires Sunday",
    compute expires_at = "2024-11-03T23:59:59".

11. **Announcements are immutable** — There is NO edit tool for announcements. If the secretary
    wants to correct a posted announcement, instruct them: "Announcements cannot be edited once
    posted. I can delete announcement #X and create a new one with the correction."

12. **Clarify ambiguous targeting** — If the secretary says "send to Priya" and `create_announcement`
    returns multiple matches, present the options clearly and ask which one. Never pick arbitrarily.

13. **Confirm bulk deletions** — Before calling `delete_expired_announcements`, inform the secretary
    how many expired announcements will be removed. Call `list_announcements(status='expired')` first
    to get the count, then confirm: "There are 12 expired announcements. Shall I delete all of them?"

14. **Post-creation confirmation** — After creating an announcement, always report:
    - The announcement ID
    - Who it was targeted at (target label)
    - The expiry date
    - Priority level (especially for urgent notices)
```

---

## 11. Targeting Resolution Helper in the AI Tools Layer

The `create_announcement` tool handles name resolution internally using two async helpers
(`_resolve_floor_name` and `_resolve_unit_label`). Here's the resolution flow map:

| Secretary Input | `target_type` | `target_name` | Internal Resolution |
|---|---|---|---|
| "all residents" | `all` | None | No lookup needed |
| "Block B" / "block B" | `block` | `"B"` | `SELECT id FROM blocks WHERE UPPER(name) = 'B'` |
| "Block A Floor 2" / "A-2" | `floor` | `"Block A Floor 2"` | `_resolve_floor_name` regex parser |
| "unit A-302" / "A-302" | `unit` | `"A-302"` | `_resolve_unit_label` splits on '-' |
| "Priya Sharma" | `user` | `"Priya Sharma"` | `LIKE '%PRIYA SHARMA%'` on users table |
| "all owners" / "owners only" | `role` | None | `target_role = 'owner'` |
| "all tenants" | `role` | None | `target_role = 'tenant'` |

**Ambiguity handling**:
- Block not found → Returns error with list of available block names
- Resident name matches multiple → Returns error with all matches (name + unit_label)
- Unit not found → Returns error with format hint `"Use format 'A-302'"`
- Floor not found → Returns error with format hint

---

## 12. Natural Language to Tool Mapping — Conversation Examples

### Example 1: Society-Wide Event Notice
```
Secretary: "Post a notice about the Diwali celebration on Nov 1 at 7 PM in the community hall.
            Valid till Nov 1."
AI:
  tool: create_announcement(
    title="Diwali Celebration — Nov 1, 7 PM",
    content="You are cordially invited to the Diwali celebration on 1st November 2024 at 7:00 PM
             in the Community Hall. Families are welcome. Refreshments will be served.",
    category="event",
    priority="normal",
    target_type="all",
    expires_at="2024-11-01T23:59:59"
  )
  Response: "Done! Diwali celebration notice posted to all 87 residents. Expires 1st Nov. ID: #45."
```

### Example 2: Urgent Block-Specific Maintenance
```
Secretary: "Urgent — Block C water will be shut off from 9 AM to 3 PM tomorrow for pipeline work."
AI:
  tool: create_announcement(
    title="Urgent: Water Supply Interruption — Block C",
    content="Water supply in Block C will be temporarily shut off tomorrow (2nd November 2024)
             from 9:00 AM to 3:00 PM for essential pipeline maintenance. Please store sufficient
             water in advance. We apologize for the inconvenience.",
    category="maintenance",
    priority="urgent",
    target_type="block",
    target_name="C",
    expires_at="2024-11-02T21:00:00"
  )
  Response: "Urgent notice posted for Block C (32 residents). Expires tomorrow 9 PM. ID: #46."
```

### Example 3: Owner-Only Financial Notice
```
Secretary: "Inform all owners that the AGM accounts will be presented on Dec 15."
AI:
  tool: create_announcement(
    title="AGM: Financial Accounts Presentation — Dec 15",
    content="All flat owners are reminded that the Annual General Meeting will be held on
             15th December 2024 at 6:00 PM in the Community Hall. Annual accounts and audit
             report will be presented.",
    category="financial",
    priority="normal",
    target_type="role",
    target_role="owner",
    expires_at="2024-12-15T23:59:59"
  )
  Response: "AGM notice posted to all 54 owners. Expires 15th Dec. ID: #47."
```

### Example 4: Check Who Read a Notice
```
Secretary: "How many people read the water shutdown notice?"
AI (doesn't know ID — asks list first):
  tool: list_announcements(category="maintenance", status="active")
  [Returns list including "Water Supply Interruption — Block C" with id=46]
AI:
  tool: get_announcement_read_stats(announcement_id=46)
  Response: "The Block C water shutdown notice (#46) has been read by 21 of 32 targeted residents (65.6%). 11 residents haven't read it yet."
```

### Example 5: Confirm Before Bulk Delete
```
Secretary: "Clean up all the old expired notices."
AI (confirms first):
  tool: list_announcements(status="expired")
  [Returns: 15 expired announcements]
AI: "There are 15 expired announcements on the board. Shall I delete all of them?"
Secretary: "Yes, go ahead."
AI:
  tool: delete_expired_announcements()
  Response: "Done! Deleted 15 expired announcements. The notice board is now clean."
```

### Example 6: Personal Unit Reminder
```
Secretary: "Remind unit A-205 that their parking pass expires this month."
AI:
  tool: create_announcement(
    title="Parking Pass Renewal Reminder",
    content="Your society parking pass is expiring this month. Please visit the secretary's
             office to renew it before 30th November 2024 to avoid disruption.",
    category="general",
    priority="normal",
    target_type="unit",
    target_name="A-205",
    expires_at="2024-11-30T23:59:59"
  )
  Response: "Personal reminder posted for unit A-205. ID: #48."
```

---

## 13. Multi-Tool Chain Scenarios

### Scenario A: Full Dashboard Review Before Posting
```
Secretary: "Before I post the maintenance notice, show me what's currently active."
  Step 1: list_announcements(status="active")
  Step 2: AI summarizes the 5 active notices
  Step 3: Secretary gives notice content
  Step 4: create_announcement(...)
```

### Scenario B: Post + Verify Read Stats Same Session
```
Secretary: "Post the AGM notice for all residents."
  Step 1: create_announcement(...) -> id=49
Secretary: "How many have read it so far?"
  Step 2: get_announcement_read_stats(announcement_id=49)
  Response: "1 of 87 residents have read it (1.1%). Just posted a few minutes ago!"
```

### Scenario C: Delete Specific + Clean Expired
```
Secretary: "Delete the October fest notice and clean up all expired ones."
  Step 1: list_announcements(status="active") [to find October fest ID]
  Step 2: delete_announcement(announcement_id=38)
  Step 3: delete_expired_announcements()
  Response: "Deleted the October Fest notice (#38). Also cleaned up 9 other expired announcements."
```

---

## 14. Edge Cases & Validation Matrix

### Tool 30: create_announcement Edge Cases

| Scenario | Expected Behavior |
|---|---|
| `title` < 5 chars | Returns error: "Title must be between 5 and 200 characters." |
| `title` > 200 chars | Returns error with length limit message |
| `expires_at` in the past | Returns error: "expires_at must be a future datetime." |
| `expires_at` invalid format | Returns error with format hint |
| `target_type = 'block'`, block name not found | Returns error + list of available block names |
| `target_type = 'user'`, name matches 2+ residents | Returns error with all matches listed (name + unit) |
| `target_type = 'user'`, name matches 0 residents | Returns error: "No active resident named X found." |
| `target_type = 'role'` with no `target_role` | Returns error: "target_role must be 'owner' or 'tenant'." |
| `target_type = 'role'`, `target_role = 'staff'` | Returns error: invalid target_role |
| `target_type = 'unit'`, unit label malformed | Returns error with format hint ('A-302') |
| `target_type = 'floor'`, floor not found | Returns error with format hint ('Block A Floor 2') |
| Secretary not in config | Returns error: "Unauthorized: Missing society context." |
| LLM tries to pass cross-society block_id | Impossible — only names accepted, and names are validated against society_id |
| `category = 'payroll'` (invalid) | Returns error with valid category list |
| Duplicate announcement (same title/content) | ALLOWED — no uniqueness constraint. Duplicates are intentional edge case |

### Tool 31: list_announcements Edge Cases

| Scenario | Expected Behavior |
|---|---|
| `status = 'invalid_value'` | Falls through to no status filter (returns all), or return error |
| `limit = 200` (exceeds max 50) | Clamped to 50 silently |
| `limit = -5` (negative) | Clamped to 1 |
| No announcements in society | Returns empty list with summary counts all 0 |
| Filter combination returns 0 results | Returns empty list (not an error) |

### Tool 32 & 35: get_announcement_details / read_stats Edge Cases

| Scenario | Expected Behavior |
|---|---|
| `announcement_id` from a different society | Returns 404: "Announcement not found or belongs to different society." |
| `announcement_id` is soft-deleted | Returns 404 (is_deleted = FALSE filter) |
| `total_targeted = 0` | `read_percentage = 0.0` — no division-by-zero error |
| No one has read the announcement yet | `read_count = 0`, `readers = []`, `read_percentage = 0.0` |

### Tool 33: delete_announcement Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Delete already-deleted announcement | Returns 404: "Announcement not found or already deleted." |
| Delete active announcement | Allowed — no restriction on active vs expired |
| Delete announcement from different society | Returns 404 |

### Tool 34: delete_expired_announcements Edge Cases

| Scenario | Expected Behavior |
|---|---|
| 0 expired announcements | Returns: `{deleted_count: 0, "message": "No expired announcements found..."}` |
| All announcements are active | Same as above |

### Tool 36: resolve_targeting_name Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Block name "BLOCK B" (with prefix) | Normalized to "B" before lookup |
| Resident name partial match | Returns all matches so LLM can pick |
| Unit label lowercase "a-302" | Normalized to uppercase before comparison |

---

## 15. Implementation Order — Step by Step

| Step | Action | File | Time Estimate |
|---|---|---|---|
| **1** | Create `announcements.py` with all 7 tools | `graph/tools/announcements.py` | 30–40 min |
| **2** | Import `get_announcement_tools()` in `__init__.py` and extend `get_all_tools()` | `graph/tools/__init__.py` | 5 min |
| **3** | Add announcement tools catalog + behavioral guidelines 9–14 to system prompt | `app/prompts/system.py` | 10 min |
| **4** | Restart service and verify startup log shows 36 tools | Terminal | 2 min |
| **5** | Smoke test: post a society-wide notice | Chat UI | 5 min |
| **6** | Smoke test: post a block-specific urgent notice | Chat UI | 5 min |
| **7** | Smoke test: check read stats | Chat UI | 5 min |
| **8** | Smoke test: bulk delete expired | Chat UI | 5 min |
| **9** | Commit to `ai` branch, merge to `dev`, push | Git | 5 min |

**Total estimated implementation time: ~1.5 hours**

---

## 16. File-by-File Change Summary

| File | Change Type | Description |
|---|---|---|
| `graph/tools/announcements.py` | **NEW** | 7 announcement tools + 4 helper functions (~400 lines) |
| `graph/tools/__init__.py` | **MODIFY** | Import `get_announcement_tools`, extend `get_all_tools()` to return 36 tools |
| `app/prompts/system.py` | **MODIFY** | Add Announcement Tools catalog + behavioral guidelines 9–14 |
| `graph/builder.py` | No change | Auto-discovers tools via `get_all_tools()` |
| `graph/edges/routers.py` | No change | Generic tool detection logic — works for all tools |
| `graph/nodes/call_model.py` | No change | Calls `get_all_tools()` dynamically — auto-picks up new tools |
| `graph/state.py` | No change | No new state fields needed |
| `graph/sanitizer.py` | No change | Turn-order sanitization is tool-agnostic |
| `services/llm_provider.py` | No change | Failover engine is model/tool agnostic |
| `services/chat_service.py` | No change | SSE streaming handles all tools identically |

---

## 17. Design Decisions Log (Phase 2C)

### DD-1: Why accept human-readable `target_name` instead of `target_id` in create_announcement?

**Problem**: Should the LLM pass raw IDs (target_id=3) or human-readable names (target_name="Block B")?

**Decision**: Human-readable names only. The tool resolves names to IDs internally.

**Rationale**: LLMs have NO KNOWLEDGE of the actual database IDs. Passing numeric IDs would require
the LLM to first call `resolve_targeting_name`, extract the ID from the response, and then pass it
to `create_announcement`. This creates fragile multi-step flows where the LLM can hallucinate IDs.
Accepting names directly and resolving internally is safer, cleaner, and more natural for the
conversational interface. The resolution logic handles edge cases (partial matches, case-insensitive,
"Block B" vs "B") that the LLM cannot reliably handle.

---

### DD-2: Why is there a dedicated `resolve_targeting_name` tool if create_announcement already resolves internally?

**Problem**: If `create_announcement` handles name resolution, why expose a separate lookup tool?

**Decision**: Expose `resolve_targeting_name` as a standalone tool for pre-creation exploration.

**Rationale**: Sometimes the secretary needs to verify before posting. Example: *"What blocks do we have?"*
or *"Is there a resident named Priya in Block A specifically?"*. Without this tool, the LLM would need to
call `get_society_structure` and parse the output for block/unit names — which is verbose and imprecise.
The dedicated tool is a lightweight, focused lookup that serves the pre-announcement discovery use case.

---

### DD-3: Why does the announcement AI agent NOT require graph structure changes?

**Problem**: Phase 2C adds 7 new tools. Do we need new nodes or edges in the graph?

**Decision**: No graph changes. The existing 3-node architecture handles announcement tools automatically.

**Rationale**: The `ToolNode` in LangGraph is dynamically constructed from `get_all_tools()`. Any tool
added to that list is immediately available to the LLM via function binding in `call_model`. The tool
call / tool result loop (call_model → tool_executor → call_model) works identically for announcement
tools as for society setup or complaint tools. This is the intentional design: a generic, extensible
agent loop where adding functionality never requires rewiring the graph.

---

### DD-4: Why confirm before bulk-delete in the system prompt rather than in the tool itself?

**Problem**: `delete_expired_announcements` is destructive. Should the tool itself ask for confirmation?

**Decision**: Confirmation is a behavioral rule in the system prompt, not a tool-level interrupt.

**Rationale**: Tool-level confirmation would require implementing LangGraph `interrupt()`, which adds
significant complexity (state changes, resume logic, frontend interrupt handling). For this use case,
the behavioral rule in the system prompt ("call list_announcements(status='expired') first, show count,
then ask for confirmation") achieves the same safety without architectural complexity. The LLM naturally
follows this pattern because the system prompt is injected on every call_model invocation.

---

### DD-5: Why is there no `edit_announcement` or `update_announcement` tool?

**Decision**: Announcements are intentionally immutable. No edit tool exists in the AI layer.

**Rationale**: If a resident read the original announcement and the secretary silently edits it,
there is no audit trail of the change. The resident's read receipt now refers to content they
never saw. The correct behavior (matching the backend design) is: delete the old one, post a
new corrected one. This creates a clear, transparent notice history. The behavioral rule in the
system prompt explicitly instructs the LLM to explain this constraint when asked.

---

### DD-6: Why include `get_announcement_read_stats` separately from `get_announcement_details`?

**Decision**: Separate lightweight stats tool vs full detail tool.

**Rationale**: `get_announcement_details` fetches the full content plus the complete list of all
readers (potentially dozens of rows). When the secretary just wants to know *"how many read it?"*,
that full query is unnecessarily heavy. `get_announcement_read_stats` runs 2 efficient queries
(COUNT only + COUNT for reads) and returns just the engagement numbers. This is the same granular
vs composite tool principle applied in Phase 2B.

---

*Guide Status: **COMPLETE — READY FOR IMPLEMENTATION***

*Phase 2C brings the total agent tool count to 36 tools.*
*Next Phase: Phase 2D (Maintenance & Dues) — once Purvi completes the financial module post-exams.*
