# Frame-timing fixtures

Tiny 16×16 clips (1.5–3 KB each) for `frameRate.test.ts`. `ffprobe.json` holds what ffprobe
reports for each one: `r_frame_rate`, the time base and the timestamp of every frame that
plays. The tests compare the parser against it, so regenerate it whenever a clip changes.

Made with ffmpeg 7.1, using `c="-c:v libx264 -preset ultrafast -pix_fmt yuv420p -an"`:

| File                   | What it covers                                                                      | Command                                                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ntsc-ts600.mov`       | 29.97 fps at QuickTime's 600 ticks/s (20/21 ticks per frame)                        | `ffmpeg -f lavfi -i color=c=gray:s=16x16:r=30000/1001:d=4 $c -video_track_timescale 600 ntsc-ts600.mov`                                                                                                                                                          |
| `slomo240-ts600.mov`   | 240 fps at 600 ticks/s (2/3 ticks per frame)                                        | `ffmpeg -f lavfi -i color=c=gray:s=16x16:r=240:d=0.2 $c -video_track_timescale 600 slomo240-ts600.mov`                                                                                                                                                           |
| `slomo240-preroll.mov` | iPhone-style slow motion: 22 frames at 30 fps hidden by the edit list, then 240 fps | `ffmpeg -f lavfi -i color=c=gray:s=16x16:r=240:d=0.35 -vf "settb=1/2400,setpts=if(lt(N\,22)\,N/30\,22/30+(N-22)/240)/TB" -fps_mode passthrough $c -g 1000 -video_track_timescale 2400 pre.mov`, then `ffmpeg -ss 0.7333 -i pre.mov -c copy slomo240-preroll.mov` |
| `vfr-dropped.mp4`      | 30 fps with three frames dropped                                                    | `ffmpeg -f lavfi -i color=c=gray:s=16x16:r=30:d=0.5 -vf "select=not(between(n\,5\,7))" -fps_mode passthrough $c vfr-dropped.mp4`                                                                                                                                 |
| `empty-edit.mp4`       | An empty edit that starts the video at 0.5 s                                        | `ffmpeg -itsoffset 0.5 -f lavfi -i color=c=gray:s=16x16:r=30:d=0.3 $c empty-edit.mp4`                                                                                                                                                                            |
| `bframes.mp4`          | B-frames: `ctts` reordering and an edit list hiding the decode delay                | `ffmpeg -f lavfi -i testsrc2=s=16x16:r=30:d=0.4 -c:v libx264 -preset medium -bf 3 -pix_fmt yuv420p -an bframes.mp4`                                                                                                                                              |
| `trim-mid-frame.mp4`   | An edit list that starts partway through a frame                                    | `ffmpeg -f lavfi -i color=c=gray:s=16x16:r=60:d=1 $c -g 600 c60.mp4`, then `ffmpeg -ss 0.51 -i c60.mp4 -c copy trim-mid-frame.mp4`                                                                                                                               |

`ffprobe.json` comes from `ffprobe -show_entries stream=r_frame_rate,time_base` and
`ffprobe -show_entries frame=best_effort_timestamp_time` on each file.
