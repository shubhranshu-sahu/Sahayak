import { sendSuccess, sendError } from '../../utils/response.js';
import * as authService from './auth.service.js';

/**
 * POST /api/v1/auth/register/secretary
 */
export const registerSecretary = async (req, res, next) => {
  try {
    const data = await authService.registerSecretary(req.body);
    return sendSuccess(res, 201, 'Secretary registered successfully. Please proceed to society setup.', data);
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.statusCode, error.message);
    }
    next(error);
  }
};

/**
 * POST /api/v1/auth/register/resident
 */
export const registerResident = async (req, res, next) => {
  try {
    const data = await authService.registerResident(req.body);
    return sendSuccess(res, 201, 'Registration submitted successfully. Awaiting approval from society secretary.', data);
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.statusCode, error.message);
    }
    next(error);
  }
};

/**
 * POST /api/v1/auth/login
 */
export const login = async (req, res, next) => {
  try {
    const data = await authService.loginUser(req.body);
    return sendSuccess(res, 200, 'Login successful', data);
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.statusCode, error.message);
    }
    next(error);
  }
};

/**
 * GET /api/v1/auth/me
 */
export const getMe = async (req, res, next) => {
  try {
    const data = await authService.getCurrentUser(req.user.userId);
    return sendSuccess(res, 200, 'Profile fetched successfully', data);
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.statusCode, error.message);
    }
    next(error);
  }
};
