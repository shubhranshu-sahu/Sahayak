import { Router } from 'express';
import * as publicController from './public.controller.js';

const router = Router();

// All public routes — no authentication required
router.get('/societies', publicController.listSocieties);
router.get('/societies/:societyId/blocks', publicController.getBlocks);
router.get('/blocks/:blockId/floors', publicController.getFloors);
router.get('/floors/:floorId/units', publicController.getUnits);

// Society code validation (Phase 1B)
router.get('/validate-code/:code', publicController.validateSocietyCode);

export default router;
