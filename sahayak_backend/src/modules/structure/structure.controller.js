import * as structureService from './structure.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const bulkAddFloors = async (req, res, next) => {
  try {
    const { blockId } = req.params;
    const { total_floors } = req.body;
    
    if (!total_floors) {
      return sendError(res, 400, 'total_floors is required');
    }

    const data = await structureService.bulkAddFloors(req.user.societyId, blockId, total_floors);
    return sendSuccess(res, 201, `${total_floors} floors created successfully`, data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

export const bulkAddUnits = async (req, res, next) => {
  try {
    const { floorId } = req.params;
    
    const data = await structureService.bulkAddUnits(req.user.societyId, floorId, req.body);
    return sendSuccess(res, 201, `${data.unitsCreated} units created successfully`, data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};
