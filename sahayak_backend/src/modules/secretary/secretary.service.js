import { pool } from '../../config/db.js';

/**
 * Fetch all residents with status = 'pending' in the secretary's society
 */
export const getPendingResidents = async (societyId) => {
  const [rows] = await pool.execute(
    `SELECT 
        u.id AS user_id,
        u.name,
        u.email,
        u.phone,
        u.created_at AS registered_at,
        un.id AS unit_id,
        un.display_label,
        un.block_name,
        un.floor_number
    FROM users u
    JOIN units un ON u.unit_id = un.id
    WHERE u.society_id = ? AND u.role = 'resident' AND u.status = 'pending'
    ORDER BY u.created_at ASC`,
    [societyId]
  );

  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    registeredAt: row.registered_at,
    unit: {
      id: row.unit_id,
      displayLabel: row.display_label,
      block: row.block_name,
      floor: row.floor_number,
    },
  }));
};

/**
 * Approve a pending resident
 */
export const approveResident = async (societyId, residentId) => {
  // Verify resident exists, belongs to society, and is pending
  const [residents] = await pool.execute(
    'SELECT id, status FROM users WHERE id = ? AND society_id = ? AND role = ?',
    [residentId, societyId, 'resident']
  );

  if (residents.length === 0) {
    throw { status: 404, message: 'Resident not found in your society' };
  }

  if (residents[0].status !== 'pending') {
    throw { status: 400, message: `Cannot approve resident with status '${residents[0].status}'. Only pending residents can be approved.` };
  }

  // Update status to active
  await pool.execute(
    'UPDATE users SET status = ? WHERE id = ?',
    ['active', residentId]
  );
};

/**
 * Reject a pending resident (with unit rollback transaction)
 */
export const rejectResident = async (societyId, residentId) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Lock and fetch resident
    const [residents] = await connection.execute(
      'SELECT id, unit_id, status FROM users WHERE id = ? AND society_id = ? FOR UPDATE',
      [residentId, societyId]
    );

    if (residents.length === 0) {
      throw { status: 404, message: 'Resident not found in your society' };
    }

    if (residents[0].status !== 'pending') {
      throw { status: 400, message: `Cannot reject resident with status '${residents[0].status}'. Only pending residents can be rejected.` };
    }

    const unitId = residents[0].unit_id;

    // Update user status to rejected
    await connection.execute(
      'UPDATE users SET status = ? WHERE id = ?',
      ['rejected', residentId]
    );

    // Rollback unit status to vacant
    if (unitId) {
      await connection.execute(
        'UPDATE units SET status = ? WHERE id = ?',
        ['vacant', unitId]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Fetch all active (approved) residents in the secretary's society
 */
export const getActiveResidents = async (societyId) => {
  const [rows] = await pool.execute(
    `SELECT 
        u.id AS user_id,
        u.name,
        u.email,
        u.phone,
        u.status,
        un.display_label,
        un.block_name,
        un.floor_number
    FROM users u
    JOIN units un ON u.unit_id = un.id
    WHERE u.society_id = ? AND u.role = 'resident' AND u.status = 'active'
    ORDER BY un.display_label ASC`,
    [societyId]
  );

  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    unit: {
      displayLabel: row.display_label,
      block: row.block_name,
      floor: row.floor_number,
    },
  }));
};

/**
 * Revoke an approved (active) resident — sets status to 'inactive',
 * clears unit_id, and releases their unit back to vacant.
 */
