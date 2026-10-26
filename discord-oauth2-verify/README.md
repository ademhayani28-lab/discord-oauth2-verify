# Discord OAuth2 Verify

A small Node.js website that lets a user log in through Discord and grants a `Verified` role **only if that Discord account is already a member of your server**.

## Requirements

- Node.js 20+
- A Discord application and bot
- A Discord server where you can manage roles
- GitHub + a hosting service such as Render for a public HTTPS URL

## Run locally

1. Install Node.js 20 or newer.
2. Extract this project.
3. Open a terminal in this folder and run `npm install`.
4. Copy `.env.example` to `.env`.
5. Fill every required variable in `.env`.
6. Run `npm start`.
7. Open `http://localhost:3000`.

Never upload `.env` to GitHub or share your bot token/client secret.

## Discord setup

1. Open https://discord.com/developers/applications and create an application.
2. In **OAuth2**, copy the Client ID and create/copy the Client Secret.
3. Add the exact callback URL to **OAuth2 Redirects**:
   - Local: `http://localhost:3000/auth/callback`
   - Production: `https://YOUR-SERVICE.onrender.com/auth/callback`
4. Under **Bot**, create a bot and copy its token. Keep it secret.
5. Invite the bot to your server using OAuth2 URL Generator with the `bot` scope and `Manage Roles` permission.
6. In your Discord server, create a role named `Verified`.
7. In Server Settings → Roles, move the bot's role above `Verified`. Do not give the bot Administrator unless you truly need it.
8. Copy your server ID and the Verified role ID (enable Developer Mode in Discord, then right-click each and choose Copy ID).
9. Put those values in the environment variables.

The OAuth flow only requests `identify`. The bot uses its own token to check server membership and assign the role. A user who is not already in the server is not assigned the role; they are shown an invite link instead.

## Deploy free with Render

1. Create a GitHub repository and upload the project files. Do **not** upload `.env`; upload `.env.example` only.
2. In Render, choose **New → Web Service**, connect the repository.
3. Choose a free instance if available for your account.
4. Build command: `npm install`
5. Start command: `npm start`
6. Add all variables from `.env.example` in Render's Environment settings, using real values.
7. Set `NODE_ENV` to `production`.
8. After the first deploy, copy the HTTPS service URL, such as `https://your-app.onrender.com`.
9. Update `DISCORD_REDIRECT_URI` in Render to `https://your-app.onrender.com/auth/callback`.
10. Add that same callback URL in Discord Developer Portal → OAuth2 → Redirects, then redeploy.

Render free services can sleep after inactivity and take about a minute to wake up. Treat this as a hobby/test deployment, not a high-availability production service.

## Environment variables

- `SESSION_SECRET`: long random secret, different from all Discord credentials
- `DISCORD_CLIENT_ID`: application Client ID
- `DISCORD_CLIENT_SECRET`: OAuth2 Client Secret
- `DISCORD_REDIRECT_URI`: exact callback URL registered in Discord
- `DISCORD_BOT_TOKEN`: bot token
- `DISCORD_GUILD_ID`: target server ID
- `DISCORD_VERIFIED_ROLE_ID`: ID of the Verified role
- `DISCORD_INVITE_URL`: optional server invite URL
- `PORT`: hosting sets this automatically; defaults to 3000
- `NODE_ENV`: set to `production` when deployed

## Troubleshooting

- `Missing Access` / `403`: make sure the bot is in the server and has Manage Roles.
- Role not assigned: move the bot role above Verified and confirm the role ID.
- `redirect_uri` error: the callback URL must match exactly in Discord and the environment variables.
- User is not a member: they must join your server first. Then retry verification.
- Free host sleeps: the first page load may take around a minute.

## Production note

This sample uses Express's in-memory session store, which is suitable for learning/testing but not a robust production session store. For a larger public server, use a persistent session store, add monitoring, and review the deployment/security configuration.
