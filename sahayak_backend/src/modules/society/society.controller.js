import * as societyService from './society.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const setupSociety = async (req, res, next) => {
  try {
    const data = await societyService.createSociety(req.user.userId, req.body);
    return sendSuccess(res, 201, 'Society created successfully', data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

export const addBlock = async (req, res, next) => {
  try {
    const { block_name } = req.body;
    if (!block_name) {
      return sendError(res, 400, 'block_name is required');
    }
    const data = await societyService.createBlock(req.user.societyId, block_name);
    return sendSuccess(res, 201, 'Block created successfully', data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

export const getStructure = async (req, res, next) => {
  try {
    const data = await societyService.getSocietyStructure(req.user.societyId);
    return sendSuccess(res, 200, 'Society structure retrieved', data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};
