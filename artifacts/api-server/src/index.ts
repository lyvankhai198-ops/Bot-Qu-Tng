import app from "./app";
import { logger } from "./lib/logger";
import { startWorker, stopWorker } from "./queue/worker.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start background health-check worker
  startWorker();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  stopWorker();
  process.exit(0);
});
process.on("SIGINT", () => {
  stopWorker();
  process.exit(0);
});
