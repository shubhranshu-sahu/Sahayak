"""
Sahayak AI Assistant — Complaints Management Tools (Phase 2B)

This module implements 12 agent tools for managing the complaint lifecycle,
analytics, and communication threads. All tools enforce strict society isolation
via society_id extracted from LangGraph RunnableConfig.

Tools:
  18. get_complaint_stats        — Dashboard analytics (counts, categories, resolution time, top units)
  19. list_complaints            — Filtered listing with pagination & global summary
  20. get_complaint_details      — Full complaint record + chronological thread
  21. update_complaint_status    — Status transitions (in_progress / pending_closure)
  22. reply_to_complaint         — Secretary posts reply; auto-advances 'open' -> 'in_progress'
  23. reject_complaint           — Reject with mandatory reason (terminal, irreversible)
  24. get_complaints_by_category — Category-scoped complaint listing
  25. get_complaints_by_unit     — Unit-scoped complaint history
  26. get_complaints_by_resident — Resident-scoped complaint history
  27. search_complaints          — Keyword search across title, description, resident, unit
  28. get_complaint_thread       — Lightweight thread-only view
  29. get_resolution_metrics     — SLA turnaround, resolution rate, stale complaints
"""

import logging
from typing import Any, Dict, List, Optional
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from app.database.mysql import get_mysql_pool

logger = logging.getLogger(__name__)


def _extract_society_id(config: Optional[RunnableConfig]) -> Optional[int]:
    """Helper to extract and validate society_id from LangGraph RunnableConfig."""
    if not config:
        return None
    configurable = config.get("configurable", {})
    society_id = configurable.get("society_id")
    if society_id is not None:
        try:
            return int(society_id)
        except (ValueError, TypeError):
            return None
    return None


# ============================================================================
# Tool 18: get_complaint_stats
# ============================================================================

