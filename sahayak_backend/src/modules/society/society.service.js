import { pool } from '../../config/db.js';

export const createSociety = async (userId, payload) => {
  const { name, society_code, address, city, state, pincode, metadata } = payload;
  
  // Validate society_code format
  const codeRegex = /^[A-Z][A-Z-]{2,19}$/;
  if (!codeRegex.test(society_code)) {
    throw { status: 400, message: 'Invalid society_code format' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check if society code exists
    const [existingCodes] = await connection.execute(
      'SELECT id FROM societies WHERE society_code = ?',
      [society_code]
    );
    if (existingCodes.length > 0) {
      throw { status: 409, message: 'Society code already in use' };
    }

    // Verify secretary doesn't already own a society
    const [existingSocieties] = await connection.execute(
      'SELECT id FROM societies WHERE secretary_id = ?',
      [userId]
    );
    if (existingSocieties.length > 0) {
      throw { status: 409, message: 'Secretary already owns a society' };
    }

    // Insert into societies table
    const [societyResult] = await connection.execute(
      `INSERT INTO societies (secretary_id, name, society_code, address, city, state, pincode, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, society_code, address, city, state, pincode, metadata ? JSON.stringify(metadata) : null]
    );

    const societyId = societyResult.insertId;

    // Update users table
    await connection.execute(
      'UPDATE users SET society_id = ? WHERE id = ?',
      [societyId, userId]
    );

    await connection.commit();

    return {
      societyId,
      name,
      societyCode: society_code,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const createBlock = async (societyId, block_name) => {
  const blockNameUpper = block_name.toUpperCase();
  const blockNameRegex = /^[A-Z]+$/;

  if (!blockNameRegex.test(blockNameUpper)) {
    throw { status: 400, message: 'Invalid block_name format' };
  }

  const [existingBlocks] = await pool.execute(
    'SELECT id FROM blocks WHERE society_id = ? AND block_name = ?',
    [societyId, blockNameUpper]
  );
  if (existingBlocks.length > 0) {
    throw { status: 409, message: 'Block name already exists in this society' };
  }

  const [result] = await pool.execute(
    'INSERT INTO blocks (society_id, block_name) VALUES (?, ?)',
    [societyId, blockNameUpper]
  );

  return {
    id: result.insertId,
    societyId,
    blockName: blockNameUpper,
  };
};

export const getSocietyStructure = async (societyId) => {
  // Fetch Blocks
  const [blocks] = await pool.execute(
    'SELECT id, block_name FROM blocks WHERE society_id = ? ORDER BY block_name ASC',
    [societyId]
  );

  // Fetch Floors
  const [floors] = await pool.execute(
    'SELECT id, block_id, floor_number FROM floors WHERE society_id = ? ORDER BY floor_number ASC',
    [societyId]
  );

  // Fetch Units
  const [units] = await pool.execute(
    'SELECT id, floor_id, unit_number, display_label, status, area_sqft FROM units WHERE society_id = ? ORDER BY unit_number ASC',
    [societyId]
  );

  // Fetch society name
  const [societies] = await pool.execute(
    'SELECT name FROM societies WHERE id = ?',
    [societyId]
  );
  const societyName = societies.length > 0 ? societies[0].name : '';

  // Assemble the tree
  const blocksMap = new Map();
  const floorsMap = new Map();

  for (const block of blocks) {
    blocksMap.set(block.id, {
      id: block.id,
      blockName: block.block_name,
      floors: [],
    });
  }

  for (const floor of floors) {
    const floorObj = {
      id: floor.id,
      floorNumber: floor.floor_number,
      units: [],
    };
    floorsMap.set(floor.id, floorObj);
    if (blocksMap.has(floor.block_id)) {
      blocksMap.get(floor.block_id).floors.push(floorObj);
    }
  }

  for (const unit of units) {
    const unitObj = {
      id: unit.id,
      unitNumber: unit.unit_number,
      displayLabel: unit.display_label,
      status: unit.status,
      areaSqft: unit.area_sqft,
    };
    if (floorsMap.has(unit.floor_id)) {
      floorsMap.get(unit.floor_id).units.push(unitObj);
    }
  }

  return {
    societyId,
    name: societyName,
    blocks: Array.from(blocksMap.values()),
  };
};

export const getSocietyConfig = async (societyId) => {
  const [societies] = await pool.execute(
    'SELECT id, secretary_id, name, society_code, address, city, state, pincode, is_active, metadata FROM societies WHERE id = ?',
    [societyId]
  );
  if (societies.length === 0) {
    throw { status: 404, message: 'Society not found' };
  }
  
  const society = societies[0];
  if (society.metadata) {
    try {
      society.metadata = JSON.parse(society.metadata);
    } catch (e) {
      // already parsed or invalid
    }
  }

  return society;
};

export const updateSocietyConfig = async (societyId, payload) => {
  const { name, society_code, address, city, state, pincode, metadata } = payload;
  
  // Validate society_code format
  if (society_code) {
    const codeRegex = /^[A-Z][A-Z-]{2,19}$/;
    if (!codeRegex.test(society_code)) {
      throw { status: 400, message: 'Invalid society_code format' };
    }

    // Check if society code exists and is not the current society
    const [existingCodes] = await pool.execute(
      'SELECT id FROM societies WHERE society_code = ? AND id != ?',
      [society_code, societyId]
    );
    if (existingCodes.length > 0) {
      throw { status: 409, message: 'Society code already in use' };
    }
  }

  // Build dynamic update query
  const updates = [];
  const values = [];

  const addUpdate = (field, value) => {
    if (value !== undefined) {
      updates.push(`${field} = ?`);
      values.push(value);
    }
  };

  addUpdate('name', name);
  addUpdate('society_code', society_code);
  addUpdate('address', address);
  addUpdate('city', city);
  addUpdate('state', state);
  addUpdate('pincode', pincode);

  if (metadata !== undefined) {
    updates.push('metadata = ?');
    values.push(metadata ? JSON.stringify(metadata) : null);
  }

  if (updates.length === 0) {
    return getSocietyConfig(societyId);
  }

  values.push(societyId);

  const query = `UPDATE societies SET ${updates.join(', ')} WHERE id = ?`;
  await pool.execute(query, values);

  return getSocietyConfig(societyId);
};
