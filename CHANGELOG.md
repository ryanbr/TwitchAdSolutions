## Unreleased

## v59.0.0 (2026-04-16)

### New Features
- **Hide Twitch ad break / Turbo promo overlay** — detect and collapse ad break cards ("taking an ad break / stick around"), Turbo promo overlays, and stream display ads (SDA) during ad blocking. One-shot logging per overlay type to prevent console spam. Enabled via `localStorage.twitchAdSolutions_hideAdOverlay = 'true'` (vaft) (#68)
- **Latency-aware post-ad reload** — the health check that skips unnecessary reloads now measures `seekable.end - currentTime`. If the player is >7s behind live edge after an ad strip, proceed with reload to reset latency instead of leaving the viewer desynchronized. Guards against garbage `seekable` values (2^30 sentinel, NaN, Infinity) by treating unknown latency as "proceed with reload" (vaft) (#128, fixes #127)
- **Cache clean native m3u8 for all-stripped recovery** — snapshot the last clean playlist during non-ad polls (mirrors TTV-AB `LastCleanNativeM3U8`). When all segments are stripped, prefer the full-playlist snapshot over the thin per-segment recovery cache for richer recovery content (vaft + video-swap-new) (#125)
- **Sticky CSAI fast path** — once a break enters the CSAI fast path (all segments live), stay on it for the entire break. Adds early-reload trigger from within the sticky path when recovery cache is thin. Includes stale backup commit guard to prevent a cache-stale backup from being committed after a channel switch (vaft) (#124)

### Performance
- **Hoist stripAdSegments regexes** — move per-line regex compilation out of the hot loop. Regexes are now compiled once per `stripAdSegments` call instead of once per line (vaft + video-swap-new) (#122)
- **Throttle AdSegmentCache prune** — limit cache pruning to once per 60s instead of every `processM3U8` call. Add diagnostic log for cache size at prune time (vaft + video-swap-new) (#121)

### Bug Fixes
- **Accept v2 API variant URLs without `.m3u8` extension** — Twitch's v2 API returns raw CDN variant URLs that don't contain `.m3u8`, causing stream info sync and resolution lookup to skip them. Accept absolute URLs (containing `://`) alongside `.m3u8` URLs in all variant URL detection paths (vaft + video-swap-new) (#118)
- **Strip LL-HLS prefetch hints on first poll of ad break** — prefetch hints (`#EXT-X-TWITCH-PREFETCH`, `#EXT-X-PRELOAD-HINT`) were only stripped after the first ad-tagged poll. Now strip on the first poll where `hasAdTags` is true, preventing the player from pre-fetching ad content before the extension can block it (vaft + video-swap-new) (#119)
- **Drop bare `'stitched'` from ad signifier list** — bare `'stitched'` matched non-ad content (e.g. CDN hostnames containing "stitched"). Narrowed to `'stitched-ad'` only (vaft + video-swap-new) (#120)
- **Debounce "Player not found" warnings** — suppress `getPlayerAndState` warnings for the first 10s after page load to avoid false-positive console noise during normal player initialization (vaft) (#126)

### Refactoring
- **StreamInfo factory** — extract the inline StreamInfo object literal into a `createStreamInfo` factory function. All 41 fields (vaft) / 25 fields (video-swap-new) are now declared up-front with appropriate zero values, including 13 fields that were previously lazily assigned (vaft + video-swap-new) (#123)

## v58.0.2 (2026-04-13)

### Bug Fixes
- **Revert PR #89 — always cycle backup player types** — PR #89 committed the first ad-laden backup immediately on the assumption that Twitch serves ads across all player types simultaneously. In practice Twitch stages ads across types, and the premature commit fed an ad-laden m3u8 into the strip+recovery path, starving the buffer and causing 2+ minute freezes (regression identified via user bisect of `afd498c`). Restored cycling as the default; ad-laden backups are only committed as a last resort after `playerTypeIndex >= playerTypesToTry.length - 1`, i.e. the full player-type list has been walked (vaft) (#116, fixes #112)

## v58.0.1 (2026-04-11)

### Bug Fixes
- **Skip injection in nested frames** — Twitch's main channel page has 5+ hidden cross-origin iframes (auth, analytics, ad SDK, etc.) that uBO/Tampermonkey were injecting the script into, causing 4+ racing instances per page that fought for player control. Use `window.frameElement` (the canonical "am I in a nested iframe" check) to skip injection in nested frames, with an allow-list for the three documented Twitch embed contexts (`player.twitch.tv`, `embed.twitch.tv`, `/embed/...`) so third-party Twitch embeds still work (vaft + video-swap-new) (#109, #113)
- **Tampermonkey compatibility** — initial nested-frame check used `window !== window.top` which returned `true` even on the top frame in Tampermonkey (window proxy quirk), causing vaft to never load on Tampermonkey installs. Fixed by switching to `window.frameElement === null` (vaft + video-swap-new) (#113, fixes #112)
- **PR #96 misfiring on initial player init** — the loading-circle health check was firing repeatedly on fresh page load because `readyState=0` is normal during player initialization (not a real stall). Track a `hasHadData` flag that flips true once the player has had data at least once; PR #96 only fires after that. Eliminates the cascade of 4+ reloads observed during fresh-load prerolls (vaft) (#111)
- **Skip `'autoplay'` from `BackupPlayerTypes`** — when the cycle committed `autoplay` as a clean backup (after all other types were ad-laden), the player got stuck in an endless loading circle because autoplay's variant ladder is incompatible with main stream variants. Removed from the cycle list; falls through to the bounded ~10s freeze + early reload path instead (vaft) (#107)
- **All-backups-ad-laden log placement** — the diagnostic log was in a code block that required `fallbackM3u8` to be null, which never happened in practice. Moved to the actual last-resort commit site so it actually fires when all backup player types are ad-laden (vaft) (#108)
- **Tighten cycle-rescue end-of-break reload skip** — PR #98 was incorrectly skipping end-of-break reloads on natural recovery (same player type became clean) cases, leaving the player with low buffer and no recovery. Restricted the skip to only fire on real cycle switches (different player type) (vaft) (#101)
- **Strip ad-laden `#EXT-X-PART:` lines** — LL-HLS parts that contained known ad URLs were leaking through. Now stripped alongside `#EXTINF` segments (vaft + video-swap-new) (#105)
- **Strip `#EXT-X-PRELOAD-HINT`** during ad blocking — forward-compatibility for when Twitch transitions from `#EXT-X-TWITCH-PREFETCH` to the standard LL-HLS tag (vaft + video-swap-new) (#104)
- **video-swap-new ports** — CSAI fast path and `HasConfirmedAdAttrs` false-positive guard ported from vaft (#103)

### Diagnostic Logging
- Log when frame check skips injection: `[AD DEBUG] vaft skipped — nested frame on <host><path>` — helps diagnose "no vaft logs" reports (vaft + video-swap-new)

## v58.0.0 (2026-04-09)

### New Features
- **CSAI fast path** — when all m3u8 segments are live, skip backup stream search entirely. Eliminates the 20-40s rebuffer gap on pure-CSAI ad breaks (vaft + video-swap-new) (#90, #103)
- **Early reload on prolonged SSAI freeze + multi-ad pod support** — after ~10s of strip+recovery loop, trigger a player reload to break the freeze. Bounded to one reload per ad in the pod. Configurable via `localStorage.twitchAdSolutions_earlyReloadPollThreshold` (default 5, set 0 to disable) (vaft) (#94)
- **Loading-circle health check during ad break** — fires reload after ~3s of confirmed `readyState < 3 + paused/no-network` during ad strip. Catches visible player stalls faster than the poll-based early reload (vaft) (#96)
- **Cycle backup player types during freeze** — when first backup is ad-laden and we're already in a recovery freeze, iterate through other player types looking for clean. Avoids unnecessary reloads when an alternate backup is healthy (vaft) (#95)
- **Skip end-of-break reload on real cycle switch** — when cycle rescue actually switched to a different clean player type, skip the redundant end-of-break reload (vaft) (#98, #101)

### Bug Fixes
- **Cross-channel cooldown leak** — first end-of-break reload on a fresh channel session was being incorrectly blocked by cooldown left over from a previous channel's reload (or session-creation timestamp). Two fixes: clear `HasTriggeredPlayerReload` on new session, and don't unconditionally set `LastPlayerReload` on session creation (vaft) (#97, #102)
- **TotalAllStrippedPolls counter never incrementing** — counter was checking `IsStrippingAdSegments && !textStr.includes(',live')` after `stripAdSegments` had already injected recovery segments. Moved the increment into `stripAdSegments` (vaft)
- **CSAI-only breaks falsely flagged as false positives** — the "consecutive ad breaks with 0 segments stripped" warning was firing on real ads that we successfully avoided via clean backup. Added `HasConfirmedAdAttrs` guard checking for `X-TV-TWITCH-AD-AD-SESSION-ID` / `X-TV-TWITCH-AD-RADS-TOKEN` markers (vaft + video-swap-new) (#103)
- **Take first ad-laden backup as fast-exit** — when first backup also has ads, commit immediately instead of cycling all player types in the common case. Cycle behavior preserved for the freeze case via #95 (vaft) (#89)
- **Skip buffer monitor when player has no data loaded** — prevents buffer monitor from misfiring on partially-initialized players (vaft) (#92)

### Low-Latency HLS Hardening
- **Strip `#EXT-X-PRELOAD-HINT`** during ad blocking alongside the existing `#EXT-X-TWITCH-PREFETCH` removal — forward-compatibility for when Twitch transitions to the standard LL-HLS tag (vaft + video-swap-new) (#104)
- **Strip ad-laden `#EXT-X-PART:` lines** — LL-HLS parts that contain known ad URLs are now stripped alongside `#EXTINF` segments. Prevents ads from leaking via the low-latency parts path (vaft + video-swap-new) (#105)

### Debug Logging
- Pod length and expected duration on ad detection: `pod: N ad(s) (~Xs expected)` (vaft)
- Ad break wall-clock duration: `Finished blocking ads — stripped N segments, duration: Xs` (vaft)
- Wall-clock freeze duration in ad break stats — replaces misleading poll-count estimate (vaft)
- Distinguishes "cycle switched to different clean type" from "same type became clean — natural recovery" (vaft) (#99)
- Per-trigger early-reload count: `[1/2]` for pod-aware budget (vaft)
- New CSAI ad request detection log via XHR/fetch hook (vaft)

### Performance / Hygiene
- Player health guard before reload — skip reload when player is already playing fine (vaft)
- PiP-aware reload downgrade — use pause/play instead of setSrc when PiP active (vaft)

### Configurable via localStorage (new in this release)
- `twitchAdSolutions_earlyReloadPollThreshold` — number, default `5` (each poll ~2s, so 5 = ~10s before early reload fires); set `0` to disable

## v57.0.0 (2026-04-09)

### Player Stability
- Skip buffer monitor and position jump drift during ad breaks — prevents unnecessary pause/play and 1.1x speedup when backup stream buffer is thin (vaft)
- Add backup switch grace period to position jump drift detection — 10s window after ad-end suppresses false jumps from stream switch buffer gaps (vaft)
- Reset position tracking on ad-end — fixes race condition where position jump fires before the grace period message arrives from the worker (vaft)
- Fast-exit backup search on known CSAI-only channels — after 3+ consecutive zero-strip ad breaks, takes first backup immediately instead of cycling all player types (~50ms vs ~2min stall) (vaft)

### Debug Logging
- Log access token failure response body (first 200 chars) and integrity header status on 403 (all scripts)
- Log Usher (m3u8 encodings) HTTP failures (all scripts)

## v56.0.0 (2026-04-09)

### Bug Fixes
- Revert hasAdTags to Array.some() — the regex used shortened alternations that matched more broadly than the signifier array, causing false ad detections and empty signifier logs on subscribed channels (#82). Removes AdSignifierRegex entirely.

### Player Stability
- Downgrade reload to pause/play when in Picture-in-Picture mode — setSrc creates a new player instance which exits PiP. Now detects `document.pictureInPictureElement` and uses pause/play instead so PiP stays open throughout ad breaks (all scripts)

### Debug Logging
- Log video element state (readyState, networkState, buffered, currentTime, paused) before buffer monitor fix attempts — helps diagnose iOS video issues and over-aggressive interventions (vaft)

## v55.0.0 (2026-04-08)

### Performance
- Use regex for hasAdTags instead of Array.some() — 6.7x faster on clean playlists (vaft)

### Player Stability
- Set actual playing quality before reload to avoid ABR ramp from low resolution — Twitch starts at the right quality instead of ramping from 360p (all scripts)
- Fall back to unmodified worker if synchronous XHR fetch fails — prevents page reload loop on iOS Safari and other restricted environments (#78) (all scripts)
- Add getCleanWorker null guard — prevents TypeError from class extends null when Worker prototype chain is unexpected (video-swap-new, strip, vaft testing)

### Anti-Fingerprinting
- Mask hooked functions (fetch, revokeObjectURL, XHR.open, localStorage) as native via toString() override — prevents Twitch from detecting the script via function inspection (all scripts)

### Debug Logging
- Warn on 3+ consecutive zero-strip ad breaks — early detection of false positive ad signifiers (vaft, video-swap-new)
- Dedupe CSAI ad request logs to once per type per page load — reduces console spam from 40+ to 2 lines (all scripts)

## v54.0.0 (2026-04-08)

### Performance
- Declare all object properties upfront in playerBufferState and streamInfo for V8 hidden class stability (vaft)

### Hardening (video-swap-new)
- Port 14 features from vaft: parseAttributes null check, Object.create(null) dictionaries, 15s GQL timeout, stream info TTL cleanup, WASM worker JS cache, React fallback discovery, revokeObjectURL hook, version logging, worker rejection/intercept logging, GQL headers log, GQL response validation, fetch hook log, split(/\r?\n/) line parsing

## v53.0.0 (2026-04-08)

### Bug Fixes
- Remove bare `maf-ad` from ad signifiers — over-matched Twitch MAF metadata in non-ad playlists, causing false ad detections every 2-3 minutes (#69). The specific `EXT-X-DATERANGE:CLASS="twitch-maf-ad"` remains for actual MAF ad breaks. Affects vaft and video-swap-new.
- Extend backup switch grace period to cover ad-end transition — buffer monitor no longer triggers pause/play on the momentary micro-stall when switching back from backup to main stream
- Raise position jump drift threshold from 1.5s to 5s — small 2-3s jumps are Twitch's own playback-monitor repositioning, not genuine behind-live-edge scenarios

### Performance
- Replace `.sort()[0]` with O(n) linear scan for HEVC resolution matching — avoids mutating source array

### Debug Logging
- Log version on script load (`TwitchAdSolutions vaft v40 loading`)
- Improve conflict detection message with `[AD DEBUG]` prefix and actionable guidance

## v52.0.0 (2026-04-08)

### CSAI Handling
- Remove pause/play for CSAI-only ad breaks — stream was never interrupted, the unnecessary pause/play caused Twitch's player to seek back ~10s, repeat video, and trigger "video buffering" warnings
- Skip grace period for CSAI-only ad breaks — require only 1 clean playlist instead of 2 (no m3u8 metadata flicker risk when 0 segments were stripped), clears ad state ~2s faster
- Skip position jump drift correction during ad breaks — backup stream switching causes buffer gaps that the browser jumps across, falsely triggering drift correction at 1.1x

### Player Stability
- Guard against drift correction restart while already correcting — prevents perpetual 1.1x playback when repeated position jumps keep resetting the 30s safety timeout
- Make revokeObjectURL hook idempotent — prevents stacking multiple wrappers if hookWindowWorker is called more than once

## v51.0.0 (2026-04-07)

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

## v50.0.0 (2026-04-06)

### CSAI Cascade Fix
- Skip reload for CSAI-only ad breaks where 0 segments were stripped — eliminates the endless reload cascade on ad-heavy channels (no reload = no fresh token = Twitch can't insert another ad)

### Ad Recovery
- Add ad-end grace period: require 2+ consecutive clean playlists before declaring ads done (prevents premature ad-end detection from m3u8 metadata flicker)
- Auto-escalate reload cooldown: if 3+ reloads in 5 minutes, triple the cooldown (30s → 90s) to reduce pressure on heavy-ad channels
- Add 10s backup switch grace period (buffer monitor waits for backup stream to stabilize before attempting fixes)
- Only track actual reloads toward auto-escalation threshold (skipped reloads don't inflate count)

## v49.0.0 (2026-04-06)

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

## v48.0.0 (2026-04-06)

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

## v47.0.0 (2026-04-05)

### Player Stability
- Retry play() within 10s window after stuck pause/play cycle in buffer monitor (auto-recovers from player stuck paused after ad-state interference)
- Add reload cooldown to break CSAI cascades (skip reload if last reload was <30s ago and no backup stream was used)

### Configuration
- Add twitchAdSolutions_reloadCooldownSeconds localStorage option (default 30, 0 to disable)

### Debug Logging
- Dedupe 'Backup stream (X) also has ads' log to once per player type per ad break
- Dedupe 'React root node / player not found' logs to once per page load (silences m.twitch.tv console spam)

## v46.0.0 (2026-04-05)

### Ad Detection
- Add maf-ad ID signifier
- Add twitch-stream-source, twitch-trigger, twitch-maf-ad, twitch-ad-quartile DATERANGE class signifiers (adopted from uBO playlist replace rule)
- Generalize X-TV-TWITCH-AD-*-URL rewrite regex to catch all ad beacon attributes (quartile, impression, etc.)

### Bug Fixes
- Fix recovery segment injection to rewrite EXT-X-MEDIA-SEQUENCE header (prevents player from replaying seen content or rejecting stale segments)

### Debug Logging
- Detect and log CSAI (client-side ad insertion) requests via fetch, XHR
- Log ad tracking attribute names seen per stream (helps identify new beacon types)

## v45.0.0 (2026-04-03)

### Player Stability
- Add live drift correction after player reload (seeks to live edge if >2s behind)
- Add buffer fix escalation (3 consecutive failures → full player reload)
- Add readyState guard to prevent seeking during active rebuffers
- Detect 7TV extension and log compatibility warning

### Other
- Add known extension conflicts section to README
- Add GitHub issue template for bug reports
- Add unit tests (73 tests) with CI integration

## v44.0.0 (2026-04-03)

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

## v42.0.0 (2026-03-24)

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
