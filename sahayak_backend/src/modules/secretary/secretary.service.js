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
