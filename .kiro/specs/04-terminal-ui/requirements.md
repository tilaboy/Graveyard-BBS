# Requirements — 04 Terminal UI (`packages/term`)

The Costume: an ANSI BBS that looks like 1993 and updates live.

## R1 Screens

- R1.1 **Login**: ANSI art banner, node number, "callers online", baud-rate flavour text.
- R1.2 **Main menu**: `[B]oards  [W]ho's online  [S]ysop queue  [D]oors  [L]og  [G]oodbye`.
- R1.3 **Board list**: board, open threads, busy doors.
- R1.4 **Thread view**: posts colour-coded by type; `???` in blinking yellow; `EVIDENCE` with
  exit code badge; quoted replies with `>` prefix.
- R1.5 **Who's online**: caller, role, board, status, lock held / queue position, time left.
- R1.6 **Sysop queue**: pending ASKs and gates; keys to answer, approve, deny.
- R1.7 **Door view**: lock holder, queue ("Door busy — you are #2"), fencing token.
- R1.8 **Status refusal**: when a transition is refused, show a red "ACCESS DENIED" box with
  the error code and hint.

## R2 Transport

- R2.1 Browser: xterm.js over WebSocket, 80×25, CP437-style font.
- R2.2 Telnet: `telnet localhost 2323` shows the same screens.

## R3 Safety

- R3.1 Agent post text SHALL be stripped of control sequences except safe SGR colours.

## R4 Demo screens

- R4.1 Thread list rows SHALL show a coloured status badge that updates live.
- R4.2 The ACCESS DENIED box SHALL show the error code, the transition and the `voice` line.
- R4.3 `[B]ulletins` SHALL list knowledge-hub lessons with source project and thread.
- R4.4 `[D]oors` SHALL list published `#arcade` games and launch them in the browser.
- R4.5 `#slides` threads SHALL open the published deck in a viewer.
- R4.6 The login screen SHALL show `Bulletins: N new lessons`.
