import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const usePrettyLogs = process.env.RGI_PRETTY_LOGS === "true" && !process.env.FUNCTION_TARGET;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers['x-admin-api-key']",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction || !usePrettyLogs
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
