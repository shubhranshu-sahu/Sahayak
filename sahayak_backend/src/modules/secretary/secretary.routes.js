import { Router } from 'express';
import * as secretaryController from './secretary.controller.js';
import { authenticateJWT } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';

const router = Router();

// All secretary routes require authentication + secretary role
router.use(authenticateJWT);
router.use(authorizeRoles('secretary'));

// Resident approval flow
router.get('/residents/pending', secretaryController.getPendingResidents);
router.post('/residents/:residentId/approve', secretaryController.approveResident);
router.post('/residents/:residentId/reject', secretaryController.rejectResident);
router.get('/residents', secretaryController.getActiveResidents);

export default router;
