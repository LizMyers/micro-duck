# MediaPipe, served locally

The webcam referee (`lab/static/pose.js`) loads these from the lab's own server instead of a CDN,
so the game works with no internet once it's set up.

| File | Source |
| --- | --- |
| `vision_bundle.js` | `@mediapipe/tasks-vision@1.0.1`, `vision_bundle.mjs` (source-map line removed) |
| `wasm/vision_wasm_internal.js`, `.wasm` | `@mediapipe/tasks-vision@1.0.1`, `wasm/` (the SIMD build; Chrome supports it) |
| `pose_landmarker_lite.task` | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task |

MediaPipe is by Google, licensed under Apache 2.0.

To update: change `TASKS_VISION_VERSION` in `pose.js`, then `npm pack @mediapipe/tasks-vision@<version>`
and copy the files above.
