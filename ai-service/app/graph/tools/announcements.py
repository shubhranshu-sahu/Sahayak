"""
Sahayak AI Assistant — Announcements & Notice Board Tools (Phase 2C)

This module implements 7 agent tools for managing the society announcement system.
All tools enforce strict society isolation via society_id from LangGraph RunnableConfig.

Tools:
  30. create_announcement          — Post targeted notices to residents
  31. list_announcements           — List with filters (status, category, priority, target_type)
  32. get_announcement_details     — Full details + read receipt breakdown
  33. delete_announcement          — Soft-delete a single announcement
  34. delete_expired_announcements — Bulk cleanup of all expired notices
  35. get_announcement_read_stats  — Quick engagement metrics
  36. resolve_targeting_name       — Name-to-ID resolution helper (block/floor/unit/resident)
"""

import logging
import re
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
    uid = configurable.get("user_id") or configurable.get("secretary_id")
    if uid is not None:
        try:
            return int(uid)
        except (ValueError, TypeError):
            return None
    return None


async def _resolve_floor_name(cur, society_id: int, name: str) -> Optional[Dict[str, Any]]:
    """
    Resolve a floor name like 'Block A Floor 2' or 'A-2' to a floor_id.
    Returns dict with floor_id and label, or None if not found.
    """
    name_clean = name.strip().upper()

    # Try pattern "A-2" (block_name-floor_number)
    match = re.match(r'^([A-Z]+)-(\d+)$', name_clean)
    if match:
        block_name, floor_num = match.group(1), int(match.group(2))
        await cur.execute(
            """SELECT f.id, f.floor_number, b.block_name
               FROM floors f JOIN blocks b ON b.id = f.block_id
               WHERE b.society_id = %s AND UPPER(b.block_name) = %s AND f.floor_number = %s""",
            (society_id, block_name, floor_num),
        )
        row = await cur.fetchone()
        if row:
            return {"floor_id": row["id"], "label": f"Block {row['block_name']} Floor {row['floor_number']}"}

    # Try "Block A Floor 2" or "A Floor 2"
    match2 = re.search(r'(?:BLOCK\s+)?([A-Z]+)\s+FLOOR\s+(\d+)', name_clean)
    if match2:
        block_name, floor_num = match2.group(1), int(match2.group(2))
        await cur.execute(
            """SELECT f.id, f.floor_number, b.block_name
               FROM floors f JOIN blocks b ON b.id = f.block_id
               WHERE b.society_id = %s AND UPPER(b.block_name) = %s AND f.floor_number = %s""",
            (society_id, block_name, floor_num),
        )
        row = await cur.fetchone()
        if row:
            return {"floor_id": row["id"], "label": f"Block {row['block_name']} Floor {row['floor_number']}"}

    return None


async def _resolve_unit_label(cur, society_id: int, label: str) -> Optional[Dict[str, Any]]:
    """
    Resolve a unit label like 'A-302' or 'A-101' to a unit_id.
    Uses indexed units.display_label directly.
    """
    clean_label = label.strip().upper()

    await cur.execute(
        """SELECT id, display_label
           FROM units
           WHERE society_id = %s AND UPPER(display_label) = %s""",
        (society_id, clean_label),
    )
    row = await cur.fetchone()
    if row:
        return {"unit_id": row["id"], "label": row["display_label"]}

    # Fallback: check without hyphens or matching unit_number
    await cur.execute(
        """SELECT id, display_label
           FROM units
           WHERE society_id = %s AND (UPPER(display_label) LIKE %s OR UPPER(unit_number) = %s)
           LIMIT 1""",
        (society_id, f"%{clean_label}%", clean_label),
    )
    row2 = await cur.fetchone()
    if row2:
        return {"unit_id": row2["id"], "label": row2["display_label"]}

    return None


