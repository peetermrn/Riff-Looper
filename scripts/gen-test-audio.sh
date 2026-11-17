#!/usr/bin/env bash
# Generates test audio files with ffmpeg into ./test-audio (git-ignored).
#
#   click120.*  40 s click track at 120 BPM. First beat at 0.250 s, 4/4 with
#               accented (louder, higher) downbeats. Used for metronome-sync and
#               loop-tightness tests.  Encoded in every supported format.
#   tone440.wav 10 s pure 440 Hz sine. Used to check pitch is preserved when slowed.
#   groove100.m4a  20 s little bass + drums groove at 100 BPM, handy for trying the
#               app by ear (first beat at 0.0 s).
#
# Usage: bash scripts/gen-test-audio.sh   (or: npm run gen-test-audio)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=test-audio
mkdir -p "$OUT"
FF="ffmpeg -hide_banner -loglevel error -y"

# --- click track ------------------------------------------------------------
# Beats every 0.5 s starting at 0.25 s. Beat n (0,1,2,...) is a downbeat when n mod 4 == 0:
# downbeats are a louder 1500 Hz blip, other beats a 1000 Hz blip, each decaying in ~10 ms.
EXPR="if(gte(t\,0.25)\, if(eq(mod(floor((t-0.25)/0.5)\,4)\,0)\, 0.9*sin(2*PI*1500*t)\, 0.6*sin(2*PI*1000*t)) * exp(-mod(t-0.25\,0.5)*300)\, 0)"
$FF -f lavfi -i "aevalsrc=${EXPR}|${EXPR}:s=44100:d=40" -c:a pcm_s16le "$OUT/click120.wav"

$FF -i "$OUT/click120.wav" -c:a aac -b:a 192k "$OUT/click120.m4a"
$FF -i "$OUT/click120.wav" -c:a aac -b:a 192k -f adts "$OUT/click120.aac"
$FF -i "$OUT/click120.wav" -c:a libmp3lame -b:a 192k "$OUT/click120.mp3"
$FF -i "$OUT/click120.wav" -c:a libvorbis -q:a 5 "$OUT/click120.ogg"
$FF -i "$OUT/click120.wav" -c:a flac "$OUT/click120.flac"

# --- pure tone (pitch check) ---------------------------------------------------
$FF -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=10" -ac 2 -c:a pcm_s16le "$OUT/tone440.wav"

# --- a small groove to listen to ------------------------------------------------
# kick on every beat (0.6 s), hi-hat noise on 8th notes, bass notes A1/C2/D2/E2 per bar.
KICK="0.8*sin(2*PI*55*t*(1+2*exp(-mod(t\,0.6)*40)))*exp(-mod(t\,0.6)*12)"
HAT="0.15*(random(0)*2-1)*exp(-mod(t\,0.3)*80)"
BASSF="if(lt(mod(t\,9.6)\,2.4)\,55\,if(lt(mod(t\,9.6)\,4.8)\,65.41\,if(lt(mod(t\,9.6)\,7.2)\,73.42\,82.41)))"
BASS="0.35*sin(2*PI*${BASSF}*t)*(0.6+0.4*exp(-mod(t\,0.6)*6))"
G="${KICK}+${HAT}+${BASS}"
$FF -f lavfi -i "aevalsrc=${G}|${G}:s=44100:d=20" -c:a aac -b:a 192k "$OUT/groove100.m4a"

ls -la "$OUT"
