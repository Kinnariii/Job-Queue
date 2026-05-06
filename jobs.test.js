// tests/jobs.test.js
//
// Tests are written with Jest + Supertest.
// We mock Redis and PostgreSQL to test logic in isolation.

const request = require('supertest');

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock the database module
jest.mock('../src/db', () => ({
  initSchema: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { end: jest.fn() },
}));

// Mock job model
jest.mock('../src/db/jobModel', () => ({
  createJob: jest.fn(),
  getJobById: jest.fn(),
  listJobs: jest.fn(),
  markProcessing: jest.fn(),
  markSuccess: jest.fn(),
  markFailed: jest.fn(),
  markPendingForRetry: jest.fn(),
}));

// Mock the queue service
jest.mock('../src/services/queue', () => ({
  enqueue: jest.fn().mockResolvedValue(undefined),
  dequeue: jest.fn(),
  requeueWithDelay: jest.fn().mockResolvedValue(undefined),
  getQueueLength: jest.fn().mockResolvedValue(3),
  closeConnections: jest.fn().mockResolvedValue(undefined),
  QUEUE_NAME: 'test_queue',
}));

// Mock job handlers
jest.mock('../src/services/jobHandlers', () => ({
  processJob: jest.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const app = require('../src/server');
const jobModel = require('../src/db/jobModel');
const queue = require('../src/services/queue');
const { processJob } = require('../src/services/jobHandlers');
const { handleJob, backoffDelay } = require('../src/workers/worker');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const sampleJob = {
  id: 'test-uuid-1234',
  type: 'send_email',
  payload: { to: 'user@example.com', subject: 'Hello', body: 'World' },
  status: 'pending',
  attempts: 0,
  max_retries: 3,
  result: null,
  error: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// ─── API Tests ────────────────────────────────────────────────────────────────

describe('POST /jobs', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a job and returns 202 with jobId', async () => {
    jobModel.createJob.mockResolvedValue(sampleJob);

    const res = await request(app)
      .post('/jobs')
      .send({ type: 'send_email', payload: { to: 'a@b.com', subject: 'Hi' } });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe(sampleJob.id);
    expect(res.body.status).toBe('pending');
    expect(res.body.statusUrl).toBe(`/jobs/${sampleJob.id}`);
    // enqueue is called with the UUID generated inside the route handler
    expect(queue.enqueue).toHaveBeenCalledWith(expect.any(String));
  });

  test('returns 400 when type is missing', async () => {
    const res = await request(app).post('/jobs').send({ payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type.*required/i);
  });

  test('returns 400 for invalid job type', async () => {
    const res = await request(app)
      .post('/jobs')
      .send({ type: 'fly_to_moon', payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid job type/i);
    expect(res.body.validTypes).toContain('send_email');
  });

  test('does NOT enqueue if DB creation fails', async () => {
    jobModel.createJob.mockRejectedValue(new Error('DB connection lost'));

    const res = await request(app)
      .post('/jobs')
      .send({ type: 'send_email', payload: {} });

    expect(res.status).toBe(500);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe('GET /jobs/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns job details when found', async () => {
    jobModel.getJobById.mockResolvedValue(sampleJob);

    const res = await request(app).get(`/jobs/${sampleJob.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(sampleJob.id);
    expect(res.body.status).toBe('pending');
    expect(res.body.type).toBe('send_email');
  });

  test('returns 404 when job not found', async () => {
    jobModel.getJobById.mockResolvedValue(null);
    const res = await request(app).get('/jobs/nonexistent-id');
    expect(res.status).toBe(404);
  });
});

describe('GET /jobs', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists all jobs with queue length', async () => {
    jobModel.listJobs.mockResolvedValue([sampleJob]);
    const res = await request(app).get('/jobs');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.queueLength).toBe(3);
    expect(res.body.filter).toBe('all');
  });

  test('filters jobs by status', async () => {
    jobModel.listJobs.mockResolvedValue([]);
    const res = await request(app).get('/jobs?status=failed');

    expect(res.status).toBe(200);
    expect(jobModel.listJobs).toHaveBeenCalledWith('failed');
  });

  test('rejects invalid status filter', async () => {
    const res = await request(app).get('/jobs?status=unknown');
    expect(res.status).toBe(400);
  });
});

// ─── Worker Tests ─────────────────────────────────────────────────────────────

describe('Worker: handleJob', () => {
  beforeEach(() => jest.clearAllMocks());

  test('marks job as success on happy path', async () => {
    const mockResult = { messageId: 'abc', sentAt: new Date().toISOString() };
    jobModel.getJobById.mockResolvedValue({ ...sampleJob, attempts: 0 });
    jobModel.markProcessing.mockResolvedValue({ ...sampleJob, attempts: 1 });
    processJob.mockResolvedValue(mockResult);

    await handleJob(sampleJob.id);

    expect(jobModel.markProcessing).toHaveBeenCalledWith(sampleJob.id);
    expect(processJob).toHaveBeenCalled();
    expect(jobModel.markSuccess).toHaveBeenCalledWith(sampleJob.id, mockResult);
    expect(jobModel.markFailed).not.toHaveBeenCalled();
  });

  test('retries job on failure (attempts < maxRetries)', async () => {
    jobModel.getJobById.mockResolvedValue({ ...sampleJob, attempts: 0 });
    jobModel.markProcessing.mockResolvedValue({ ...sampleJob, attempts: 1 }); // 1st attempt
    processJob.mockRejectedValue(new Error('Network timeout'));

    await handleJob(sampleJob.id);

    expect(jobModel.markPendingForRetry).toHaveBeenCalledWith(sampleJob.id);
    expect(queue.requeueWithDelay).toHaveBeenCalledWith(sampleJob.id, expect.any(Number));
    expect(jobModel.markFailed).not.toHaveBeenCalled();
  });

  test('marks job as failed when max retries exceeded', async () => {
    jobModel.getJobById.mockResolvedValue({ ...sampleJob, attempts: 2 });
    jobModel.markProcessing.mockResolvedValue({ ...sampleJob, attempts: 3 }); // 3rd = max
    processJob.mockRejectedValue(new Error('Permanent failure'));

    await handleJob(sampleJob.id);

    expect(jobModel.markFailed).toHaveBeenCalledWith(sampleJob.id, 'Permanent failure');
    expect(queue.requeueWithDelay).not.toHaveBeenCalled();
  });

  test('skips job if already succeeded', async () => {
    jobModel.getJobById.mockResolvedValue({ ...sampleJob, status: 'success' });

    await handleJob(sampleJob.id);

    expect(jobModel.markProcessing).not.toHaveBeenCalled();
    expect(processJob).not.toHaveBeenCalled();
  });

  test('skips if job not found in DB', async () => {
    jobModel.getJobById.mockResolvedValue(null);

    await handleJob('ghost-id');

    expect(processJob).not.toHaveBeenCalled();
    expect(jobModel.markFailed).not.toHaveBeenCalled();
  });
});

// ─── Backoff Tests ────────────────────────────────────────────────────────────

describe('Worker: backoffDelay', () => {
  test('returns 2s for attempt 1', () => {
    expect(backoffDelay(1)).toBe(2000);
  });

  test('returns 4s for attempt 2', () => {
    expect(backoffDelay(2)).toBe(4000);
  });

  test('returns 8s for attempt 3', () => {
    expect(backoffDelay(3)).toBe(8000);
  });
});
