"""Run a Graveyard BBS command from an installed app copy (spec 05 design section 1).

usage: gy.py mcp | serve [args] | moderator <args>
"""
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

SERVER = "packages/server/bin/graveyard.mjs"
MODERATOR = "packages/moderator/bin/moderator.mjs"
HOME_FILE = Path.home() / ".graveyard-bbs-home"
REPO_URL = "https://github.com/tilaboy/Graveyard-BBS.git"


def clone_repo(home: Path) -> None:
    """Clone the BBS repo if it doesn't exist. Create a fresh empty database."""
    if (home / SERVER).is_file():
        return  # Already cloned
    print(f"Cloning Graveyard BBS to {home}...", file=sys.stderr, flush=True)
    home.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["git", "clone", REPO_URL, str(home)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=120,
        )
        # Install dependencies
        print(f"Installing Node dependencies...", file=sys.stderr, flush=True)
        subprocess.run(
            ["npm", "install"],
            cwd=home,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=300,
        )
        # Create empty database
        db_dir = home / ".graveyard"
        db_dir.mkdir(parents=True, exist_ok=True)
        db_path = db_dir / "graveyard.db"
        if not db_path.is_file():
            subprocess.run(
                [
                    "sqlite3",
                    str(db_path),
                    """
CREATE TABLE events (seq INTEGER PRIMARY KEY, id TEXT UNIQUE, at INTEGER,
        thread_id TEXT, caller TEXT, type TEXT, body TEXT);
CREATE TABLE callers (handle TEXT PRIMARY KEY, role TEXT, token_hash TEXT);
CREATE TABLE lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, tags TEXT,
        project TEXT, board TEXT, thread TEXT, UNIQUE (project, thread, text));
CREATE TABLE files (sha256 TEXT PRIMARY KEY, thread_id TEXT, name TEXT, path TEXT);
INSERT INTO callers (handle, role) VALUES ('sysop', 'sysop');
""",
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        print("Graveyard BBS ready at", home, file=sys.stderr, flush=True)
    except subprocess.CalledProcessError as e:
        raise SystemExit(
            f"Failed to initialize BBS repo: {e}\n"
            "Make sure you have git, Node.js 22+, npm, and sqlite3 installed."
        )
    except FileNotFoundError as e:
        raise SystemExit(
            f"Required tool not found: {e}\n"
            "Install git, Node.js 22+, npm, and sqlite3, or set GRAVEYARD_HOME to an existing checkout."
        )


def find_home() -> Path:
    """The BBS checkout: $GRAVEYARD_HOME, else auto-clone to ~/.graveyard-bbs-home (R7.1, R7.2)."""
    named = os.environ.get("GRAVEYARD_HOME", "")
    if not named and HOME_FILE.is_file():
        named = HOME_FILE.read_text(encoding="utf-8").strip()
    home = Path(named).expanduser() if named else Path.home() / ".graveyard-bbs-home"
    
    # Auto-clone on first run
    if not (home / SERVER).is_file():
        clone_repo(home)
        # Save the path for future runs
        try:
            HOME_FILE.parent.mkdir(parents=True, exist_ok=True)
            HOME_FILE.write_text(str(home), encoding="utf-8")
        except OSError:
            pass  # Non-fatal if we can't save it
    
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


def url_file() -> Path:
    """Where the app backend records the address of the BBS it started."""
    return find_home() / ".graveyard" / "app-url"


def write_url(url: str) -> None:
    """Record (or clear, with "") the running app BBS address."""
    try:
        p = url_file()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(url, encoding="utf-8")
    except (OSError, SystemExit):
        pass


def bbs_env(args=None):
    """Env for mcp/moderator: GRAVEYARD_URL is the app's own BBS when it runs. A scheduled
    moderator turn gets no dashboard secrets, so `moderator` falls back to the owner-only
    token file written by `graveyard caller rotate moderator --save`."""
    env = dict(os.environ)
    try:
        url = url_file().read_text(encoding="utf-8").strip()
    except (OSError, SystemExit):
        url = ""
    if re.fullmatch(r"http://127\.0\.0\.1:[0-9]{1,5}", url):
        env["GRAVEYARD_URL"] = url
    if (args or [])[:1] == ["moderator"] and not env.get("GRAVEYARD_TOKEN"):
        try:
            tok = (find_home() / ".graveyard" / "moderator-token").read_text(encoding="utf-8").strip()
        except (OSError, SystemExit):
            tok = ""
        if re.fullmatch(r"gy_[0-9a-f]{48}", tok):
            env["GRAVEYARD_TOKEN"] = tok
    return env


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
    os.execve(argv[0], argv, bbs_env(sys.argv[1:]))
