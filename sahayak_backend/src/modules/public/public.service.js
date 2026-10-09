import { pool } from '../../config/db.js';

/**
 * List all active societies (for resident registration dropdown)
 */
export const listActiveSocieties = async () => {
  const [rows] = await pool.execute(
    'SELECT id, name, society_code, city, state FROM societies WHERE is_active = TRUE'
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    societyCode: row.society_code,
    city: row.city,
    state: row.state,
  }));
};

/**
 * Get blocks belonging to a society
 */
export const getBlocksBySociety = async (societyId) => {
  const [societies] = await pool.execute(
    'SELECT id FROM societies WHERE id = ?',
    [societyId]
  );

  if (societies.length === 0) {
    throw { status: 404, message: 'Society not found' };
  }

  const [rows] = await pool.execute(
    'SELECT id, block_name FROM blocks WHERE society_id = ? ORDER BY block_name ASC',
    [societyId]
  );

  return rows.map((row) => ({
    id: row.id,
    blockName: row.block_name,
  }));
};

/**
 * Get floors belonging to a block
 */
export const getFloorsByBlock = async (blockId) => {
  const [blocks] = await pool.execute(
    'SELECT id FROM blocks WHERE id = ?',
    [blockId]
  );

  if (blocks.length === 0) {
    throw { status: 404, message: 'Block not found' };
  }

  const [rows] = await pool.execute(
    'SELECT id, floor_number FROM floors WHERE block_id = ? ORDER BY floor_number ASC',
    [blockId]
  );

  return rows.map((row) => ({
    id: row.id,
    floorNumber: row.floor_number,
  }));
};

/**
 * Get units on a floor with availability status
 */
export const getUnitsByFloor = async (floorId) => {
  const [floors] = await pool.execute(
    'SELECT id FROM floors WHERE id = ?',
    [floorId]
  );

  if (floors.length === 0) {
    throw { status: 404, message: 'Floor not found' };
  }

  const [rows] = await pool.execute(
    'SELECT id, unit_number, display_label, unit_type, status FROM units WHERE floor_id = ? ORDER BY unit_number ASC',
    [floorId]
  );

  return rows.map((row) => ({
    id: row.id,
    unitNumber: row.unit_number,
    displayLabel: row.display_label,
    status: row.status,
    isSelectable: row.status === 'vacant',
  }));
};

export const validateSocietyCode = async (code) => {
  const codeUpper = code.toUpperCase();
  const codeRegex = /^[A-Z][A-Z-]{2,19}$/;

  if (!codeRegex.test(codeUpper)) {
    throw { status: 400, message: 'Invalid code format. Must be 3-20 uppercase characters (A-Z and hyphens only), starting with a letter.' };
  }

  const [societies] = await pool.execute(
    'SELECT id FROM societies WHERE society_code = ?',
    [codeUpper]
  );

  return {
    code: codeUpper,
    available: societies.length === 0
  };
};
