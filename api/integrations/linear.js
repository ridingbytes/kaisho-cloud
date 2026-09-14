"use strict"

/**
 * @module integrations/linear
 *
 * Linear integration. Authenticates
 * with a personal API key (no OAuth app required) sent in
 * the Authorization header to Linear's GraphQL API.
 *
 * Exposes ``validate`` (used at connect time to verify the
 * key) plus the ``tools()`` / ``dispatch()`` pair the MCP
 * gateway unions into a Pro user's tool surface. Tool
 * names are namespaced ``linear_*`` to avoid colliding
 * with the core kaisho tools.
 */

const { z } = require("zod")

const ENDPOINT = "https://api.linear.app/graphql"
const KIND = "linear"

/**
 * Run a GraphQL query against Linear.
 *
 * @param {string} apiKey - Linear personal API key.
 * @param {string} query
 * @param {object} [variables]
 * @returns {Promise<object>} The ``data`` payload.
 */
async function gql(apiKey, query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Linear personal API keys go in Authorization
      // directly (no "Bearer " prefix).
      "Authorization": apiKey,
    },
    body: JSON.stringify({ query, variables }),
  })
  let json
  try {
    json = await res.json()
  } catch {
    throw new Error(`Linear API ${res.status}`)
  }
  if (!res.ok || json.errors) {
    const msg = json.errors?.[0]?.message || res.status
    throw new Error(`Linear API error: ${msg}`)
  }
  return json.data
}

/**
 * Verify a credential object by fetching the viewer.
 * Throws if the key is invalid.
 *
 * @param {object} credentials - { api_key }.
 * @returns {Promise<{name: string, email: string}>}
 */
async function validate(credentials) {
  const data = await gql(
    credentials.api_key,
    "{ viewer { id name email } }",
  )
  return {
    name: data.viewer.name,
    email: data.viewer.email,
  }
}

/**
 * MCP tool definitions, namespaced ``linear_*``.
 * inputSchema is a raw Zod shape (the McpServer form).
 *
 * @returns {Array<object>}
 */
function tools() {
  return [
    {
      name: "linear_list_teams",
      title: "List Linear teams",
      description:
        "List the Linear teams you can access (id + key "
        + "needed to create issues).",
      inputSchema: {},
    },
    {
      name: "linear_list_issues",
      title: "List Linear issues",
      description:
        "List Linear issues, newest first. Optional "
        + "free-text search and limit.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    {
      name: "linear_get_issue",
      title: "Get a Linear issue",
      description: "Fetch one Linear issue by id.",
      inputSchema: { id: z.string().min(1) },
    },
    {
      name: "linear_create_issue",
      title: "Create a Linear issue",
      description:
        "Create a Linear issue in a team "
        + "(team_id from linear_list_teams).",
      inputSchema: {
        team_id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
      },
    },
  ]
}

const CLAMP_MAX = 100

function clampLimit(n) {
  const v = Number.isFinite(n) ? Math.floor(n) : 25
  return Math.max(1, Math.min(v, CLAMP_MAX))
}

/**
 * Execute a ``linear_*`` tool.
 *
 * @param {string} tool - Tool name.
 * @param {object} args - Validated tool args.
 * @param {object} credentials - { api_key }.
 * @returns {Promise<*>} JSON-serialisable result.
 */
async function dispatch(tool, args, credentials) {
  const key = credentials.api_key
  if (tool === "linear_list_teams") {
    const data = await gql(
      key,
      "{ teams { nodes { id key name } } }",
    )
    return data.teams.nodes
  }
  if (tool === "linear_list_issues") {
    const data = await gql(
      key,
      `query ($first: Int!, $filter: IssueFilter) {
         issues(first: $first, filter: $filter,
                orderBy: updatedAt) {
           nodes {
             id identifier title
             state { name } assignee { name }
             updatedAt url
           }
         }
       }`,
      {
        first: clampLimit(args.limit),
        filter: args.query
          ? { title: { containsIgnoreCase: args.query } }
          : undefined,
      },
    )
    return data.issues.nodes
  }
  if (tool === "linear_get_issue") {
    const data = await gql(
      key,
      `query ($id: String!) {
         issue(id: $id) {
           id identifier title description
           state { name } assignee { name }
           createdAt updatedAt url
         }
       }`,
      { id: args.id },
    )
    return data.issue
  }
  if (tool === "linear_create_issue") {
    const data = await gql(
      key,
      `mutation ($input: IssueCreateInput!) {
         issueCreate(input: $input) {
           success
           issue { id identifier title url }
         }
       }`,
      {
        input: {
          teamId: args.team_id,
          title: args.title,
          description: args.description,
        },
      },
    )
    return data.issueCreate.issue
  }
  throw new Error(`Unknown tool: ${tool}`)
}

module.exports = { KIND, validate, tools, dispatch }
