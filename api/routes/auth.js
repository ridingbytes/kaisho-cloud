"use strict"

const crypto = require("crypto")
const bcrypt = require("bcryptjs")
const { Router } = require("express")
const {
  signupLimiter, authLimiter, rotateKeyLimiter,
} = require("../config")
const { supabase, invalidateAuthCache } = require("../db")
const { requireJwt } = require("../middleware")
const {
  validate, signupSchema, loginSchema, rotateKeySchema,
} = require("../validation")
const {
  sendWelcomeEmail, sendNewApiKeyEmail,
} = require("../emails/mailer")

const router = Router()

// ── POST /auth/signup ────────────────────────────────────

router.post(
  "/signup",
  signupLimiter,
  validate(signupSchema),
  async (req, res) => {
    const { email, password } = req.body

    const { data: authData, error: authErr } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

    if (authErr) {
      if (authErr.message.includes("already")) {
        return res
          .status(409)
          .json({ error: "Email already registered" })
      }
      return res
        .status(500)
        .json({ error: "Could not create account" })
    }

    const userId = authData.user.id

    await supabase.from("users").insert({
      id: userId,
      plan: "free",
    })

    const apiKey = crypto.randomUUID()
    const keyHash = await bcrypt.hash(apiKey, 10)

    await supabase
      .from("users")
      .update({ api_key_hash: keyHash })
      .eq("id", userId)

    sendWelcomeEmail({ email, apiKey })

    res.status(201).json({
      user_id: userId,
      api_key: apiKey,
    })
  },
)

// ── POST /auth/login ─────────────────────────────────────

router.post(
  "/login",
  authLimiter,
  validate(loginSchema),
  async (req, res) => {
    const { email, password } = req.body

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    if (error) {
      return res
        .status(401)
        .json({ error: "Invalid credentials" })
    }

    const { data: user } = await supabase
      .from("users")
      .select("plan")
      .eq("id", data.user.id)
      .single()

    res.json({
      user_id: data.user.id,
      email: data.user.email,
      plan: user?.plan || "free",
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    })
  },
)

// ── POST /auth/refresh ───────────────────────────────────

router.post("/refresh", async (req, res) => {
  const { refresh_token } = req.body
  if (!refresh_token) {
    return res
      .status(400)
      .json({ error: "refresh_token is required" })
  }

  const { data, error } =
    await supabase.auth.refreshSession({
      refresh_token,
    })

  if (error) {
    return res
      .status(401)
      .json({ error: "Invalid refresh token" })
  }

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
})

// ── POST /auth/api-key ───────────────────────────────────
// Generate a new API key for local sync. Replaces any
// existing key.

router.post(
  "/api-key",
  requireJwt,
  async (req, res) => {
    const apiKey = crypto.randomUUID()
    const keyHash = await bcrypt.hash(apiKey, 10)

    await supabase
      .from("users")
      .update({ api_key_hash: keyHash })
      .eq("id", req.userId)

    invalidateAuthCache(req.userId)

    res.json({ api_key: apiKey })
  },
)

// ── POST /auth/rotate-key ────────────────────────────────
// Rotate API key by email (for recovery without login).

router.post(
  "/rotate-key",
  rotateKeyLimiter,
  validate(rotateKeySchema),
  async (req, res) => {
    const { email } = req.body

    const { data: authUsers } =
      await supabase.auth.admin.listUsers()

    const authUser = authUsers?.users?.find(
      (u) => u.email === email,
    )

    if (!authUser) {
      return res
        .status(404)
        .json({ error: "No account found" })
    }

    const apiKey = crypto.randomUUID()
    const keyHash = await bcrypt.hash(apiKey, 10)

    await supabase
      .from("users")
      .update({ api_key_hash: keyHash })
      .eq("id", authUser.id)

    invalidateAuthCache(authUser.id)

    sendNewApiKeyEmail({ email, apiKey })

    res.json({ api_key: apiKey })
  },
)

module.exports = router
