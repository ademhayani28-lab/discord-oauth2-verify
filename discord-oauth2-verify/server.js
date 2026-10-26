require("dotenv").config();

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");
const path = require("node:path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";

const requiredEnv = [
  "SESSION_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_REDIRECT_URI",
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
  "DISCORD_VERIFIED_ROLE_ID"
];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("Missing required environment variables:", missing.join(", "));
  console.error("Copy .env.example to .env and fill in the values.");
  process.exit(1);
}

if (isProduction) app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));

app.use(session({
  name: "discord_verify_session",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false
});
app.use("/auth", authLimiter);

function page(res, title, message, extra = "") {
  return res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="stylesheet" href="/style.css"></head>
<body><main class="shell"><div class="mark">✓</div><p class="eyebrow">DISCORD VERIFICATION</p>
<h1>${escapeHtml(title)}</h1><p class="message">${escapeHtml(message)}</p>${extra}
<a class="back" href="/">Back to home</a></main></body></html>`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function requiredString(value) {
  return typeof value === "string" && value.length > 0;
}

async function discordApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`Discord API returned ${response.status}: ${body.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

app.get("/auth/discord", (req, res) => {
  const state = crypto.randomBytes(32).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    scope: "identify",
    state,
    prompt: "consent"
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    delete req.session.oauthState;
    return page(res, "Login cancelled", "Discord login was cancelled. You can try again.");
  }

  const receivedState = requiredString(state) ? Buffer.from(String(state)) : Buffer.alloc(0);
  const expectedState = requiredString(req.session.oauthState) ? Buffer.from(req.session.oauthState) : Buffer.alloc(0);
  if (!requiredString(code) || !requiredString(state) ||
      receivedState.length !== expectedState.length || expectedState.length === 0 ||
      !crypto.timingSafeEqual(receivedState, expectedState)) {
    delete req.session.oauthState;
    return page(res, "Verification failed", "The login session expired or the security check failed. Please try again.");
  }

  delete req.session.oauthState;

  try {
    const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      })
    });

    if (!tokenResponse.ok) {
      console.error("OAuth token exchange failed:", tokenResponse.status);
      return page(res, "Login failed", "Discord could not complete the login. Please try again.");
    }

    const tokenData = await tokenResponse.json();
    const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!userResponse.ok) {
      return page(res, "Login failed", "Could not retrieve your Discord profile. Please try again.");
    }

    const user = await userResponse.json();

    // Confirm the account is already a member of the target server.
    let member;
    try {
      member = await discordApi(
        `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}`
      );
    } catch (err) {
      if (err.status === 404) {
        const invite = process.env.DISCORD_INVITE_URL;
        const link = invite
          ? `<a class="button" href="${escapeHtml(invite)}" target="_blank" rel="noopener noreferrer">Join our Discord</a>`
          : "";
        return page(res, "Join the Discord first", "This Discord account is not a member of our server. Join the server, then return here and verify.", link);
      }
      throw err;
    }

    // If the role is already present, do not attempt to add it again.
    const roleId = process.env.DISCORD_VERIFIED_ROLE_ID;
    if (!member.roles.includes(roleId)) {
      await discordApi(
        `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}/roles/${roleId}`,
        { method: "PUT" }
      );
    }

    req.session.user = {
      id: user.id,
      username: user.global_name || user.username,
      avatar: user.avatar || null
    };

    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : "";
    const avatar = avatarUrl
      ? `<img class="avatar" src="${avatarUrl}" alt="Discord avatar">`
      : `<div class="avatar placeholder">✓</div>`;

    return page(
      res,
      "You're verified!",
      `Welcome, ${user.global_name || user.username}. The Verified role has been checked for your account.`,
      `<div class="profile">${avatar}<span>@${escapeHtml(user.username)}</span></div><p class="small">You can return to Discord now. If Discord is open, your role should appear automatically.</p>`
    );
  } catch (err) {
    console.error("Verification error:", err.message);
    return page(res, "Something went wrong", "The bot could not finish verification. Check the bot permissions, role hierarchy, and server configuration.");
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Discord Verify site listening on port ${PORT}`);
});
