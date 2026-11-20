"""Agent tools package for Sahayak LangGraph assistant."""

from app.graph.tools.society_setup import (
    get_all_tools as _get_society_tools,
    get_society_info,
    update_society_info,
    get_society_structure,
    add_blocks,
    rename_block,
    delete_block,
    add_floors,
    delete_floor,
    add_units,
    edit_unit,
    delete_unit,
    get_dashboard_stats,
    get_residents_list,
    approve_resident,
    reject_resident,
    revoke_resident,
    reactivate_resident,
)

from app.graph.tools.complaints import (
    get_complaint_tools as _get_complaint_tools,
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
)

from app.graph.tools.announcements import (
    get_announcement_tools as _get_announcement_tools,
    create_announcement,
    list_announcements,
    get_announcement_details,
    delete_announcement,
    delete_expired_announcements,
    get_announcement_read_stats,
    resolve_targeting_name,
)


def get_all_tools():
    """Return all registered agent tools (Phase 2A + 2B + 2C = 36 tools)."""
    return _get_society_tools() + _get_complaint_tools() + _get_announcement_tools()


__all__ = [
    "get_all_tools",
    # Society tools (Phase 2A: 17)
    "get_society_info",
    "update_society_info",
    "get_society_structure",
    "add_blocks",
    "rename_block",
    "delete_block",
    "add_floors",
    "delete_floor",
    "add_units",
    "edit_unit",
    "delete_unit",
    "get_dashboard_stats",
    "get_residents_list",
    "approve_resident",
    "reject_resident",
    "revoke_resident",
    "reactivate_resident",
    # Complaint tools (Phase 2B: 12)
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
    # Announcement tools (Phase 2C: 7)
    "create_announcement",
    "list_announcements",
    "get_announcement_details",
    "delete_announcement",
    "delete_expired_announcements",
    "get_announcement_read_stats",
    "resolve_targeting_name",
]
