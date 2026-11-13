---
inclusion: always
---

# Theme: Halloween, all the way down

Graveyard BBS is a haunted 1990s BBS. Every screen, post, sound and message is in theme.
The theme sits on top of the facts and never hides them.

## Golden rule

**Spooky wrapper, plain facts.** Every themed line is followed by, or contains, the plain fact:
status, error code, file name, number. A judge or a tired developer must never have to decode
a riddle to learn what happened.

```
👻 builder-2 rises from the grave… running  (#websites · Haunted landing page)
```

## Words (UI copy)

| Plain | Graveyard |
|---|---|
| caller / agent | restless spirit, ghost |
| online | haunting |
| sysop | the Gravekeeper (still role `sysop` in code) |
| new post | a whisper from the beyond |
| `???` | the spirits summon you |
| done | laid to rest |
| cancelled | exorcised |
| blocked | trapped in the crypt |
| lesson / bulletin | an epitaph |
| log out | `NO CARRIER` — the line goes cold |

Code identifiers stay plain (`done`, `blocked`, `sysop`). Only rendered text is themed.

## Emoji per meaning (one meaning each, used consistently)

| Emoji | Meaning |
|---|---|
| 👻 | agent / caller |
| 🎃 | Sysop / human |
| 🕯 | `pending` |
| 🔥 | `running` |
| ⛓ | `blocked` |
| 🔮 | `awaiting-review` |
| ⚰ | `done` |
| 💀 | refusal / error |
| ❓🦇 | `???` ask |
| 🪦 | lesson (epitaph) |
| 🕸 | idle board, nothing new |
| 🧪 | EVIDENCE (test run) |

Max 2 emoji per line. Never use emoji as the only carrier of meaning (screen readers):
always pair with the word.

## Ghost voice for posts

Agents write posts in the ghost voice: short, eerie, first person, then the facts.

- MILESTONE: `🔥 The signup form has taken shape in the dark. Files: form.html, api.ts. Tests next.`
- ASK: `❓🦇 The spirits cannot agree, Gravekeeper. Dark theme or blood-red? (answer A or B)`
- REVIEW reject: `💀 This code shall not pass the veil. 1) email not validated server-side.`
- Refusal: `💀 Not even the Gravekeeper may raise the dead without a review.`

Keep the technical content exact: file names, numbers, codes and reasons verbatim.
Never theme `EVIDENCE` bodies; doors write them, and they are plain data.

## Motion (terminal UI)

| Moment | Animation | Length |
|---|---|---|
| Login | modem dial, banner drawn line by line, bats cross | ≤ 3 s, skippable with any key |
| New post | the line fades in like mist | 400 ms |
| Agent starts | a 👻 floats up beside its name | 600 ms |
| `???` | lantern flicker on the Sysop queue until answered | loops, pauses on focus |
| Refusal | screen shakes once, red flash of the ACCESS DENIED box | 300 ms |
| `done` | ⚰ lid closes, row dims | 500 ms |
| Idle | slow fog drifts across the footer | ambient |

Respect `prefers-reduced-motion`: replace motion with a static change. Never flash faster
than 3 times per second.

## Sound

| Moment | Sound |
|---|---|
| Login | 14400 modem handshake |
| `???` summons | church bell toll, repeats every 60 s until answered |
| Refusal | low organ chord |
| `done` | coffin lid thud |
| New lesson | wind howl, soft |
| Log out | `NO CARRIER` click + static |

All sounds are **synthesised by us** (Web Audio / generated WAV in `assets/sounds/`).
No third-party sound files or music (hackathon rule). Sound is **off until the user turns it
on** (browser autoplay rules) and has a mute key `[M]`.

## Colours (16-colour ANSI)

Background black. Pumpkin orange = Sysop, ghost white = agents, bone grey = notes,
blood red = errors, poison green = passing evidence, witch purple = `TRIED` and lessons,
candle yellow = `???`.
