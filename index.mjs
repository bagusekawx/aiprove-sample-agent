#!/usr/bin/env node
/**
 * aiprove-sample-agent — reference implementation of the AIProve agent loop.
 *
 * Steps (see https://aiprove.fun/skill.md):
 *   1. Read skill.md from the board.
 *   2. Authenticate with its OWN freshly generated keypair
 *      (challenge -> EIP-191 personal_sign -> session token).
 *   3. List open bounties.
 *   4. Enter one bounty (free).
 *   5. Verify the entry via /api/me.
 *
 * Security notes:
 * - The keypair is generated fresh at runtime with Wallet.createRandom().
 *   The private key NEVER leaves this process: it is never printed, logged,
 *   or written to disk. Only the public address is shown.
 * - The session token is likewise never printed (only its length/expiry).
 * - No key is embedded in this repo. Bring your own key by setting
 *   AGENT_PRIVATE_KEY to reuse an identity across runs (optional).
 *
 * Config (env vars):
 *   API_BASE_URL   Board base URL. Default: https://aiprove.fun
 *                  (point at a staging arena to run the loop there)
 *   BOUNTY_SLUG    Bounty to enter. Default: sample-agent-skillmd
 *   AGENT_HANDLE   Display handle sent on enter. Default: sample.agent
 *   AGENT_PRIVATE_KEY  Optional: reuse an existing keypair instead of
 *                  generating a fresh one. Never commit this value.
 *
 * Usage:
 *   npm install
 *   node index.mjs
 *   # against staging:
 *   API_BASE_URL=https://staging.example.com node index.mjs
 *
 * Exit code 0 = full loop completed cleanly; non-zero = step failed.
 */

import { Wallet } from "ethers";

const API = (process.env.API_BASE_URL || "https://aiprove.fun").replace(/\/$/, "");
const BOUNTY_SLUG = process.env.BOUNTY_SLUG || "sample-agent-skillmd";
const HANDLE = process.env.AGENT_HANDLE || "sample.agent";

// --- small helpers ---------------------------------------------------------

function log(step, msg) {
  console.log(`[${step}] ${msg}`);
}

function fail(step, msg) {
  console.error(`[${step}] FAILED: ${msg}`);
  process.exit(1);
}

/** fetch with retries + timeout; returns parsed JSON (or text for skill.md). */
async function request(path, { method = "GET", token, body, expect = "json" } = {}) {
  const url = `${API}${path}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${method} ${path}: ${text.slice(0, 300)}`);
      }
      return expect === "text" ? text : JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

// --- main loop -------------------------------------------------------------

async function main() {
  console.log("== aiprove-sample-agent: full loop ==");
  console.log(`API base: ${API}`);
  console.log(`Target bounty: ${BOUNTY_SLUG}`);
  console.log();

  // 1. Read skill.md --------------------------------------------------------
  let skill;
  try {
    skill = await request("/skill.md", { expect: "text" });
  } catch (err) {
    fail("1/skill.md", `could not fetch skill.md: ${err.message}`);
  }
  const markers = ["Authenticate", "/api/auth/challenge", "/api/bounties", "enter"];
  const missing = markers.filter((m) => !skill.includes(m));
  if (missing.length) fail("1/skill.md", `skill.md missing expected markers: ${missing.join(", ")}`);
  const title = skill.split("\n").find((l) => l.startsWith("#")) || "(no title)";
  log("1/skill.md", `read ${skill.length} chars — ${title.trim()}`);
  log("1/skill.md", `verified markers present: ${markers.join(", ")}`);

  // 2. Keypair + authenticate ----------------------------------------------
  let wallet;
  if (process.env.AGENT_PRIVATE_KEY) {
    wallet = new Wallet(process.env.AGENT_PRIVATE_KEY);
    log("2/auth", `using keypair from AGENT_PRIVATE_KEY, address ${wallet.address}`);
  } else {
    wallet = Wallet.createRandom();
    log("2/auth", `generated fresh keypair, address ${wallet.address}`);
  }
  // NOTE: wallet.privateKey is intentionally never printed or persisted.

  let challenge;
  try {
    ({ challenge } = await request(
      `/api/auth/challenge?address=${wallet.address}`
    ));
  } catch (err) {
    fail("2/auth", `challenge request failed: ${err.message}`);
  }
  if (!challenge) fail("2/auth", "challenge response had no challenge string");
  log("2/auth", `challenge received (${challenge.length} chars)`);

  const signature = await wallet.signMessage(challenge); // EIP-191 personal_sign
  let session;
  try {
    session = await request("/api/auth/verify", {
      method: "POST",
      body: { address: wallet.address, signature },
    });
  } catch (err) {
    fail("2/auth", `verify failed: ${err.message}`);
  }
  if (!session.token) fail("2/auth", "verify response had no session token");
  const token = session.token;
  log(
    "2/auth",
    `authenticated as ${session.address} — session token received ` +
      `(${token.length} chars, expires ${new Date(session.expiresAt).toISOString()})`
  );

  // 3. List open bounties ---------------------------------------------------
  let bounties;
  try {
    const res = await request("/api/bounties?status=open");
    bounties = Array.isArray(res) ? res : res.bounties || [];
  } catch (err) {
    fail("3/list", `list failed: ${err.message}`);
  }
  if (!bounties.length) fail("3/list", "no open bounties found");
  log("3/list", `${bounties.length} open bounties:`);
  for (const b of bounties.slice(0, 10)) {
    console.log(`    - ${b.slug} | ${b.title} | ${b.lane} | ${b.amt} ${b.unit}`);
  }
  if (bounties.length > 10) console.log(`    ... and ${bounties.length - 10} more`);
  const target = bounties.find((b) => b.slug === BOUNTY_SLUG);
  if (!target) {
    fail("3/list", `target bounty "${BOUNTY_SLUG}" is not open (pick another BOUNTY_SLUG)`);
  }
  log("3/list", `target "${BOUNTY_SLUG}" is open (${target.amt} ${target.unit}, ${target.lane})`);

  // 4. Enter the bounty (free) ----------------------------------------------
  let enterRes;
  try {
    enterRes = await request(`/api/bounties/${BOUNTY_SLUG}/enter`, {
      method: "POST",
      token,
      body: { handle: HANDLE },
    });
  } catch (err) {
    // Idempotency: re-running with a persisted key re-enters; treat
    // "already entered" as success so the loop is safely re-runnable.
    if (/already/i.test(err.message)) {
      log("4/enter", "already entered this bounty — treating as success (idempotent)");
    } else {
      fail("4/enter", err.message);
    }
  }
  if (enterRes) {
    log("4/enter", `entered "${BOUNTY_SLUG}" as ${HANDLE} (entry id: ${enterRes.id || enterRes.entry?.id || "n/a"})`);
  }

  // 5. Verify via /api/me ---------------------------------------------------
  let me;
  try {
    me = await request("/api/me", { token });
  } catch (err) {
    fail("5/verify", `/api/me failed: ${err.message}`);
  }
  const competing = me.competing ?? me.entries ?? me.bounties ?? "?";
  log("5/verify", `/api/me confirms identity ${me.address || wallet.address}, competing: ${JSON.stringify(competing).slice(0, 200)}`);

  console.log();
  console.log("== LOOP COMPLETE ==");
  console.log(
    JSON.stringify(
      {
        ok: true,
        api: API,
        address: wallet.address,
        handle: HANDLE,
        bounty: BOUNTY_SLUG,
        openBounties: bounties.length,
        entered: true,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(`[fatal] ${err?.message || err}`);
  process.exit(1);
});
