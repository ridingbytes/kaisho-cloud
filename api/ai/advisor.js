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

const ADVISOR_SYSTEM =
  "You are the Kaisho AI advisor. You help the user "
  + "manage their time tracking, tasks, customers, notes "
  + "and their connected tools (calendar, Linear, GitHub, "
  + "Slack). Use the available tools to look up real data "
  + "before answering — never guess and never claim you "
  + "lack access when a tool can fetch it. Be concise and "
  + "actionable. Answer in the user's language."

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
 * Collect the advisor toolset for a user: OpenAI-format
 * tool definitions plus a ``name -> handler`` map. Reuses
 * the MCP registrars by handing them a collector that
 * captures each ``registerTool`` call instead of wiring a
 * transport.
 *
 * @param {string} userId
 * @returns {Promise<{tools: Array, handlers: object}>}
 */
async function collectTools(userId) {
  const tools = []
  const handlers = {}
  const collector = {
    registerTool(name, def, handler) {
      const shape = def.inputSchema || {}
      const parameters = zodToJsonSchema(z.object(shape), {
        target: "openApi3",
        $refStrategy: "none",
      })
      tools.push({
        type: "function",
        function: {
          name,
          description: def.description || "",
          parameters,
        },
      })
      handlers[name] = handler
    },
  }
  registerReadTools(collector, userId)
  registerWriteTools(collector, userId)
  // Pro premium integrations — a no-op when the user has
  // none connected (companion users simply get the data
  // tools, Pro users additionally get integration tools).
  await registerIntegrationTools(collector, userId)
  return { tools, handlers }
}

/**
 * Run one tool call and return its result as a string for
 * the tool message. MCP handlers return
 * ``{ content: [{ type, text }], isError? }``; flatten the
 * text parts. Errors are returned (not thrown) so the
 * model can see the failure and recover on the next turn.
 *
 * @param {object} call - OpenAI tool_call object.
 * @param {object} handlers - name -> handler map.
 * @returns {Promise<string>}
 */
async function runToolCall(call, handlers) {
  const name = call.function && call.function.name
  const handler = handlers[name]
  if (!handler) return `Error: unknown tool ${name}`

  let args = {}
  try {
    args = JSON.parse(call.function.arguments || "{}")
  } catch (err) {
    return "Error: malformed tool arguments"
  }

  try {
    const result = await handler(args)
    const text = (result && result.content || [])
      .map((c) => c.text)
      .filter(Boolean)
      .join("\n")
    return text || "(no output)"
  } catch (err) {
    logger.error(
      { err, tool: name }, "advisor tool failed",
    )
    return `Error: ${err.message}`
  }
}

/**
 * Append the assistant turn to the running conversation,
 * carrying tool_calls only when present.
 */
function pushAssistant(convo, msg, calls) {
  convo.push({
    role: "assistant",
    content: msg.content || "",
    ...(calls.length ? { tool_calls: calls } : {}),
  })
}

/**
 * Run the agentic advisor loop.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.plan] - Sets priority-queue order.
 * @param {object} [opts.backend] - Pre-resolved backend.
 * @param {string} opts.model
 * @param {string} [opts.system] - Base prompt override.
 * @param {string} [opts.context] - Extra context block.
 * @param {Array}  opts.messages - OpenAI chat messages.
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{text, steps, toolsUsed, usage}>}
 */
async function runAdvisor(opts) {
  const { tools, handlers } = await collectTools(opts.userId)
  const system = buildSystem(opts.system, opts.context)
  const convo = [...opts.messages]
  const toolsUsed = []
  const usage = { input: 0, output: 0 }

  for (let step = 0; step < MAX_STEPS; step++) {
    // Drop tools on the final round to force a prose
    // answer instead of another tool request.
    const lastStep = step === MAX_STEPS - 1
    const result = await callModel({
      backend: opts.backend,
      plan: opts.plan,
      model: opts.model,
      system,
      messages: convo,
      tools: lastStep ? undefined : tools,
      maxTokens: opts.maxTokens,
    })

    const u = extractUsage(result)
    usage.input += u.input
    usage.output += u.output

    const choice = result.choices && result.choices[0]
    const msg = (choice && choice.message) || {}
    const calls = msg.tool_calls || []
    pushAssistant(convo, msg, calls)

    if (!calls.length) {
      return {
        text: msg.content || "",
        steps: step + 1,
        toolsUsed,
        usage,
      }
    }

    for (const call of calls) {
      toolsUsed.push(call.function && call.function.name)
      const content = await runToolCall(call, handlers)
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content,
      })
    }
  }

  // Reached only if the model kept emitting tool_calls
  // through the penultimate round; the last round has no
  // tools, so in practice it returns above.
  return { text: "", steps: MAX_STEPS, toolsUsed, usage }
}

module.exports = {
  MAX_STEPS,
  ADVISOR_SYSTEM,
  buildSystem,
  collectTools,
  runAdvisor,
}
