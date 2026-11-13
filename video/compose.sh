#!/usr/bin/env bash
# Task 19 helper (spec 00 design §6, §7): split-screen 1920x1080 demo from recorded inputs.
#   terminal 1280 | Crew dashboard 640 (scenes caseA + caseB), full-screen terminal elsewhere,
#   caption bar at the bottom, REPLAY badge, narration MP3s + synthesised WAVs at scene offsets.
# Fails if the result is 180 s or longer.
#   PLACEHOLDER=1 ./video/compose.sh     self-test on generated ffmpeg lavfi clips
set -euo pipefail
cd "$(dirname "$0")/.."

# ---- inputs (override from the environment) --------------------------------------------
TERM_CLIP=${TERM_CLIP:-video/recorded/terminal.mp4}   # BBS terminal, aligned to the final timeline
CREW_CLIP=${CREW_CLIP:-video/recorded/crew.mp4}       # Kiro Crew dashboard capture, same alignment
NARR_DIR=${NARR_DIR:-video/audio}                     # why.mp3 dialup.mp3 caseA.mp3 caseB.mp3 kiro.mp3 close.mp3
SOUNDS_DIR=${SOUNDS_DIR:-assets/sounds}               # from `npm run sounds`
OUT=${OUT:-video/out/graveyard-bbs-demo.mp4}
RUN_ID=${RUN_ID:-run-id}                              # shown in the REPLAY badge
DURATION=${DURATION:-179}                             # seconds; must stay under 180
FONT=${FONT:-/System/Library/Fonts/Menlo.ttc}         # Linux: /usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
CAPTIONS=${CAPTIONS:-auto}                            # auto | skip  (skip = no text burn-in)
PLACEHOLDER=${PLACEHOLDER:-0}

# ---- timeline (docs/demo.md): scene start seconds --------------------------------------
SCENES=(why dialup caseA caseB kiro close)
START=(0 30 45 85 125 160)
SPLIT_FROM=45 SPLIT_TO=125            # split screen while agents work
REPLAY_FROM=45 REPLAY_TO=85 REPLAY_X=20   # Case A is replayed; Case B is real time (no badge)
# sound cues: file start-seconds volume
CUES=("wind 0 0.25" "modem 30.5 0.7" "thud 91 0.9" "bell 100 0.8" "organ 113 0.8" "nocarrier 178 0.8")
# captions: from|to|text   (no quote, colon or percent characters: drawtext escaping)
CAPS=(
  "0|30|Agents are fast. The human is the bottleneck."
  "30|45|CONNECT 14400 - Bulletins mean 12 lessons from the knowledge hub"
  "45|85|Board = topic. Thread = task. Caller = agent."
  "85|105|Status badge = task lifecycle. ??? = the agent needs the Sysop."
  "105|125|The rules are code, not suggestions."
  "125|160|Built with Kiro: specs, steering, hooks, agents, Crew, MCP, power, PBT"
  "160|179|NO CARRIER"
)

have_drawtext() { ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' drawtext '; }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

if [ "$PLACEHOLDER" = 1 ]; then
  ffmpeg -loglevel error -y -f lavfi -i "testsrc=s=1280x800:r=10:d=$DURATION" -pix_fmt yuv420p "$WORK/term.mp4"
  ffmpeg -loglevel error -y -f lavfi -i "testsrc2=s=640x800:r=10:d=$DURATION" -pix_fmt yuv420p "$WORK/crew.mp4"
  mkdir "$WORK/narr"
  for s in "${SCENES[@]}"; do
    ffmpeg -loglevel error -y -f lavfi -i "sine=f=440:d=8" -c:a libmp3lame "$WORK/narr/$s.mp3"
  done
  TERM_CLIP=$WORK/term.mp4 CREW_CLIP=$WORK/crew.mp4 NARR_DIR=$WORK/narr
fi

