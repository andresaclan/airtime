# Airtime

Airtime measures one athlete's jumps from video. The athlete marks the frames where their feet leave and touch the ground, and Airtime turns those marks into flight time, contact time and jump height.

## Language

### Sessions and marks

**Session**:
The marks, title and notes saved for one video. Each video has exactly one session.
_Avoid_: Clip, training session, recording

**Mark**:
A frame the athlete flags as a takeoff or a landing.

**Takeoff**:
A mark on the first frame where the feet have left the ground.

**Landing**:
A mark on the first frame where the feet touch the ground again.

**Unpaired mark**:
A mark that isn't part of any flight or contact.
_Avoid_: Stray mark

**Out of sequence**:
Why a mark is unpaired when it has the same type as the mark before it, such as two takeoffs in a row.

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
The time from a landing to the next takeoff, while the feet are on the ground.
_Avoid_: Ground time

**Jump height**:
How high the athlete rose, estimated from flight time on the assumption that they took off and landed in the same position.

**RSI**:
Reactive strength index: a jump's height divided by the contact before it. Only jumps with a contact have one, and it only means something for rebound and drop jumps.

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

**Assumed frame rate**:
The 30 fps Airtime uses when it can neither read a video's frame rate from the file nor measure it during playback.
_Avoid_: Default frame rate, low trust
