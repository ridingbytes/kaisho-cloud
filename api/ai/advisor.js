"use strict"

/**
 * @module ai/advisor
 *
 * Server-side agentic advisor.
 *
 * Runs a tool-using completion loop entirely on the
 * server so thin clients (the PWA) get the same
 * capability the desktop advisor has from its local
 * loop: the model can call kaisho data tools and the
 * user's connected premium-integration tools (Pro), read
 * the results, then answer — instead of being limited to
 * a single shot over a fixed, pre-baked context block.
 *
 * The toolset is harvested from the very same registrars
 * the MCP gateway uses (``registerReadTools`` /
 * ``registerWriteTools`` / ``registerIntegrationTools``)
 * through a minimal collector that mimics
 * ``McpServer.registerTool``. There is exactly one
 * definition of each tool; this module only changes the
 * transport (an internal loop instead of MCP wire).
 *
 * Unlike the MCP wire, the SDK's pre-handler Zod
 * validation does not run for us, so the collector keeps
 * each tool's schema and ``runToolCall`` validates args
 * before invoking the handler — restoring the contract
 * the handlers were written against.
 */

const { z } = require("zod")
const { zodToJsonSchema } = require("zod-to-json-schema")
const { registerReadTools } = require("../mcp/tools/read")
const { registerWriteTools } = require("../mcp/tools/write")
const {
  registerIntegrationTools,
} = require("../integrations")
const { callModel, extractUsage } = require("./engine")
const { logger } = require("../logger")

// Hard cap on tool-use rounds. Bounds latency, cost, and
// runaway loops if the model keeps calling tools. The
// final round is run without tools so the model is forced
// to answer in prose rather than request yet another call.
const MAX_STEPS = 6

// Per-round output cap. Lower than /ai/complete's 8192
// because the advisor multiplies it by up to MAX_STEPS.
const DEFAULT_MAX_TOKENS = 2048
const MAX_TOKENS_LIMIT = 4096

// Premium integrations are gated to these plans, matching
// the MCP gateway (see routes/mcp.js).
const INTEGRATION_PLANS = ["pro", "team"]

const ADVISOR_SYSTEM =
  "You are the Kaisho AI advisor. You help the user "
  + "manage their time tracking, tasks, customers, notes "
  + "and their connected tools (calendar, Linear, GitHub, "
  + "Slack). Use the available tools to look up real data "
  + "before answering — never guess and never claim you "
  + "lack access when a tool can fetch it. Be concise and "
  + "actionable. Answer in the user's language."

const STEP_LIMIT_REPLY =
  "I wasn't able to finish that within my tool-use "
  + "budget. Please narrow the question and try again."

/**
 * Build the advisor system prompt: the base (or a
 * caller-supplied override), the current server time so
 * relative dates resolve, and any extra context block.
 *
 * @param {string} [custom] - Override for the base prompt.
 * @param {string} [context] - Extra context to append.
 * @returns {string}
 */
function buildSystem(custom, context) {
  const parts = [custom || ADVISOR_SYSTEM]
  parts.push(
    `Current server time (UTC): ${new Date().toISOString()}.`,
  )
  if (context) parts.push("## Context\n\n" + context)
  return parts.join("\n\n")
}

/**
 * Convert a raw Zod shape to a JSON schema the model
 * accepts. The default (draft-07) target emits the number
 * form of exclusiveMinimum, valid under draft 2020-12
 * (what Anthropic tool schemas require); the openApi3
 * target's boolean form is rejected. The $schema marker
 * is dropped — providers reject the extra key.
 *
 * @param {object} shape - Raw Zod shape.
 * @returns {object} JSON schema for the tool parameters.
 */
function shapeToParameters(shape) {
  const parameters = zodToJsonSchema(z.object(shape), {
    $refStrategy: "none",
  })
  delete parameters.$schema
  return parameters
}

