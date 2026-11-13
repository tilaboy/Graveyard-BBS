# Tasks — 03 Moderator on Kiro Crew

- [x] 1. `bbs_check_gate` and `bbs_register_child` MCP tools on the server (R2.2, R3.3); also `bbs_escalate`, `bbs_add_lesson`, `bbs_list_lessons`, and a `lessons` arg on `bbs_get_packet`
- [x] 2. Moderator agent prompt + steering (routing, split, recovery, conflict rules)
- [x] 3. Event cursor stored in the log (R7.1)
- [x] 4. Split `tasks.md` into sub-threads with parallel limit (R3.1)
- [x] 5. Spawn with QWK packet via Kiro Crew `spawn_run` (R3.2) — `KiroCrewRunner` maps the action to the `spawn_run` call the moderator agent makes; Crew has no CLI/HTTP spawn path
- [x] 6. Crash respawn with limit (R4)
- [x] 7. Sysop steer forwarding (R6)
- [x] 8. `KiroCliRunner` fallback
- [ ] 9. End-to-end dry run on the `#bugfix` board with a toy repo — needs a live Kiro Crew session; not run. The same path is covered in-process by `packages/moderator/test/execute.test.ts`
- [x] 10. Parallel start: one sub-agent per root task (R8)
- [x] 11. Knowledge hub: distil lessons on thread close, store in Kiro Crew with source (R9.1, R9.2) — stored in the server hub (source project/board/thread) and mirrored by a `learn_add` call
- [x] 12. Lesson search on packet build (R9.3)
- [x] 13. Refusal flow for "skip review" requests (R10)
- [x] 14. Write wall-clock timestamps for each spawn/steer into the log, for dashboard alignment (spec 00 design §6)
