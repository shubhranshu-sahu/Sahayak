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

export default router;

