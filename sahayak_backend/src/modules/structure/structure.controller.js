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

export const deleteFloor = async (req, res, next) => {
  try {
    const { blockId, floorId } = req.params;
    const data = await structureService.deleteFloor(req.user.societyId, blockId, floorId);
    
    return sendSuccess(
      res, 
      200, 
      `Floor ${data.floorNumber} deleted from block '${data.blockName}' successfully.`
    );
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

export const deleteUnit = async (req, res, next) => {
  try {
    const { unitId } = req.params;
    const data = await structureService.deleteUnit(req.user.societyId, unitId);
    
    return sendSuccess(
      res, 
      200, 
      `Unit '${data.displayLabel}' deleted successfully.`
    );
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};

export const editUnit = async (req, res, next) => {
  try {
    const { unitId } = req.params;
    const data = await structureService.editUnit(req.user.societyId, unitId, req.body);
    
    return sendSuccess(
      res, 
      200, 
      `Unit '${data.displayLabel}' updated successfully.`,
      data
    );
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};
