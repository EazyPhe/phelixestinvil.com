# Public M5Stack behavior demo

This is a portfolio interface over an unchanged snapshot of the M5Stack DJ Smart Hub TypeScript simulator model. The source snapshot is `76d2d7cb2827d4cbfa931678b851a061f60986a7`. `provenance.json` records every copied model file and its SHA-256. The build rejects modified vendor files.

The visitor UI, synthetic test-data generator, and presentation CSS are new. The model owns the two device states, queued peer commands/audio, looks, fixture profiles, blackout policy, and virtual DMX universe. The stage reads final RGB7 universe bytes, because the model intentionally retains cached fixture previews during blackout. Brain controls travel through the model's peer queue; Controller blackout is local and works while disconnected. Reconnecting does not replay commands missed while disconnected.

This demo is a behavior model, not the firmware's LVGL renderer or proof of radio, audio hardware, or physical DMX performance. No hardware bridge, microphone, file picker, network controls, storage, or private endpoints are included. Synthetic 120 BPM input is silent. The model contains sample power data internally; the interface does not expose that as measured telemetry.

## Build

The generated static files are checked in at `src/demos/m5stack/` so the website remains dependency-free at deploy time. The dependency lockfile comes from the simulator snapshot (including its test tooling). From this directory, `npm ci` then `npm run build` checks TypeScript and rebuilds the static bundle with relative asset URLs. No source maps are emitted. The build only clears its exact generated demo output directory.

For an existing compatible toolchain, set `M5_DEMO_TOOLCHAIN` to its `node_modules` directory and run `node build.mjs`. This avoids installing another copy of Vite 8.0.16 and TypeScript 6.0.3. The original firmware/simulator checkout is never modified or built by this export.

## Verification hooks

`#demo` exposes read-only `data-brain-master`, `data-controller-master`, `data-linked`, `data-blackout`, `data-dmx-zero`, `data-audio`, `data-paused`, `data-sim-time`, and output-role attributes. Controls use stable IDs `master`, `look`, `audio-toggle`, `link-toggle`, `blackout`, `motion-toggle`, and `reset`. All controls use native elements and keyboard behavior. Reduced-motion preferences pause continuous animation by default; controls still settle to static results.

The Content Security Policy prohibits connections and remote scripts. The static output contains only this page, local CSS, and a local JavaScript bundle. Root-site checks and browser interaction verification should accompany each rebuild.
