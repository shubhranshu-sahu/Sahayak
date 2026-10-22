"""
Sahayak AI Assistant — Society Setup & Management Tools (Phase 2A)

This module implements the 17 agent tools for managing society configuration,
building structure (blocks, floors, units), and resident approvals directly
against MySQL using connection pooling via aiomysql.

All tools enforce society isolation: `society_id` is extracted strictly from
the LangGraph `RunnableConfig` (injected from verified JWT auth claims),
preventing any cross-society data leakage or tampering by LLM hallucinations.
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


# =============================================================================
# 1. Society Configuration Tools
# =============================================================================

@tool
async def get_society_info(config: RunnableConfig) -> Dict[str, Any]:
    """Get the full configuration of the current society including name, society_code,
    address, city, state, pincode, active status, and metadata."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """SELECT id, name, society_code, address, city, state, pincode,
                              is_active, metadata, created_at, updated_at
                       FROM societies WHERE id = %s""",
                    (society_id,),
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
                "createdAt": str(row["created_at"]) if row.get("created_at") else None,
                "updatedAt": str(row["updated_at"]) if row.get("updated_at") else None,
            },
        }
    except Exception as e:
        logger.error("Error in get_society_info: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def update_society_info(
    config: RunnableConfig,
    name: Optional[str] = None,
    address: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    pincode: Optional[str] = None,
) -> Dict[str, Any]:
    """Update society configuration fields. Pass only the fields you want to change.
    Cannot update society_code or is_active through this tool."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    updates = []
    values = []
    if name is not None and name.strip():
        updates.append("name = %s")
        values.append(name.strip())
    if address is not None and address.strip():
        updates.append("address = %s")
        values.append(address.strip())
    if city is not None and city.strip():
        updates.append("city = %s")
        values.append(city.strip())
    if state is not None and state.strip():
        updates.append("state = %s")
        values.append(state.strip())
    if pincode is not None and pincode.strip():
        updates.append("pincode = %s")
        values.append(pincode.strip())

    if not updates:
        return {"success": False, "error": "No valid fields provided to update."}

    values.append(society_id)
    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    f"UPDATE societies SET {', '.join(updates)} WHERE id = %s",
                    tuple(values),
                )
                await conn.commit()

        return {"success": True, "message": "Society information updated successfully."}
    except Exception as e:
        logger.error("Error in update_society_info: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# =============================================================================
# 2. Society Structure & Layout Tools
# =============================================================================

@tool
async def get_society_structure(config: RunnableConfig) -> Dict[str, Any]:
    """Get the complete hierarchical structure of the society: all blocks, their floors,
    and all units on each floor including unit status (vacant/occupied), type, and area.
    Use this tool whenever you need to understand the current building layout."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Blocks
                await cur.execute(
                    "SELECT id, block_name FROM blocks WHERE society_id = %s ORDER BY block_name",
                    (society_id,),
                )
                blocks = await cur.fetchall()

                # 2. Floors
                await cur.execute(
                    "SELECT id, block_id, floor_number FROM floors WHERE society_id = %s ORDER BY floor_number",
                    (society_id,),
                )
                floors = await cur.fetchall()

                # 3. Units
                await cur.execute(
                    """SELECT id, floor_id, block_id, unit_number, display_label, status, unit_type, area_sqft
                       FROM units WHERE society_id = %s ORDER BY unit_number""",
                    (society_id,),
                )
                units = await cur.fetchall()

        # Group floors by block_id
        floor_map: Dict[int, List[Dict[str, Any]]] = {}
        for f in floors:
            floor_map.setdefault(f["block_id"], []).append({
                "id": f["id"],
                "floorNumber": f["floor_number"],
                "units": [],
            })

        # Group units by floor_id
        unit_map: Dict[int, List[Dict[str, Any]]] = {}
        for u in units:
            unit_map.setdefault(u["floor_id"], []).append({
                "id": u["id"],
                "unitNumber": u["unit_number"],
                "displayLabel": u["display_label"],
                "status": u["status"],
                "unitType": u["unit_type"],
                "areaSqft": u["area_sqft"],
            })

        # Assemble tree hierarchy
        structure = []
        for b in blocks:
            b_id = b["id"]
            block_floors = floor_map.get(b_id, [])
            for fl in block_floors:
                fl["units"] = unit_map.get(fl["id"], [])
            structure.append({
                "id": b_id,
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
            },
        }
    except Exception as e:
        logger.error("Error in get_society_structure: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def add_blocks(config: RunnableConfig, block_names: List[str]) -> Dict[str, Any]:
    """Add one or more new blocks to the society. Each block_name must be
    letters only (e.g., 'A', 'B', 'Tower A'). Duplicates within the society are rejected."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    if not block_names:
        return {"success": False, "error": "Please provide at least one block name."}

    created = []
    errors = []

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                for name in block_names:
                    clean_name = name.strip().upper()
                    if not clean_name:
                        continue
                    try:
                        await cur.execute(
                            "INSERT INTO blocks (society_id, block_name) VALUES (%s, %s)",
                            (society_id, clean_name),
                        )
                        await conn.commit()
                        created.append({"blockId": cur.lastrowid, "blockName": clean_name})
                    except Exception as e:
                        err_str = str(e)
                        if "Duplicate" in err_str or "uq_" in err_str.lower():
                            errors.append(f"Block '{clean_name}' already exists.")
                        else:
                            errors.append(f"Block '{clean_name}': {err_str}")

        result: Dict[str, Any] = {"success": len(created) > 0, "created": created}
        if errors:
            result["errors"] = errors
        if not created:
            result["error"] = "No blocks were created due to validation or duplicate errors."
        else:
            result["message"] = f"Successfully created {len(created)} block(s): {', '.join([b['blockName'] for b in created])}."
        return result
    except Exception as e:
        logger.error("Error in add_blocks: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def rename_block(config: RunnableConfig, block_id: int, new_name: str) -> Dict[str, Any]:
    """Rename an existing block. The new_name must be uppercase letters only."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    new_name_clean = new_name.strip().upper()
    if not new_name_clean:
        return {"success": False, "error": "New block name cannot be empty."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Verify block belongs to society
                await cur.execute(
                    "SELECT id, block_name FROM blocks WHERE id = %s AND society_id = %s",
                    (block_id, society_id),
                )
                block = await cur.fetchone()
                if not block:
                    return {"success": False, "error": f"Block with ID {block_id} not found in this society."}

                old_name = block["block_name"]
                if old_name == new_name_clean:
                    return {"success": True, "message": f"Block is already named '{old_name}'."}

                # 2. Check for duplicate block name
                await cur.execute(
                    "SELECT id FROM blocks WHERE society_id = %s AND block_name = %s AND id != %s",
                    (society_id, new_name_clean, block_id),
                )
                if await cur.fetchone():
                    return {"success": False, "error": f"Block '{new_name_clean}' already exists in this society."}

                # 3. Update block and denormalized units
                await cur.execute("UPDATE blocks SET block_name = %s WHERE id = %s", (new_name_clean, block_id))
                await cur.execute(
                    "UPDATE units SET block_name = %s WHERE block_id = %s AND society_id = %s",
                    (new_name_clean, block_id, society_id),
                )
                await conn.commit()

        return {
            "success": True,
            "message": f"Block renamed from '{old_name}' to '{new_name_clean}'. Unit labels have been updated.",
        }
    except Exception as e:
        logger.error("Error in rename_block: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def delete_block(config: RunnableConfig, block_id: int) -> Dict[str, Any]:
    """Delete a block from the society. The block must have zero floors and zero units.
    If it has floors or units, they must be deleted first."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, block_name FROM blocks WHERE id = %s AND society_id = %s",
                    (block_id, society_id),
                )
                block = await cur.fetchone()
                if not block:
                    return {"success": False, "error": f"Block with ID {block_id} not found in this society."}

                # Check for existing floors
                await cur.execute("SELECT COUNT(*) as cnt FROM floors WHERE block_id = %s", (block_id,))
                floor_row = await cur.fetchone()
                floor_count = floor_row["cnt"] if floor_row else 0
                if floor_count > 0:
                    return {
                        "success": False,
                        "error": f"Cannot delete Block '{block['block_name']}': it contains {floor_count} floor(s). Delete all floors and units first.",
                    }

                await cur.execute("DELETE FROM blocks WHERE id = %s AND society_id = %s", (block_id, society_id))
                await conn.commit()

        return {"success": True, "message": f"Block '{block['block_name']}' deleted successfully."}
    except Exception as e:
        logger.error("Error in delete_block: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# =============================================================================
# 3. Floor Management Tools
# =============================================================================

@tool
async def add_floors(config: RunnableConfig, block_id: int, total_floors: int) -> Dict[str, Any]:
    """Add multiple floors to a block. Floors are auto-numbered starting from the
    next available floor number. For example, if Block A has floors 1-3, adding 2 floors
    creates floors 4 and 5."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    if total_floors < 1 or total_floors > 50:
        return {"success": False, "error": "total_floors must be between 1 and 50."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Verify block
                await cur.execute(
                    "SELECT id, block_name FROM blocks WHERE id = %s AND society_id = %s",
                    (block_id, society_id),
                )
                block = await cur.fetchone()
                if not block:
                    return {"success": False, "error": f"Block with ID {block_id} not found in this society."}

                # 2. Get current max floor
                await cur.execute(
                    "SELECT IFNULL(MAX(floor_number), 0) AS max_floor FROM floors WHERE block_id = %s",
                    (block_id,),
                )
                max_row = await cur.fetchone()
                current_max = int(max_row["max_floor"]) if max_row else 0
                start_floor = current_max + 1

                for i in range(total_floors):
                    floor_num = start_floor + i
                    await cur.execute(
                        "INSERT INTO floors (block_id, society_id, floor_number) VALUES (%s, %s, %s)",
                        (block_id, society_id, floor_num),
                    )
                await conn.commit()

        end_floor = start_floor + total_floors - 1
        return {
            "success": True,
            "message": f"Added {total_floors} floor(s) to Block {block['block_name']} (floors {start_floor} to {end_floor}).",
            "data": {
                "blockId": block_id,
                "blockName": block["block_name"],
                "floorsCreated": total_floors,
                "floorRange": f"{start_floor}-{end_floor}",
            },
        }
    except Exception as e:
        logger.error("Error in add_floors: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def delete_floor(config: RunnableConfig, floor_id: int) -> Dict[str, Any]:
    """Delete a floor. The floor must have zero units. If it has units, they must be
    deleted first."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, block_id, floor_number FROM floors WHERE id = %s AND society_id = %s",
                    (floor_id, society_id),
                )
                floor = await cur.fetchone()
                if not floor:
                    return {"success": False, "error": f"Floor with ID {floor_id} not found in this society."}

                await cur.execute("SELECT COUNT(*) as cnt FROM units WHERE floor_id = %s", (floor_id,))
                unit_row = await cur.fetchone()
                unit_count = unit_row["cnt"] if unit_row else 0
                if unit_count > 0:
                    return {
                        "success": False,
                        "error": f"Floor {floor['floor_number']} has {unit_count} unit(s). Delete units first before deleting the floor.",
                    }

                await cur.execute("DELETE FROM floors WHERE id = %s AND society_id = %s", (floor_id, society_id))
                await conn.commit()

        return {"success": True, "message": f"Floor {floor['floor_number']} deleted successfully."}
    except Exception as e:
        logger.error("Error in delete_floor: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# =============================================================================
# 4. Unit Management Tools
# =============================================================================

@tool
async def add_units(
    config: RunnableConfig,
    floor_id: int,
    start_unit: int,
    end_unit: int,
    unit_type: str = "apartment",
    area_sqft: Optional[int] = None,
) -> Dict[str, Any]:
    """Add units to a floor in bulk. Units are numbered from start_unit to end_unit
    (inclusive). Unit numbers must be between 1 and 99. Display labels are auto-generated
    as 'BlockName-FloorUnit' (e.g., A-101, B-203). unit_type defaults to 'apartment'.
    Existing unit numbers on the floor are skipped (not duplicated)."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    if start_unit < 1 or end_unit > 99 or start_unit > end_unit:
        return {"success": False, "error": "Unit numbers must be 1-99 and start_unit <= end_unit."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Fetch floor + block info
                await cur.execute(
                    """SELECT f.id, f.block_id, f.floor_number, b.block_name
                       FROM floors f JOIN blocks b ON f.block_id = b.id
                       WHERE f.id = %s AND f.society_id = %s""",
                    (floor_id, society_id),
                )
                floor = await cur.fetchone()
                if not floor:
                    return {"success": False, "error": f"Floor with ID {floor_id} not found in this society."}

                created = 0
                skipped = 0
                for i in range(start_unit, end_unit + 1):
                    # Check if unit already exists on this floor
                    await cur.execute(
                        "SELECT id FROM units WHERE floor_id = %s AND unit_number = %s",
                        (floor_id, i),
                    )
                    if await cur.fetchone():
                        skipped += 1
                        continue

                    # Insert unit (display_label is auto-generated by MySQL)
                    await cur.execute(
                        """INSERT INTO units
                           (floor_id, block_id, society_id, block_name, floor_number,
                            unit_number, unit_type, area_sqft, status)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'vacant')""",
                        (
                            floor_id,
                            floor["block_id"],
                            society_id,
                            floor["block_name"],
                            floor["floor_number"],
                            i,
                            unit_type,
                            area_sqft,
                        ),
                    )
                    created += 1

                await conn.commit()

        msg = f"Created {created} unit(s) on Floor {floor['floor_number']} of Block {floor['block_name']}."
        if skipped > 0:
            msg += f" {skipped} existing unit(s) were skipped."

        return {
            "success": True,
            "message": msg,
            "data": {
                "floorId": floor_id,
                "blockName": floor["block_name"],
                "floorNumber": floor["floor_number"],
                "created": created,
                "skipped": skipped,
            },
        }
    except Exception as e:
        logger.error("Error in add_units: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def edit_unit(
    config: RunnableConfig,
    unit_id: int,
    unit_type: Optional[str] = None,
    area_sqft: Optional[int] = None,
) -> Dict[str, Any]:
    """Edit a unit's details (unit_type or area_sqft). Pass only the fields to change.
    Unit number and display label cannot be changed directly."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, display_label FROM units WHERE id = %s AND society_id = %s",
                    (unit_id, society_id),
                )
                unit = await cur.fetchone()
                if not unit:
                    return {"success": False, "error": f"Unit with ID {unit_id} not found in this society."}

                updates, values = [], []
                if unit_type is not None:
                    updates.append("unit_type = %s")
                    values.append(unit_type)
                if area_sqft is not None:
                    updates.append("area_sqft = %s")
                    values.append(area_sqft)

                if not updates:
                    return {"success": False, "error": "No fields provided to update."}

                values.append(unit_id)
                await cur.execute(f"UPDATE units SET {', '.join(updates)} WHERE id = %s", tuple(values))
                await conn.commit()

        return {"success": True, "message": f"Unit {unit['display_label']} updated successfully."}
    except Exception as e:
        logger.error("Error in edit_unit: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def delete_unit(config: RunnableConfig, unit_id: int) -> Dict[str, Any]:
    """Delete a unit from the society. The unit must be 'vacant' (no resident assigned).
    Occupied units cannot be deleted — the resident must be removed or revoked first."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, display_label, status FROM units WHERE id = %s AND society_id = %s",
                    (unit_id, society_id),
                )
                unit = await cur.fetchone()
                if not unit:
                    return {"success": False, "error": f"Unit with ID {unit_id} not found in this society."}

                if unit["status"] != "vacant":
                    return {
                        "success": False,
                        "error": f"Cannot delete unit {unit['display_label']}: status is '{unit['status']}'. Only vacant units can be deleted.",
                    }

                await cur.execute("DELETE FROM units WHERE id = %s AND society_id = %s", (unit_id, society_id))
                await conn.commit()

        return {"success": True, "message": f"Unit {unit['display_label']} deleted successfully."}
    except Exception as e:
        logger.error("Error in delete_unit: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# =============================================================================
# 5. Dashboard Statistics Tool
# =============================================================================

@tool
async def get_dashboard_stats(config: RunnableConfig) -> Dict[str, Any]:
    """Get dashboard summary statistics: block/floor/unit counts, occupancy rate,
    resident counts by status, and occupancy breakdown."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Unit statistics
                await cur.execute(
                    """SELECT COUNT(*) as total,
                              SUM(status = 'occupied') as occupied,
                              SUM(status = 'vacant') as vacant
                       FROM units WHERE society_id = %s""",
                    (society_id,),
                )
                unit_stats = await cur.fetchone()

                # 2. Block and floor counts
                await cur.execute("SELECT COUNT(*) as cnt FROM blocks WHERE society_id = %s", (society_id,))
                block_res = await cur.fetchone()
                block_count = block_res["cnt"] if block_res else 0

                await cur.execute("SELECT COUNT(*) as cnt FROM floors WHERE society_id = %s", (society_id,))
                floor_res = await cur.fetchone()
                floor_count = floor_res["cnt"] if floor_res else 0

                # 3. Resident counts
                await cur.execute(
                    """SELECT COUNT(*) as total,
                              SUM(status = 'pending') as pending,
                              SUM(status = 'active') as active,
                              SUM(status = 'inactive') as inactive,
                              SUM(status = 'rejected') as rejected
                       FROM users WHERE society_id = %s AND role = 'resident'""",
                    (society_id,),
                )
                resident_stats = await cur.fetchone()

        total_units = int(unit_stats["total"] or 0) if unit_stats else 0
        occupied = int(unit_stats["occupied"] or 0) if unit_stats else 0
        vacant = int(unit_stats["vacant"] or 0) if unit_stats else 0
        rate = round((occupied / total_units * 100), 1) if total_units > 0 else 0.0

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
                    "total": int(resident_stats["total"] or 0) if resident_stats else 0,
                    "pending": int(resident_stats["pending"] or 0) if resident_stats else 0,
                    "active": int(resident_stats["active"] or 0) if resident_stats else 0,
                    "inactive": int(resident_stats["inactive"] or 0) if resident_stats else 0,
                    "rejected": int(resident_stats["rejected"] or 0) if resident_stats else 0,
                },
            },
        }
    except Exception as e:
        logger.error("Error in get_dashboard_stats: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# =============================================================================
# 6. Resident Management Tools
# =============================================================================

@tool
async def get_residents_list(config: RunnableConfig, status_filter: Optional[str] = None) -> Dict[str, Any]:
    """Get a list of residents in the society. Optionally filter by status:
    'pending', 'active', 'inactive', 'rejected'. Returns name, email, phone,
    status, and assigned unit information for each resident."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    valid_statuses = ["pending", "active", "inactive", "rejected"]
    if status_filter and status_filter.lower() not in valid_statuses:
        return {"success": False, "error": f"Invalid status. Must be one of: {', '.join(valid_statuses)}"}

    try:
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
                    params.append(status_filter.lower())
                query += " ORDER BY u.created_at DESC"

                await cur.execute(query, tuple(params))
                rows = await cur.fetchall()

        residents = [
            {
                "userId": r["id"],
                "name": r["name"],
                "email": r["email"],
                "phone": r["phone"],
                "status": r["status"],
                "registeredAt": str(r["created_at"]) if r.get("created_at") else None,
                "unit": {
                    "id": r["unit_id"],
                    "displayLabel": r["display_label"],
                    "block": r["block_name"],
                    "floor": r["floor_number"],
                } if r.get("unit_id") else None,
            }
            for r in rows
        ]

        return {"success": True, "data": {"count": len(residents), "residents": residents}}
    except Exception as e:
        logger.error("Error in get_residents_list: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def approve_resident(config: RunnableConfig, resident_id: int) -> Dict[str, Any]:
    """Approve a pending resident registration. Only residents with status 'pending'
    can be approved. Their status changes to 'active'."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, name, status FROM users WHERE id = %s AND society_id = %s AND role = 'resident'",
                    (resident_id, society_id),
                )
                user = await cur.fetchone()
                if not user:
                    return {"success": False, "error": f"Resident with ID {resident_id} not found in your society."}
                if user["status"] != "pending":
                    return {"success": False, "error": f"Cannot approve: resident status is '{user['status']}', must be 'pending'."}

                await cur.execute("UPDATE users SET status = 'active' WHERE id = %s", (resident_id,))
                await conn.commit()

        return {"success": True, "message": f"Resident '{user['name']}' has been approved and can now log in."}
    except Exception as e:
        logger.error("Error in approve_resident: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def reject_resident(config: RunnableConfig, resident_id: int) -> Dict[str, Any]:
    """Reject a pending resident registration. Sets status to 'rejected' and releases
    their claimed unit back to 'vacant'. Only 'pending' residents can be rejected."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, name, unit_id, status FROM users WHERE id = %s AND society_id = %s AND role = 'resident'",
                    (resident_id, society_id),
                )
                user = await cur.fetchone()
                if not user:
                    return {"success": False, "error": f"Resident with ID {resident_id} not found in your society."}
                if user["status"] != "pending":
                    return {"success": False, "error": f"Cannot reject: resident status is '{user['status']}', must be 'pending'."}

                await cur.execute("UPDATE users SET status = 'rejected' WHERE id = %s", (resident_id,))
                if user.get("unit_id"):
                    await cur.execute("UPDATE units SET status = 'vacant' WHERE id = %s", (user["unit_id"],))
                await conn.commit()

        return {"success": True, "message": f"Resident '{user['name']}' has been rejected. Their unit was released to vacant."}
    except Exception as e:
        logger.error("Error in reject_resident: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def revoke_resident(config: RunnableConfig, resident_id: int) -> Dict[str, Any]:
    """Revoke access for an active resident. Sets status to 'inactive', unlinks their unit,
    and marks the unit as 'vacant'. Only 'active' residents can be revoked."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, name, unit_id, status FROM users WHERE id = %s AND society_id = %s AND role = 'resident'",
                    (resident_id, society_id),
                )
                user = await cur.fetchone()
                if not user:
                    return {"success": False, "error": f"Resident with ID {resident_id} not found in your society."}
                if user["status"] != "active":
                    return {"success": False, "error": f"Cannot revoke: resident status is '{user['status']}', must be 'active'."}

                unit_id = user.get("unit_id")
                await cur.execute("UPDATE users SET status = 'inactive', unit_id = NULL WHERE id = %s", (resident_id,))
                if unit_id:
                    await cur.execute("UPDATE units SET status = 'vacant' WHERE id = %s", (unit_id,))
                await conn.commit()

        return {"success": True, "message": f"Access revoked for resident '{user['name']}'. Their unit is now vacant."}
    except Exception as e:
        logger.error("Error in revoke_resident: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


@tool
async def reactivate_resident(config: RunnableConfig, resident_id: int, unit_id: int) -> Dict[str, Any]:
    """Reactivate an inactive (revoked) or rejected resident and assign them an available vacant unit.
    The target unit must be 'vacant' and belong to this society."""
    society_id = _extract_society_id(config)
    if not society_id:
        return {"success": False, "error": "Unauthorized: Missing society context."}

    try:
        pool = await get_mysql_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Check resident
                await cur.execute(
                    "SELECT id, name, status FROM users WHERE id = %s AND society_id = %s AND role = 'resident'",
                    (resident_id, society_id),
                )
                user = await cur.fetchone()
                if not user:
                    return {"success": False, "error": f"Resident with ID {resident_id} not found in your society."}
                if user["status"] == "active":
                    return {"success": False, "error": f"Resident '{user['name']}' is already active."}
                if user["status"] == "pending":
                    return {"success": False, "error": f"Resident '{user['name']}' is pending. Use approve_resident instead."}

                # 2. Check target unit
                await cur.execute(
                    "SELECT id, display_label, status FROM units WHERE id = %s AND society_id = %s",
                    (unit_id, society_id),
                )
                unit = await cur.fetchone()
                if not unit:
                    return {"success": False, "error": f"Unit with ID {unit_id} not found in this society."}
                if unit["status"] != "vacant":
                    return {"success": False, "error": f"Unit {unit['display_label']} is currently '{unit['status']}'. It must be vacant."}

                # 3. Assign unit and reactivate
                await cur.execute("UPDATE users SET status = 'active', unit_id = %s WHERE id = %s", (unit_id, resident_id))
                await cur.execute("UPDATE units SET status = 'occupied' WHERE id = %s", (unit_id,))
                await conn.commit()

        return {
            "success": True,
            "message": f"Resident '{user['name']}' has been reactivated and assigned to unit {unit['display_label']}.",
        }
    except Exception as e:
        logger.error("Error in reactivate_resident: %s", e, exc_info=True)
        return {"success": False, "error": f"Database error: {str(e)}"}


# =============================================================================
# Tool Registry Collector
# =============================================================================

def get_all_tools() -> List[Any]:
    """
    Return all 17 society setup and management tools as a flat list.
    Used for both `llm.bind_tools(tools)` and LangGraph's `ToolNode(tools)`.
    """
    return [
        # Society Info
        get_society_info,
        update_society_info,
        # Layout & Structure
        get_society_structure,
        add_blocks,
        rename_block,
        delete_block,
        add_floors,
        delete_floor,
        add_units,
        edit_unit,
        delete_unit,
        # Dashboard & Statistics
        get_dashboard_stats,
        # Residents Management
        get_residents_list,
        approve_resident,
        reject_resident,
        revoke_resident,
        reactivate_resident,
    ]
