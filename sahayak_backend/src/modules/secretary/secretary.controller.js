import * as secretaryService from './secretary.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

/**
 * GET /api/v1/secretary/residents/pending
 * List all pending resident approvals
 */
export const getPendingResidents = async (req, res, next) => {
  try {
    const data = await secretaryService.getPendingResidents(req.user.societyId);
    return sendSuccess(res, 200, 'Pending residents retrieved', data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

/**
 * POST /api/v1/secretary/residents/:residentId/approve
 * Approve a pending resident
 */
export const approveResident = async (req, res, next) => {
  try {
    const { residentId } = req.params;
    await secretaryService.approveResident(req.user.societyId, residentId);
    return sendSuccess(res, 200, 'Resident approved successfully. They can now log in.');
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

/**
 * POST /api/v1/secretary/residents/:residentId/reject
 * Reject a pending resident and release their unit
 */
export const rejectResident = async (req, res, next) => {
  try {
    const { residentId } = req.params;
    await secretaryService.rejectResident(req.user.societyId, residentId);
    return sendSuccess(res, 200, 'Resident registration rejected and unit released to vacant.');
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

/**
 * GET /api/v1/secretary/residents
 * List all active residents in the society
 */
export const getActiveResidents = async (req, res, next) => {
  try {
    const data = await secretaryService.getActiveResidents(req.user.societyId);
    return sendSuccess(res, 200, 'Active residents retrieved', data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};
