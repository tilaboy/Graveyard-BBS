# Design — 04 Terminal UI

- Screens are pure functions `render(state, view) → string` (ANSI). Easy to snapshot-test.
- One `Session` per connection keeps the view stack and key handler.
- The same `Session` runs over WebSocket (xterm.js) and over a telnet socket.
- Live updates: the server event feed triggers a re-render of the current view.
- Palette: 16-colour ANSI. Types → colours: TASK white, NOTE grey, ASK yellow blink,
  EVIDENCE green/red, TRIED magenta, REVIEW cyan, SYSTEM dark blue.
