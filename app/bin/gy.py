"""Run a Graveyard BBS command from an installed app copy (spec 05 design section 1).

usage: gy.py mcp | serve [args] | moderator <args>
"""
import os
import shutil
import sys
from pathlib import Path

SERVER = "packages/server/bin/graveyard.mjs"
MODERATOR = "packages/moderator/bin/moderator.mjs"
HOME_FILE = Path.home() / ".graveyard-bbs-home"


def find_home() -> Path:
    """The BBS checkout: $GRAVEYARD_HOME, else the path in ~/.graveyard-bbs-home (R7.1)."""
    named = os.environ.get("GRAVEYARD_HOME", "")
    if not named and HOME_FILE.is_file():
        named = HOME_FILE.read_text(encoding="utf-8").strip()
    home = Path(named).expanduser() if named else None
    if home is None or not (home / SERVER).is_file():
        raise SystemExit(
            "Graveyard BBS checkout not found. Set GRAVEYARD_HOME, or write the checkout path "
            f"into {HOME_FILE} (it must contain {SERVER})."
        )
    return home


def find_node() -> str:
    """The node binary. App processes may get a short PATH without Homebrew."""
    named = os.environ.get("GRAVEYARD_NODE", "")
    if named:
        return named
    found = shutil.which("node")
    if found:
        return found
    for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"):
        if Path(p).is_file():
            return p
    raise SystemExit("node not found. Install Node.js, or set GRAVEYARD_NODE to its path.")


def command(args: list[str]) -> tuple[Path, list[str]]:
    """(working directory, argv) for one launcher command."""
    home = find_home()
    if args[:1] == ["moderator"]:
        return home, [find_node(), str(home / MODERATOR), *args[1:]]
    if args[:1] in (["mcp"], ["serve"]):
        return home, [find_node(), str(home / SERVER), *args]
    raise SystemExit(__doc__)


if __name__ == "__main__":
    cwd, argv = command(sys.argv[1:])
    os.chdir(cwd)
    os.execv(argv[0], argv)
