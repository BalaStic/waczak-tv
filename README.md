# waczak-tv

A manually launched, Windows-hosted MP4 channel for browsers on the same PC. The server owns one alphabetical playlist clock; viewers join its current position and cannot control or advance the channel.

## Requirements

- Windows 10/11.
- Node.js 20 or later.
- FFmpeg's `ffprobe` available on `PATH`, or set `FFPROBE_PATH` to its full executable path.
- MP4 files with a readable video stream and usable duration. H.264/AVC is recommended for Edge, Chrome, and Firefox on Windows; AAC-LC is suitable when a file has audio. Browser/Windows codec support still varies.

## Configure and launch

1. Create `%LOCALAPPDATA%\waczak-tv\config.json`. For example:

   ```json
   {
     "mediaFolder": "C:\\Users\\you\\Videos\\MP4s"
   }
   ```

   `mediaFolder` may also be relative to the configuration file. `config.example.json` shows the required shape.
2. From this project folder, run:

   ```powershell
   npm start
   ```

3. Open the printed URL (normally `http://127.0.0.1:4173/`) in Edge, Chrome, or Firefox. Playback starts muted; use the volume control on the video to unmute or adjust it. If browser autoplay is blocked, select **Start playback**.

The configuration path can be overridden with `WACZAK_TV_CONFIG`; the port can be changed with `PORT`. The server always binds to `127.0.0.1`, never a LAN interface.

At launch, the server snapshots regular `.mp4` files in the configured folder, sorts names case-insensitively with a deterministic tie-break, and asks `ffprobe` to confirm a video stream and positive duration. Unusable files are reported by name and skipped. The server exits with a clear error if the folder is missing/unreadable or no playable file remains. Add or remove files by restarting the server.

## Playback and recovery

- Viewers load the same server-authoritative item and playhead. State is refreshed every two seconds; drift over 1.5 seconds is corrected locally. Browser stalls or decode errors affect only that viewer.
- MP4 delivery supports byte ranges for seeking and late joins. The server serves only IDs from its startup media snapshot and verifies that each requested file resolves directly inside the configured folder.
- Playback position is checkpointed atomically every five seconds and on item transitions to `%LOCALAPPDATA%\waczak-tv\checkpoint.json`. Downtime does not advance the saved position. If a saved file is no longer playable, the next alphabetical item is selected; malformed checkpoints are reported and ignored.
- Files are rechecked when they are scheduled and while they are current. If no playable file remains, the channel stops and reports the reason in the server console and viewer page.

To diagnose an unplayable file, try opening it in a current browser and inspect its codecs with:

```powershell
ffprobe -v error -show_streams -show_format "C:\path\to\video.mp4"
```

## Development

The project uses Node's built-in modules and test runner; there are no npm dependencies.

```powershell
npm test
```
