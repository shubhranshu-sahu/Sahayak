import * as complaintsService from './complaints.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const createComplaint = async (req, res, next) => {
  try {
    const data = await complaintsService.createComplaint(
      req.user.societyId,
      req.user.userId,
      req.user.unitId,
      req.body
    );
    return sendSuccess(res, 201, 'Complaint raised successfully.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

