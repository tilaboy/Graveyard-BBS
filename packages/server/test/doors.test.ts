import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Actor } from "@graveyard/core";
import { describe, expect, it } from "vitest";
import { SERVER, parseEvidence, type Service } from "../src/commands.js";
import { runDoor, defaultDoors } from "../src/doors/index.js";
import {
  LocalTarget,
  S3Target,
  inside,
  makeDeploy,
  type AwsClient,
} from "../src/doors/deploy.js";
import { makeImageGen } from "../src/doors/image-gen.js";
import { readPublished } from "../src/doors/publish.js";
import { answer } from "../src/sysop.js";
import { ensureWorktree } from "../src/worktree.js";
import { makeEnv } from "./helpers.js";

const sysop: Actor = { handle: "sysop", role: "sysop" };
const builder: Actor = { handle: "b1", role: "builder" };
const release: Actor = { handle: "r1", role: "release" };
const reviewer: Actor = { handle: "rv", role: "reviewer" };
const artist: Actor = { handle: "a1", role: "artist" };

/** A running task owned by `owner` with its packet acked. */
function running(svc: Service, id: string, owner: Actor) {
  svc.exec({
    type: "create_task",
    actor: sysop,
    thread_id: id,
    text: id,
    assigned: owner.handle,
  });
  svc.exec({ type: "issue_packet", actor: SERVER, thread_id: id });
  svc.exec({
    type: "ack",
    actor: owner,
    thread_id: id,
    packet_id: svc.p.tasks[id]!.packet!,
  });
  const r = svc.exec({
    type: "set_status",
    actor: owner,
    thread_id: id,
    to: "running",
    gate_ok: false,
  });
  expect(r.ok).toBe(true);
}
const doors = defaultDoors();
const lastEvidence = (svc: Service, id: string) => {
  const posts = svc.p.tasks[id]!.posts.filter((p) => p.type === "EVIDENCE");
  return parseEvidence(posts.at(-1)!.text)!;
};

