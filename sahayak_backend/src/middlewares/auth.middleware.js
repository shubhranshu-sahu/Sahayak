import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { pool } from '../config/db.js';
import { sendError } from '../utils/response.js';

/**
 * JWT Authentication Middleware
 * 1. Reads Authorization: Bearer <token> header
 * 2. Verifies token signature and expiry
 * 3. Fetches user from DB and checks account status
 * 4. Checks society is_active status if user belongs to a society
 * 5. Attaches req.user
 */
export const authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'Access denied. No token provided.');
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return sendError(res, 401, 'Token has expired. Please login again.');
      }
      return sendError(res, 401, 'Invalid token.');
    }

    // Fetch fresh user data from DB
    const [users] = await pool.execute(
      'SELECT id, role, society_id, unit_id, name, email, phone, status FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (users.length === 0) {
      return sendError(res, 401, 'User not found.');
    }

    const user = users[0];

    // Account status check
    if (user.status !== 'active') {
      return sendError(res, 403, 'Account is not active.');
    }

    // Society suspension check
    if (user.society_id) {
      const [societies] = await pool.execute(
        'SELECT is_active FROM societies WHERE id = ?',
        [user.society_id]
      );

      if (societies.length > 0 && !societies[0].is_active) {
        return sendError(res, 403, 'Society access has been suspended.');
      }
    }

    // Attach user to request
    req.user = {
      userId: user.id,
      role: user.role,
      societyId: user.society_id,
      unitId: user.unit_id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status,
    };

    next();
  } catch (error) {
    next(error);
  }
};
