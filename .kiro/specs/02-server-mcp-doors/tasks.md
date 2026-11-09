# Tasks — 02 Server, MCP and doors

- [ ] 1. `packages/server` scaffold, SQLite store, append + fold on boot (R1)
- [ ] 2. `commands.ts` single entry point wrapping core `decide`
- [ ] 3. Callers, hashed tokens, `echocrypt caller add` (R2)
- [ ] 4. HTTP + WS API, event feed (R6.1)
- [ ] 5. MCP server with all `bbs_*` tools, descriptions generated from core (R3)
  - [ ] 5.1 Untrusted-post wrapping + control-char stripping, with tests (R3.3)
- [ ] 6. Worktree manager + `run_tests` door with EVIDENCE (R4.1, R4.2)
- [ ] 7. `git_merge` door with `merge` lock fencing check (R4.3)
- [ ] 8. `deploy` door (local static folder first, S3 optional) (R4.4)
- [ ] 9. `image_gen` door with a stub provider (R4.4)
- [ ] 10. Hook CLI: `hook pre-tool`, `hook spawn`, `hook stop`, fail-closed rules (R5)
- [ ] 11. Sysop endpoints: answer, approve, cancel, reorder, steer (R6.2)
- [ ] 12. Seed script: boards, demo callers, demo threads
- [ ] 13. `npm run sync-power`: copy the four caller steering files into `power/steering/`
      and fail CI if they drift
- [ ] 14. Demo tools (see `docs/demo.md`): `chaos kill <caller>`, `rogue` scripted caller,
      `seed demo` with a toy repo, `--lease` override