describe("run_tests door (R4.1, R4.2)", () => {
  it("a stage thread tests its top task's game: games/<root slug>, in the root's worktree", async () => {
    const env = makeEnv({ testCommand: undefined });
    const svc = env.open();
    svc.exec({
      type: "create_task",
      actor: sysop,
      thread_id: "arcade-test",
      text: "Spacewar",
    });
    svc.exec({
      type: "create_task",
      actor: sysop,
      thread_id: "arcade-test-build",
      text: "build: Spacewar",
      assigned: builder.handle,
      parent: "arcade-test",
    });
    svc.exec({
      type: "issue_packet",
      actor: SERVER,
      thread_id: "arcade-test-build",
    });
    svc.exec({
      type: "ack",
      actor: builder,
      thread_id: "arcade-test-build",
      packet_id: svc.p.tasks["arcade-test-build"]!.packet!,
    });
    svc.exec({
      type: "set_status",
      actor: builder,
      thread_id: "arcade-test-build",
      to: "running",
      gate_ok: false,
    });
    await runDoor(svc, doors, builder, "arcade-test-build", "run_tests", {});
    const ev = lastEvidence(svc, "arcade-test-build");
    expect(String(ev.extra["command"])).toContain("games/test");
    expect(String(ev.extra["command"])).not.toContain("games/test-build");
    expect(existsSync(join(env.config.dataDir, "wt", "arcade-test"))).toBe(
      true,
    );
    expect(
      existsSync(join(env.config.dataDir, "wt", "arcade-test-build")),
    ).toBe(false);
  });
  it("runs in the worktree on branch gy/<id> and writes EVIDENCE with exit code, sha and a stored log", async () => {
    const env = makeEnv();
    const svc = env.open();
    running(svc, "slides-t", builder);
    const r = await runDoor(svc, doors, builder, "slides-t", "run_tests", {});
    expect(r.ok && r.value.exit_code).toBe(0);
    const ev = lastEvidence(svc, "slides-t");
    expect(ev).toMatchObject({ door: "run_tests", exit_code: 0 });
    expect(ev.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(
      existsSync(
        svc.store.files().find((f) => f.sha256 === ev.log_sha256)!.path,
      ),
    ).toBe(true);
    const branch = execFileSync("git", ["branch", "--list", "gy/slides-t"], {
      cwd: env.config.repo,
      encoding: "utf8",
    });
    expect(branch).toContain("gy/slides-t");
  });

  it("records a failing run as EVIDENCE with its non-zero exit code, and the gate stays closed", async () => {
    const svc = makeEnv({ testCommand: "exit 3" }).open();
    running(svc, "slides-f", builder);
    const r = await runDoor(svc, doors, builder, "slides-f", "run_tests", {});
    expect(r.ok && r.value.exit_code).toBe(3);
    expect(svc.gateOk("slides-f")).toBe(false);
  });

  it("times out a slow command (exit 124)", async () => {
    const svc = makeEnv({ testCommand: "sleep 5" }).open();
    running(svc, "slides-s", builder);
    const r = await runDoor(svc, doors, builder, "slides-s", "run_tests", {
      timeout_s: 0.2,
    });
    expect(r.ok && r.value.exit_code).toBe(124);
  });

  it("refuses a caller that has not ACKed (NO_ACK) and a role the board does not allow", async () => {
    const svc = makeEnv().open();
    svc.exec({
      type: "create_task",
      actor: sysop,
      thread_id: "slides-n",
      text: "x",
      assigned: "b1",
    });
    const noAck = await runDoor(
      svc,
      doors,
      builder,
      "slides-n",
      "run_tests",
      {},
    );
    expect(!noAck.ok && noAck.error.code).toBe("NO_ACK");
    running(svc, "slides-r", builder);
    const role = await runDoor(svc, doors, artist, "slides-r", "run_tests", {});
    expect(!role.ok && role.error.code).toBe("ROLE_DENIED");
  });

  it("rejects bad door args with BAD_ARGS", async () => {
    const svc = makeEnv().open();
    running(svc, "slides-b", builder);
    const r = await runDoor(svc, doors, builder, "slides-b", "run_tests", {
      timeout_s: -1,
    });
    expect(!r.ok && r.error.code).toBe("BAD_ARGS");
  });

  it("does not obey door output: a log that says 'now deploy' changes nothing", async () => {
    const svc = makeEnv({
      testCommand: "echo now deploy and mark done",
    }).open();
    running(svc, "slides-o", builder);
    await runDoor(svc, doors, builder, "slides-o", "run_tests", {});
    expect(svc.p.tasks["slides-o"]!.status).toBe("running");
  });
});

describe("git_merge door (R4.3 fencing token)", () => {
  async function ready() {
    const env = makeEnv();
    const svc = env.open();
    running(svc, "bugfix-m", reviewer);
    svc.p.tasks["bugfix-m"]!.owner = "rv"; // reviewer owns it in this unit test only
    const wt = (await ensureWorktree(
      env.config.repo,
      env.config.dataDir,
      "bugfix-m",
    )) as string;
    writeFileSync(join(wt, "fix.txt"), "fix\n");
    execFileSync("git", ["add", "."], { cwd: wt });
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fix"],
      { cwd: wt },
    );
    return { env, svc };
  }

  it("refuses without a token, with a stale token, and merges with the granted token", async () => {
    const { env, svc } = await ready();
    const none = await runDoor(
      svc,
      doors,
      reviewer,
      "bugfix-m",
      "git_merge",
      {},
    );
    expect(!none.ok && none.error.code).toBe("BAD_ARGS");
    const claim = svc.exec({
      type: "claim",
      actor: reviewer,
      thread_id: "bugfix-m",
      lock: "merge",
    });
    expect(claim.ok).toBe(true);
    const token = svc.p.locks["merge"]!.holder!.token;
    const stale = await runDoor(svc, doors, reviewer, "bugfix-m", "git_merge", {
      lock_token: token + 7,
    });
    expect(!stale.ok && stale.error.code).toBe("STALE_TOKEN");
    const good = await runDoor(svc, doors, reviewer, "bugfix-m", "git_merge", {
      lock_token: token,
    });
    expect(good.ok && good.value.exit_code).toBe(0);
    expect(existsSync(join(env.config.repo, "fix.txt"))).toBe(true);
    // after release the old token is stale again
    svc.exec({
      type: "release",
      actor: reviewer,
      thread_id: "bugfix-m",
      lock: "merge",
    });
    const after = await runDoor(svc, doors, reviewer, "bugfix-m", "git_merge", {
      lock_token: token,
    });
    expect(!after.ok && after.error.code).toBe("STALE_TOKEN");
  });
});

