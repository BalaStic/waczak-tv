---
title: Building a locally hosted TV-style MP4 stream
status: open
label: wayfinder:spec
parent: ../map.md
---

# Building a locally hosted TV-style MP4 stream

## Source and goal

This specification expands [map issue #1](https://github.com/BalaStic/waczak-tv/issues/1) into an implementation target for a runnable MVP. The app is a manually launched Windows webapp that serves one shared, silent channel from a configured local MP4 folder. Multiple viewers on the host PC watch the same server-authoritative playlist position in current desktop versions of Edge, Chrome, and Firefox.

Use the terms in [GLOSSARY.md](../../GLOSSARY.md). Browser and media constraints are summarized in the [playback research report](https://github.com/BalaStic/waczak-tv/blob/d3b0452/.wayfinder/research/browser-playback-options.md).

## Scope

### In scope

- Windows host, manually launched by the host.
- One configured local folder, read as a playlist snapshot at server startup.
- Alphabetical, endless playback of playable MP4 files.
- Same-host browser viewers joining the current channel position.
- Best-effort synchronization, with the server as the authority for schedule and position.
- Resume after server restart, with a user-local checkpoint.
- Clear startup, media, and persistence diagnostics.
- Current desktop Edge, Chrome, and Firefox on Windows.

### Out of scope

- Non-Windows hosts or access from other devices/LAN.
- Uploading, editing, or managing the library in the web UI.
- Viewer pause, seek, playlist controls, or audible playback.
- Automatic startup with Windows or a desktop-shell application.
- Frame-accurate synchronization, adaptive bitrate streaming, HLS/DASH, or WebRTC.

## Product decisions

- Deliver each source file progressively over HTTP using byte ranges and a native HTML `<video>` element.
- Keep one authoritative playlist schedule and playhead on the server. Viewers load a snapshot and independently decode the current file; periodically reconcile meaningful drift. Synchronization is best-effort, not frame-locked.
- Prefer H.264/AVC video in MP4; if an audio track is present, AAC-LC is the compatibility target. The UI always mutes playback. Codec support remains dependent on the browser and Windows media components.
- The host selects the one media folder in a configuration file.
- Persist the exact playlist filename and playback position in seconds as JSON under `%LOCALAPPDATA%\waczak-tv`, separate from the media folder and configuration.
- A viewer's local decode or playback failure must not advance or skip the shared channel.
- If no usable playlist item remains at startup or during runtime, stop with a clear error.

Decision records: [playback architecture (#3)](https://github.com/BalaStic/waczak-tv/issues/3), [folder configuration (#4)](https://github.com/BalaStic/waczak-tv/issues/4), [resume behavior (#5)](https://github.com/BalaStic/waczak-tv/issues/5), and [runtime exhaustion (#6)](https://github.com/BalaStic/waczak-tv/issues/6).

## Functional requirements

### Startup and library

**FR-1 — Configuration.** On manual launch, read the configured media-folder path from a configuration file. If the configuration is missing, malformed, points to a missing folder, or cannot be read, report an actionable startup error and do not start the channel.

**FR-2 — Playlist snapshot.** Enumerate the folder's MP4 files at startup and order them alphabetically by filename. The playlist is a snapshot: changes to folder membership are not incorporated until the server restarts.

**FR-3 — Media preflight.** Determine a usable duration for each candidate before using it to calculate the shared schedule or late-join position. Do not infer playability from the `.mp4` extension alone. Mark media that is missing, malformed, has no usable duration, or fails the server's media checks as unavailable; report the filename and reason, then continue with the next candidate.

**FR-4 — Empty playlist.** If startup finds no playable items after preflight, fail startup with a clear error. Do not leave a server running that appears to be playing a channel.

### Channel schedule and viewers

**FR-5 — Continuous channel.** Maintain one server-authoritative current item and position. Advance through playable items in alphabetical order, then wrap to the first item and continue indefinitely. Item transitions are scheduled from known media durations, not triggered by an individual viewer's `ended` event.

**FR-6 — Late join.** On connection, give each viewer the current item and its position from the authoritative schedule. The viewer loads that MP4, waits until metadata is available, seeks to the supplied position, and begins playback when permitted.

**FR-7 — Drift correction.** Provide periodic authoritative state updates and correct meaningful client drift without treating local browser playback events as channel state. A stalled or delayed viewer may temporarily differ from the channel; other viewers and the server schedule continue unaffected.

**FR-8 — Client playback failures.** Start the video muted. If browser autoplay is rejected, show a clear user-gesture action to start playback. Show client-specific load, decode, and playback errors to that viewer. Never advance the shared schedule solely because one viewer reports an error.

### Media delivery and local access

**FR-9 — HTTP media delivery.** Serve the application, channel state, and MP4 media from the same local HTTP origin. Media responses must support byte ranges correctly, including `206 Partial Content` and `Content-Range` for valid range requests, so browser seeks and late joins do not require downloading each file from byte zero.

**FR-10 — Loopback-only server.** Bind the server only to loopback addresses. Do not expose the application or media folder to LAN interfaces. Serve only files selected from the configured media folder; a media request must not allow access to arbitrary host files.

### Bad media and runtime exhaustion

**FR-11 — Skip server-detected bad media.** If the server determines that a scheduled file is no longer available or usable, report it and continue at the next playable alphabetical item, wrapping at most once to find a candidate.

**FR-12 — Runtime exhaustion.** If no playable candidate remains, stop the channel and report a clear error. Do not silently loop, wait indefinitely, or present a successful/playing state.

### Restart and checkpoint

**FR-13 — Checkpoint writes.** Store the current filename and position in seconds in a JSON checkpoint under `%LOCALAPPDATA%\waczak-tv`. Write atomically, about every five seconds and on item changes. If a write fails, report the failure, continue playback, and retry later; resume is not guaranteed until a checkpoint succeeds.

**FR-14 — Restore behavior.**

- A missing checkpoint is a normal first run: start the first playable item at position zero.
- A valid checkpoint restores the saved item and position; downtime does not advance the saved position.
- If the saved filename is missing or unusable, or its saved position is at or beyond its current duration, select the next playable item in alphabetical order, wrapping at most once, and start it at zero.
- If the checkpoint is malformed or invalid, warn, ignore it, and start the first playable item at zero.
- If restore leaves no usable item, stop with the clear error required by FR-12.

## Acceptance criteria

1. With a valid configured folder containing multiple playable files, launch the server manually and load the channel from the host PC in Edge, Chrome, and Firefox.
2. Confirm the viewer receives alphabetically ordered playback, including wraparound, with video muted.
3. Join a second viewer mid-file and confirm it seeks to the server's current item and approximate position without changing the first viewer's schedule.
4. Verify a valid byte-range request returns the requested bytes with correct range headers, and verify a browser can seek into a large MP4.
5. Confirm a server-detected bad file is reported and skipped; confirm one viewer's unsupported codec or playback failure does not skip for other viewers.
6. Confirm autoplay rejection presents a user-gesture start action and a per-viewer error is visible when playback cannot proceed.
7. Restart with a valid checkpoint and confirm the saved item and position are restored. Also verify missing, malformed, stale, and out-of-range checkpoints follow FR-14.
8. Confirm missing/unreadable configuration and an empty or entirely unplayable folder produce clear startup errors.
9. Remove or invalidate all remaining playable media during runtime; confirm the channel stops with a clear error.
10. Confirm the listener is loopback-only and media URLs cannot read files outside the configured library.

## Open implementation decisions

- Configuration filename, location, format, key name, and how a host discovers or edits it.
- Server runtime/framework, launch command, browser entry URL, and fixed-versus-ephemeral port behavior.
- Media probing mechanism and the exact validation policy for codec/profile, duration, and partially corrupt files. Preserve browser-specific playback errors: server preflight cannot guarantee every client's decoder will succeed.
- Deterministic filename collation details, including case handling and ties.
- Drift-correction interval, threshold, and measurable synchronization tolerance; viewer count and load-test target.
- Exact representation of the server clock/state endpoint and client reconnection behavior.
- User-visible/host diagnostic surfaces, graceful shutdown behavior, and log retention.

These choices should be resolved during implementation without changing the product decisions above. In particular, do not let one client's delayed events or decoder capabilities control the shared playlist.