async def _count_targeted_residents(cur, society_id: int, ann: Dict[str, Any]) -> int:
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
               JOIN units un ON un.id = u.unit_id
               WHERE un.block_id = %s AND u.society_id = %s AND u.role = 'resident' AND u.status = 'active'""",
            (ann["target_id"], society_id),
        )
    elif target_type == "floor":
        await cur.execute(
            """SELECT COUNT(DISTINCT u.id) AS c FROM users u
               JOIN units un ON un.id = u.unit_id
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
            "SELECT COUNT(*) AS c FROM users WHERE society_id = %s AND role = 'resident' AND status = 'active'",
            (society_id,),
        )
    else:
        return 0

    row = await cur.fetchone()
    return int(row["c"]) if row else 0


# ============================================================================
# Tool 30: create_announcement
# ============================================================================

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
                  Example: '2026-11-15T23:59:59'. Use the current date from context to compute this.
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
        expiry_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if expiry_dt.tzinfo is None:
            expiry_dt = expiry_dt.replace(tzinfo=timezone.utc)
        if expiry_dt <= datetime.now(timezone.utc):
            return {"success": False, "error": "expires_at must be a future datetime. Please provide a date after today."}
    except ValueError:
        return {"success": False, "error": f"Invalid expires_at format: '{expires_at}'. Use ISO 8601 format like '2026-11-15T23:59:59'."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                target_id = None
                target_label = None

                # 1. Resolve targeting scope
                if target_type == "all":
                    target_label = "All Residents"

                elif target_type == "role":
                    if not target_role or target_role not in ["owner", "tenant"]:
                        return {"success": False, "error": "target_role must be 'owner' or 'tenant' when target_type is 'role'."}
                    target_label = f"All {target_role.capitalize()}s"

                elif target_type == "block":
                    if not target_name:
                        return {"success": False, "error": "target_name (block name) is required when target_type is 'block'."}
                    block_search = target_name.strip().upper().replace("BLOCK ", "").replace("BLOCK", "").strip()
                    await cur.execute(
                        "SELECT id, block_name FROM blocks WHERE society_id = %s AND (UPPER(block_name) = %s OR UPPER(block_name) = %s)",
                        (society_id, target_name.strip().upper(), block_search),
                    )
                    row = await cur.fetchone()
                    if not row:
                        await cur.execute(
                            "SELECT id, block_name FROM blocks WHERE society_id = %s AND UPPER(block_name) LIKE %s LIMIT 1",
                            (society_id, f"%{block_search}%"),
                        )
                        row = await cur.fetchone()
                    if not row:
                        return {"success": False, "error": f"Block '{target_name}' not found in this society. Use get_society_structure to check block names."}
                    target_id = row["id"]
                    target_label = f"Block {row['block_name']}"

                elif target_type == "floor":
                    if not target_name:
                        return {"success": False, "error": "target_name is required for floor targeting. Example: 'Block A Floor 2' or 'A-2'."}
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
                    target_label = f"Unit {resolved['label']}"

                elif target_type == "user":
                    if not target_name:
                        return {"success": False, "error": "target_name (resident full name) is required when target_type is 'user'."}
                    await cur.execute(
                        """SELECT u.id, u.name, un.display_label AS unit_label
                           FROM users u
                           LEFT JOIN units un ON un.id = u.unit_id
                           WHERE u.society_id = %s AND u.role = 'resident' AND u.status = 'active'
                           AND UPPER(u.name) LIKE %s""",
                        (society_id, f"%{target_name.strip().upper()}%"),
                    )
                    rows = await cur.fetchall()
                    if not rows:
                        return {"success": False, "error": f"No active resident named '{target_name}' found. Check the name spelling."}
                    if len(rows) > 1:
                        matches = [f"{r['name']} ({r['unit_label'] or 'No Unit'})" for r in rows]
                        return {"success": False, "error": f"Multiple residents match '{target_name}': {', '.join(matches)}. Please be more specific."}
                    target_id = rows[0]["id"]
                    target_label = f"{rows[0]['name']} (Personal)"

                # 2. Extract or resolve secretary_id for created_by
                sec_id = _extract_secretary_id(config)
                if not sec_id:
                    await cur.execute("SELECT secretary_id FROM societies WHERE id = %s", (society_id,))
                    soc = await cur.fetchone()
                    sec_id = soc["secretary_id"] if soc else None

                if not sec_id:
                    return {"success": False, "error": "Unable to determine secretary author ID for this society."}

                # 3. Insert announcement
                await cur.execute(
                    """INSERT INTO announcements
                       (society_id, created_by, title, content, category, priority, target_type, target_id, target_role, expires_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        society_id,
                        sec_id,
                        title.strip(),
                        content.strip(),
                        category,
                        priority,
                        target_type,
                        target_id,
                        target_role if target_type == "role" else None,
                        expiry_dt.strftime("%Y-%m-%d %H:%M:%S"),
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


# ============================================================================
# Tool 31: list_announcements
# ============================================================================

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
                params: list = [society_id]

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
                            "total_active": int(counts["total_active"] or 0) if counts else 0,
                            "total_expired": int(counts["total_expired"] or 0) if counts else 0,
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


# ============================================================================
# Tool 32: get_announcement_details
# ============================================================================

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

                total_targeted = await _count_targeted_residents(cur, society_id, ann)

                await cur.execute(
                    "SELECT COUNT(*) AS rc FROM announcement_reads WHERE announcement_id = %s",
                    (announcement_id,),
                )
                read_row = await cur.fetchone()
                read_count = int(read_row["rc"]) if read_row else 0

                await cur.execute(
                    """SELECT ar.resident_id, u.name AS resident_name,
                              un.display_label AS unit_label, ar.read_at
                       FROM announcement_reads ar
                       JOIN users u ON u.id = ar.resident_id
                       LEFT JOIN units un ON un.id = u.unit_id
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


# ============================================================================
# Tool 33: delete_announcement
# ============================================================================

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


# ============================================================================
# Tool 34: delete_expired_announcements
# ============================================================================

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


# ============================================================================
# Tool 35: get_announcement_read_stats
# ============================================================================

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
                read_row = await cur.fetchone()
                read_count = int(read_row["rc"]) if read_row else 0

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


# ============================================================================
# Tool 36: resolve_targeting_name
# ============================================================================

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
                    search = name.strip().upper().replace("BLOCK ", "").replace("BLOCK", "").strip()
                    await cur.execute(
                        "SELECT id, block_name FROM blocks WHERE society_id = %s AND (UPPER(block_name) = %s OR UPPER(block_name) LIKE %s)",
                        (society_id, search, f"%{search}%"),
                    )
                    rows = await cur.fetchall()
                    if not rows:
                        await cur.execute("SELECT id, block_name FROM blocks WHERE society_id = %s", (society_id,))
                        all_blocks = await cur.fetchall()
                        return {"success": False, "error": f"Block '{name}' not found.", "available_blocks": [r["block_name"] for r in all_blocks]}
                    return {"success": True, "data": {"results": [{"id": r["id"], "name": r["block_name"]} for r in rows]}}

                elif lookup_type == "floor":
                    resolved = await _resolve_floor_name(cur, society_id, name)
                    if not resolved:
                        return {"success": False, "error": f"Could not resolve floor '{name}'. Try 'Block A Floor 2' or 'A-2'."}
                    return {"success": True, "data": resolved}

                elif lookup_type == "unit":
                    resolved = await _resolve_unit_label(cur, society_id, name)
                    if not resolved:
                        return {"success": False, "error": f"Unit '{name}' not found. Use format 'A-302'."}
                    return {"success": True, "data": resolved}

                elif lookup_type == "resident":
                    await cur.execute(
                        """SELECT u.id, u.name, un.display_label AS unit_label
                           FROM users u
                           LEFT JOIN units un ON un.id = u.unit_id
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


# ============================================================================
# Tool Registration
# ============================================================================

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


__all__ = [
    "get_announcement_tools",
    "create_announcement",
    "list_announcements",
    "get_announcement_details",
    "delete_announcement",
    "delete_expired_announcements",
    "get_announcement_read_stats",
    "resolve_targeting_name",
]

