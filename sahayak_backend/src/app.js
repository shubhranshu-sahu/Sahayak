import express from 'express';
import cors from 'cors';

// Route imports
import authRoutes from './modules/auth/auth.routes.js';
import societyRoutes from './modules/society/society.routes.js';
import structureRoutes from './modules/structure/structure.routes.js';
import publicRoutes from './modules/public/public.routes.js';
import secretaryRoutes from './modules/secretary/secretary.routes.js';

// Middleware imports
import { errorHandler } from './middlewares/error.middleware.js';

const app = express();

// Global middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Sahayak Backend is running',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/society', societyRoutes);
app.use('/api/v1', structureRoutes);
app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/secretary', secretaryRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// Centralized error handler (must be last)
app.use(errorHandler);

export default app;