@tool
async def get_complaint_stats(config: RunnableConfig) -> Dict[str, Any]:
    """Get comprehensive complaint analytics for the society: total counts by status
    (open, in_progress, pending_closure, closed, rejected), breakdown by category
    (plumbing, electrical, lift, etc.), average resolution time in hours and days,
    and the top 5 units with the most complaints raised."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Status breakdown
                await cur.execute(
                    """SELECT
                        COUNT(*) AS total,
                        SUM(status = 'open') AS cnt_open,
                        SUM(status = 'in_progress') AS cnt_in_progress,
                        SUM(status = 'pending_closure') AS cnt_pending_closure,
                        SUM(status = 'closed') AS cnt_closed,
                        SUM(status = 'rejected') AS cnt_rejected
                    FROM complaints WHERE society_id = %s""",
                    (society_id,),
                )
                status_row = await cur.fetchone()

                # 2. Category breakdown
                await cur.execute(
                    """SELECT category, COUNT(*) AS cnt
                    FROM complaints WHERE society_id = %s
                    GROUP BY category ORDER BY cnt DESC""",
                    (society_id,),
                )
                category_rows = await cur.fetchall()

                # 3. Average resolution time (only closed complaints with closed_at)
                await cur.execute(
                    """SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, closed_at)) AS avg_hours
                    FROM complaints
                    WHERE society_id = %s AND status = 'closed' AND closed_at IS NOT NULL""",
                    (society_id,),
                )
                time_row = await cur.fetchone()

                # 4. Top 5 units with most complaints
                await cur.execute(
                    """SELECT u.id AS unit_id, u.display_label, u.block_name,
                              u.floor_number, COUNT(c.id) AS complaint_count
                    FROM complaints c
                    JOIN units u ON c.unit_id = u.id
                    WHERE c.society_id = %s
                    GROUP BY u.id, u.display_label, u.block_name, u.floor_number
                    ORDER BY complaint_count DESC
                    LIMIT 5""",
                    (society_id,),
                )
                top_units = await cur.fetchall()

        # Assemble response
        by_category = {}
        for r in category_rows:
            by_category[r["category"]] = int(r["cnt"])

        avg_hours = float(time_row["avg_hours"]) if time_row and time_row.get("avg_hours") else 0.0
        avg_hours = round(avg_hours, 1)
        avg_days = round(avg_hours / 24, 1) if avg_hours > 0 else 0.0

        return {
            "success": True,
            "data": {
                "summary": {
                    "total": int(status_row["total"] or 0),
                    "open": int(status_row["cnt_open"] or 0),
                    "inProgress": int(status_row["cnt_in_progress"] or 0),
                    "pendingClosure": int(status_row["cnt_pending_closure"] or 0),
                    "closed": int(status_row["cnt_closed"] or 0),
                    "rejected": int(status_row["cnt_rejected"] or 0),
                },
                "byCategory": by_category,
                "performance": {
                    "avgResolutionHours": avg_hours,
                    "avgResolutionDays": avg_days,
                },
                "topComplaintUnits": [
                    {
                        "unitId": r["unit_id"],
                        "displayLabel": r["display_label"],
                        "blockName": r["block_name"],
                        "floorNumber": r["floor_number"],
                        "complaintCount": int(r["complaint_count"]),
                    }
                    for r in top_units
                ],
            },
        }
    except Exception as e:
        logger.error("Error in get_complaint_stats: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 19: list_complaints
# ============================================================================

@tool
async def list_complaints(
    config: RunnableConfig,
    status_filter: Optional[str] = None,
    category_filter: Optional[str] = None,
    search_query: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> Dict[str, Any]:
    """List all complaints in the society with optional filters. Supports filtering by:
    - status_filter: 'open', 'in_progress', 'pending_closure', 'closed', 'rejected'
    - category_filter: 'plumbing', 'electrical', 'lift', 'cleanliness', 'security', 'parking', 'noise', 'other'
    - search_query: text to search in title, description, resident name, or unit label
    Returns paginated results along with summary counts across all statuses."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    valid_statuses = ["open", "in_progress", "pending_closure", "closed", "rejected"]
    valid_categories = ["plumbing", "electrical", "lift", "cleanliness", "security", "parking", "noise", "other"]

    if status_filter and status_filter.lower() not in valid_statuses:
        return {"success": False, "error": f"Invalid status. Must be one of: {', '.join(valid_statuses)}"}
    if category_filter and category_filter.lower() not in valid_categories:
        return {"success": False, "error": f"Invalid category. Must be one of: {', '.join(valid_categories)}"}

    page = max(1, page)
    limit = max(1, min(limit, 50))
    offset = (page - 1) * limit

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Summary counts (always unfiltered for the overview badges)
                await cur.execute(
                    """SELECT
                        COUNT(*) AS total,
                        SUM(status = 'open') AS cnt_open,
                        SUM(status = 'in_progress') AS cnt_in_progress,
                        SUM(status = 'pending_closure') AS cnt_pending_closure,
                        SUM(status = 'closed') AS cnt_closed,
                        SUM(status = 'rejected') AS cnt_rejected
                    FROM complaints WHERE society_id = %s""",
                    (society_id,),
                )
                counts_row = await cur.fetchone()

                # 2. Build filtered query
                conditions = ["c.society_id = %s"]
                params: list = [society_id]

                if status_filter:
                    conditions.append("c.status = %s")
                    params.append(status_filter.lower())
                if category_filter:
                    conditions.append("c.category = %s")
                    params.append(category_filter.lower())
                if search_query and search_query.strip():
                    like_pattern = f"%{search_query.strip()}%"
                    conditions.append(
                        "(c.title LIKE %s OR c.description LIKE %s OR u.name LIKE %s OR un.display_label LIKE %s)"
                    )
                    params.extend([like_pattern] * 4)

                where_clause = " AND ".join(conditions)

                # 3. Get filtered total
                count_sql = f"""
                    SELECT COUNT(*) AS total
                    FROM complaints c
                    JOIN users u ON c.resident_id = u.id
                    JOIN units un ON c.unit_id = un.id
                    WHERE {where_clause}
                """
                await cur.execute(count_sql, tuple(params))
                filtered_total = int((await cur.fetchone())["total"])

                # 4. Fetch paginated complaints
                list_sql = f"""
                    SELECT
                        c.id, c.title, c.category, c.category_label,
                        c.status, c.created_at, c.updated_at, c.closed_at,
                        c.rejection_reason,
                        u.id AS resident_id, u.name AS resident_name,
                        u.phone AS resident_phone, u.email AS resident_email,
                        un.id AS unit_id, un.display_label AS unit_label,
                        un.block_name, un.floor_number,
                        (SELECT COUNT(*) FROM complaint_replies WHERE complaint_id = c.id) AS reply_count
                    FROM complaints c
                    JOIN users u ON c.resident_id = u.id
                    JOIN units un ON c.unit_id = un.id
                    WHERE {where_clause}
                    ORDER BY c.created_at DESC
                    LIMIT %s OFFSET %s
                """
                await cur.execute(list_sql, (*params, limit, offset))
                rows = await cur.fetchall()

        complaints = [
            {
                "id": r["id"],
                "title": r["title"],
                "category": r["category"],
                "categoryLabel": r["category_label"],
                "status": r["status"],
                "rejectionReason": r["rejection_reason"],
                "createdAt": str(r["created_at"]) if r.get("created_at") else None,
                "updatedAt": str(r["updated_at"]) if r.get("updated_at") else None,
                "closedAt": str(r["closed_at"]) if r.get("closed_at") else None,
                "replyCount": int(r["reply_count"] or 0),
                "resident": {
                    "id": r["resident_id"],
                    "name": r["resident_name"],
                    "phone": r["resident_phone"],
                    "email": r["resident_email"],
                },
                "unit": {
                    "id": r["unit_id"],
                    "displayLabel": r["unit_label"],
                    "blockName": r["block_name"],
                    "floorNumber": r["floor_number"],
                },
            }
            for r in rows
        ]

        return {
            "success": True,
            "data": {
                "counts": {
                    "total": int(counts_row["total"] or 0),
                    "open": int(counts_row["cnt_open"] or 0),
                    "inProgress": int(counts_row["cnt_in_progress"] or 0),
                    "pendingClosure": int(counts_row["cnt_pending_closure"] or 0),
                    "closed": int(counts_row["cnt_closed"] or 0),
                    "rejected": int(counts_row["cnt_rejected"] or 0),
                },
                "complaints": complaints,
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": filtered_total,
                    "totalPages": max(1, -(-filtered_total // limit)),
                },
            },
        }
    except Exception as e:
        logger.error("Error in list_complaints: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 20: get_complaint_details
# ============================================================================

@tool
async def get_complaint_details(
    config: RunnableConfig,
    complaint_id: int,
) -> Dict[str, Any]:
    """Get full details of a specific complaint including resident info, unit info,
    current status, rejection reason (if rejected), and the complete chronological
    discussion thread with all replies from residents, secretary, and system."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Fetch complaint with resident and unit info
                await cur.execute(
                    """SELECT
                        c.id, c.title, c.category, c.category_label,
                        c.description, c.attachment_url, c.status,
                        c.rejection_reason, c.closed_at, c.created_at, c.updated_at,
                        u.id AS resident_id, u.name AS resident_name,
                        u.email AS resident_email, u.phone AS resident_phone,
                        un.id AS unit_id, un.display_label AS unit_label,
                        un.block_name, un.floor_number
                    FROM complaints c
                    JOIN users u ON c.resident_id = u.id
                    JOIN units un ON c.unit_id = un.id
                    WHERE c.id = %s AND c.society_id = %s""",
                    (complaint_id, society_id),
                )
                complaint = await cur.fetchone()

                if not complaint:
                    return {"success": False, "error": f"Complaint #{complaint_id} not found in this society."}

                # 2. Fetch discussion thread (chronological)
                await cur.execute(
                    """SELECT
                        r.id, r.sender_id, r.sender_role, r.message,
                        r.attachment_url, r.created_at,
                        u.name AS sender_name
                    FROM complaint_replies r
                    LEFT JOIN users u ON r.sender_id = u.id
                    WHERE r.complaint_id = %s
                    ORDER BY r.created_at ASC""",
                    (complaint_id,),
                )
                replies = await cur.fetchall()

        thread = [
            {
                "id": r["id"],
                "senderId": r["sender_id"],
                "senderRole": r["sender_role"],
                "senderName": "System" if r["sender_role"] == "system" else (r["sender_name"] or "Unknown"),
                "message": r["message"],
                "attachmentUrl": r["attachment_url"],
                "createdAt": str(r["created_at"]) if r.get("created_at") else None,
            }
            for r in replies
        ]

        c = complaint
        return {
            "success": True,
            "data": {
                "complaint": {
                    "id": c["id"],
                    "title": c["title"],
                    "category": c["category"],
                    "categoryLabel": c["category_label"],
                    "description": c["description"],
                    "attachmentUrl": c["attachment_url"],
                    "status": c["status"],
                    "rejectionReason": c["rejection_reason"],
                    "createdAt": str(c["created_at"]) if c.get("created_at") else None,
                    "updatedAt": str(c["updated_at"]) if c.get("updated_at") else None,
                    "closedAt": str(c["closed_at"]) if c.get("closed_at") else None,
                },
                "resident": {
                    "id": c["resident_id"],
                    "name": c["resident_name"],
                    "email": c["resident_email"],
                    "phone": c["resident_phone"],
                },
                "unit": {
                    "id": c["unit_id"],
                    "displayLabel": c["unit_label"],
                    "blockName": c["block_name"],
                    "floorNumber": c["floor_number"],
                },
                "thread": thread,
                "totalReplies": len(thread),
            },
        }
    except Exception as e:
        logger.error("Error in get_complaint_details: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 21: update_complaint_status
# ============================================================================

@tool
async def update_complaint_status(
    config: RunnableConfig,
    complaint_id: int,
    new_status: str,
) -> Dict[str, Any]:
    """Update a complaint's status to 'in_progress' or 'pending_closure'.
    Cannot set status to 'closed' (only the resident can confirm closure) or
    'rejected' (use the reject_complaint tool instead, which requires a reason).
    Automatically inserts a status-change notification in the complaint thread."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    allowed = ["in_progress", "pending_closure"]
    new_status_lower = new_status.strip().lower()

    if new_status_lower == "closed":
        return {
            "success": False,
            "error": "Secretary cannot directly close a complaint. Set status to 'pending_closure' — the resident must confirm resolution, or it auto-closes after 7 days."
        }
    if new_status_lower == "rejected":
        return {
            "success": False,
            "error": "Use the reject_complaint tool instead, which requires a rejection reason."
        }
    if new_status_lower not in allowed:
        return {"success": False, "error": f"Invalid status. Must be one of: {', '.join(allowed)}"}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Fetch and verify complaint
                await cur.execute(
                    "SELECT id, status, title FROM complaints WHERE id = %s AND society_id = %s",
                    (complaint_id, society_id),
                )
                complaint = await cur.fetchone()

                if not complaint:
                    return {"success": False, "error": f"Complaint #{complaint_id} not found in this society."}

                current = complaint["status"]

                # 2. Terminal state checks
                if current == "closed":
                    return {"success": False, "error": f"Complaint #{complaint_id} is already closed. No further status changes allowed."}
                if current == "rejected":
                    return {"success": False, "error": f"Complaint #{complaint_id} is already rejected. No further status changes allowed."}

                # 3. Prevent no-op transitions
                if current == new_status_lower:
                    return {"success": True, "message": f"Complaint #{complaint_id} is already '{current}'. No change needed."}

                # 4. Update status
                await cur.execute(
                    "UPDATE complaints SET status = %s WHERE id = %s",
                    (new_status_lower, complaint_id),
                )

                # 5. Insert status-change notification reply
                if new_status_lower == "pending_closure":
                    system_msg = "Secretary marked this complaint as Pending Closure. Awaiting resident confirmation."
                else:
                    system_msg = "Secretary marked this complaint as In Progress."

                await cur.execute(
                    """INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message)
                       VALUES (%s, NULL, 'system', %s)""",
                    (complaint_id, system_msg),
                )
                await conn.commit()

        status_label = "Pending Closure" if new_status_lower == "pending_closure" else "In Progress"
        return {
            "success": True,
            "message": f"Complaint #{complaint_id} ('{complaint['title']}') status updated from '{current}' to '{status_label}'.",
            "data": {
                "complaintId": complaint_id,
                "previousStatus": current,
                "newStatus": new_status_lower,
            },
        }
    except Exception as e:
        logger.error("Error in update_complaint_status: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 22: reply_to_complaint
# ============================================================================

@tool
async def reply_to_complaint(
    config: RunnableConfig,
    complaint_id: int,
    message: str,
) -> Dict[str, Any]:
    """Post a secretary reply in a complaint's discussion thread. The message
    will be visible to both the resident and secretary. If the complaint is
    currently 'open', it is automatically advanced to 'in_progress'.
    Cannot reply to 'closed' or 'rejected' complaints."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    if not message or not message.strip():
        return {"success": False, "error": "Message cannot be empty."}

    clean_message = message.strip()
    if len(clean_message) < 2:
        return {"success": False, "error": "Reply message is too short (minimum 2 characters)."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Fetch complaint
                await cur.execute(
                    "SELECT id, status, title FROM complaints WHERE id = %s AND society_id = %s",
                    (complaint_id, society_id),
                )
                complaint = await cur.fetchone()

                if not complaint:
                    return {"success": False, "error": f"Complaint #{complaint_id} not found in this society."}

                current_status = complaint["status"]

                # 2. Terminal state checks
                if current_status == "closed":
                    return {"success": False, "error": f"Cannot reply to complaint #{complaint_id}: it is already closed."}
                if current_status == "rejected":
                    return {"success": False, "error": f"Cannot reply to complaint #{complaint_id}: it is already rejected."}

                # 3. Auto-advance: open -> in_progress on secretary reply
                status_advanced = False
                if current_status == "open":
                    await cur.execute(
                        "UPDATE complaints SET status = 'in_progress' WHERE id = %s",
                        (complaint_id,),
                    )
                    status_advanced = True

                # 4. Insert secretary reply (sender_role = 'secretary', sender_id = NULL for AI agent)
                await cur.execute(
                    """INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message)
                       VALUES (%s, NULL, 'secretary', %s)""",
                    (complaint_id, clean_message),
                )
                reply_id = cur.lastrowid
                await conn.commit()

        result_msg = f"Reply posted to complaint #{complaint_id} ('{complaint['title']}')."
        if status_advanced:
            result_msg += " Status automatically advanced from 'open' to 'in_progress'."

        return {
            "success": True,
            "message": result_msg,
            "data": {
                "replyId": reply_id,
                "complaintId": complaint_id,
                "senderRole": "secretary",
                "statusAdvanced": status_advanced,
            },
        }
    except Exception as e:
        logger.error("Error in reply_to_complaint: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 23: reject_complaint
# ============================================================================

@tool
async def reject_complaint(
    config: RunnableConfig,
    complaint_id: int,
    rejection_reason: str,
) -> Dict[str, Any]:
    """Reject a complaint with a mandatory reason. This is a TERMINAL action — the complaint
    cannot be reopened or replied to after rejection. The rejection reason must be at least
    5 characters and will be visible to the resident. Cannot reject already closed or rejected complaints."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    if not rejection_reason or not rejection_reason.strip():
        return {"success": False, "error": "Rejection reason is required."}

    clean_reason = rejection_reason.strip()
    if len(clean_reason) < 5:
        return {"success": False, "error": "Rejection reason must be at least 5 characters."}
    if len(clean_reason) > 500:
        return {"success": False, "error": "Rejection reason must be under 500 characters."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Fetch complaint
                await cur.execute(
                    "SELECT id, status, title FROM complaints WHERE id = %s AND society_id = %s",
                    (complaint_id, society_id),
                )
                complaint = await cur.fetchone()

                if not complaint:
                    return {"success": False, "error": f"Complaint #{complaint_id} not found in this society."}

                current = complaint["status"]
                if current == "closed":
                    return {"success": False, "error": f"Complaint #{complaint_id} is already closed. Cannot reject."}
                if current == "rejected":
                    return {"success": False, "error": f"Complaint #{complaint_id} is already rejected."}

                # 2. Update to rejected with reason
                await cur.execute(
                    "UPDATE complaints SET status = 'rejected', rejection_reason = %s WHERE id = %s",
                    (clean_reason, complaint_id),
                )

                # 3. Insert rejection notification reply
                await cur.execute(
                    """INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message)
                       VALUES (%s, NULL, 'system', %s)""",
                    (complaint_id, f"Secretary rejected this complaint. Reason: {clean_reason}"),
                )
                await conn.commit()

        return {
            "success": True,
            "message": f"Complaint #{complaint_id} ('{complaint['title']}') has been rejected. Reason: {clean_reason}",
            "data": {
                "complaintId": complaint_id,
                "previousStatus": current,
                "newStatus": "rejected",
                "rejectionReason": clean_reason,
            },
        }
    except Exception as e:
        logger.error("Error in reject_complaint: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 24: get_complaints_by_category
# ============================================================================

@tool
async def get_complaints_by_category(
    config: RunnableConfig,
    category: str,
    status_filter: Optional[str] = None,
) -> Dict[str, Any]:
    """Get complaints filtered by category (plumbing, electrical, lift, cleanliness,
    security, parking, noise, other). Optionally further filter by status.
    Returns a summary count and complaint list for the specified category."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    valid_categories = ["plumbing", "electrical", "lift", "cleanliness", "security", "parking", "noise", "other"]
    category_lower = category.strip().lower()
    if category_lower not in valid_categories:
        return {"success": False, "error": f"Invalid category. Must be one of: {', '.join(valid_categories)}"}

    valid_statuses = ["open", "in_progress", "pending_closure", "closed", "rejected"]
    if status_filter and status_filter.lower() not in valid_statuses:
        return {"success": False, "error": f"Invalid status filter. Must be one of: {', '.join(valid_statuses)}"}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                conditions = ["c.society_id = %s", "c.category = %s"]
                params: list = [society_id, category_lower]

                if status_filter:
                    conditions.append("c.status = %s")
                    params.append(status_filter.lower())

                where_clause = " AND ".join(conditions)

                await cur.execute(
                    f"""SELECT
                        c.id, c.title, c.status, c.category_label,
                        c.created_at, c.updated_at,
                        u.name AS resident_name,
                        un.display_label AS unit_label
                    FROM complaints c
                    JOIN users u ON c.resident_id = u.id
                    JOIN units un ON c.unit_id = un.id
                    WHERE {where_clause}
                    ORDER BY c.created_at DESC
                    LIMIT 50""",
                    tuple(params),
                )
                rows = await cur.fetchall()

        complaints = [
            {
                "id": r["id"],
                "title": r["title"],
                "status": r["status"],
                "categoryLabel": r["category_label"],
                "residentName": r["resident_name"],
                "unitLabel": r["unit_label"],
                "createdAt": str(r["created_at"]) if r.get("created_at") else None,
            }
            for r in rows
        ]

        return {
            "success": True,
            "data": {
                "category": category_lower,
                "statusFilter": status_filter,
                "totalCount": len(complaints),
                "complaints": complaints,
            },
        }
    except Exception as e:
        logger.error("Error in get_complaints_by_category: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 25: get_complaints_by_unit
# ============================================================================

@tool
async def get_complaints_by_unit(
    config: RunnableConfig,
    unit_id: int,
) -> Dict[str, Any]:
    """Get all complaints raised from a specific unit. Returns the unit details
    and a chronological list of all complaints from that unit with status and category."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Verify unit belongs to society
                await cur.execute(
                    "SELECT id, display_label, block_name, floor_number, status FROM units WHERE id = %s AND society_id = %s",
                    (unit_id, society_id),
                )
                unit = await cur.fetchone()
                if not unit:
                    return {"success": False, "error": f"Unit with ID {unit_id} not found in this society."}

                # 2. Fetch complaints for this unit
                await cur.execute(
                    """SELECT
                        c.id, c.title, c.category, c.category_label,
                        c.status, c.created_at, c.updated_at, c.closed_at,
                        u.name AS resident_name
                    FROM complaints c
                    JOIN users u ON c.resident_id = u.id
                    WHERE c.unit_id = %s AND c.society_id = %s
                    ORDER BY c.created_at DESC""",
                    (unit_id, society_id),
                )
                rows = await cur.fetchall()

        complaints = [
            {
                "id": r["id"],
                "title": r["title"],
                "category": r["category"],
                "categoryLabel": r["category_label"],
                "status": r["status"],
                "residentName": r["resident_name"],
                "createdAt": str(r["created_at"]) if r.get("created_at") else None,
                "closedAt": str(r["closed_at"]) if r.get("closed_at") else None,
            }
            for r in rows
        ]

        return {
            "success": True,
            "data": {
                "unit": {
                    "id": unit["id"],
                    "displayLabel": unit["display_label"],
                    "blockName": unit["block_name"],
                    "floorNumber": unit["floor_number"],
                    "occupancyStatus": unit["status"],
                },
                "totalComplaints": len(complaints),
                "complaints": complaints,
            },
        }
    except Exception as e:
        logger.error("Error in get_complaints_by_unit: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 26: get_complaints_by_resident
# ============================================================================

@tool
async def get_complaints_by_resident(
    config: RunnableConfig,
    resident_id: int,
) -> Dict[str, Any]:
    """Get all complaints filed by a specific resident. Returns the resident's details
    and a chronological list of their complaints with status and category."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Verify resident belongs to society
                await cur.execute(
                    """SELECT id, name, email, phone, status AS user_status
                    FROM users WHERE id = %s AND society_id = %s AND role = 'resident'""",
                    (resident_id, society_id),
                )
                resident = await cur.fetchone()
                if not resident:
                    return {"success": False, "error": f"Resident with ID {resident_id} not found in this society."}

                # 2. Fetch complaints
                await cur.execute(
                    """SELECT
                        c.id, c.title, c.category, c.category_label,
                        c.status, c.created_at, c.updated_at, c.closed_at,
                        un.display_label AS unit_label
                    FROM complaints c
                    JOIN units un ON c.unit_id = un.id
                    WHERE c.resident_id = %s AND c.society_id = %s
                    ORDER BY c.created_at DESC""",
                    (resident_id, society_id),
                )
                rows = await cur.fetchall()

        complaints = [
            {
                "id": r["id"],
                "title": r["title"],
                "category": r["category"],
                "categoryLabel": r["category_label"],
                "status": r["status"],
                "unitLabel": r["unit_label"],
                "createdAt": str(r["created_at"]) if r.get("created_at") else None,
                "closedAt": str(r["closed_at"]) if r.get("closed_at") else None,
            }
            for r in rows
        ]

        return {
            "success": True,
            "data": {
                "resident": {
                    "id": resident["id"],
                    "name": resident["name"],
                    "email": resident["email"],
                    "phone": resident["phone"],
                    "accountStatus": resident["user_status"],
                },
                "totalComplaints": len(complaints),
                "complaints": complaints,
            },
        }
    except Exception as e:
        logger.error("Error in get_complaints_by_resident: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 27: search_complaints
# ============================================================================

@tool
async def search_complaints(
    config: RunnableConfig,
    query: str,
    limit: int = 20,
) -> Dict[str, Any]:
    """Search complaints by keyword across title, description, resident name, and unit label.
    Returns matching complaints ordered by relevance (newest first). Minimum 2 characters required."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    if not query or len(query.strip()) < 2:
        return {"success": False, "error": "Search query must be at least 2 characters."}

    clean_query = query.strip()
    like_pattern = f"%{clean_query}%"
    limit = max(1, min(limit, 50))

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """SELECT
                        c.id, c.title, c.category, c.status, c.description,
                        c.created_at,
                        u.name AS resident_name,
                        un.display_label AS unit_label
                    FROM complaints c
                    JOIN users u ON c.resident_id = u.id
                    JOIN units un ON c.unit_id = un.id
                    WHERE c.society_id = %s
                      AND (c.title LIKE %s OR c.description LIKE %s
                           OR u.name LIKE %s OR un.display_label LIKE %s)
                    ORDER BY c.created_at DESC
                    LIMIT %s""",
                    (society_id, like_pattern, like_pattern, like_pattern, like_pattern, limit),
                )
                rows = await cur.fetchall()

        results = [
            {
                "id": r["id"],
                "title": r["title"],
                "category": r["category"],
                "status": r["status"],
                "description": r["description"][:200] + "..." if r["description"] and len(r["description"]) > 200 else r["description"],
                "residentName": r["resident_name"],
                "unitLabel": r["unit_label"],
                "createdAt": str(r["created_at"]) if r.get("created_at") else None,
            }
            for r in rows
        ]

        return {
            "success": True,
            "data": {
                "query": clean_query,
                "matchCount": len(results),
                "results": results,
            },
        }
    except Exception as e:
        logger.error("Error in search_complaints: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 28: get_complaint_thread
# ============================================================================

@tool
async def get_complaint_thread(
    config: RunnableConfig,
    complaint_id: int,
) -> Dict[str, Any]:
    """Get the discussion thread (all replies) for a specific complaint.
    Returns chronological messages from residents, secretary, and system.
    Use get_complaint_details for the full complaint + thread together."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Verify complaint belongs to society
                await cur.execute(
                    "SELECT id, title, status FROM complaints WHERE id = %s AND society_id = %s",
                    (complaint_id, society_id),
                )
                complaint = await cur.fetchone()
                if not complaint:
                    return {"success": False, "error": f"Complaint #{complaint_id} not found in this society."}

                # Fetch thread
                await cur.execute(
                    """SELECT
                        r.id, r.sender_id, r.sender_role, r.message,
                        r.attachment_url, r.created_at,
                        u.name AS sender_name
                    FROM complaint_replies r
                    LEFT JOIN users u ON r.sender_id = u.id
                    WHERE r.complaint_id = %s
                    ORDER BY r.created_at ASC""",
                    (complaint_id,),
                )
                replies = await cur.fetchall()

        thread = [
            {
                "id": r["id"],
                "senderRole": r["sender_role"],
                "senderName": "System" if r["sender_role"] == "system" else (r["sender_name"] or "Unknown"),
                "message": r["message"],
                "hasAttachment": bool(r["attachment_url"]),
                "createdAt": str(r["created_at"]) if r.get("created_at") else None,
            }
            for r in replies
        ]

        return {
            "success": True,
            "data": {
                "complaintId": complaint_id,
                "complaintTitle": complaint["title"],
                "complaintStatus": complaint["status"],
                "totalReplies": len(thread),
                "thread": thread,
            },
        }
    except Exception as e:
        logger.error("Error in get_complaint_thread: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool 29: get_resolution_metrics
# ============================================================================

@tool
async def get_resolution_metrics(
    config: RunnableConfig,
    category_filter: Optional[str] = None,
) -> Dict[str, Any]:
    """Get detailed resolution performance metrics: average resolution time,
    resolution rate (% of total that reached 'closed'), count of stale complaints
    (in_progress or pending_closure for more than 72 hours), and optionally filtered by category."""

    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    valid_categories = ["plumbing", "electrical", "lift", "cleanliness", "security", "parking", "noise", "other"]
    if category_filter and category_filter.lower() not in valid_categories:
        return {"success": False, "error": f"Invalid category. Must be one of: {', '.join(valid_categories)}"}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                base_condition = "society_id = %s"
                params: list = [society_id]

                if category_filter:
                    base_condition += " AND category = %s"
                    params.append(category_filter.lower())

                # 1. Total and closed counts
                await cur.execute(
                    f"""SELECT
                        COUNT(*) AS total,
                        SUM(status = 'closed') AS closed_count
                    FROM complaints WHERE {base_condition}""",
                    tuple(params),
                )
                count_row = await cur.fetchone()
                total = int(count_row["total"] or 0)
                closed = int(count_row["closed_count"] or 0)

                # 2. Average resolution time
                await cur.execute(
                    f"""SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, closed_at)) AS avg_hours
                    FROM complaints
                    WHERE {base_condition} AND status = 'closed' AND closed_at IS NOT NULL""",
                    tuple(params),
                )
                time_row = await cur.fetchone()
                avg_hours = round(float(time_row["avg_hours"]), 1) if time_row and time_row.get("avg_hours") else 0.0

                # 3. Stale complaints (in_progress or pending_closure > 72 hours)
                await cur.execute(
                    f"""SELECT COUNT(*) AS stale_count
                    FROM complaints
                    WHERE {base_condition}
                      AND status IN ('in_progress', 'pending_closure')
                      AND updated_at < NOW() - INTERVAL 72 HOUR""",
                    tuple(params),
                )
                stale_row = await cur.fetchone()
                stale_count = int(stale_row["stale_count"] or 0)

                # 4. Active (non-terminal) complaints
                await cur.execute(
                    f"""SELECT COUNT(*) AS active_count
                    FROM complaints
                    WHERE {base_condition}
                      AND status IN ('open', 'in_progress', 'pending_closure')""",
                    tuple(params),
                )
                active_row = await cur.fetchone()
                active_count = int(active_row["active_count"] or 0)

        resolution_rate = round((closed / total * 100), 1) if total > 0 else 0.0

        return {
            "success": True,
            "data": {
                "categoryFilter": category_filter,
                "totalComplaints": total,
                "closedComplaints": closed,
                "activeComplaints": active_count,
                "resolutionRate": resolution_rate,
                "avgResolutionHours": avg_hours,
                "avgResolutionDays": round(avg_hours / 24, 1) if avg_hours > 0 else 0.0,
                "staleComplaints": stale_count,
                "staleThresholdHours": 72,
            },
        }
    except Exception as e:
        logger.error("Error in get_resolution_metrics: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# ============================================================================
# Tool Registration
# ============================================================================

def get_complaint_tools() -> List[Any]:
    """Return all 12 complaint management tools as a flat list."""
    return [
        get_complaint_stats,
        list_complaints,
        get_complaint_details,
        update_complaint_status,
        reply_to_complaint,
        reject_complaint,
        get_complaints_by_category,
        get_complaints_by_unit,
        get_complaints_by_resident,
        search_complaints,
        get_complaint_thread,
        get_resolution_metrics,
    ]


__all__ = [
    "get_complaint_tools",
    "get_complaint_stats",
    "list_complaints",
    "get_complaint_details",
    "update_complaint_status",
    "reply_to_complaint",
    "reject_complaint",
    "get_complaints_by_category",
    "get_complaints_by_unit",
    "get_complaints_by_resident",
    "search_complaints",
    "get_complaint_thread",
    "get_resolution_metrics",
]
