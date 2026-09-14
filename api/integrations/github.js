"use strict"

/**
 * @module integrations/github
 *
 * GitHub Projects (v2) integration.
 * Authenticates with a personal access token (classic or
 * fine-grained with `read:project` / `project` scope) — no
 * OAuth app required. Projects v2 is GraphQL-only, so all
 * calls go through the GitHub GraphQL API.
 *
 * Tool names are namespaced ``github_*``.
 */

const { z } = require("zod")

const ENDPOINT = "https://api.github.com/graphql"
const KIND = "github"

/**
 * Run a GraphQL query against GitHub.
 *
 * @param {string} token - PAT.
 * @param {string} query
 * @param {object} [variables]
 * @returns {Promise<object>} The ``data`` payload.
 */
async function gql(token, query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      // GitHub requires a User-Agent on every request.
      "User-Agent": "kaisho-cloud",
    },
    body: JSON.stringify({ query, variables }),
  })
  let json
  try {
    json = await res.json()
  } catch {
    throw new Error(`GitHub API ${res.status}`)
  }
  if (!res.ok || json.errors) {
    const msg = json.errors?.[0]?.message || res.status
    throw new Error(`GitHub API error: ${msg}`)
  }
  return json.data
}

/**
 * Verify a PAT by fetching the viewer login.
 *
 * @param {object} credentials - { api_key }.
 * @returns {Promise<{login: string}>}
 */
async function validate(credentials) {
  const data = await gql(
    credentials.api_key,
    "{ viewer { login } }",
  )
  return { login: data.viewer.login }
}

function tools() {
  return [
    {
      name: "github_list_projects",
      title: "List GitHub projects",
      description:
        "List your GitHub Projects (v2) — id + number "
        + "needed for the other tools.",
      inputSchema: {
        limit: z.number().int().positive().optional(),
      },
    },
    {
      name: "github_list_project_items",
      title: "List project items",
      description:
        "List items in a GitHub Project (title + status).",
      inputSchema: {
        project_id: z.string().min(1),
        limit: z.number().int().positive().optional(),
      },
    },
    {
      name: "github_create_draft_item",
      title: "Create a draft project item",
      description:
        "Add a draft issue to a GitHub Project.",
      inputSchema: {
        project_id: z.string().min(1),
        title: z.string().min(1),
        body: z.string().optional(),
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
 * Shape a Projects v2 item node into a flat summary.
 */
function itemSummary(node) {
  const status = (node.fieldValues?.nodes || [])
    .map((f) => f?.name)
    .find((n) => n)
  const content = node.content || {}
  return {
    id: node.id,
    title: content.title || "(draft)",
    number: content.number ?? null,
    url: content.url ?? null,
    state: content.state ?? null,
    status: status ?? null,
  }
}

async function dispatch(tool, args, credentials) {
  const token = credentials.api_key
  if (tool === "github_list_projects") {
    const data = await gql(
      token,
      `query ($first: Int!) {
         viewer {
           projectsV2(first: $first) {
             nodes { id number title url closed }
           }
         }
       }`,
      { first: clampLimit(args.limit) },
    )
    return data.viewer.projectsV2.nodes
  }
  if (tool === "github_list_project_items") {
    const data = await gql(
      token,
      `query ($id: ID!, $first: Int!) {
         node(id: $id) {
           ... on ProjectV2 {
             items(first: $first) {
               nodes {
                 id
                 content {
                   ... on Issue {
                     title number url state
                   }
                   ... on PullRequest {
                     title number url state
                   }
                   ... on DraftIssue { title }
                 }
                 fieldValues(first: 8) {
                   nodes {
                     ... on
                       ProjectV2ItemFieldSingleSelectValue {
                       name
                     }
                   }
                 }
               }
             }
           }
         }
       }`,
      { id: args.project_id, first: clampLimit(args.limit) },
    )
    const items = data.node?.items?.nodes || []
    return items.map(itemSummary)
  }
  if (tool === "github_create_draft_item") {
    const data = await gql(
      token,
      `mutation ($projectId: ID!, $title: String!,
                 $body: String) {
         addProjectV2DraftIssue(input: {
           projectId: $projectId, title: $title,
           body: $body
         }) {
           projectItem { id }
         }
       }`,
      {
        projectId: args.project_id,
        title: args.title,
        body: args.body,
      },
    )
    return {
      id: data.addProjectV2DraftIssue.projectItem.id,
      title: args.title,
    }
  }
  throw new Error(`Unknown tool: ${tool}`)
}

module.exports = { KIND, validate, tools, dispatch }
