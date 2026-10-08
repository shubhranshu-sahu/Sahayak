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


export const getMyComplaints = async (req, res, next) => {
  try {
    const data = await complaintsService.getMyComplaints(
      req.user.societyId,
      req.user.userId,
      req.query
    );
    return sendSuccess(res, 200, 'Complaints retrieved successfully.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const getComplaintById = async (req, res, next) => {
  try {
    const data = await complaintsService.getComplaintById(
      req.user.societyId,
      req.user,
      req.params.id
    );
    return sendSuccess(res, 200, 'Complaint details retrieved.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const addReply = async (req, res, next) => {
  try {
    const data = await complaintsService.addReply(
      req.user.societyId,
      req.user,
      req.params.id,
      req.body
    );
    return sendSuccess(res, 201, 'Reply posted successfully.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const confirmResolution = async (req, res, next) => {
  try {
    const data = await complaintsService.confirmResolution(
      req.user.societyId,
      req.user.userId,
      req.params.id,
      req.body.feedback
    );
    return sendSuccess(res, 200, 'Complaint closed successfully. Thank you for your feedback.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const reopenComplaint = async (req, res, next) => {
  try {
    const data = await complaintsService.reopenComplaint(
      req.user.societyId,
      req.user.userId,
      req.params.id,
      req.body.reason
    );
    return sendSuccess(res, 200, 'Complaint reopened and moved back to in progress.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};
