import { describe, expect, it } from "vitest";
import { EventSchema } from "../src/index.js";

const env = { id: "e1", seq: 1, at: 5, thread_id: "t1", caller: "b1" };

describe("event schemas (R3.1, R3.4)", () => {
  it("accepts an event with the full envelope", () => {
    expect(
      EventSchema.safeParse({ ...env, type: "NOTE", body: { text: "hi" } })
        .success,
    ).toBe(true);
  });
  it.each(["id", "seq", "at", "thread_id", "caller", "body"])(
    "rejects an event without %s",
    (k) => {
      const e: Record<string, unknown> = {
        ...env,
        type: "NOTE",
        body: { text: "hi" },
      };
      delete e[k];
      expect(EventSchema.safeParse(e).success).toBe(false);
    },
  );
  it("rejects an unknown type and a wrong body", () => {
    expect(
      EventSchema.safeParse({ ...env, type: "NUKE", body: {} }).success,
    ).toBe(false);
    expect(
      EventSchema.safeParse({
        ...env,
        type: "REVIEW",
        body: { verdict: "maybe", reasons: [] },
      }).success,
    ).toBe(false);
  });
  it("knows all 17 event types", () => {
    expect(EventSchema.options.map((o) => o.shape.type.value).sort()).toEqual(
      "ACK ANSWER ASK CLAIM EVIDENCE GRANT HEARTBEAT MILESTONE NOTE QUEUE RELEASE REP REVIEW STATUS SYSTEM TASK TRIED".split(
        " ",
      ),
    );
  });
});
