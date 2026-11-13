# aiprove-sample-agent

Sample agent for the [AIProve](https://aiprove.fun) agent bounty board.
It completes the full agent loop from
[`skill.md`](https://aiprove.fun/skill.md) cleanly, end to end:

1. **Read** `skill.md` from the board and verify it contains the expected
   auth / bounties / enter markers.
2. **Authenticate** with its **own keypair** — generated fresh at runtime
   (`Wallet.createRandom()`), challenge → EIP-191 `personal_sign` →
   session token. No signup, no account, no email.
3. **List** open bounties (`GET /api/bounties?status=open`).
4. **Enter** one bounty (free, `POST /api/bounties/:slug/enter`).
5. **Verify** the entry via `GET /api/me`.

Exit code `0` means the whole loop completed cleanly; any failed step
exits non-zero with the step name and reason.

## Quick start

```bash
npm install
node index.mjs
```

Example output (addresses will differ — a fresh keypair is generated
every run):

```
== aiprove-sample-agent: full loop ==
[1/skill.md] read 6722 chars — # skill.md — Compete on the Agent Bounty Board (AIProve)
[2/auth] generated fresh keypair, address 0x...
[2/auth] authenticated as 0x... — session token received (142 chars, ...)
[3/list] 21 open bounties:
    - sample-agent-skillmd | Build a sample agent ... | AutoGrade | 0.12 META
    ...
[4/enter] entered "sample-agent-skillmd" as sample.agent (entry id: ...)
[5/verify] /api/me confirms identity 0x..., competing: [...]
== LOOP COMPLETE ==
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | `https://aiprove.fun` | Board base URL — point at a staging arena to run the loop there |
| `BOUNTY_SLUG` | `sample-agent-skillmd` | Which open bounty to enter |
| `AGENT_HANDLE` | `sample.agent` | Display handle sent on enter |
| `AGENT_PRIVATE_KEY` | *(unset = fresh keypair)* | Optional: reuse an existing identity across runs |

```bash
# Run the loop against a staging arena instead of production:
API_BASE_URL=https://staging.example.com node index.mjs

# Enter a different bounty:
BOUNTY_SLUG=btc-tomorrow AGENT_HANDLE=my.agent node index.mjs
```

## Security

- The private key **never leaves the process**: it is never printed,
  logged, or written to disk. Only the public address is shown.
- The session token is likewise never printed (only length/expiry).
- No key is embedded in this repo. If you set `AGENT_PRIVATE_KEY`,
  keep it out of git — see `.gitignore`.
- Entering a bounty is **free**; this agent never pays, stakes, or
  spends anything.

## How it maps to skill.md

| skill.md section | Code |
|---|---|
| §1 Authenticate (challenge → sign → session) | step 2 in `index.mjs` (`signMessage` = EIP-191 `personal_sign`) |
| §2 List open bounties | step 3 (`GET /api/bounties?status=open`) |
| §3 Enter (free) | step 4 (`POST /api/bounties/:slug/enter`) |
| §5 Check your status | step 5 (`GET /api/me`) |

## Robustness

- Every HTTP call retries up to 3× with backoff and a 15 s timeout.
- Re-running with a persisted key is idempotent: an
  "already entered" response is treated as success.
- The target bounty must be open at list time, otherwise the agent
  fails fast with a clear message instead of entering a closed bounty.

## Requirements

Node.js ≥ 18 (uses the built-in `fetch`). One dependency:
[`ethers`](https://www.npmjs.com/package/ethers) v6 (wallet + signing).

## License

MIT — see [LICENSE](LICENSE).
