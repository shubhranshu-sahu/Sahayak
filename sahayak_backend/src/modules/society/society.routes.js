import { Router } from 'express';
import * as societyController from './society.controller.js';
import { authenticateJWT } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';

const router = Router();

// All society routes are private and secretary only for now
router.use(authenticateJWT);
router.use(authorizeRoles('secretary'));

router.get('/setup', societyController.getSocietyConfig);
router.post('/setup', societyController.setupSociety);
router.put('/setup', societyController.updateSocietyConfig);
router.post('/blocks', societyController.addBlock);
router.get('/structure', societyController.getStructure);

// --- Phase 1B routes ---
router.delete('/blocks/:blockId', societyController.deleteBlock);
router.put('/blocks/:blockId', societyController.renameBlock);

export default router;
