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


def get_all_tools():
    """Return all registered agent tools (society setup + complaints)."""
    return _get_society_tools() + _get_complaint_tools()


__all__ = [
    "get_all_tools",
    # Society tools (existing 17)
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
    # Complaint tools (new 12)
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
