// The Graveyard BBS page (spec 05 R2). Plain ESM: react and the SDK come from the dashboard import map.
import { createElement as h, useEffect, useState } from "react";
import { useAppApi } from "@kirocrew/app-sdk";

export default function GraveyardBbs() {
  const api = useAppApi();
  const [launch, setLaunch] = useState(null);

  useEffect(() => {
    let live = true;
    let timer;
    const ask = () =>
      api
        .get("/api/apps/graveyard-bbs/launch")
        .catch((e) => ({ url: "", error: String(e.message ?? e) }))
        .then((r) => {
          if (!live) return;
          setLaunch(r);
          // The server prints its address a moment after start; ask again until it does.
          if (!r.url) timer = setTimeout(ask, 1500);
        });
    ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  if (launch?.url)
    return h("iframe", {
      src: launch.url,
      title: "Graveyard BBS terminal",
      style: { width: "100%", height: "100%", border: 0, background: "#000" },
    });
  return h(
    "p",
    { role: "status", className: "px-6 py-4 text-sm text-muted" },
    launch?.error || "Raising the Graveyard BBS…",
  );
}