for f in "$TERM_CLIP" "$CREW_CLIP"; do [ -f "$f" ] || { echo "missing input: $f" >&2; exit 1; }; done
for s in "${SCENES[@]}"; do [ -f "$NARR_DIR/$s.mp3" ] || { echo "missing narration: $NARR_DIR/$s.mp3" >&2; exit 1; }; done

# ---- video graph -----------------------------------------------------------------------
W="between(t,$SPLIT_FROM,$SPLIT_TO)"
fit() { echo "scale=$1:$2:force_original_aspect_ratio=decrease,pad=$1:$2:-1:-1:black,setsar=1"; }
G="[0:v]split[a][b];[a]$(fit 1920 1000)[full];[b]$(fit 1280 1000)[left];[1:v]$(fit 640 1000)[right];"
G+="color=c=black:s=1920x1080:r=25[bg];"
G+="[bg][full]overlay=0:0:eof_action=pass:enable='not($W)'[v1];"
G+="[v1][left]overlay=0:0:eof_action=pass:enable='$W'[v2];"
G+="[v2][right]overlay=1280:0:eof_action=pass:enable='$W'[v3];"
G+="[v3]drawbox=0:1000:1920:80:color=0x14101c:t=fill"
if [ "$CAPTIONS" = auto ] && have_drawtext; then
  for c in "${CAPS[@]}"; do
    IFS='|' read -r a b t <<<"$c"
    G+=",drawtext=fontfile='$FONT':text='$t':x=24:y=1030:fontsize=30:fontcolor=white:enable='between(t,$a,$b)'"
  done
  G+=",drawtext=fontfile='$FONT':text='REPLAY x$REPLAY_X - real log $RUN_ID':x=w-text_w-24:y=1030:fontsize=30:fontcolor=yellow:enable='between(t,$REPLAY_FROM,$REPLAY_TO)'"
else
  echo "captions skipped: this ffmpeg has no drawtext filter (or CAPTIONS=skip); badge is a bare box" >&2
  G+=",drawbox=1560:1020:340:40:color=yellow@0.9:t=fill:enable='between(t,$REPLAY_FROM,$REPLAY_TO)'"
fi
G+="[vout];"

# ---- audio graph: inputs 2.. are narration, then sound cues -----------------------------
IN=(-i "$TERM_CLIP" -i "$CREW_CLIP")
A="" MIX="" n=2
for i in "${!SCENES[@]}"; do
  IN+=(-i "$NARR_DIR/${SCENES[$i]}.mp3")
  ms=$((${START[$i]} * 1000))
  A+="[$n:a]aresample=44100,aformat=channel_layouts=stereo,adelay=$ms|$ms[a$n];"; MIX+="[a$n]"; n=$((n + 1))
done
for c in "${CUES[@]}"; do
  read -r name at vol <<<"$c"
  IN+=(-i "$SOUNDS_DIR/$name.wav")
  ms=$(awk -v s="$at" 'BEGIN{printf "%d", s*1000}')
  A+="[$n:a]aresample=44100,aformat=channel_layouts=stereo,volume=$vol,adelay=$ms|$ms[a$n];"; MIX+="[a$n]"; n=$((n + 1))
done
A+="${MIX}amix=inputs=$((n - 2)):normalize=0:duration=longest[aout]"

mkdir -p "$(dirname "$OUT")"
ffmpeg -loglevel error -y "${IN[@]}" -filter_complex "$G$A" -map '[vout]' -map '[aout]' \
  -t "$DURATION" -r 25 -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -b:a 160k "$OUT"

# ---- gate: under 3:00 and 1920x1080 ----------------------------------------------------
LEN=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
SIZE=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$OUT")
echo "$OUT  ${LEN}s  $SIZE"
awk -v l="$LEN" 'BEGIN{exit !(l < 180)}' || { echo "FAIL: video is ${LEN}s, limit is under 180 s" >&2; exit 1; }
[ "$SIZE" = 1920x1080 ] || { echo "FAIL: size is $SIZE" >&2; exit 1; }
