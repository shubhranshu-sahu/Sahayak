import * as publicService from './public.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

/**
 * GET /api/v1/public/societies
 * List all active societies
 */
export const listSocieties = async (req, res, next) => {
  try {
    const data = await publicService.listActiveSocieties();
    return sendSuccess(res, 200, 'Active societies retrieved', data);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/public/societies/:societyId/blocks
 * Get blocks in a society
 */
export const getBlocks = async (req, res, next) => {
  try {
    const { societyId } = req.params;
    const data = await publicService.getBlocksBySociety(societyId);
    return sendSuccess(res, 200, 'Blocks retrieved', data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

/**
 * GET /api/v1/public/blocks/:blockId/floors
 * Get floors in a block
 */
export const getFloors = async (req, res, next) => {
  try {
    const { blockId } = req.params;
    const data = await publicService.getFloorsByBlock(blockId);
    return sendSuccess(res, 200, 'Floors retrieved', data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

/**
 * GET /api/v1/public/floors/:floorId/units
 * Get units on a floor with availability
 */
export const getUnits = async (req, res, next) => {
  try {
    const { floorId } = req.params;
    const data = await publicService.getUnitsByFloor(floorId);
    return sendSuccess(res, 200, 'Units retrieved', data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};
