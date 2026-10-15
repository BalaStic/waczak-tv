# Building a locally hosted TV-style MP4 stream

## Destination

Deliver a working Windows-only webapp, manually launched on the host PC, that serves a silent, shared-live, view-only channel to multiple viewers on current major desktop browsers. It reads one configured local folder at startup, plays MP4s alphabetically in an endless loop, lets late viewers join the current position, resumes after restart, skips and reports bad media, and fails startup clearly if no playable files exist.

## Notes

- This map carries the work through implementation of the runnable MVP, not just an implementation-ready specification.
- Read [GLOSSARY.md](../GLOSSARY.md) for domain terms.
- Consult `research` for browser and media-delivery facts; use `grilling` and `domain-modeling` for open decisions.

## Decisions so far

- [Browser playback options](research/browser-playback-options.md): Use range-served MP4 plus a server-owned persisted playlist clock; give late viewers a snapshot and reconcile client drift.

## Not yet specified

- Additional runtime and operational constraints that become clear after the delivery architecture is chosen, such as graceful shutdown and diagnostics.

## Out of scope

- Non-Windows hosts.
- Access from other devices or over the LAN.
- Uploading or managing the media library through the web page.
- Viewer pause, seek, or playlist controls.
- Audible playback.
- Automatic startup with Windows or a desktop-shell application.
