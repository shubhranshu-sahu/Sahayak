import { Router } from 'express';
import { registerSecretary, registerResident, login, getMe } from './auth.controller.js';
import { authenticateJWT } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.js';
import { z } from 'zod';

const router = Router();

// Validation schemas
const secretaryRegisterSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address').max(150),
  phone: z.string().max(15).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

const residentRegisterSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address').max(150),
  phone: z.string().max(15).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  society_id: z.number().int().positive('Society ID must be a positive integer'),
  unit_id: z.number().int().positive('Unit ID must be a positive integer'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// Routes
router.post('/register/secretary', validate(secretaryRegisterSchema), registerSecretary);
router.post('/register/resident', validate(residentRegisterSchema), registerResident);
router.post('/login', validate(loginSchema), login);
router.get('/me', authenticateJWT, getMe);

export default router;
