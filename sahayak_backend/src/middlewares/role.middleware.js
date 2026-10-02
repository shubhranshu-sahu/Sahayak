import { sendError } from '../utils/response.js';

/**
 * Role-based access control middleware factory
 * @param  {...string} roles - Allowed roles (e.g., 'secretary', 'resident', 'super_admin')
 */
export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 401, 'Authentication required.');
    }

    if (!roles.includes(req.user.role)) {
      return sendError(res, 403, 'Access forbidden for this role.');
    }

    next();
  };
};
