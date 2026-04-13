"use strict"

const pino = require("pino")
const pinoHttp = require("pino-http")

const VERBOSE = process.argv.includes("-v")

const logger = pino({
  level: VERBOSE ? "debug" : "info",
  transport: process.stdout.isTTY
    ? { target: "pino/file", options: { destination: 1 } }
    : undefined,
})

const httpLogger = pinoHttp({
  logger,
  genReqId: (req) =>
    req.headers["x-request-id"] || undefined,
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      userId: req.raw?.userId,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  autoLogging: {
    ignore: (req) => req.url === "/health",
  },
})

module.exports = { logger, httpLogger }
