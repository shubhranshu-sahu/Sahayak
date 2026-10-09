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

export const deleteBlock = async (req, res, next) => {
  try {
    const { blockId } = req.params;
    const blockName = await societyService.deleteBlock(req.user.societyId, blockId);
    return sendSuccess(res, 200, `Block '${blockName}' deleted successfully.`);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

export const renameBlock = async (req, res, next) => {
  try {
    const { blockId } = req.params;
    const { block_name } = req.body;

    if (!block_name) {
      return sendError(res, 400, 'block_name is required in request body');
    }

    const data = await societyService.renameBlock(req.user.societyId, blockId, block_name);
    
    return sendSuccess(
      res, 
      200, 
      `Block renamed from '${data.oldName}' to '${data.newName}' successfully. All unit labels updated.`,
      {
        id: data.id,
        blockName: data.newName,
        unitsUpdated: data.unitsUpdated
      }
    );
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};
