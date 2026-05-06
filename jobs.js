// src/routes/jobs.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createJob, getJobById, listJobs } = require('../db/jobModel');
const { enqueue, getQueueLength } = require('../services/queue');

const router = express.Router();

// Allowed job types (whitelist for validation)
const VALID_JOB_TYPES = ['send_email', 'resize_image', 'generate_report'];

/**
 * POST /jobs
 * Create and enqueue a new job
 *
 * Body: { type: string, payload: object }
 * Response: { jobId, status, message }
 */
router.post('/', async (req, res) => {
  try {
    const { type, payload = {} } = req.body;

    // Validate job type
    if (!type) {
      return res.status(400).json({ error: 'Field "type" is required' });
    }
    if (!VALID_JOB_TYPES.includes(type)) {
      return res.status(400).json({
        error: `Invalid job type "${type}"`,
        validTypes: VALID_JOB_TYPES,
      });
    }

    const jobId = uuidv4();

    // Step 1: Persist to Postgres (source of truth)
    const job = await createJob({ id: jobId, type, payload });

    // Step 2: Push job_id to Redis queue
    await enqueue(jobId);

    return res.status(202).json({
      jobId: job.id,
      type: job.type,
      status: job.status,
      message: 'Job accepted and queued for processing',
      statusUrl: `/jobs/${job.id}`,
    });
  } catch (err) {
    console.error('[API] POST /jobs error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /jobs/:id
 * Get the status and result of a specific job
 */
router.get('/:id', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);

    if (!job) {
      return res.status(404).json({ error: `Job ${req.params.id} not found` });
    }

    return res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      maxRetries: job.max_retries,
      payload: job.payload,
      result: job.result || null,
      error: job.error || null,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    });
  } catch (err) {
    console.error('[API] GET /jobs/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /jobs
 * List all jobs, optionally filtered by status
 * Query params: ?status=pending|processing|success|failed
 */
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const validStatuses = ['pending', 'processing', 'success', 'failed'];

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status filter "${status}"`,
        validStatuses,
      });
    }

    const jobs = await listJobs(status || null);
    const queueLength = await getQueueLength();

    return res.json({
      total: jobs.length,
      queueLength,
      filter: status || 'all',
      jobs: jobs.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        attempts: j.attempts,
        createdAt: j.created_at,
        updatedAt: j.updated_at,
      })),
    });
  } catch (err) {
    console.error('[API] GET /jobs error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
