import app from './app.js';
import env from './config/env.js';
import { testConnection } from './config/db.js';

const startServer = async () => {
  // Test database connection before starting the server
  await testConnection();

  app.listen(env.PORT, () => {
    console.log(`\n🚀 Sahayak Backend Server running on port ${env.PORT}`);
    console.log(`📍 Environment: ${env.NODE_ENV}`);
    console.log(`🔗 Health check: http://localhost:${env.PORT}/api/health\n`);
  });
};

startServer().catch((error) => {
  console.error('❌ Failed to start server:', error.message);
  process.exit(1);
});