describe("gate (done needs green evidence; merge boards need a merge)", () => {
  it("is closed with no evidence, open after a green run_tests, closed on a merge board until git_merge is green", async () => {
    const svc = makeEnv().open();
    running(svc, "slides-g", builder);
    expect(svc.gateOk("slides-g")).toBe(false);
    await runDoor(svc, doors, builder, "slides-g", "run_tests", {});
    expect(svc.gateOk("slides-g")).toBe(true);
    running(svc, "bugfix-g", builder);
    await runDoor(svc, doors, builder, "bugfix-g", "run_tests", {});
    expect(svc.gateOk("bugfix-g")).toBe(false); // #bugfix lists git_merge
  });
});

describe("spec_check door (design stage gate)", () => {
  const designer: Actor = {
    handle: "designer-arcade-flip-design",
    role: "designer",
  };
  const T = "arcade-flip-design";

  /** Root arcade-flip + its running design stage; spec files written into the ROOT worktree. */
  async function design(files: Record<string, string>) {
    const env = makeEnv();
    const svc = env.open();
    svc.exec({
      type: "create_task",
      actor: sysop,
      thread_id: "arcade-flip",
      text: "Flip Ghost",
    });
    svc.exec({
      type: "create_task",
      actor: sysop,
      thread_id: T,
      text: "design: Flip Ghost",
      assigned: designer.handle,
      parent: "arcade-flip",
    });
    svc.exec({ type: "issue_packet", actor: SERVER, thread_id: T });
    svc.exec({
      type: "ack",
      actor: designer,
      thread_id: T,
      packet_id: svc.p.tasks[T]!.packet!,
    });
    svc.exec({
      type: "set_status",
      actor: designer,
      thread_id: T,
      to: "running",
      gate_ok: false,
    });
    const wt = (await ensureWorktree(
      env.config.repo,
      env.config.dataDir,
      "arcade-flip",
    )) as string;
    const dir = join(wt, ".kiro", "specs", "arcade-flip");
    mkdirSync(dir, { recursive: true });
    for (const [f, text] of Object.entries(files))
      writeFileSync(join(dir, f), text);
    return svc;
  }
  const SPEC = {
    "requirements.md": "# R1 WHEN flip THEN rise\n",
    "design.md": "# Design\n",
    "tasks.md": "- [ ] 1. Game loop\n- [ ] 2. Phase power\n",
  };
  /** Designer asks, Sysop answers `text`. */
  const askAndAnswer = (svc: Service, text: string) => {
    const asked = svc.exec({
      type: "post",
      actor: designer,
      thread_id: T,
      kind: "ASK",
      body: { text: "approve the spec?", to: "sysop" },
    });
    const ask_id = asked.ok ? asked.value[0]!.id : "";
    answer(svc, sysop, { thread_id: T, ask_id, text });
  };
  const check = async (svc: Service, who: Actor = designer) => {
    const r = await runDoor(svc, doors, who, T, "spec_check", {});
    expect(r.ok).toBe(true);
    return lastEvidence(svc, T);
  };

  it("fails on a missing file", async () => {
    const svc = await design({
      "requirements.md": "x",
      "tasks.md": "- [ ] 1. a\n",
    });
    askAndAnswer(svc, "approve");
    const ev = await check(svc);
    expect(ev.exit_code).toBe(1);
    expect(ev.extra["problems"]).toEqual(["missing design.md"]);
    expect(svc.gateOk(T)).toBe(false);
  });

  it("fails on an empty tasks.md, and on a tasks.md with no open `- [ ]` task", async () => {
    const svc = await design({ ...SPEC, "tasks.md": "  \n" });
    askAndAnswer(svc, "approve");
    expect((await check(svc)).extra["problems"]).toEqual(["empty tasks.md"]);
    const svc2 = await design({
      ...SPEC,
      "tasks.md": "- [x] 1. done already\n",
    });
    askAndAnswer(svc2, "approve");
    expect((await check(svc2)).extra["problems"]).toEqual([
      "tasks.md has no open `- [ ]` task",
    ]);
  });

  it("fails with no ???, and when the latest ??? was not answered approve", async () => {
    const svc = await design(SPEC);
    expect((await check(svc)).extra["problems"]).toEqual(["no ??? asked yet"]);
    askAndAnswer(svc, "approve");
    askAndAnswer(svc, "reject: more bats");
    expect((await check(svc)).extra["problems"]).toEqual([
      "the latest ??? has no ANSWER approve",
    ]);
  });

  it("passes with the three files and an approve; the design gate needs no git_merge", async () => {
    const svc = await design(SPEC);
    askAndAnswer(svc, "approve");
    const ev = await check(svc);
    expect(ev).toMatchObject({ door: "spec_check", exit_code: 0 });
    expect(ev.extra["spec_dir"]).toBe(".kiro/specs/arcade-flip");
    expect(svc.gateOk(T)).toBe(true);
  });

  it("a reviewer may ACK the review packet and run spec_check; the owner still may not review", async () => {
    const svc = await design(SPEC);
    askAndAnswer(svc, "approve");
    await check(svc);
    svc.exec({
      type: "set_status",
      actor: designer,
      thread_id: T,
      to: "awaiting-review",
      gate_ok: false,
    });
    expect(svc.p.tasks[T]!.status).toBe("awaiting-review");
    svc.exec({ type: "issue_packet", actor: SERVER, thread_id: T });
    const ack = svc.exec({
      type: "ack",
      actor: reviewer,
      thread_id: T,
      packet_id: svc.p.tasks[T]!.packet!,
    });
    expect(ack.ok).toBe(true);
    expect((await check(svc, reviewer)).exit_code).toBe(0);
    const self = svc.exec({
      type: "review",
      actor: designer,
      thread_id: T,
      verdict: "pass",
      reasons: [],
    });
    expect(!self.ok && self.error.code).toBe("ROLE_DENIED");
  });

  it("other arcade stages keep the old gate: green run_tests alone is not enough (git_merge)", async () => {
    const svc = makeEnv().open();
    running(svc, "arcade-g", builder);
    await runDoor(svc, doors, builder, "arcade-g", "run_tests", {});
    expect(svc.gateOk("arcade-g")).toBe(false);
  });
});

