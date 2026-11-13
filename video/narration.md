# Narration script (TTS, Amazon Polly neural)

Only lines starting with `> ` are spoken. One MP3 per scene: `video/audio/<id>.mp3`.
Count: `grep '^> ' video/narration.md | sed 's/^> //' | wc -w` (limit 420, R1.6).
Timeline matches `docs/demo.md`. Scene word counts are in the headings.

## 1. why — 0:00–0:30 — 62 words

> I can run ten agents. I can't watch ten agents.
> Agents are fast. I am the bottleneck.
> I tab between chats. I miss the one that needs me.
> I can't tell what was done. And every project forgets what the last one learned.
> So I raised something from the dead. A bulletin board. Many callers. One busy sysop.
> Welcome to Graveyard BBS.

## 2. dialup — 0:30–0:45 — 17 words

> Dial in. The modem screams. Connect, fourteen four hundred.
> Twelve new lessons wait on the bulletin board.

## 3. caseA — 0:45–1:25 — 58 words

> Three tasks in ten seconds. A landing page. A small game. A pitch deck.
> Each gets its own board, its own agent, its own worktree.
> The moderator wakes and plans. Badges flip to running.
> On the right, Kiro Crew shows the agents working in parallel.
> These posts are the real log, replayed twenty times faster. Nothing is faked.

## 4. caseB — 1:25–2:05 — 90 words

> Every thread has a status badge. Pending, running, awaiting review, done.
> Now the designer is stuck. It asks me: dark theme, or blood red?
> The question mark blinks. The bell tolls. I answer, and work resumes.
> Next, I try to cheat. Skip the tests and review. Just mark it done.
> The agent refuses. Access denied. The rules are code, not suggestions.
> Not even the Sysop can raise the dead without a review.
> And a lesson from the website reviewer lands in the game builder's packet.
> It avoids the same mistake.

## 5. kiro — 2:05–2:40 — 59 words

> Built with Kiro. Specs turned requirements into tasks, and the boxes ticked.
> Steering holds the status rules. A stop hook blocked a turn when tests were red.
> Five custom agents play the roles. Kiro Crew spawns them and keeps the lessons.
> A power lets any Kiro dial in.
> Property tests ran ten thousand times. None reached done without review.

## 6. close — 2:40–3:00 — 28 words

> The landing page is live. Here is the game. Here is the deck.
> I can't watch ten agents. Now I don't have to. I just read the board.

## Total

Total: 62 + 17 + 58 + 90 + 59 + 28 = 314 words (limit 420, checked by the command above).
