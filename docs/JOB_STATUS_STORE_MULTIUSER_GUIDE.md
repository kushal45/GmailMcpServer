# JobStatusStore Multi-User Best Practices Guide

## Overview
This document outlines best practices for using `JobStatusStore` in a multi-user environment, including how to handle job creation, querying, cleanup, and test isolation. It covers both production and test scenarios.

---

## 1. Production (Real-World) Usage

### User-Scoped Operations
- **Always pass `user_id`** for user-facing job operations.
- Ensures each user only sees and manages their own jobs.

#### Examples
```js
// Create a job for a user
const jobId = await jobStatusStore.createJob("categorization", { year: 2024 }, currentUserId);

// List jobs for a user
const userJobs = await jobStatusStore.listJobs({ user_id: currentUserId });

// Get job status (permission-checked)
const job = await jobStatusStore.getJobStatus(jobId, currentUserId);

// Cancel or delete a job (permission-checked)
await jobStatusStore.cancelJob(jobId, currentUserId);
await jobStatusStore.deleteJob(jobId, currentUserId);

// Cleanup old jobs for a user
await jobStatusStore.cleanupOldJobs(30, currentUserId);
```

### Admin/System Operations
- **Omit `user_id`** for global operations (admin/maintenance only).
- Example:
```js
// Delete all jobs older than 90 days (all users)
await jobStatusStore.cleanupOldJobs(90);
```

---

## 2. Test Environment Best Practices

- Use a **per-test, temporary database file** for isolation.
- Reset and initialize the global DB and JobStatusStore singleton before each test.
- Clean up all jobs from the global DB after each test.
- Never run tests against the production DB.

#### Example (Jest):
```js
beforeEach(async () => {
  DatabaseManager.resetInstance();
  JobStatusStore.resetInstance();
  // ...initialize DB and JobStatusStore...
  await DatabaseManager.getInstance().query("DELETE FROM job_statuses", []);
});
afterEach(async () => {
  await DatabaseManager.getInstance().query("DELETE FROM job_statuses", []);
});
```

---

## 3. Summary Table

| Operation         | User-Facing (with user_id)         | Admin/System (global)         |
|-------------------|------------------------------------|-------------------------------|
| List Jobs         | `listJobs({ user_id })`            | `listJobs()`                  |
| Cleanup Old Jobs  | `cleanupOldJobs(days, user_id)`    | `cleanupOldJobs(days)`        |
| Get/Cancel/Delete | `getJobStatus(jobId, user_id)`     | `getJobStatus(jobId)`         |

---

## 4. Key Takeaways
- Always use `user_id` for user-facing operations.
- Omit `user_id` only for admin/system-wide operations.
- In tests, use per-test DBs and full cleanup for isolation.
- Never mix test and production DBs.

---

*This document is intended for future reference and implementation. Update as the system evolves.* 