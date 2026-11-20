import { Router } from 'express';
import * as announcementsController from './announcements.controller.js';
import { authenticateJWT } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';

const router = Router();
router.use(authenticateJWT);

// ============================================================
// CRITICAL: Static routes MUST be registered BEFORE /:id
// ============================================================

// Secretary: List all
router.get('/', authorizeRoles('secretary'), announcementsController.listAnnouncements);

// Secretary: Create
router.post('/', authorizeRoles('secretary'), announcementsController.createAnnouncement);

// Secretary: Bulk delete expired -- MUST be before /:id
router.delete('/expired', authorizeRoles('secretary'), announcementsController.deleteExpiredAnnouncements);

// Resident: Get my feed -- MUST be before /:id
router.get('/my', authorizeRoles('resident'), announcementsController.getMyAnnouncements);

// Shared: Get single (secretary sees read stats, resident sees is_read)
router.get('/:id', authorizeRoles('secretary', 'resident'), announcementsController.getAnnouncementById);

// Resident: Mark as read
router.post('/:id/read', authorizeRoles('resident'), announcementsController.markAsRead);

// Secretary: Delete single
router.delete('/:id', authorizeRoles('secretary'), announcementsController.deleteAnnouncement);

export default router;