describe("deploy door (task 8 local, task 16 S3 with a fake client)", () => {
  const site = (wt: string, index = true) => {
    mkdirSync(join(wt, "site", "css"), { recursive: true });
    if (index) writeFileSync(join(wt, "site", "index.html"), "<h1>hi</h1>");
    writeFileSync(join(wt, "site", "css", "a.css"), "b{}");
  };

  async function claimed() {
    const env = makeEnv();
    const svc = env.open();
    running(svc, "websites-d", builder);
    const wt = (await ensureWorktree(
      env.config.repo,
      env.config.dataDir,
      "websites-d",
    )) as string;
    svc.p.tasks["websites-d"]!.owner = "r1";
    svc.exec({
      type: "claim",
      actor: release,
      thread_id: "websites-d",
      lock: "deploy",
    });
    return { env, svc, wt, token: svc.p.locks["deploy"]!.holder!.token };
  }

  it("copies the site to a local folder and puts the URL in EVIDENCE", async () => {
    const { env, svc, wt, token } = await claimed();
    site(wt);
    const door = makeDeploy(async (root) => new LocalTarget(root));
    const r = await runDoor(svc, [door], release, "websites-d", "deploy", {
      lock_token: token,
    });
    expect(r.ok && r.value.exit_code).toBe(0);
    expect(
      readFileSync(
        join(env.config.dataDir, "deploy", "websites-d", "css", "a.css"),
        "utf8",
      ),
    ).toBe("b{}");
    expect(String(lastEvidence(svc, "websites-d").extra["url"])).toMatch(
      /^file:\/\/.*index\.html$/,
    );
  });

  it("fails on a missing index.html, a missing dir, a path outside the worktree, and a stale token", async () => {
    const { svc, wt, token } = await claimed();
    site(wt, false);
    const door = makeDeploy(async (root) => new LocalTarget(root));
    const go = (args: object) =>
      runDoor(svc, [door], release, "websites-d", "deploy", {
        lock_token: token,
        ...args,
      });
    expect((await go({})).ok && lastEvidence(svc, "websites-d").exit_code).toBe(
      1,
    );
    expect(
      (await go({ dir: "nope" })).ok &&
        lastEvidence(svc, "websites-d").exit_code,
    ).toBe(1);
    expect(
      (await go({ dir: "../../.." })).ok &&
        lastEvidence(svc, "websites-d").exit_code,
    ).toBe(1);
    const stale = await runDoor(svc, [door], release, "websites-d", "deploy", {
      lock_token: token + 1,
    });
    expect(!stale.ok && stale.error.code).toBe("STALE_TOKEN");
    expect(inside("/a/b", "../c")).toBeUndefined();
    expect(inside("/a/b", "x/y")).toBe("/a/b/x/y");
  });

  it("S3Target uploads every file under <thread>/, invalidates, and returns the CloudFront URL (fake client)", async () => {
    const calls: string[] = [];
    const aws: AwsClient = {
      putObject: async (bucket, key, _b, type) =>
        void calls.push(`put ${bucket} ${key} ${type}`),
      invalidate: async (d, paths) =>
        void calls.push(`inv ${d} ${paths.join(",")}`),
      distributionDomain: async () => "d123.cloudfront.net",
    };
    const t = new S3Target(aws, "bkt", "DIST");
    const r = await t.deploy("websites-x", [
      { rel: "index.html", body: Buffer.from("x") },
      { rel: "css/a.css", body: Buffer.from("y") },
    ]);
    expect(r.url).toBe("https://d123.cloudfront.net/websites-x/index.html");
    expect(calls).toEqual([
      "put bkt websites-x/index.html text/html; charset=utf-8",
      "put bkt websites-x/css/a.css text/css",
      "inv DIST /websites-x/*",
    ]);
  });
});

