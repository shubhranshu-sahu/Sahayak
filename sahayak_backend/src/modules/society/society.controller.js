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

export const getSocietyConfig = async (req, res, next) => {
  try {
    if (!req.user.societyId) {
      return sendError(res, 404, 'No society found for this secretary');
    }
    const data = await societyService.getSocietyConfig(req.user.societyId);
    return sendSuccess(res, 200, 'Society configuration retrieved', data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

export const updateSocietyConfig = async (req, res, next) => {
  try {
    if (!req.user.societyId) {
      return sendError(res, 404, 'No society found to update');
    }
    const data = await societyService.updateSocietyConfig(req.user.societyId, req.body);
    return sendSuccess(res, 200, 'Society configuration updated', data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};
