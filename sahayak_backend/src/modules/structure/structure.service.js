import { pool } from '../../config/db.js';

export const bulkAddFloors = async (societyId, blockId, total_floors) => {
  if (!total_floors || total_floors < 1) {
    throw { status: 400, message: 'total_floors must be at least 1' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Verify block belongs to society
    const [blocks] = await connection.execute(
      'SELECT id, block_name FROM blocks WHERE id = ? AND society_id = ? FOR UPDATE',
      [blockId, societyId]
    );

    if (blocks.length === 0) {
      throw { status: 404, message: 'Block not found or does not belong to your society' };
    }

    // Get current max floor for the block
    const [maxFloorRes] = await connection.execute(
      'SELECT IFNULL(MAX(floor_number), 0) AS max_floor FROM floors WHERE block_id = ?',
      [blockId]
    );
    const currentMax = Number(maxFloorRes[0]?.max_floor) || 0;
    const startFloor = currentMax + 1;

    for (let i = 0; i < total_floors; i++) {
      const floorNum = startFloor + i;
      await connection.execute(
        'INSERT INTO floors (block_id, society_id, floor_number) VALUES (?, ?, ?)',
        [blockId, societyId, floorNum]
      );
    }

    await connection.commit();

    return {
      blockId: Number(blockId),
      floorsCreated: total_floors,
      floorRange: {
        from: startFloor,
        to: startFloor + total_floors - 1
      }
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const bulkAddUnits = async (societyId, floorId, payload) => {
  const start_unit = Number(payload.start_unit);
  const end_unit = Number(payload.end_unit);
  const { unit_type, area_sqft } = payload;

  if (start_unit < 1 || end_unit > 99 || start_unit > end_unit) {
    throw { status: 400, message: 'Invalid start_unit or end_unit (must be between 1 and 99)' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Fetch floor and verify ownership
    const [floors] = await connection.execute(
      'SELECT f.id, f.block_id, f.floor_number, b.block_name FROM floors f JOIN blocks b ON f.block_id = b.id WHERE f.id = ? AND f.society_id = ? FOR UPDATE',
      [floorId, societyId]
    );

    if (floors.length === 0) {
      throw { status: 404, message: 'Floor not found or does not belong to your society' };
    }

    const floor = floors[0];
    let exampleLabel = '';
    let unitsCreated = 0;

    for (let i = start_unit; i <= end_unit; i++) {
      // Check if unit already exists
      const [existingUnits] = await connection.execute(
        'SELECT id FROM units WHERE floor_id = ? AND unit_number = ?',
        [floorId, i]
      );

      if (existingUnits.length > 0) {
        continue; // Skip if already exists
      }

      const [result] = await connection.execute(
        `INSERT INTO units (floor_id, block_id, society_id, block_name, floor_number, unit_number, unit_type, area_sqft, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'vacant')`,
        [
          floorId, 
          floor.block_id, 
          societyId, 
          floor.block_name, 
          floor.floor_number, 
          i, 
          unit_type || 'apartment', 
          area_sqft || null
        ]
      );
      unitsCreated++;

      // We don't have display_label manually inserted if it's generated, 
      // but let's build it for the response example
      const floorStr = floor.floor_number === 0 ? 'G' : floor.floor_number.toString();
      const unitStr = i.toString().padStart(2, '0');
      if (!exampleLabel) {
        exampleLabel = `${floor.block_name}-${floorStr}${unitStr}`;
      }
    }

    await connection.commit();

    return {
      floorId: Number(floorId),
      unitsCreated,
      unitsSkipped: (end_unit - start_unit + 1) - unitsCreated,
      exampleLabel: exampleLabel || 'N/A'
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const deleteFloor = async (societyId, blockId, floorId) => {
  // Verify floor exists, belongs to the correct block and society
  const [floors] = await pool.execute(
    `SELECT f.id, f.floor_number, f.block_id, b.block_name
     FROM floors f
     JOIN blocks b ON f.block_id = b.id
     WHERE f.id = ? AND f.block_id = ? AND b.society_id = ?`,
    [floorId, blockId, societyId]
  );

  if (floors.length === 0) {
    throw { status: 404, message: 'Floor not found in this block.' };
  }

  const floorNumber = floors[0].floor_number;
  const blockName = floors[0].block_name;

  // Guard: Check if floor has units
  const [units] = await pool.execute(
    'SELECT COUNT(*) AS unit_count FROM units WHERE floor_id = ?',
    [floorId]
  );

  const unitCount = units[0].unit_count;
  if (unitCount > 0) {
    throw { status: 409, message: `Cannot delete floor ${floorNumber}. It has ${unitCount} unit(s). Delete all units on this floor first.` };
  }

  // Delete the floor
  await pool.execute('DELETE FROM floors WHERE id = ?', [floorId]);

  return { floorNumber, blockName };
};

export const deleteUnit = async (societyId, unitId) => {
  // 1. Verify unit exists and belongs to society
  const [units] = await pool.execute(
    'SELECT id, status, display_label FROM units WHERE id = ? AND society_id = ?',
    [unitId, societyId]
  );

  if (units.length === 0) {
    throw { status: 404, message: 'Unit not found in your society.' };
  }

  const unit = units[0];

  // 2. Guard: Check if unit is occupied
  if (unit.status === 'occupied') {
    throw { status: 409, message: `Cannot delete unit '${unit.display_label}'. It is currently occupied by a resident. Revoke the resident first, then delete the unit.` };
  }

  // 3. Guard: Check if any user with active/pending status is still linked
  const [users] = await pool.execute(
    `SELECT id, name, status FROM users WHERE unit_id = ? AND status IN ('pending', 'active')`,
    [unitId]
  );

  if (users.length > 0) {
    throw { status: 409, message: 'Cannot delete unit. It has linked residents with active or pending status.' };
  }

  // 4. Delete the unit
  await pool.execute('DELETE FROM units WHERE id = ?', [unitId]);

  return { displayLabel: unit.display_label };
};

export const editUnit = async (societyId, unitId, payload) => {
  const { unit_type, area_sqft } = payload;

  // 1. Verify unit exists and belongs to society
  const [units] = await pool.execute(
    'SELECT id, display_label FROM units WHERE id = ? AND society_id = ?',
    [unitId, societyId]
  );

  if (units.length === 0) {
    throw { status: 404, message: 'Unit not found in your society.' };
  }

  // 2. Validate inputs
  if (unit_type !== undefined) {
    const validTypes = ['apartment', 'villa', 'row_house', 'plot', 'other'];
    if (!validTypes.includes(unit_type)) {
      throw { status: 400, message: 'Invalid unit_type. Must be one of: apartment, villa, row_house, plot, other.' };
    }
  }

  if (area_sqft !== undefined && area_sqft !== null) {
    if (!Number.isInteger(area_sqft) || area_sqft < 0 || area_sqft > 65535) {
      throw { status: 400, message: 'area_sqft must be a positive integer up to 65535.' };
    }
  }

  // 3. Build dynamic update query
  const updates = [];
  const values = [];

  if (unit_type !== undefined) {
    updates.push('unit_type = ?');
    values.push(unit_type);
  }
  
  if (area_sqft !== undefined) {
    updates.push('area_sqft = ?');
    values.push(area_sqft);
  }

  if (updates.length > 0) {
    values.push(unitId);
    const query = `UPDATE units SET ${updates.join(', ')} WHERE id = ?`;
    await pool.execute(query, values);
  }

  // 4. Fetch and return updated unit details
  const [updatedUnits] = await pool.execute(
    'SELECT id, display_label, unit_type, area_sqft, status FROM units WHERE id = ?',
    [unitId]
  );

  const updatedUnit = updatedUnits[0];

  return {
    id: updatedUnit.id,
    displayLabel: updatedUnit.display_label,
    unitType: updatedUnit.unit_type,
    areaSqft: updatedUnit.area_sqft,
    status: updatedUnit.status
  };
};