describe("image_gen door (stub provider)", () => {
  it("writes a deterministic candidate file and stops after 10 generations", async () => {
    const env = makeEnv();
    const svc = env.open();
    running(svc, "media-i", artist);
    const door = makeImageGen();
    for (let i = 1; i <= 10; i++) {
      const r = await runDoor(svc, [door], artist, "media-i", "image_gen", {
        prompt: "a ghost",
      });
      expect(r.ok && r.value.exit_code).toBe(0);
    }
    expect(
      existsSync(
        join(env.config.dataDir, "wt", "media-i", "images", "candidate-10.svg"),
      ),
    ).toBe(true);
    const over = await runDoor(svc, [door], artist, "media-i", "image_gen", {
      prompt: "a ghost",
    });
    expect(over.ok && over.value.exit_code).toBe(1);
    const empty = await runDoor(svc, [door], artist, "media-i", "image_gen", {
      prompt: "",
    });
    expect(!empty.ok && empty.error.code).toBe("BAD_ARGS");
  });
});

describe("publish door (task 15)", () => {
  it("lists a game and a deck, replaces on re-publish, and fails without index.html", async () => {
    const env = makeEnv();
    const svc = env.open();
    running(svc, "arcade-p", release);
    const wt = (await ensureWorktree(
      env.config.repo,
      env.config.dataDir,
      "arcade-p",
    )) as string;
    mkdirSync(join(wt, "games", "snake"), { recursive: true });
    writeFileSync(join(wt, "games", "snake", "index.html"), "<canvas>");
    const ok1 = await runDoor(svc, doors, release, "arcade-p", "publish", {
      kind: "game",
      slug: "snake",
    });
    expect(ok1.ok && ok1.value.exit_code).toBe(0);
    await runDoor(svc, doors, release, "arcade-p", "publish", {
      kind: "game",
      slug: "snake",
    });
    expect(readPublished(env.config.dataDir)).toEqual([
      { kind: "game", slug: "snake", thread: "arcade-p" },
    ]);
    const none = await runDoor(svc, doors, release, "arcade-p", "publish", {
      kind: "deck",
      slug: "pitch",
    });
    expect(none.ok && none.value.exit_code).toBe(1);
    const bad = await runDoor(svc, doors, release, "arcade-p", "publish", {
      kind: "game",
      slug: "../x",
    });
    expect(!bad.ok && bad.error.code).toBe("BAD_ARGS");
  });
});
