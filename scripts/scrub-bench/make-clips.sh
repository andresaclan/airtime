#!/usr/bin/env bash
# Test clips for the scrub bench: long-GOP H.264 1080p60, HEVC 4K60 and H.264 1080p240
# (slow motion), with noise so every frame differs. ~90 MB in all.
#
#   scripts/scrub-bench/make-clips.sh [dir]   (default /tmp/airtime-scrub)
set -euo pipefail
dir=${1:-/tmp/airtime-scrub}
mkdir -p "$dir"
cd "$dir"
q=(-hide_banner -loglevel error -y)
[ -f h264-1080p60.mp4 ] || ffmpeg "${q[@]}" -f lavfi -i "testsrc2=size=1920x1080:rate=60:duration=10" \
	-vf "noise=alls=8:allf=t" -c:v libx264 -profile:v high -g 60 -bf 2 -pix_fmt yuv420p -b:v 20M h264-1080p60.mp4
[ -f hevc-4k60.mp4 ] || ffmpeg "${q[@]}" -f lavfi -i "testsrc2=size=3840x2160:rate=60:duration=8" \
	-vf "noise=alls=8:allf=t" -c:v libx265 -preset ultrafast -x265-params keyint=60:log-level=error \
	-tag:v hvc1 -pix_fmt yuv420p -b:v 40M hevc-4k60.mp4
[ -f h264-1080p240.mp4 ] || ffmpeg "${q[@]}" -f lavfi -i "testsrc2=size=1920x1080:rate=240:duration=5" \
	-vf "noise=alls=8:allf=t" -c:v libx264 -g 240 -bf 2 -pix_fmt yuv420p -b:v 30M h264-1080p240.mp4
# Brightness encodes the frame number, for seek-truth.html.
[ -f framenum60.mp4 ] || ffmpeg "${q[@]}" -f lavfi -i "color=c=black:s=320x240:r=60:d=1,format=gray,geq=lum='16+N*3'" \
	-pix_fmt yuv420p -c:v libx264 -crf 2 -g 30 -bf 2 framenum60.mp4
ls -l "$dir"/*.mp4
