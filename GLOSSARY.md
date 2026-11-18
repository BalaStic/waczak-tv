# waczak-tv

This context describes a locally hosted video channel watched through a browser.

## Language

**Channel**:
A single shared, continuously advancing sequence of videos that all viewers observe at the same live position.

**Host**:
The Windows PC running the local server and holding the configured media folder.

**Media folder**:
One configured local folder whose MP4 and WebM files form a channel's playlist. The server takes a snapshot at startup.

**URL path**:
The single path segment that selects a configured media folder, such as `waczak-tv` in `/waczak-tv`.

**Playlist**:
The ordered list of MP4 and WebM files played by the channel. The playlist orders files alphabetically by filename and loops to the beginning.

**Resume point**:
The saved playlist item and playback position restored when the server restarts.

**Viewer**:
A browser client that watches the shared channel without controlling its playback.
