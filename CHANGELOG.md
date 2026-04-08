## Unreleased

## v53.0.0

### Bug Fixes
- Remove bare `maf-ad` from ad signifiers — over-matched Twitch MAF metadata in non-ad playlists, causing false ad detections every 2-3 minutes (#69). The specific `EXT-X-DATERANGE:CLASS="twitch-maf-ad"` remains for actual MAF ad breaks. Affects vaft and video-swap-new.
- Extend backup switch grace period to cover ad-end transition — buffer monitor no longer triggers pause/play on the momentary micro-stall when switching back from backup to main stream
- Raise position jump drift threshold from 1.5s to 5s — small 2-3s jumps are Twitch's own playback-monitor repositioning, not genuine behind-live-edge scenarios

### Performance
- Replace `.sort()[0]` with O(n) linear scan for HEVC resolution matching — avoids mutating source array

### Debug Logging
- Log version on script load (`TwitchAdSolutions vaft v40 loading`)
- Improve conflict detection message with `[AD DEBUG]` prefix and actionable guidance

## v52.0.0

### CSAI Handling
- Remove pause/play for CSAI-only ad breaks — stream was never interrupted, the unnecessary pause/play caused Twitch's player to seek back ~10s, repeat video, and trigger "video buffering" warnings
- Skip grace period for CSAI-only ad breaks — require only 1 clean playlist instead of 2 (no m3u8 metadata flicker risk when 0 segments were stripped), clears ad state ~2s faster
- Skip position jump drift correction during ad breaks — backup stream switching causes buffer gaps that the browser jumps across, falsely triggering drift correction at 1.1x

### Player Stability
- Guard against drift correction restart while already correcting — prevents perpetual 1.1x playback when repeated position jumps keep resetting the 30s safety timeout
- Make revokeObjectURL hook idempotent — prevents stacking multiple wrappers if hookWindowWorker is called more than once

## v51.0.0

### Hardening
- Harden parseAttributes: null/empty guard + strip HLS tag prefix before parsing (fixes first key incorrectly prefixed with tag name)
- Prevent Twitch from revoking injected worker blob URL (hook URL.revokeObjectURL)
- Walk Worker prototype chain to remove conflicting overrides and re-insert compatible ones (e.g. TwitchNoSub)
- Add 15s timeout on GQL fetch requests from worker (prevents hung backup stream lookups)
- Cache WASM worker JS to avoid redundant synchronous fetches on worker re-creation

### Player Stability
- Fresh player lookup every buffer monitor tick (eliminates stale ref class entirely — no manual invalidation needed)
- React fallback discovery: structural match on getHTMLVideoElement/getBufferDuration/core.state when Twitch renames setPlayerActive/mediaPlayerInstance
- Player state fallback: TTV-AB's videoPlayerInstance.playerMode approach as third discovery path
- Seek past buffer gaps at ad transitions instead of stalling + drift correction to recover
- Trigger drift correction on position jumps >1.5s (native gap recovery by browser)
- Extract startDriftCorrection as shared function (used by post-reload, buffer gap seek, and position jump)

### Backup Stream
- Auto-pin source-quality backup types (embed/site/popout) without requiring PinBackupPlayerType flag
- Default PinBackupPlayerType to true

### Performance
- Use Object.create(null) for StreamInfos, StreamInfosByUrl, streamInfo.Urls dictionaries (avoids prototype chain lookups)
- Prune stale stream infos older than 30 minutes (prevents unbounded memory growth on long sessions)

### Ad Recovery
- Respect reload cooldown when segments were stripped (was force-reloading regardless of cooldown)

## v50.0.0

### CSAI Cascade Fix
- Skip reload for CSAI-only ad breaks where 0 segments were stripped — eliminates the endless reload cascade on ad-heavy channels (no reload = no fresh token = Twitch can't insert another ad)

### Ad Recovery
- Add ad-end grace period: require 2+ consecutive clean playlists before declaring ads done (prevents premature ad-end detection from m3u8 metadata flicker)
- Auto-escalate reload cooldown: if 3+ reloads in 5 minutes, triple the cooldown (30s → 90s) to reduce pressure on heavy-ad channels
- Add 10s backup switch grace period (buffer monitor waits for backup stream to stabilize before attempting fixes)
- Only track actual reloads toward auto-escalation threshold (skipped reloads don't inflate count)

## v49.0.0

### Bug Fixes
- Invalidate cached player reference on reload — root cause fix for black screen after ad-end reloads (stale ref read 242s buffer at position 0, causing false stall detection on wrong player instance)
- Fix stale 30s drift correction timeout not cleared when new correction starts (premature playbackRate reset on back-to-back reloads)

### Player Stability
- Add user pause intent tracking via video element events (distinguishes user-initiated pause from script/system pause, won't auto-resume user pauses)
- Smooth drift correction via gradual 1.1× playback rate instead of jarring instant seek
- Prevent duplicate monitorPlayerBuffering scheduling on tab return (pendingTick guard)

### Performance
- Cache isLiveSegment result per line in stripAdSegments hot loop (avoids repeated string scan)
- Initialize all streamInfo properties upfront (stabilizes V8 hidden class)

### Configuration
- Add twitchAdSolutions_driftCorrectionRate localStorage option (default 1.1, 0 to disable)

### Debug Logging
- Remove 'React root node not found' log (timing artifact on page load, not actionable)
- Add log when user pause intent is respected

## v48.0.0

### Player Stability
- Add one-reload-per-recovery cap to buffer monitor (prevents infinite reload loops during persistent stalls)
- Add 15s reload grace period after player reload (buffer monitor waits for Twitch's player to finish initializing before attempting fixes)
- Add visibility-aware poll backoff (3× slower polling when tab is hidden, PiP-aware, immediate tick on tab return)
- Reset buffer monitor state on channel change (fixAttempts, recoveryReloadUsed)

### Ad Recovery
- Force reload after ad break when real segments were stripped, even within cooldown window (ensures clean player state)
- FailedBackupPlayerTypes now expire after 15s allowing retry on transient failures (was permanent per ad break)

### Configuration
- Add twitchAdSolutions_disableReloadCap localStorage option (revert to unlimited reloads)
- Document twitchAdSolutions_pinBackupPlayerType quality caveat in README

## v47.0.0

### Player Stability
- Retry play() within 10s window after stuck pause/play cycle in buffer monitor (auto-recovers from player stuck paused after ad-state interference)
- Add reload cooldown to break CSAI cascades (skip reload if last reload was <30s ago and no backup stream was used)

### Configuration
- Add twitchAdSolutions_reloadCooldownSeconds localStorage option (default 30, 0 to disable)

### Debug Logging
- Dedupe 'Backup stream (X) also has ads' log to once per player type per ad break
- Dedupe 'React root node / player not found' logs to once per page load (silences m.twitch.tv console spam)

## v46.0.0

### Ad Detection
- Add maf-ad ID signifier
- Add twitch-stream-source, twitch-trigger, twitch-maf-ad, twitch-ad-quartile DATERANGE class signifiers (adopted from uBO playlist replace rule)
- Generalize X-TV-TWITCH-AD-*-URL rewrite regex to catch all ad beacon attributes (quartile, impression, etc.)

### Bug Fixes
- Fix recovery segment injection to rewrite EXT-X-MEDIA-SEQUENCE header (prevents player from replaying seen content or rejecting stale segments)

### Debug Logging
- Detect and log CSAI (client-side ad insertion) requests via fetch, XHR
- Log ad tracking attribute names seen per stream (helps identify new beacon types)

## v45.0.0

### Player Stability
- Add live drift correction after player reload (seeks to live edge if >2s behind)
- Add buffer fix escalation (3 consecutive failures → full player reload)
- Add readyState guard to prevent seeking during active rebuffers
- Detect 7TV extension and log compatibility warning

### Other
- Add known extension conflicts section to README
- Add GitHub issue template for bug reports
- Add unit tests (73 tests) with CI integration

## v44.0.0

### Ad Detection
- Add SCTE35-OUT signifier for alternative SCTE-35 marker detection
- Add ad segment URL pattern detection (/adsquared/, /_404/, /processing)
- Log matched ad signifiers when ads are detected
- Log SCTE-35 CUE-OUT/CUE-IN ad boundary transitions
- Detect and log unknown ad-related HLS tags

### Backup Stream
- Track failed backup player types and skip them during ad breaks
- Pin successful backup player type across ad breaks (opt-in via localStorage)
- Add mobile_web to backup player types
- Log backup stream search time in ms
- Show backup player type in ad blocking banner

### Ad Recovery
- Add segment recovery cache to prevent black screen when all segments are stripped

### Bug Fixes
- Rename .adblock-overlay to .tas-adblock-overlay to fix Twitch CSS conflict (#19)
- Remove unused legacy singular ad signifier variables
- Remove unused isChrome variable from vaft visibility handler

### Configuration
- Add pinBackupPlayerType localStorage option
- Add hideAdOverlay localStorage option to hide "Blocking ads" banner

### Compatibility
- Auto-resume video on tab return regardless of muted state

## v42.0.0

### Ad Detection
- Add SCTE-35 ad signifier detection and CUE-OUT/CUE-IN tracking
- Add multiple ad signifiers (stitched-ad, X-TV-TWITCH-AD, EXT-X-CUE-OUT, EXT-X-DATERANGE)

### Bug Fixes
- Fix Map.forEach parameter order in AdSegmentCache cleanup
- Fix null crash in getServerTimeFromM3u8
- Fix ad tracking URL replacement being silently discarded
- Add null guard for hidden getter in visibilityChange handler
- Add null-safety to regex match results with optional chaining

### Performance
- Cache blank MP4 blob instead of re-fetching data URI on every ad segment
- Cache #root and .video-player DOM element lookups
- Cache Date.now() outside forEach in stripAdSegments
- Replace new URL() with string parsing in monitorPlayerBuffering
- Use split(/\r?\n/) instead of replaceAll + split for line parsing

### Debug Logging
- Add [AD DEBUG] console logging for ad blocking diagnostics
- Add debug logging for detecting Twitch code changes (GQL, React, worker)
- Log stripped ad segment count when ad blocking finishes
- Log conflict string when isValidWorker rejects a worker

### Compatibility
- Wrap document.hasFocus override in try/catch for WebKit compatibility
- Remove Chrome-only restriction on tab focus auto-play resume
- Remove deprecated visibility API prefixes

### Testing
- Add vaft testing scripts with player error auto-recovery (#2000/#3000/#4000)

### Other
- Add ReloadPlayerAfterAd and ForceAccessTokenPlayerType config options with localStorage toggles
- Update userscript URLs and author fields to ryanbr repo
- Clear old worker references when creating new Twitch worker
- Clear RequestedAds set when ads finish
