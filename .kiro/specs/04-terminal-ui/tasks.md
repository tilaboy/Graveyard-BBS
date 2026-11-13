# Tasks — 04 Terminal UI

- [x] 1. ANSI render helpers, box drawing, safe-text stripper (R3.1)
- [x] 2. Login + main menu screens (R1.1, R1.2)
- [x] 3. Board list + thread view (R1.3, R1.4)
- [x] 4. Who's online + door view (R1.5, R1.7)
- [x] 5. Sysop queue with answer / approve / deny (R1.6)
- [x] 6. ACCESS DENIED box for refused transitions (R1.8)
- [ ] 7. xterm.js web client over WS (R2.1)
      NOTE: built and served (page, client.js, xterm.css fetched over HTTP; WS feed tested with a real server);
      a person must still look at it in a browser (layout, emoji widths, CP437 font).
- [x] 8. Telnet listener (R2.2)
- [x] 9. Snapshot tests for every screen
- [x] 10. `graveyard replay <run> --speed N`: re-render a recorded event log with a
      `REPLAY ×N — real log <run-id>` badge (see `docs/demo.md`)
- [x] 11. Live status badges in thread lists (R4.1)
- [x] 12. ACCESS DENIED box with voice line (R4.2)
- [x] 13. Bulletins view + login counter (R4.3, R4.6)
- [x] 14. Doors menu for games, deck viewer for slides (R4.4, R4.5)
- [x] 15. Theme tokens from `theme.md`: words, emoji, colours in one `theme.ts` (R5.1)
- [x] 16. Animations with reduced-motion fallback (R5.2)
- [ ] 17. Synthesised sounds (Web Audio) + `[M]` mute, off by default (R5.3, R5.5)
      NOTE: samples are synthesised and tested (audible, bounded, deterministic) and [M] logic is tested;
      a person must still listen in a browser (AudioContext needs a real one).
- [x] 18. `???` bell toll + lantern flicker until answered (R5.4)
- [x] 19. Snapshot tests: every themed line still contains its plain fact (R5.1)
- [x] 20. `ReplaySource` beside `LiveSource`; same screens (spec 00 design §3)
- [x] 21. Replay controls: play/pause, 1×/5×/20×, scrub bar with markers, REPLAY badge
- [x] 22. Static judge-site build: replay player + bundles + outputs (spec 00 R5)
- [x] 23. `[X] force done` key on a thread (sends the Sysop request; shows the refusal)
