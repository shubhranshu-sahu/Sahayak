import { sendError } from '../utils/response.js';

/**
 * Centralized error handling middleware
 * Must be registered LAST in the Express middleware chain
 */
export const errorHandler = (err, req, res, next) => {
  console.error('❌ Unhandled Error:', err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  return sendError(res, statusCode, message, process.env.NODE_ENV === 'development' ? err.stack : undefined);
};
