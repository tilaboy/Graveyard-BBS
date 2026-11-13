---
inclusion: fileMatch
fileMatchPattern: "packages/**/*.{ts,tsx}"
---

# Testing rules

- `vitest` for unit tests, `fast-check` for property-based tests (PBT).
- Each spec requirement marked **[PBT]** must have a property test that names the
  requirement id in its title, e.g. `it("R1.4 no sequence reaches done without review")`.
- Core properties that must always hold:
  - **P1** No sequence of commands reaches `done` without passing `awaiting-review`.
  - **P2** At most one caller holds a lock at any time; fencing tokens strictly increase.
  - **P3** Folding the event log twice gives equal projections (replay is deterministic).
  - **P4** Folding a prefix then the rest equals folding the whole log.
  - **P5** A QWK packet always contains every `TRIED` item of its thread.
  - **P6** Lease expiry always frees the lock and returns the task to `pending`.
- Use model-based testing (`fc.commands`) for the status machine and locks.
- Never weaken an assertion or delete a failing test. Fix the code.
