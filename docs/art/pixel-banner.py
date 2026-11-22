"""Print the SVG path data for the pixel-block "GRAVEYARD BBS" banner.

docs/art/render.sh puts this path into every source that has d="BANNER" before rendering.
Each lit cell of a 5x7 glyph becomes a 0.86-unit square, so the letters look like ANSI blocks.
One unit = one cell; the banner is 77 x 7 units. Scale it with a transform in the SVG.
Run: python3 docs/art/pixel-banner.py
"""

GLYPHS = {
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    " ": ["....."] * 7,
}


def path(text: str = "GRAVEYARD BBS", cell: float = 0.86) -> str:
    out = []
    for i, ch in enumerate(text):
        for y, row in enumerate(GLYPHS[ch]):
            for x, c in enumerate(row):
                if c == "#":
                    out.append(f"M{i * 6 + x} {y}h{cell}v{cell}h-{cell}z")
    return "".join(out)


if __name__ == "__main__":
    print(path())
