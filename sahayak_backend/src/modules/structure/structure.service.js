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
      exampleLabel: exampleLabel || 'N/A'
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
