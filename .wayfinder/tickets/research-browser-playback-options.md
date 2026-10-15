---
title: Researching browser playback options for a shared live MP4 channel
status: closed
label: wayfinder:research
parent: ../map.md
---

## Question

What browser media-delivery approaches can a Windows-local server use to play a shared, silent MP4 channel in current Edge, Chrome, and Firefox browsers, including late viewers joining at the current position and automatic transitions through an alphabetical, looping playlist? Surface practical constraints around codec support, multiple simultaneous viewers, synchronization, and server restart/resume behavior that affect the MVP's delivery choice.


## Resolution

Prefer progressive, range-enabled HTTP delivery of H.264/AVC MP4 files through native `<video>`, with a persisted server-authoritative playlist clock/state. Late viewers load a current snapshot and seek to its position; clients decode independently and periodically reconcile drift. This is the least-complex fit for a fixed local folder; MSE/DASH/HLS or WebRTC add machinery not currently required. Codec availability (notably Windows N/KN) and autoplay remain client-dependent. See [Browser playback options](../research/browser-playback-options.md) for evidence, constraints, and alternatives.