/**
 * Collect the advisor toolset for a user: OpenAI-format
 * tool definitions plus a ``name -> { schema, handler }``
 * map. Reuses the MCP registrars by handing them a
 * collector that captures each ``registerTool`` call
 * instead of wiring a transport.
 *
 * Read + write tools are always included so the advisor
 * can both look up and act (create events, add tasks).
 * Integration tools are added only for Pro/Team plans,
 * matching the MCP gateway's plan gate — never for
 * companion users, even if integration rows linger from a
 * prior Pro subscription.
 *
 * @param {string} userId
 * @param {string} [plan] - Caller's plan.
 * @returns {Promise<{tools: Array, handlers: object}>}
 */
async function collectTools(userId, plan) {
  const tools = []
  const handlers = {}
  const collector = {
    registerTool(name, def, handler) {
      tools.push({
        type: "function",
        function: {
          name,
          description: def.description || "",
          parameters: shapeToParameters(def.inputSchema || {}),
        },
      })
      handlers[name] = {
        schema: z.object(def.inputSchema || {}),
        handler,
      }
    },
  }
  registerReadTools(collector, userId)
  registerWriteTools(collector, userId)
  if (INTEGRATION_PLANS.includes(plan)) {
    await registerIntegrationTools(collector, userId)
  }
  return { tools, handlers }
}

/**
 * Flatten an MCP handler result
 * (``{ content: [{ type, text }], isError? }``) to a
 * string for the tool message.
 *
 * @param {object} result
 * @returns {string}
 */
function flattenResult(result) {
  const parts = (result && result.content) || []
  const text = parts
    .map((c) => c.text)
    .filter(Boolean)
    .join("\n")
  return text || "(no output)"
}

/**
 * Validate args against the tool's Zod schema, then run
 * the handler and return its result as a string. The MCP
 * SDK normally validates before invoking the handler; on
 * the internal loop we do it here. Errors (bad args,
 * unknown tool, handler throw) are returned as text — not
 * thrown — so the model can see the failure and recover.
 *
 * @param {object} call - OpenAI tool_call object.
 * @param {object} handlers - name -> { schema, handler }.
 * @returns {Promise<string>}
 */
async function runToolCall(call, handlers) {
  const name = call.function && call.function.name
  const entry = handlers[name]
  if (!entry) return `Error: unknown tool ${name}`

  let rawArgs = {}
  try {
    rawArgs = JSON.parse(call.function.arguments || "{}")
  } catch {
    return "Error: malformed tool arguments"
  }

  const parsed = entry.schema.safeParse(rawArgs)
  if (!parsed.success) {
    return `Error: invalid arguments: ${parsed.error.message}`
  }

  try {
    return flattenResult(await entry.handler(parsed.data))
  } catch (err) {
    // Full error (with body / headers / token) goes to
    // logs only. The model receives a sanitised summary
    // so any credentials the integration backend echoed
    // in its error body (Slack and Google occasionally do)
    // don't end up in the model context window — and from
    // there, potentially in the user's transcript.
    logger.error(
      { err, tool: name }, "advisor tool failed",
    )
    return sanitisedToolError(name, err)
  }
}

// Whitelist of error-message prefixes that are safe to
// pass back to the model verbatim. These come from the
// integration adapters themselves (we wrote them), not
// from raw upstream response bodies. Everything outside
// the whitelist collapses to a "tool failed (code)"
// summary so we never echo an upstream body containing a
// token or API key.
const SAFE_ERROR_PREFIXES = [
  "Slack OAuth:",
  "Google OAuth:",
  "Integration not configured",
  "Invalid arguments",
  "Not connected",
]

/**
 * Build a model-safe error string for a failed tool call.
 * Strips any raw upstream body that might contain OAuth
 * tokens, API keys, or other secrets the integration
 * backend echoed back in its error.
 *
 * @param {string} toolName
 * @param {Error} err
 * @returns {string}
 */
function sanitisedToolError(toolName, err) {
  const msg = String(err.message || err)
  for (const prefix of SAFE_ERROR_PREFIXES) {
    if (msg.startsWith(prefix)) return `Error: ${msg}`
  }
  const code = err.code || err.status || "unknown"
  return `Error: ${toolName} failed (${code})`
}

