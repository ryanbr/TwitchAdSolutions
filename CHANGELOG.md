## Unreleased

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
