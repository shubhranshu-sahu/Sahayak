import jwt from 'jsonwebtoken';
import env from '../../config/env.js';
import { pool } from '../../config/db.js';
import { hashPassword, comparePassword } from '../../utils/password.js';

/**
 * Register a new secretary
 */
export const registerSecretary = async ({ name, email, phone, password }) => {
  // Check if email already exists
  const [existing] = await pool.execute(
    'SELECT id FROM users WHERE email = ?',
    [email]
  );

  if (existing.length > 0) {
    const error = new Error('Email is already registered.');
    error.statusCode = 409;
    throw error;
  }

  const passwordHash = await hashPassword(password);

  const [result] = await pool.execute(
    `INSERT INTO users (role, society_id, unit_id, name, email, phone, password_hash, status, is_email_verified)
     VALUES ('secretary', NULL, NULL, ?, ?, ?, ?, 'active', TRUE)`,
    [name, email, phone || null, passwordHash]
  );

  return {
    userId: result.insertId,
    name,
    email,
    role: 'secretary',
  };
};

/**
 * Register a new resident (with atomic transaction for unit reservation)
 */
export const registerResident = async ({ name, email, phone, password, society_id, unit_id }) => {
  // Check if email already exists (outside transaction)
  const [existing] = await pool.execute(
    'SELECT id FROM users WHERE email = ?',
    [email]
  );

  if (existing.length > 0) {
    const error = new Error('Email is already registered.');
    error.statusCode = 409;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Lock and verify unit
    const [units] = await connection.execute(
      'SELECT id, society_id, status FROM units WHERE id = ? FOR UPDATE',
      [unit_id]
    );

    if (units.length === 0 || units[0].society_id !== society_id) {
      await connection.rollback();
      const error = new Error('Invalid unit or unit does not belong to the specified society.');
      error.statusCode = 400;
      throw error;
    }

    if (units[0].status !== 'vacant') {
      await connection.rollback();
      const error = new Error('This unit is already claimed/occupied.');
      error.statusCode = 409;
      throw error;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Insert resident user
    const [result] = await connection.execute(
      `INSERT INTO users (role, society_id, unit_id, name, email, phone, password_hash, status, is_email_verified)
       VALUES ('resident', ?, ?, ?, ?, ?, ?, 'pending', TRUE)`,
      [society_id, unit_id, name, email, phone || null, passwordHash]
    );

    // Reserve the unit
    await connection.execute(
      'UPDATE units SET status = ? WHERE id = ?',
      ['occupied', unit_id]
    );

    await connection.commit();

    return {
      userId: result.insertId,
      name,
      status: 'pending',
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Login user (secretary or resident)
 */
export const loginUser = async ({ email, password }) => {
  // Find user by email
  const [users] = await pool.execute(
    'SELECT id, role, society_id, unit_id, name, email, phone, password_hash, status FROM users WHERE email = ?',
    [email]
  );

  if (users.length === 0) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    throw error;
  }

  const user = users[0];

  // Verify password
  const isMatch = await comparePassword(password, user.password_hash);
  if (!isMatch) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    throw error;
  }

  // Check account status
  if (user.status === 'pending') {
    const error = new Error('Registration pending secretary approval.');
    error.statusCode = 403;
    throw error;
  }
  if (user.status === 'rejected') {
    const error = new Error('Your registration request was rejected by the society secretary.');
    error.statusCode = 403;
    throw error;
  }
  if (user.status === 'inactive') {
    const error = new Error('Your account has been deactivated.');
    error.statusCode = 403;
    throw error;
  }

  // Check society is_active if user belongs to a society
  if (user.society_id) {
    const [societies] = await pool.execute(
      'SELECT is_active FROM societies WHERE id = ?',
      [user.society_id]
    );

    if (societies.length > 0 && !societies[0].is_active) {
      const error = new Error('Society access is suspended.');
      error.statusCode = 403;
      throw error;
    }
  }

  // Generate JWT token
  const tokenPayload = {
    userId: user.id,
    role: user.role,
    societyId: user.society_id,
    status: user.status,
  };

  const token = jwt.sign(tokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      societyId: user.society_id,
      unitId: user.unit_id,
    },
  };
};

/**
 * Get current user profile
 */
export const getCurrentUser = async (userId) => {
  const [users] = await pool.execute(
    'SELECT id, role, society_id, unit_id, name, email, phone FROM users WHERE id = ?',
    [userId]
  );

  if (users.length === 0) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    throw error;
  }

  const user = users[0];
  const profile = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };

  // If user belongs to a society, include society details
  if (user.society_id) {
    const [societies] = await pool.execute(
      'SELECT id, name, society_code FROM societies WHERE id = ?',
      [user.society_id]
    );
    if (societies.length > 0) {
      profile.society = {
        id: societies[0].id,
        name: societies[0].name,
        societyCode: societies[0].society_code,
      };
    }
  }

  // If user has a unit, include unit details
  if (user.unit_id) {
    const [units] = await pool.execute(
      'SELECT id, display_label, block_name, floor_number FROM units WHERE id = ?',
      [user.unit_id]
    );
    if (units.length > 0) {
      profile.unit = {
        id: units[0].id,
        displayLabel: units[0].display_label,
        blockName: units[0].block_name,
        floorNumber: units[0].floor_number,
      };
    }
  }

  return profile;
};
