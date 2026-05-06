// src/workers/worker.js
//
// This process runs SEPARATELY from the Express server.
// Start it with: node src/workers/worker.js
//
// FLOW:
//   1. Block on Redis queue waiting for a job_id
//   2. Fetch full job details from PostgreSQL
//   3. Execute the job handler
//   4. On success → mark success in DB
//   5. On failure → retry with exponential backoff, or mark failed

require('dotenv').config();
const { dequeue, requeueWithDelay } = require('../services/queue');
const { getJobById, markProcessing, markSuccess, markFailed, markPendingForRetry } = require('../db/jobModel');
const { processJob } = require('../services/jobHandlers');
const { initSchema } = require('../db');

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

/**
 * Calculate exponential backoff delay
 * Attempt 1 → 2000ms, Attempt 2 → 4000ms, Attempt 3 → 8000ms
 */
function backoffDelay(attempt) {
  return Math.pow(2, attempt) * 1000;
}

/**
 * Process a single job from the queue
 */
async function handleJob(jobId) {
  // 1. Load job from Postgres
  const job = await getJobById(jobId);

  if (!job) {
    console.warn(`[Worker] Job ${jobId} not found in DB — skipping`);
    return;
  }

  // Guard: skip if already succeeded (edge case: duplicate queue entries)
  if (job.status === 'success') {
    console.log(`[Worker] Job ${jobId} already succeeded — skipping`);
    return;
  }

  console.log(`[Worker] Processing job ${jobId} | type=${job.type} | attempt=${job.attempts + 1}/${MAX_RETRIES}`);

  // 2. Mark as processing in Postgres (increments attempts)
  const updatedJob = await markProcessing(jobId);

  try {
    // 3. Execute the actual job work
    const result = await processJob(updatedJob);

    // 4. SUCCESS — save result
    await markSuccess(jobId, result);
    console.log(`[Worker] ✅ Job ${jobId} succeeded`);

  } catch (err) {
    console.error(`[Worker] ❌ Job ${jobId} failed: ${err.message}`);

    if (updatedJob.attempts < MAX_RETRIES) {
      // RETRY with exponential backoff
      const delay = backoffDelay(updatedJob.attempts);
      console.log(`[Worker] 🔁 Retry ${updatedJob.attempts}/${MAX_RETRIES} for job ${jobId} in ${delay}ms`);

      await markPendingForRetry(jobId);
      await requeueWithDelay(jobId, delay);
    } else {
      // GIVE UP — mark as permanently failed
      console.log(`[Worker] 💀 Job ${jobId} exceeded max retries (${MAX_RETRIES}) — marking failed`);
      await markFailed(jobId, err.message);
    }
  }
}

/**
 * Main worker loop — runs forever, blocking on Redis
 */
async function startWorker() {
  console.log('[Worker] Starting up...');
  await initSchema();
  console.log(`[Worker] Listening on queue. MAX_RETRIES=${MAX_RETRIES}`);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[Worker] SIGTERM received — shutting down gracefully');
    process.exit(0);
  });

  // The infinite loop: wait for job → process → repeat
  while (true) {
    try {
      // BRPOP blocks here (timeout=0 = wait forever) until a job arrives
      const jobId = await dequeue(0);

      if (jobId) {
        await handleJob(jobId);
      }
    } catch (err) {
      // Don't crash the worker on unexpected errors
      console.error('[Worker] Unexpected error in main loop:', err);
      await sleep(1000); // Brief pause before retrying
    }
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Only start if run directly (not imported in tests)
if (require.main === module) {
  startWorker().catch((err) => {
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { handleJob, backoffDelay, startWorker };
