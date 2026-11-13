/** `graveyard-site --bundles <file|dir> --out <dir> [--published <dir>]` and `build-cli client`. */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { buildClient, buildSite } from "./build.js";

const [cmd, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    bundles: { type: "string", multiple: true },
    out: { type: "string" },
    published: { type: "string" },
  },
});

if (cmd === "client") {
  const out = resolve(values.out ?? "dist/live");
  await buildClient(out, "live");
  console.log(out);
} else if (cmd === "site" && values.bundles?.length) {
  const out = resolve(values.out ?? "dist/site");
  const { runs } = await buildSite({
    bundles: values.bundles.map((b) => resolve(b)),
    out,
    ...(values.published ? { published: resolve(values.published) } : {}),
  });
  console.log(
    `${out} (${runs.length} run${runs.length === 1 ? "" : "s"}: ${runs.join(", ")})`,
  );
} else {
  console.error(
    "usage: graveyard-site --bundles <file|dir>... --out <dir> [--published <dir>]",
  );
  process.exit(1);
}