export const revokeResident = async (societyId, residentId) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Lock and fetch resident
    const [residents] = await connection.execute(
      'SELECT id, unit_id, status FROM users WHERE id = ? AND society_id = ? AND role = ? FOR UPDATE',
      [residentId, societyId, 'resident']
    );

    if (residents.length === 0) {
      throw { status: 404, message: 'Resident not found in your society' };
    }

    if (residents[0].status !== 'active') {
      throw { status: 400, message: `Cannot revoke resident with status '${residents[0].status}'. Only active residents can be revoked.` };
    }

    const unitId = residents[0].unit_id;

    // Update user status to inactive and clear unit reference
    await connection.execute(
      'UPDATE users SET status = ?, unit_id = NULL WHERE id = ?',
      ['inactive', residentId]
    );

    // Release unit back to vacant
    if (unitId) {
      await connection.execute(
        'UPDATE units SET status = ? WHERE id = ?',
        ['vacant', unitId]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Fetch ALL residents in the society, with an optional status filter.
 */
export const getAllResidents = async (societyId, status) => {
  // Validate status if provided
  const validStatuses = ['pending', 'active', 'inactive', 'rejected'];
  if (status && !validStatuses.includes(status)) {
    throw { status: 400, message: 'Invalid status filter. Must be one of: pending, active, inactive, rejected' };
  }

  let query = `
    SELECT
        u.id AS user_id,
        u.name,
        u.email,
        u.phone,
        u.status,
        u.created_at AS registered_at,
        un.id AS unit_id,
        un.display_label,
        un.block_name,
        un.floor_number
    FROM users u
    LEFT JOIN units un ON u.unit_id = un.id
    WHERE u.society_id = ? AND u.role = 'resident'
  `;
  const queryParams = [societyId];

  if (status) {
    query += ` AND u.status = ?`;
    queryParams.push(status);
  }

  query += ` ORDER BY u.created_at DESC`;

  const [rows] = await pool.execute(query, queryParams);

  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    registeredAt: row.registered_at,
    unit: row.unit_id ? {
      id: row.unit_id,
      displayLabel: row.display_label,
      block: row.block_name,
      floor: row.floor_number,
    } : null,
  }));
};

/**
 * Fetch dashboard statistics for the secretary's society
 */
export const getDashboardStats = async (societyId) => {
  // Execute all 4 queries concurrently for performance
  const [unitStatsResult, structureStatsResult, residentStatsResult, recentRegsResult] = await Promise.all([
    // Query 1: Unit stats
    pool.execute(
      `SELECT
          COUNT(*) AS total_units,
          SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied_units,
          SUM(CASE WHEN status = 'vacant' THEN 1 ELSE 0 END) AS vacant_units
      FROM units
      WHERE society_id = ?`,
      [societyId]
    ),
    // Query 2: Block and floor counts
    pool.execute(
      `SELECT
          (SELECT COUNT(*) FROM blocks WHERE society_id = ?) AS total_blocks,
          (SELECT COUNT(*) FROM floors WHERE society_id = ?) AS total_floors`,
      [societyId, societyId]
    ),
    // Query 3: Resident statistics by status
    pool.execute(
      `SELECT
          COUNT(*) AS total_residents,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_residents,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_residents,
          SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive_residents,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_residents
      FROM users
      WHERE society_id = ? AND role = 'resident'`,
      [societyId]
    ),
    // Query 4: Recent registrations (last 5)
    pool.execute(
      `SELECT
          u.id AS user_id,
          u.name,
          u.status,
          u.created_at AS registered_at,
          un.display_label
      FROM users u
      LEFT JOIN units un ON u.unit_id = un.id
      WHERE u.society_id = ? AND u.role = 'resident'
      ORDER BY u.created_at DESC
      LIMIT 5`,
      [societyId]
    )
  ]);

  // Extract rows
  const unitRow = unitStatsResult[0][0];
  const structureRow = structureStatsResult[0][0];
  const residentRow = residentStatsResult[0][0];
  const recentRegsRows = recentRegsResult[0];

  // Parse counts/sums as integers (MySQL SUM/COUNT can return strings)
  const totalUnits = Number(unitRow.total_units || 0);
  const occupiedUnits = Number(unitRow.occupied_units || 0);
  const vacantUnits = Number(unitRow.vacant_units || 0);
  
  // Calculate occupancy rate (round to 1 decimal)
  const occupancyRate = totalUnits === 0 ? 0 : Number(((occupiedUnits / totalUnits) * 100).toFixed(1));

  return {
    structure: {
      totalBlocks: Number(structureRow.total_blocks || 0),
      totalFloors: Number(structureRow.total_floors || 0),
      totalUnits,
      occupiedUnits,
      vacantUnits,
      occupancyRate
    },
    residents: {
      total: Number(residentRow.total_residents || 0),
      pending: Number(residentRow.pending_residents || 0),
      active: Number(residentRow.active_residents || 0),
      inactive: Number(residentRow.inactive_residents || 0),
      rejected: Number(residentRow.rejected_residents || 0)
    },
    recentRegistrations: recentRegsRows.map(row => ({
      userId: row.user_id,
      name: row.name,
      status: row.status,
      registeredAt: row.registered_at,
      unitLabel: row.display_label || null
    }))
  };
};
