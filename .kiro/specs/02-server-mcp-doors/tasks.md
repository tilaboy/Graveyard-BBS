# Tasks — 02 Server, MCP and doors

- [x] 1. `packages/server` scaffold, SQLite store, append + fold on boot (R1)
- [x] 2. `commands.ts` single entry point wrapping core `decide`
- [x] 3. Callers, hashed tokens, `graveyard caller add` (R2)
- [x] 4. HTTP + WS API, event feed (R6.1)
- [x] 5. MCP server with all `bbs_*` tools, descriptions generated from core (R3)
  - [x] 5.1 Untrusted-post wrapping + control-char stripping, with tests (R3.3)
- [x] 6. Worktree manager + `run_tests` door with EVIDENCE (R4.1, R4.2)
- [x] 7. `git_merge` door with `merge` lock fencing check (R4.3)
- [x] 8. `deploy` door (local static folder first, S3 optional) (R4.4)
- [x] 9. `image_gen` door with a stub provider (R4.4)
- [x] 10. Hook CLI: `hook pre-tool`, `hook spawn`, `hook stop`, fail-closed rules (R5)
- [x] 11. Sysop endpoints: answer, approve, cancel, reorder, steer (R6.2)
- [x] 12. Seed script: boards, demo callers, demo threads
- [x] 13. `npm run sync-power`: copy the four caller steering files into `power/steering/`
      and fail CI if they drift
- [x] 14. Demo tools (see `docs/demo.md`): `seed demo` with a clean demo repo, `--lease` override;
      `chaos kill <caller>` and `rogue` scripted caller kept for tests only (not in the video)
- [x] 15. `publish` door for `#arcade` games and `#slides` decks (boards/arcade.md, boards/slides.md)
- [ ] 16. `deploy` door target S3 + CloudFront (profile + bucket from env), URL in EVIDENCE (spec 00 R2.6)
- [x] 17. `graveyard export <run-id>`: run bundle JSON + artifacts, tokens/env/home paths stripped (spec 00 design §2)
- [x] 18. Sysop "force done" command that goes through the normal status rules and is refused (spec 00 R3.3)

Notes (feat/server):
- Task 8 ticked for the local static-folder target. Task 16 stays unticked: `S3Target` is built and unit-tested with a fake client
  (`GRAVEYARD_DEPLOY_BUCKET`, `GRAVEYARD_DEPLOY_DISTRIBUTION`, `AWS_PROFILE` via the default credential chain), but the real
  `awsClientFromSdk` adapter (needs `@aws-sdk/client-s3` and `@aws-sdk/client-cloudfront`, not installed) has never touched AWS.
