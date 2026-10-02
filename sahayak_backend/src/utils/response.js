/**
 * Standardized API response helpers
 */

export const sendSuccess = (res, statusCode, message, data = null) => {
  const response = {
    success: true,
    message,
  };
  if (data !== null) {
    response.data = data;
  }
  return res.status(statusCode).json(response);
};

export const sendError = (res, statusCode, message, error = null) => {
  const response = {
    success: false,
    message,
  };
  if (error !== null) {
    response.error = error;
  }
  return res.status(statusCode).json(response);
};
