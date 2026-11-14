# Demo and submission

Primary track: **AI Security & Defense (`security`)**. The official deadline is **14 November 2026, 23:59 UTC**, or **15 November, 00:59 Lagos time**. Recheck [HACKATHON.md](https://nearhackathon.com/HACKATHON.md) before submitting.

## The 60–90 second demo

Start the local app and wait for the funded vault. Record the visible result of each request, rather than setup or architecture slides.

1. **0–10 seconds:** “An agent can be instructed to redirect a payment. IntentGuard binds its spending authority to an invoice the owner approved independently.”
2. **10–35 seconds:** Click **Run attack demo**. Show the unprotected control paying 0.08 NEAR to the attacker, the scoped vault rejecting the changed recipient, and the approved vendor getting paid.
3. **35–55 seconds:** Select **Skip the firewall** and submit. Show the native transfer refused by NEAR itself and the exact `execute_payment` key scope.
4. **55–75 seconds:** Inspect the receipt error and download the JSON proof. Show the public testnet bundle or the read-only verifier when available.
5. **75–90 seconds:** “The owner sets the boundary. NEAR enforces it even when the agent's payment arguments are malicious.” End with the repository link.

Label the local console as **NEAR Sandbox**. Show public testnet separately. The scripted instructions demonstrate malicious tool behavior; do not claim a measured LLM prompt-injection success rate.

## X post draft

```text
AI agents need spending limits.

I built IntentGuard at NEAR HACKATHON: exact invoice approvals enforced by NEAR.

Redirect blocked. Vendor paid. Recorded Sandbox demo.

@NEARProtocol #NEARHackathon
https://code-kaybee.github.io/Intent-Guard/
https://github.com/Code-Kaybee/Intent-Guard
```

Attach the demo video. Local-only projects need a video under Q-012; screenshots alone do not meet that exception. The human publishes the post and uses its public URL in the submission.

## Record an upload-ready demo

Requires the web build, Playwright Chromium (`npx playwright install chromium --only-shell`), and FFmpeg with an H.264 encoder.

```sh
npm run build:web
npm run record:demo -- --ffmpeg /path/to/ffmpeg
```

The script opens the actual public-console build and records the control payment, blocked recipient substitution, protocol-level direct-transfer refusal, approved payment, receipt logs, and complete case list. Captions explicitly identify recorded NEAR Sandbox evidence; it sends no chain transaction. It writes `artifacts/submission/intentguard-demo.mp4`, a WebM original, and `intentguard-demo-cover.png`. Generated media stays outside Git.

The recording is captioned and silent. Preview it before uploading; add a spoken explanation if desired. To record the deployed version, add `--url https://code-kaybee.github.io/Intent-Guard/` after deployment completes.

Upload the MP4 through your X account, use the post text above, and retain the public post URL. A website URL alone is not the required demo-post URL.

## Repository About description

```text
A spending firewall for AI payment agents. NEAR enforces exact invoice approvals and restricted keys to block unauthorized payments.
```

## Project description draft

IntentGuard is an invoice-capability vault for AI payment agents. An owner independently approves an exact recipient, amount and expiry on NEAR. The agent receives a function-call key scoped to one vault method with a finite gas allowance. The contract enforces invoice binding, one-time use, current spending limits, pause and revocation before transferring native NEAR. The demo compares a compromised unrestricted wallet with the protected vault, then pays the approved vendor. Reproducible adversarial tests check actual NEAR runtime refusals, receipt errors and recipient balances. The repository also includes public testnet deployment and read-only verification tools.

## Finish

- Keep the public repository at https://github.com/Code-Kaybee/Intent-Guard updated with the tested build and reproducible README.
- Run the local proof and, if deployed, `npm run verify:testnet`. Keep code and demo accessible through judging.
- Publish the demo video on X with the required event name, tag and hashtag.
- Submit the repository URL and the demo post URL at https://nearhackathon.com/#apply, choosing `security`.
- Supply the actual team lead name, contact email, solo team size and **mainnet** prize-payout account. A testnet account is not the payout address.
- Agree to the organizers' contact notice and review the exact submission before sending it. One submission per project.

Do not select unrelated tracks to inflate coverage. The current product's clearest fit is security; its invoicing use case does not by itself demonstrate a complete autonomous business.
