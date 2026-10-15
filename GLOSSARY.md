# waczak-tv

This context describes a locally hosted video channel watched through a browser.

## Language

**Channel**:
A single shared, continuously advancing sequence of videos that all viewers observe at the same live position.

**Host**:
The Windows PC running the local server and holding the configured media folder.

**Media folder**:
The single local folder whose MP4 files form the channel's playlist. The MVP takes a snapshot at server startup.

**Playlist**:
The ordered list of MP4 files played by the channel. The MVP orders files alphabetically by filename and loops to the beginning.

**Resume point**:
The saved playlist item and playback position restored when the server restarts.

**Viewer**:
A browser client that watches the shared channel without controlling its playback.
