// src/services/queue.js
const Redis = require('ioredis');
require('dotenv').config();

const QUEUE_NAME = process.env.QUEUE_NAME || 'job_queue';

// Separate Redis clients for producer and consumer.
// Consumer uses BRPOP (blocking) — it MUST be on its own connection
// so it doesn't block the producer.
let producerClient = null;
let consumerClient = null;

function getProducer() {
  if (!producerClient) {
    producerClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    producerClient.on('connect', () => console.log('[Redis] Producer connected'));
    producerClient.on('error', (err) => console.error('[Redis] Producer error:', err));
  }
  return producerClient;
}

function getConsumer() {
  if (!consumerClient) {
    consumerClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    consumerClient.on('connect', () => console.log('[Redis] Consumer connected'));
    consumerClient.on('error', (err) => console.error('[Redis] Consumer error:', err));
  }
  return consumerClient;
}

/**
 * PRODUCER: Push a job_id onto the LEFT side of the Redis list.
 * The worker will pop from the RIGHT (FIFO order).
 *
 * @param {string} jobId - UUID of the job to enqueue
 */
async function enqueue(jobId) {
  const client = getProducer();
  await client.lpush(QUEUE_NAME, jobId);
  console.log(`[Queue] Enqueued job ${jobId}`);
}

/**
 * CONSUMER: Block until a job is available, then pop it.
 * BRPOP blocks the connection until an item appears (timeout=0 means wait forever).
 * Returns the job_id string, or null on timeout.
 *
 * @param {number} timeout - Seconds to block (0 = forever)
 */
async function dequeue(timeout = 0) {
  const client = getConsumer();
  // BRPOP returns [queueName, value] or null on timeout
  const result = await client.brpop(QUEUE_NAME, timeout);
  if (!result) return null;
  const [, jobId] = result;
  console.log(`[Queue] Dequeued job ${jobId}`);
  return jobId;
}

/**
 * Re-queue a job after a delay (for retry with backoff).
 * Uses setTimeout to delay the LPUSH.
 *
 * @param {string} jobId
 * @param {number} delayMs - Milliseconds to wait before re-queuing
 */
async function requeueWithDelay(jobId, delayMs) {
  console.log(`[Queue] Re-queuing job ${jobId} after ${delayMs}ms delay`);
  return new Promise((resolve) => {
    setTimeout(async () => {
      await enqueue(jobId);
      resolve();
    }, delayMs);
  });
}

/**
 * Get current queue length (pending jobs in Redis)
 */
async function getQueueLength() {
  const client = getProducer();
  return client.llen(QUEUE_NAME);
}

async function closeConnections() {
  if (producerClient) await producerClient.quit();
  if (consumerClient) await consumerClient.quit();
}

module.exports = {
  enqueue,
  dequeue,
  requeueWithDelay,
  getQueueLength,
  closeConnections,
  QUEUE_NAME,
};
