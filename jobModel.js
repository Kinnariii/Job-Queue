// src/db/jobModel.js
const { query } = require('./index');

/**
 * Create a new job record in the database
 * @param {Object} opts
 * @param {string} opts.id - UUID for the job
 * @param {string} opts.type - Job type (e.g. 'send_email', 'resize_image')
 * @param {Object} opts.payload - Job-specific data
 * @param {number} opts.maxRetries - Max retry attempts (default 3)
 */
async function createJob({ id, type, payload, maxRetries = 3 }) {
  const res = await query(
    `INSERT INTO jobs (id, type, payload, status, max_retries)
     VALUES ($1, $2, $3, 'pending', $4)
     RETURNING *`,
    [id, type, JSON.stringify(payload), maxRetries]
  );
  return res.rows[0];
}

/**
 * Fetch a single job by ID
 */
async function getJobById(id) {
  const res = await query('SELECT * FROM jobs WHERE id = $1', [id]);
  return res.rows[0] || null;
}

/**
 * Fetch all jobs, optionally filtered by status
 * @param {string|null} status - Filter by status
 */
async function listJobs(status = null) {
  if (status) {
    const res = await query(
      'SELECT * FROM jobs WHERE status = $1 ORDER BY created_at DESC',
      [status]
    );
    return res.rows;
  }
  const res = await query('SELECT * FROM jobs ORDER BY created_at DESC');
  return res.rows;
}

/**
 * Mark a job as "processing" and increment attempts
 */
async function markProcessing(id) {
  const res = await query(
    `UPDATE jobs
     SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return res.rows[0];
}

/**
 * Mark a job as successfully completed
 * @param {string} id
 * @param {Object} result - Output/result data from the job
 */
async function markSuccess(id, result) {
  const res = await query(
    `UPDATE jobs
     SET status = 'success', result = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, JSON.stringify(result)]
  );
  return res.rows[0];
}

/**
 * Mark a job as failed (no more retries)
 * @param {string} id
 * @param {string} errorMessage - Error description
 */
async function markFailed(id, errorMessage) {
  const res = await query(
    `UPDATE jobs
     SET status = 'failed', error = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, errorMessage]
  );
  return res.rows[0];
}

/**
 * Reset job to "pending" for retry (keeps attempt count)
 */
async function markPendingForRetry(id) {
  const res = await query(
    `UPDATE jobs
     SET status = 'pending', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return res.rows[0];
}

module.exports = {
  createJob,
  getJobById,
  listJobs,
  markProcessing,
  markSuccess,
  markFailed,
  markPendingForRetry,
};
