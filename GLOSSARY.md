# Airtime

Airtime measures one athlete's jumps from video. The athlete marks the frames where their feet leave and touch the ground, and Airtime turns those marks into flight time, contact time and jump height.

## Language

### Sessions and marks

**Video**:
One specific video file. Trimming, compressing or re-exporting it produces a different video.

**Session**:
The marks, title, notes and jump type saved for one video. Each video has exactly one session.
_Avoid_: Clip, training session, recording

**Recorded date**:
When the video was filmed. It starts as the file's date and the athlete can correct it.

**Mark**:
A frame the athlete flags as a takeoff or a landing.

**Takeoff**:
A mark on the first frame where the feet have left the ground.

**Landing**:
A mark on the first frame where the feet touch the ground again.

**Unpaired mark**:
A mark that isn't part of any flight or contact, either because it is out of sequence or because it is alone.
_Avoid_: Stray mark

**Out of sequence**:
A mark next to another mark of the same type, such as two takeoffs in a row.

**Alone**:
Why a mark is unpaired when no mark comes before or after it, such as a single landing.

### Jumps

**Jump**:
A takeoff and the flight that follows it, plus the contact before it when there is one.
_Avoid_: Attempt, rep

**Incomplete jump**:
A jump whose takeoff has no landing after it yet.

**Flight**:
The time from a takeoff to the next landing.
_Avoid_: Air time, hang time

**Contact**:
The time from a landing to the next takeoff, while the feet are on the ground. It only means something for approach jumps, drop jumps and repeat hops.
_Avoid_: Ground time

**Jump height**:
How high the athlete rose, estimated from flight time on the assumption that they took off and landed in the same position.

**RSI**:
Reactive strength index: a jump's height divided by the contact before it. Only jumps with a contact have one, and it only means something for approach jumps, drop jumps and repeat hops.

**Jump type**:
What kind of jump a session holds: approach, drop jump or repeat hops. Sessions saved earlier may be countermovement or squat jumps, which are no longer offered. A session has one jump type, so later comparisons set like against like. A session saved before jump types existed has none until the athlete sets one.
_Avoid_: Drill, exercise

**Approach jump**:
A jump taken at the end of a run-up, as in volleyball or basketball. Its contact is the plant step: the last landing before takeoff. The default jump type for a new session.

**Drop jump**:
A jump that starts by stepping off a box, landing, and jumping again straight away.

**Repeat hops**:
Several jumps in a row, each aiming for as little ground contact as possible before the next. Stored as `rebound`.
_Avoid_: Rebound jump

**Countermovement jump**:
A jump that starts standing, dips down, then drives straight up. No longer offered.

**Squat jump**:
A jump that starts from a held squat, with no dip beforehand. No longer offered.

**Best jump**:
The jump with the greatest jump height in a session.

**Best height**:
The greatest jump height across several sessions.

### Time

**Media time**:
Time as the video file counts it.

**Real time**:
Time as it passed when the video was recorded. It equals media time unless the video is slow motion.

**Slow-motion factor**:
How many times slower than real time a video plays back (1×, 2×, 4× or 8×).
_Avoid_: Speed, time scale

**Playback speed**:
How fast the video plays while you review it. It is only a viewing aid and never changes any timing.
_Avoid_: Slow motion

**Frame rate**:
How many frames per second a video holds, either read from the file or measured during playback. A video whose frame rate can't be found can't be marked.
_Avoid_: Assumed frame rate, default frame rate

**Frame times**:
When each frame of a video is shown, read from the file. When a video has them, stepping, marks and timings follow them, so a video whose frames aren't evenly spaced (a **variable frame rate**, such as slow motion with dropped frames) is still stepped one real frame at a time. Videos without them (WebM) are treated as evenly spaced at the frame rate.

### Keeping data

**Save**:
Store a session in this browser.

**Export**:
A file containing one or more sessions, which can be read back in on any browser.

**Backup**:
An export of every saved session.

**Import**:
Read the sessions from an export into this browser.
_Avoid_: Restore
