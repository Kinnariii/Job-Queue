// src/server.js
require('dotenv').config();
const express = require('express');
const { initSchema } = require('./db');
const jobRoutes = require('./routes/jobs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/jobs', jobRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[API] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await initSchema();
  app.listen(PORT, () => {
    console.log(`[API] Server running on http://localhost:${PORT}`);
    console.log('[API] Available routes:');
    console.log('       POST /jobs          - Create a new job');
    console.log('       GET  /jobs          - List all jobs');
    console.log('       GET  /jobs/:id      - Get job status');
    console.log('       GET  /health        - Health check');
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[API] Failed to start:', err);
    process.exit(1);
  });
}

module.exports = app;
