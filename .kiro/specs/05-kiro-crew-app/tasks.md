# Tasks — 05 Kiro Crew app

- [x] 1. `app/bin/gy.py` launcher: find the checkout, exec `mcp` / `serve` / `moderator` (R5.1, R7)
- [x] 2. `app/backend/server.py`: `/health`, signed `launch`, child `serve` lifecycle (R3)
- [x] 3. `app/ui/index.mjs` page: iframe or error (R2)
- [x] 4. `sync-app` script + `npm run sync-app` / `check-app`; generate `app/agents`, `app/steering` (R4)
- [x] 5. `app/app.json` manifest, icon, README (R1, R5, R6, R8)
- [x] 6. Tests: manifest paths exist, agents in sync, launcher errors, backend auth (R1.3, R3.3, R4.2, R7.2)
- [x] 7. Run the Kiro Crew validator on `app/` and record the output in the README (R1.2)
      NOTE: `errors: none` (command in `app/README.md`); it checks fields and path containment, not that files exist,
      which `app.test.ts` covers.
- [ ] 8. Owner: `kirocrew app install <repo>/app`, trust, enable; look at the page in a browser
      (R2, R3.1 end to end; cannot be done by a worker, see design §7)
