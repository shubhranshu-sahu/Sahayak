import { Router } from 'express';
import * as structureController from './structure.controller.js';
import { authenticateJWT } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';

const router = Router();

// Structure routes are private and secretary only for setup phase
router.use(authenticateJWT);
router.use(authorizeRoles('secretary'));

// Routes will be mounted at /api/v1
// e.g. /blocks/:blockId/floors/bulk
router.post('/blocks/:blockId/floors/bulk', structureController.bulkAddFloors);
router.post('/floors/:floorId/units/bulk', structureController.bulkAddUnits);

export default router;
