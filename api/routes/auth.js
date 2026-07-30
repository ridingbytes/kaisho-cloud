"use strict"

/**
 * Authentication routes — signup, login, token refresh,
 * and API key management.
 */

const crypto = require("crypto")
const { Router } = require("express")
const {
  signupLimiter, authLimiter, rotateKeyLimiter,
} = require("../config")
const { supabase, supabaseAuth } = require("../db")
const {
  OWN_AUTH,
  hashPassword,
  verifyPassword,
  signAccess,
  signRefresh,
  verifyRefresh,
} = require("../auth/session")
const {
  createAccount, generateApiKey,
} = require("../services/accounts")

// open  - anyone may POST /auth/signup (self-host default)
// token - public signup is closed; accounts come only from the
//         admin provisioning API (our managed instance).
const SIGNUP_MODE = process.env.SIGNUP_MODE || "open"
const { logger } = require("../logger")
const { requireJwt } = require("../middleware")
const {
  validate,
  signupSchema,
  loginSchema,
  rotateKeySchema,
  refreshSchema,
} = require("../validation")
const {
  sendWelcomeEmail,
  sendPasswordResetEmail,
} = require("../emails/mailer")
const { asyncHandler } = require("../utils/asyncHandler")

const router = Router()

// ── POST /auth/signup ───────────────────────────────────

/**
 * Register a new user account and generate its API key.
 * Disabled when SIGNUP_MODE=token (accounts are provisioned
 * by the operator via the admin API instead).
 *
 * @route POST /auth/signup
 */
router.post(
  "/signup",
  signupLimiter,
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    if (SIGNUP_MODE === "token") {
      return res.status(403).json({
        error: "Signups are closed on this server.",
      })
    }
    const { email, password } = req.body

    const result = await createAccount({ email, password })
    if (result.error) {
      return res
        .status(result.error.status)
        .json({ error: result.error.message })
    }

    const apiKey = await generateApiKey(result.userId)
    sendWelcomeEmail({ email, apiKey })

    res.status(201).json({
      user_id: result.userId,
      api_key: apiKey,
    })
  }),
)

// ── POST /auth/login ────────────────────────────────────

/**
 * Authenticate with email and password. Returns JWT
 * tokens and user plan.
 *
 * @route POST /auth/login
 */
router.post(
  "/login",
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body
    if (OWN_AUTH) return loginOwn(email, password, res)

    const { data, error } =
      await supabaseAuth.auth.signInWithPassword({
        email,
        password,
      })

    if (error) {
      return res
        .status(401)
        .json({ error: "Invalid credentials" })
    }

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("plan")
      .eq("id", data.user.id)
      .single()

    if (userErr) {
      req.log.error(
        { err: userErr, userId: data.user.id },
        "login: failed to read users.plan",
      )
    }

    res.json({
      user_id: data.user.id,
      email: data.user.email,
      plan: user?.plan || "free",
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    })
  }),
)

/**
 * Self-owned login: verify the bcrypt password_hash on the
 * users row and issue our own access + refresh JWTs. Same
 * 401 and wire shape as the Supabase path.
 */
async function loginOwn(email, password, res) {
  const { data: user } = await supabase
    .from("users")
    .select("id, email, plan, password_hash, disabled_at")
    .eq("email", email)
    .maybeSingle()

  const ok = user &&
    await verifyPassword(password, user.password_hash)
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" })
  }
  if (user.disabled_at) {
    return res.status(403).json({ error: "Account disabled" })
  }

  res.json({
    user_id: user.id,
    email: user.email,
    plan: user.plan || "free",
    access_token: signAccess(user.id, user.email),
    refresh_token: signRefresh(user.id),
  })
}

// ── POST /auth/refresh ──────────────────────────────────

/**
 * Exchange a refresh token for new JWT tokens.
 *
 * @route POST /auth/refresh
 */
router.post(
  "/refresh",
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const { refresh_token } = req.body
    if (OWN_AUTH) return refreshOwn(refresh_token, res)

    const { data, error } =
      await supabaseAuth.auth.refreshSession({
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
  }),
)

/**
 * Self-owned refresh: verify the refresh JWT, then issue a
 * fresh access + refresh pair (rotation). The email claim on
 * the new access token is re-read from the users row.
 */
async function refreshOwn(refreshToken, res) {
  const claim = refreshToken && verifyRefresh(refreshToken)
  if (!claim) {
    return res.status(401).json({ error: "Invalid refresh token" })
  }
  const { data: user } = await supabase
    .from("users")
    .select("email, disabled_at")
    .eq("id", claim.userId)
    .maybeSingle()
  if (!user || user.disabled_at) {
    return res.status(401).json({ error: "Invalid refresh token" })
  }
  res.json({
    access_token: signAccess(claim.userId, user.email),
    refresh_token: signRefresh(claim.userId),
  })
}

// ── POST /auth/api-key ──────────────────────────────────

