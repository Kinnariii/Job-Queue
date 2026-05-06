# Async Job Queue System

A production-grade asynchronous job processing system using **Node.js**, **Redis**, **PostgreSQL**, and **Express.js**.

---

## Architecture

```
┌──────────────┐    POST /jobs     ┌─────────────────┐
│   Client     │ ──────────────→  │   Express API    │
│              │ ←──────────────  │   (Producer)     │
│ { jobId }    │   202 Accepted   └────────┬─────────┘
└──────────────┘                           │
                                           │  LPUSH job_id
                                           ▼
                                   ┌──────────────┐
                                   │    Redis      │
                                   │  job_queue    │
                                   │  [id3,id2,id1]│
                                   └──────┬───────┘
                                          │  BRPOP (blocking)
                                          ▼
                                  ┌───────────────┐
                                  │  Worker Node   │
                                  │  (Consumer)    │
                                  │  retry logic   │
                                  └──────┬─────────┘
                                         │
                            ┌────────────┼─────────────┐
                            ▼            ▼              ▼
                         success      failure        failure x3
                            │        (retry)        (give up)
                            └────────────┴──────────────┘
                                         │
                                         ▼
                                  ┌─────────────┐
                                  │  PostgreSQL   │
                                  │  jobs table   │
                                  └─────────────┘
```

---

## Job Lifecycle

| Status       | Meaning                                      |
|--------------|----------------------------------------------|
| `pending`    | Created, waiting in Redis queue              |
| `processing` | Worker picked it up, executing right now     |
| `success`    | Completed successfully, result saved         |
| `failed`     | Exceeded max retries, permanently failed     |

---

## Retry Strategy: Exponential Backoff

When a job fails, the worker waits before re-queuing:

| Attempt | Wait    |
|---------|---------|
| 1st fail | 2 sec  |
| 2nd fail | 4 sec  |
| 3rd fail | ❌ Mark failed |

---

## Quick Start

### With Docker (Recommended)

```bash
docker compose up
```

This starts PostgreSQL, Redis, the API server, and one worker.

Scale workers:
```bash
docker compose up --scale worker=3
```

### Manual Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your Postgres and Redis URLs

# 3. Start the API server (Terminal 1)
npm start

# 4. Start the worker (Terminal 2)
npm run worker
```

---

## API Usage

### Create a Job

```bash
# Send Email Job
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "send_email",
    "payload": {
      "to": "user@example.com",
      "subject": "Welcome!",
      "body": "Thanks for signing up."
    }
  }'

# Response:
# { "jobId": "abc-123", "status": "pending", "statusUrl": "/jobs/abc-123" }
```

```bash
# Image Resize Job
curl -X POST http://localhost:3000/jobs \
  -d '{ "type": "resize_image", "payload": { "imageUrl": "https://...", "width": 800, "height": 600 } }'

# Report Generation Job
curl -X POST http://localhost:3000/jobs \
  -d '{ "type": "generate_report", "payload": { "reportType": "sales", "userId": "u_123" } }'
```

### Check Job Status

```bash
curl http://localhost:3000/jobs/abc-123
```

### List All Jobs

```bash
curl http://localhost:3000/jobs
curl http://localhost:3000/jobs?status=failed
curl http://localhost:3000/jobs?status=success
```

---

## Running Tests

```bash
npm test
npm run test:coverage
```

Tests use mocked Redis and PostgreSQL — no live connections required.

---

## Project Structure

```
src/
├── server.js              # Express app entry point
├── db/
│   ├── index.js           # PostgreSQL pool + schema init
│   └── jobModel.js        # All DB operations for jobs
├── routes/
│   └── jobs.js            # REST API endpoints
├── services/
│   ├── queue.js           # Redis producer/consumer
│   └── jobHandlers.js     # Business logic per job type
└── workers/
    └── worker.js          # Consumer loop with retry logic
tests/
└── jobs.test.js           # Jest test suite
```

---

## Adding a New Job Type

1. Add the type to the whitelist in `src/routes/jobs.js`:
   ```js
   const VALID_JOB_TYPES = ['send_email', 'resize_image', 'generate_report', 'your_new_type'];
   ```

2. Add a handler in `src/services/jobHandlers.js`:
   ```js
   async function handleYourNewType({ param1, param2 }) {
     // your logic here
     return { success: true };
   }
   ```

3. Register it in the switch statement in `processJob()`:
   ```js
   case 'your_new_type':
     return handleYourNewType(payload);
   ```
