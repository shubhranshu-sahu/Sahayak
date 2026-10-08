import { Router } from 'express';
import * as complaintsController from './complaints.controller.js';
import { authenticateJWT } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';

const router = Router();

// All complaint routes require a valid active JWT
router.use(authenticateJWT);

// ==========================================
// 1. Resident Specific Routes
// ==========================================
router.post(
  '/',
  authorizeRoles('resident'),
  complaintsController.createComplaint
);

router.get(
  '/my',
  authorizeRoles('resident'),
  complaintsController.getMyComplaints
);

router.post(
  '/:id/confirm-resolved',
  authorizeRoles('resident'),
  complaintsController.confirmResolution
);

router.post(
  '/:id/reopen',
  authorizeRoles('resident'),
  complaintsController.reopenComplaint
);

// ==========================================
// 2. Shared Routes (Resident & Secretary)
// ==========================================
router.get(
  '/:id',
  authorizeRoles('resident', 'secretary'),
  complaintsController.getComplaintById
);

router.post(
  '/:id/replies',
  authorizeRoles('resident', 'secretary'),
  complaintsController.addReply
);

export default router;