/**
 * Generate a new API key for the authenticated user.
 * Replaces any existing key.
 *
 * @route POST /auth/api-key
 */
router.post(
  "/api-key",
  requireJwt,
  asyncHandler(async (req, res) => {
    const apiKey = await generateApiKey(req.userId)
    res.json({ api_key: apiKey })
  }),
)

// ── POST /auth/forgot-password ──────────────────────────

const RESET_SECRET = process.env.RESET_TOKEN_SECRET

if (!RESET_SECRET) {
  logger.warn(
    "RESET_TOKEN_SECRET is not set. "
    + "Password reset endpoints will return 503.",
  )
}
const RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Create an HMAC-signed reset token.
 *
 * @param {string} userId - User UUID.
 * @param {number} timestamp - Unix ms.
 * @returns {string} Base64url-encoded token.
 */
function createResetToken(userId, timestamp) {
  const payload = `${userId}.${timestamp}`
  const sig = crypto
    .createHmac("sha256", RESET_SECRET)
    .update(payload)
    .digest("base64url")
  return Buffer.from(`${payload}.${sig}`)
    .toString("base64url")
}

/**
 * Verify a reset token and return the userId if
 * valid, or null if expired/invalid.
 *
 * @param {string} token - Base64url token.
 * @returns {string|null} userId or null.
 */
function verifyResetToken(token) {
  try {
    const decoded = Buffer.from(
      token, "base64url",
    ).toString()
    const [userId, ts, sig] = decoded.split(".")
    const timestamp = Number(ts)
    if (Date.now() - timestamp > RESET_TTL_MS) {
      return null
    }
    const expected = crypto
      .createHmac("sha256", RESET_SECRET)
      .update(`${userId}.${ts}`)
      .digest("base64url")
    const sigBuf = Buffer.from(sig)
    const expBuf = Buffer.from(expected)
    if (
      sigBuf.length !== expBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expBuf)
    ) {
      return null
    }
    return userId
  } catch {
    return null
  }
}

/**
 * Send a branded password reset email.
 * Always returns 200 to prevent email enumeration.
 *
 * @route POST /auth/forgot-password
 */
router.post(
  "/forgot-password",
  rotateKeyLimiter,
  validate(rotateKeySchema),
  asyncHandler(async (req, res) => {
    if (!RESET_SECRET) {
      return res.status(503).json({
        error: "Password reset is not configured.",
      })
    }
    const { email } = req.body

    // Direct lookup via find_user_id_by_email SECURITY
    // DEFINER function (migration 020). Replaces the
    // earlier auth.admin.listUsers() scan that grew
    // linearly with user count. The RPC returns NULL
    // on miss so the no-account path stays silent.
    const { data: userId } = await supabase.rpc(
      "find_user_id_by_email", { p_email: email },
    )

    if (userId) {
      const token = createResetToken(userId, Date.now())
      // The mobile PWA always lives at <BASE_URL>/m/ in
      // every deployment we ship. The earlier MOBILE_URL
      // override was a knob nobody used.
      const baseUrl = process.env.BASE_URL
        || "https://cloud.kaisho.dev"
      const resetUrl =
        `${baseUrl}/m/#reset-password=${token}`
      sendPasswordResetEmail({ email, resetUrl })
    }

    // Always 200 to prevent email enumeration
    res.json({
      message: "If an account exists, a reset "
        + "link has been sent.",
    })
  }),
)

// ── POST /auth/reset-password ──────────────────────────

/**
 * Set a new password using a signed reset token.
 *
 * @route POST /auth/reset-password
 */
router.post(
  "/reset-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    if (!RESET_SECRET) {
      return res.status(503).json({
        error: "Password reset is not configured.",
      })
    }
    const { token, password } = req.body

    if (!token || !password) {
      return res.status(400).json({
        error: "Token and password required.",
      })
    }
    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least "
          + "8 characters.",
      })
    }

    const userId = verifyResetToken(token)
    if (!userId) {
      return res.status(400).json({
        error: "Reset link expired or invalid.",
      })
    }

    const error = OWN_AUTH
      ? (await supabase
        .from("users")
        .update({ password_hash: await hashPassword(password) })
        .eq("id", userId)).error
      : (await supabase.auth.admin.updateUserById(
        userId, { password },
      )).error

    if (error) {
      return res.status(500).json({
        error: "Could not update password.",
      })
    }

    res.json({ message: "Password updated." })
  }),
)

// ── GET /auth/me ────────────────────────────────────────

/**
 * Return the current user's email and plan.
 *
 * @route GET /auth/me
 */
router.get(
  "/me",
  requireJwt,
  asyncHandler(async (req, res) => {
    const { data: user } = await supabase
      .from("users")
      .select("plan")
      .eq("id", req.userId)
      .single()

    res.json({
      user_id: req.userId,
      email: req.userEmail,
      plan: user?.plan || "free",
    })
  }),
)

module.exports = router
