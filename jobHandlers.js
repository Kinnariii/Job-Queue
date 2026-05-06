// src/services/jobHandlers.js
//
// This is where the REAL work happens for each job type.
// Each handler receives the job's payload and must return a result object.
// Throw an error to trigger retry logic.

/**
 * Simulate sending an email
 * In production: use Nodemailer, SendGrid, AWS SES, etc.
 */
async function handleSendEmail({ to, subject, body }) {
  if (!to || !subject) throw new Error('Missing required fields: to, subject');

  // Simulate network delay
  await sleep(500);

  // Simulate 20% random failure (to demonstrate retry logic)
  if (Math.random() < 0.2) {
    throw new Error('SMTP connection timeout — simulated failure');
  }

  console.log(`[Handler] Email sent to ${to}: "${subject}"`);
  return { messageId: `msg_${Date.now()}`, to, subject, sentAt: new Date().toISOString() };
}

/**
 * Simulate resizing an image
 * In production: use Sharp, Jimp, ImageMagick
 */
async function handleResizeImage({ imageUrl, width, height }) {
  if (!imageUrl) throw new Error('Missing required field: imageUrl');

  await sleep(800);

  if (Math.random() < 0.1) {
    throw new Error('Image processing service unavailable — simulated failure');
  }

  console.log(`[Handler] Image resized: ${imageUrl} → ${width}x${height}`);
  return {
    originalUrl: imageUrl,
    resizedUrl: `${imageUrl}?w=${width}&h=${height}`,
    width,
    height,
    processedAt: new Date().toISOString(),
  };
}

/**
 * Simulate generating a report
 * In production: query DB, build PDF with pdfkit, upload to S3
 */
async function handleGenerateReport({ reportType, userId, dateRange }) {
  if (!reportType || !userId) throw new Error('Missing required fields: reportType, userId');

  await sleep(1200);

  console.log(`[Handler] Report generated: ${reportType} for user ${userId}`);
  return {
    reportType,
    userId,
    dateRange,
    downloadUrl: `https://reports.example.com/${userId}/${reportType}_${Date.now()}.pdf`,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Route a job to the correct handler based on its type
 * @param {Object} job - Full job record from PostgreSQL
 * @returns {Object} Result from the handler
 */
async function processJob(job) {
  const { type, payload } = job;

  switch (type) {
    case 'send_email':
      return handleSendEmail(payload);
    case 'resize_image':
      return handleResizeImage(payload);
    case 'generate_report':
      return handleGenerateReport(payload);
    default:
      throw new Error(`Unknown job type: "${type}"`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { processJob };
