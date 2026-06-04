import app, { initializeApp } from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);
const host = process.env.HOST || "127.0.0.1";

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ host, port }, "Server listening");

  void initializeApp().catch((initErr) => {
    const error = initErr instanceof Error ? initErr : new Error(String(initErr));
    logger.warn(
      { message: error.message, stack: error.stack },
      "Backend background initialization failed; server remains online"
    );
  });
});