/**
 * Append the assistant turn to the running conversation,
 * carrying tool_calls only when present.
 */
function pushAssistant(conversation, msg, calls) {
  conversation.push({
    role: "assistant",
    content: msg.content || "",
    ...(calls.length ? { tool_calls: calls } : {}),
  })
}

/**
 * Run every tool call in a round, appending each result
 * as a tool message and recording the names that actually
 * ran. Calls are executed in order.
 *
 * @param {Array} calls
 * @param {object} handlers
 * @param {Array} conversation
 * @param {Array} toolsUsed - Mutated with executed names.
 */
async function runRoundTools(calls, handlers, conversation, toolsUsed) {
  for (const call of calls) {
    const content = await runToolCall(call, handlers)
    const name = call.function && call.function.name
    if (name) toolsUsed.push(name)
    conversation.push({
      role: "tool",
      tool_call_id: call.id,
      content,
    })
  }
}

/**
 * Run the agentic advisor loop.
 *
 * Usage is reported per round through ``onUsage`` (so it
 * is metered even if a later round throws) and the loop
 * stops early once cumulative usage would reach the cap.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.plan] - Gates integrations + queue.
 * @param {object} [opts.backend] - Pre-resolved backend.
 * @param {string} opts.model
 * @param {string} [opts.system] - Base prompt override.
 * @param {string} [opts.context] - Extra context block.
 * @param {Array}  opts.messages - OpenAI chat messages.
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.cap] - Monthly token cap.
 * @param {number} [opts.used=0] - Tokens already used.
 * @param {function} [opts.onUsage] - (input, output) per
 *   round; may be async. Persists usage incrementally.
 * @returns {Promise<{text, steps, toolsUsed, usage}>}
 */
async function runAdvisor(opts) {
  const { tools, handlers } =
    await collectTools(opts.userId, opts.plan)
  const system = buildSystem(opts.system, opts.context)
  const conversation = [...opts.messages]
  const toolsUsed = []
  const usage = { input: 0, output: 0 }
  const cap = Number.isFinite(opts.cap) ? opts.cap : Infinity
  const used = opts.used || 0

  const finish = (text, step) => ({
    text, steps: step + 1, toolsUsed, usage,
  })

  for (let step = 0; step < MAX_STEPS; step++) {
    const capReached =
      used + usage.input + usage.output >= cap
    // Drop tools on the final round, or once the cap is
    // reached, to force a prose answer with what we have.
    const noTools = step === MAX_STEPS - 1 || capReached

    const result = await callModel({
      backend: opts.backend,
      plan: opts.plan,
      model: opts.model,
      system,
      messages: conversation,
      tools: noTools ? undefined : tools,
      maxTokens: opts.maxTokens || DEFAULT_MAX_TOKENS,
    })

    const roundUsage = extractUsage(result)
    usage.input += roundUsage.input
    usage.output += roundUsage.output
    if (opts.onUsage) {
      await opts.onUsage(roundUsage.input, roundUsage.output)
    }

    const choice = result.choices && result.choices[0]
    const msg = (choice && choice.message) || {}
    const calls = msg.tool_calls || []
    pushAssistant(conversation, msg, calls)

    if (!calls.length || noTools) {
      // A forced tool-less round with empty content means
      // the model gave up mid-task — surface a fallback so
      // the client never renders a blank answer.
      const text =
        msg.content || (noTools ? STEP_LIMIT_REPLY : "")
      return finish(text, step)
    }
    await runRoundTools(
      calls, handlers, conversation, toolsUsed,
    )
  }

  // Should not be reached: the final round runs tool-less
  // and returns above. Guard with a clear fallback.
  return finish(STEP_LIMIT_REPLY, MAX_STEPS - 1)
}

module.exports = {
  MAX_STEPS,
  DEFAULT_MAX_TOKENS,
  MAX_TOKENS_LIMIT,
  ADVISOR_SYSTEM,
  buildSystem,
  collectTools,
  runAdvisor,
}
