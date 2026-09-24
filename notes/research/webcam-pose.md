# Research · Webcam pose tracking (the Simon Says judge)

*Written 2026-09-23. Code: `lab/static/pose.js`, test page `/static/pose-test-cam.html`, tests `lab/static/tests/pose-rules.test.mjs`.*

## What it is
**MediaPipe Pose** (Google) is a small neural network that looks at a video frame and returns
**33 points on the body**: nose, eyes, ears, mouth corners, shoulders, elbows, wrists, fingers (index,
pinky, thumb), hips, knees, ankles, heels and toes. Each point has an x/y position in the picture (0–1),
a rough depth, and a **visibility** score (how sure it is that point is actually in view).

We use the **lite** model (≈5.8 MB), pinned:
- Library: `@mediapipe/tasks-vision@1.0.1` from jsDelivr (+ its `/wasm` runtime, ≈11.8 MB)
- Model: `storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`

It runs in "video" mode on the GPU (falls back to CPU), roughly as fast as the webcam delivers frames.

## Privacy
Everything runs **inside the browser tab**. The video is never uploaded or saved; only the 33 numbers-per-
point stay in memory for the current frame. Chrome asks for camera permission the first time.

## How each command is judged
Shoulder width is used as the "ruler", so the same rules work whether you're near or far from the camera.
Left and right are **your own** left and right (MediaPipe labels anatomy), even though the video on screen
is mirrored like a selfie. A pose only counts once it has been **held for 300 ms**, so a passing flail
doesn't score.

| Command | Rule |
|---|---|
| Raise your right / left arm | That wrist is clearly above that shoulder (and not resting on the head) |
| Raise both arms | Both of the above |
| Flap your wings | Both wrists out wide (more than 1.2 shoulder-widths from the middle of the body), each on its own side, at about shoulder height |
| Touch your head | A hand (index fingertip, else wrist) above the eye line and close to the head |
| Cover your eyes | Both hands close to the eyes (the eyes themselves may be hidden, which is fine) |
| Crouch down | Your head has dropped well below where it was when you pressed **Calibrate** |

Points with visibility below 0.5 aren't trusted: e.g. a wrist out of frame can't count as "raised".

## Known limitations
- **Needs your upper body in frame** (head to hips). Too close to the camera and the shoulders/wrists vanish.
- **Crouch needs calibration** (stand normally, press Calibrate). Stepping towards/away from the camera
  after calibrating can fool it.
- **Lighting and clothing** matter: dark sleeves on a dark background lower visibility scores.
- **One person only** (we ask for a single pose); a second person in shot can confuse it.
- Borderline poses (arm half-raised) are deliberately *not* counted, so it errs on the side of "you didn't do it".
- Tested with synthetic landmarks (19 unit tests) and a headless fake-camera smoke run (model loads, first frame
  processed, no errors). **Not yet tested on a real person** — tune thresholds after Liz tries it.
