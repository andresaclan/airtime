"""Regenerate tiny, independently identifiable decoded-frame fixtures (ffmpeg required)."""

import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tests/frame-stepping/fixtures"
WIDTH, HEIGHT = 256, 144


def run(*args):
    return subprocess.check_output(args)


with tempfile.TemporaryDirectory(prefix="airtime-frame-fixtures-") as scratch:
    raw = Path(scratch) / "frames.rgb"
    with raw.open("wb") as file:
        for frame in range(96):
            # Eight index bits, then their inverse: invalid/blank images cannot be frame 0.
            bits = [(frame >> bit) & 1 for bit in range(8)]
            row = b"".join(bytes([235 if bit else 16]) * 3 * 16 for bit in bits + [1 - b for b in bits])
            file.write(row * HEIGHT)

    manifest = []
    cases = [
        ("cfr30.mp4", "30", 36, []),
        ("ntsc.mov", "30000/1001", 80, ["-video_track_timescale", "600"]),
        ("slomo240.mov", "240", 48, ["-video_track_timescale", "600"]),
        ("vfr.mp4", "30", 24, ["-vf", "select=not(between(n\\,5\\,7))", "-fps_mode", "passthrough"]),
        ("bframes.mp4", "30", 36, ["-bf", "3"]),
        ("preroll.mov", "240", 48, ["-vf", "settb=1/2400,setpts=if(lt(N\\,8)\\,N*80\\,640+(N-8)*10)", "-enc_time_base", "1:2400", "-fps_mode", "passthrough", "-video_track_timescale", "2400"]),
    ]
    for name, rate, count, extra in cases:
        output = OUTPUT / name
        # Limit input, rather than output: the VFR filter must retain dropped-frame IDs.
        source = Path(scratch) / "input.rgb"
        source.write_bytes(raw.read_bytes()[:count * WIDTH * HEIGHT * 3])
        run("ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
            "-video_size", f"{WIDTH}x{HEIGHT}", "-framerate", rate, "-i", str(source),
            "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-pix_fmt", "yuv420p",
            "-g", "96", "-bf", "0", *extra, "-an", str(output))
        manifest.append({"file": name})

    # A transformed PTS can leave the last packet without a duration. Give that
    # sample its full 1/240 s, so the oracle never promises a zero-length frame.
    preroll = Path(scratch) / "preroll.mov"
    run("ffmpeg", "-v", "error", "-y", "-i", str(OUTPUT / "preroll.mov"), "-c", "copy",
        "-bsf:v", "setts=duration=10", "-video_track_timescale", "2400", str(preroll))
    (OUTPUT / "preroll.mov").write_bytes(preroll.read_bytes())

    # What an iPhone records by default: HEVC tagged hvc1 (Safari won't play hev1),
    # B-frames, in a QuickTime file on a 600 ticks/s timescale.
    source = Path(scratch) / "input.rgb"
    source.write_bytes(raw.read_bytes()[:60 * WIDTH * HEIGHT * 3])
    run("ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
        "-video_size", f"{WIDTH}x{HEIGHT}", "-framerate", "60", "-i", str(source),
        "-c:v", "libx265", "-preset", "medium", "-crf", "10", "-pix_fmt", "yuv420p",
        "-x265-params", "log-level=error:keyint=60:bframes=3", "-tag:v", "hvc1",
        "-video_track_timescale", "600", "-an", str(OUTPUT / "hevc.mov"))
    manifest.append({"file": "hevc.mov"})

    # How an iPhone stores portrait video: landscape-coded frames and a -90° display
    # matrix, so players show 144x256. The bands run across the coded rows so that,
    # once rotated for display, they read left to right like every other fixture.
    rotated = Path(scratch) / "rotated.rgb"
    with rotated.open("wb") as file:
        for frame in range(36):
            bits = [(frame >> bit) & 1 for bit in range(8)]
            stripes = bits + [1 - b for b in bits]
            # Displayed column x is coded row HEIGHT - 1 - x after a clockwise turn.
            file.write(b"".join(
                bytes([235 if stripes[(HEIGHT - 1 - row) * 16 // HEIGHT] else 16]) * 3 * WIDTH
                for row in range(HEIGHT)))
    coded = Path(scratch) / "coded.mov"
    run("ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
        "-video_size", f"{WIDTH}x{HEIGHT}", "-framerate", "30", "-i", str(rotated),
        "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-pix_fmt", "yuv420p",
        "-g", "96", "-bf", "0", "-video_track_timescale", "600", "-an", str(coded))
    run("ffmpeg", "-v", "error", "-y", "-display_rotation:v:0", "-90", "-i", str(coded),
        "-c", "copy", "-video_track_timescale", "600", str(OUTPUT / "portrait.mov"))
    manifest.append({"file": "portrait.mov"})

    # Trim inside a frame without re-encoding: an edit list and decode-only pre-roll.
    output = OUTPUT / "trim.mp4"
    run("ffmpeg", "-v", "error", "-y", "-ss", "0.51", "-i", str(OUTPUT / "cfr30.mp4"),
        "-c", "copy", str(output))
    manifest.append({"file": "trim.mp4"})

    for case in manifest:
        path = OUTPUT / case["file"]
        probe = json.loads(run("ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(path)))
        case["times"] = [float(frame["best_effort_timestamp_time"]) for frame in probe["frames"]]
        # Decode again with ffmpeg, independently of Airtime's parser and browser decoder.
        # ffmpeg applies the display matrix first; scaling every picture to the coded
        # fixture size keeps one sampling grid for portrait and landscape alike.
        pixels = run("ffmpeg", "-v", "error", "-i", str(path), "-fps_mode", "passthrough",
            "-vf", f"scale={WIDTH}:{HEIGHT}:flags=neighbor",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-")
        ids = []
        size = WIDTH * HEIGHT * 3
        for start in range(0, len(pixels), size):
            bits = [pixels[start + (bit * 16 + 8) * 3] > 128 for bit in range(16)]
            assert all(bits[bit] != bits[bit + 8] for bit in range(8))
            ids.append(sum(int(bits[bit]) << bit for bit in range(8)))
        assert len(ids) == len(case["times"]), case
        case["ids"] = ids
        # AVFoundation keeps the partial edit offset; Chromium and ffmpeg shift it.
        # The source is 30 fps at 15360 ticks/s; ffmpeg rounds the edit to a tick.
        case["webkitOffset"] = ids[0] / 30 - round(0.51 * 15360) / 15360 if case["file"] == "trim.mp4" else 0

    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
