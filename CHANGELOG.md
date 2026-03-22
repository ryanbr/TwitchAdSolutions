## Changes since pixeltris (upstream)

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
- Update userscript URLs and author fields to ryanbr repo
- Clear old worker references when creating new Twitch worker
- Clear RequestedAds set when ads finish
