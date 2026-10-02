import { Router } from 'express';
import * as structureController from './structure.controller.js';
import { authenticateJWT } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';

const router = Router();

// Apply auth directly to each endpoint rather than blanket router.use()
// This prevents authenticateJWT from running on unrelated /api/v1/* routes
router.post(
  '/blocks/:blockId/floors/bulk',
  authenticateJWT,
  authorizeRoles('secretary'),
  structureController.bulkAddFloors
);

router.post(
  '/floors/:floorId/units/bulk',
  authenticateJWT,
  authorizeRoles('secretary'),
  structureController.bulkAddUnits
);

export default router;
