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

// --- Phase 1B routes ---
// Resident lifecycle
router.post('/residents/:residentId/revoke', secretaryController.revokeResident);
router.post('/residents/:residentId/reactivate', secretaryController.reactivateResident);
router.get('/residents/all', secretaryController.getAllResidents);

// Dashboard
router.get('/dashboard/stats', secretaryController.getDashboardStats);

export default router;
