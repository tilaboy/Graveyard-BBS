import { describe, expect, it } from "vitest";
import { buildTools, callTool, type ToolCtx } from "../src/tools.js";
import { makeEnv } from "./helpers.js";

const tools = buildTools();

function setup() {
  const svc = makeEnv().open();
  const as = (handle: string, role: ToolCtx["actor"]["role"]): ToolCtx => ({
    svc,
    doors: [],
    actor: { handle, role },
  });
  const mod = as("moderator", "moderator");
  return { svc, as, mod };
}

describe("spec 03 server additions", () => {
  it("R2.2 bbs_check_gate reports the server's gate, false without evidence", async () => {
    const { mod } = setup();
    await callTool(tools, mod, "bbs_create_task", {
      thread_id: "slides-a",
      text: "x",
      assigned: "builder-1",
    });
    const r = await callTool(tools, mod, "bbs_check_gate", {
      thread_id: "slides-a",
    });
    expect(r).toMatchObject({ ok: true, value: { gate_ok: false } });
  });

  it("R3.3 bbs_register_child binds the token to the owner, once, moderator only", async () => {
    const { svc, as, mod } = setup();
    await callTool(tools, mod, "bbs_create_task", {
      thread_id: "slides-a",
      text: "x",
      assigned: "builder-1",
    });
    const args = {
      thread_id: "slides-a",
      handle: "builder-1",
      role: "builder",
    };
    expect(
      (
        await callTool(
          tools,
          as("builder-9", "builder"),
          "bbs_register_child",
          args,
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await callTool(tools, mod, "bbs_register_child", {
          ...args,
          handle: "other",
        })
      ).ok,
    ).toBe(false);
    const ok = await callTool(tools, mod, "bbs_register_child", args);
    const token = (ok as { value: { token: string } }).value.token;
    expect(svc.store.callerBySecret(token)).toEqual({
      handle: "builder-1",
      role: "builder",
    });
    const again = await callTool(tools, mod, "bbs_register_child", args);
    const token2 = (again as { value: { token: string } }).value.token;
    expect(svc.store.callerBySecret(token)).toBeUndefined();
    expect(svc.store.callerBySecret(token2)?.handle).toBe("builder-1");
    expect(
      (
        await callTool(tools, mod, "bbs_register_child", {
          ...args,
          role: "release",
        })
      ).ok,
    ).toBe(false);
  });

  it("R4.2 bbs_escalate posts ASK without moving the status", async () => {
    const { svc, as, mod } = setup();
    await callTool(tools, mod, "bbs_create_task", {
      thread_id: "slides-a",
      text: "x",
    });
    expect(
      (
        await callTool(tools, as("builder-1", "builder"), "bbs_escalate", {
          thread_id: "slides-a",
          text: "?",
        })
      ).ok,
    ).toBe(false);
    await callTool(tools, mod, "bbs_escalate", {
      thread_id: "slides-a",
      text: "help",
    });
    expect(svc.p.tasks["slides-a"]?.status).toBe("pending");
    expect(svc.p.tasks["slides-a"]?.posts.at(-1)?.type).toBe("ASK");
  });

  it("R9.2/R9.3/R9.5 lessons are stored once, listed, and quoted in the packet", async () => {
    const { as, mod } = setup();
    await callTool(tools, mod, "bbs_create_task", {
      thread_id: "arcade-a",
      text: "x",
    });
    const add = {
      thread_id: "websites-a",
      text: "add alt text",
      tags: ["a11y"],
      project: "p",
    };
    expect(await callTool(tools, mod, "bbs_add_lesson", add)).toMatchObject({
      value: { stored: true },
    });
    expect(await callTool(tools, mod, "bbs_add_lesson", add)).toMatchObject({
      value: { stored: false },
    });
    expect(
      (await callTool(tools, as("builder-1", "builder"), "bbs_add_lesson", add))
        .ok,
    ).toBe(false);
    const list = await callTool(tools, mod, "bbs_list_lessons", {
      board: "websites",
    });
    expect((list as { value: unknown[] }).value).toHaveLength(1);
    const pk = await callTool(tools, mod, "bbs_get_packet", {
      thread_id: "arcade-a",
      lessons: [{ text: "add alt text", project: "p", thread: "websites-a" }],
    });
    expect((pk as { value: { text: string } }).value.text).toContain(
      '## lessons\n- "add alt text" (from p/websites-a)',
    );
    expect(
      (
        await callTool(tools, as("builder-1", "builder"), "bbs_get_packet", {
          thread_id: "arcade-a",
          lessons: [{ text: "x", project: "p", thread: "t" }],
        })
      ).ok,
    ).toBe(false);
  });
});
