# Design — 04 Terminal UI

- Screens are pure functions `render(state, view) → string` (ANSI). Easy to snapshot-test.
- One `Session` per connection keeps the view stack and key handler.
- The same `Session` runs over WebSocket (xterm.js) and over a telnet socket.
- Live updates: the server event feed triggers a re-render of the current view.
- Palette, words, emoji, animations and sounds come from `.kiro/steering/theme.md`, compiled
  into one `src/theme.ts` token table. Screens never hard-code a colour or an emoji.
- Animations are frame sequences driven by a small scheduler; `reducedMotion` swaps each for
  its final frame.
- Sounds are generated with the Web Audio API at runtime (oscillators + noise); a build step
  can also render them to WAV in `assets/sounds/` for the video. Muted by default.
