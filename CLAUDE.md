# TwitchAdSolutions

Fork of pixeltris/TwitchAdSolutions (archived). Remote `origin` = pixeltris, remote `master` = ryanbr.

## Worker Blob Serialization (CRITICAL)

Functions serialized via `.toString()` into the Web Worker blob CANNOT reference outer-scope variables. This includes: `processM3U8`, `stripAdSegments`, `hookWorkerFetch`, `getAccessToken`, `gqlRequest`, `hasAdTags`, `getMatchedAdSignifiers`, `getStreamUrlForResolution`, `parseAttributes`, `getServerTimeFromM3u8`, `replaceServerTimeInM3u8`, `pruneStreamInfos`, `createStreamInfo`, `getWasmWorkerJs`.

- Declare variables in `declareOptions()` (also serialized) or in the inline blob template literal
- To pass window-scope values to the worker, inject after `declareOptions(self)`: e.g. `ReloadPlayerAfterAd = ${ReloadPlayerAfterAd};`
- Regex hoisting or referencing outer-scope variables from these functions causes `ReferenceError`

## Files

Synced pairs (same logic, different format):
- `vaft/vaft.user.js` + `vaft/vaft-ublock-origin.js`
- `vaft/vaft_testing.user.js` + `vaft/vaft-testing-ublock-origin.js`
- `video-swap-new/video-swap-new.user.js` + `video-swap-new/video-swap-new-ublock-origin.js`
- `video-swap-new/video-swap-new-ublock-origin-testing.js` (testing only)
- `strip/strip.user.js` (standalone)

uBlock files have `twitch-videoad.js text/javascript` as line 1 (not valid JS — uBlock resource header).

## Naming Differences

| | vaft | video-swap-new | strip |
|---|---|---|---|
| Signifiers | `AdSignifiers` | `AD_SIGNIFIERS` | N/A |
| URL patterns | `AdSegmentURLPatterns` | `AD_SEGMENT_URL_PATTERNS` | N/A |
| Player type | `ForceAccessTokenPlayerType` | `OPT_FORCE_ACCESS_TOKEN_PLAYER_TYPE` | `ForceAccessTokenPlayerType` (default `site`) |
| Reload after ad | `ReloadPlayerAfterAd` | `ReloadPlayerAfterAd` | `ReloadPlayerAfterAds` |

## Versions

Bump `@version` (userscript header) and `ourTwitchAdSolutionsVersion` together for functional changes. Current: vaft 60.2.0/52, video-swap-new 1.74/42, strip 1.9/26. Testing: vaft 606.0.0/606, video-swap-new 606/606.

## localStorage Config

All read at init, injected into worker blob:
- `twitchAdSolutions_reloadPlayerAfterAd` — `true`/`false`, default `true`
- `twitchAdSolutions_playerType` — string, default `popout`
- `twitchAdSolutions_pinBackupPlayerType` — `true`/`false`, default `false` (vaft default `true`)
- `twitchAdSolutions_hideAdOverlay` — `true` to hide the internal `.tas-adblock-overlay` banner (SDA wrapper hide always runs), default not set
- `twitchAdSolutions_reloadCooldownSeconds` — number, default `30` (0 to disable)
- `twitchAdSolutions_disableReloadCap` — `true` to revert to unlimited reloads
- `twitchAdSolutions_driftCorrectionRate` — number, default `1.1` (0 to disable)
- `twitchAdSolutions_earlyReloadPollThreshold` — number, default `5` (0 to disable; thin cache overrides to 1)

## CSAI vs SSAI

- **SSAI** (Server-Side Ad Insertion) — ads embedded in m3u8 segments. Blockable by stripping.
- **CSAI** (Client-Side Ad Insertion) — ads delivered via `edge.ads.twitch.tv`, outside m3u8. Not blockable at m3u8 level. Detected via fetch/XHR hooks for logging only.
- When `hadStrippedSegments === false` (CSAI-only), skip reload entirely to prevent cascade.

## Key Architecture (vaft)

- **Buffer monitor** (`monitorPlayerBuffering`) — polls player state every 1-3s (visibility-aware). Detects stalls, fires pause/play or reload.
- **Reload cooldown** — 30s default, auto-escalates to 90s if 3+ reloads in 5 minutes.
- **Reload cap** — buffer monitor reloads at most once per recovery window (`recoveryReloadUsed`).
- **Grace periods** — 15s after reload, 10s after backup switch. Buffer monitor skips fixes during these.
- **Drift correction** — `startDriftCorrection(videoElement)` shared function. 1.1× playback rate, 30s safety timeout. Restarts fresh on re-entry (clears stale timers). Used by post-reload drift and buffer gap seek.
- **Reload routing** — worker → main `ReloadPlayer` messages carry a `kind` field. `doTwitchPlayerTask(isPausePlay, isReload, reloadKind)` picks `setSrc` params: `kind === 'early'` → hard reload (`isNewMediaPlayerInstance: true, refreshAccessToken: true`, new session); otherwise soft reload. Early reload sites (both sticky + normal paths) AND post-ad reload sites send `kind: 'early'` to force hard reload. HEVC force reload stays soft (codec change, no strip involved). Hard reload flushes the MediaSource buffer — required after strip activity (BLANK_MP4 injection, recovery replay) to avoid audio/video desync from accumulated timestamp drift.
- **Early reload** — fires during prolonged all-stripped freeze. Threshold: 5 polls (~10s), or 1 poll when recovery cache <3 segments (thin-cache fast path). Budget: `max(1, PodLength)` or `max(2, PodLength)` when thin. `EarlyReloadTriggered` resets on "still ads" (both sticky + normal paths) to allow budget-based re-fire.
- **Sticky CSAI fast path** — once a break enters CSAI fast path (all segments live), stays on it for the whole break. Has its own early-reload trigger + `EarlyReloadAwaitingResult` check (normal-path check unreachable due to early return).
- **Latency-aware reload health check** — measures `seekable.end - currentTime` before skipping post-ad reload. If >7s behind live or seekable unavailable/garbage, proceeds with reload. Guards against 2^30 sentinel values via `Number.isFinite` + 3600s cap.
- **User pause intent** — tracks video pause/play events to distinguish user vs script pauses. `weJustPaused` only resets when player wasn't paused (guards against clearing intent during stall recovery).
- **Stale player ref** — `playerForMonitoringBuffering = null` on reload to force re-acquisition.
- **StreamInfo factory** — `createStreamInfo()` declares all fields up-front (41 fields vaft, 25 fields video-swap-new). Serialized into worker blob.

## Debug Logging

All logs use `[AD DEBUG]` prefix. Logs in `.toString()` functions must use `console.log` directly. Some logs are deduped (once per ad break or once per page load) to prevent console spam.

## Validation

`npx acorn --ecma2022 file.js` (skip line 1 for uBlock files: `tail -n +2 file.js | npx acorn --ecma2022`). GitHub Actions validates on push/PR.

## Testing

Testing files include experimental features (ad completion spoofing, lower thresholds, removed pruneStreamInfos). Don't apply to main scripts without explicit request. Testing-script-only changes commit directly to master; PRs are for release scripts.

## Backup Player Types

- **vaft**: `embed`, `site`, `popout`, `mobile_web` (autoplay removed — gets stuck in loading circle on transition back)
- **video-swap-new**: `embed`, `popout`, `mobile_web` (autoplay + picture-by-picture removed)

## Ad Overlay Hiding

`hideTwitchAdOverlays()` hides one overlay type during ad blocking:
- **Stream display ads (SDA)** — via exact `[data-test-selector="sda-wrapper"]` selector, no parent walking

Called on every buffer monitor tick. Guards via `dataset.tasHidden` to skip already-hidden elements.

**Previously removed:**
- Turbo promo / "allow ads" overlay hide (PR #143) — used `.player-overlay-background` which is Twitch's generic modal scrim (also used for content gates, error dialogs, subscription warnings). Too broad to use safely.
- Ad-break-card text match (PR #141) — scanned `span/p/h1/h2/h3` text for "taking an ad break" phrases then walked up via fuzzy `[class*="overlay"]` + `parentElement` fallback. Could hide player controls on false matches. TTV-AB doesn't attempt this either.

Only keep overlay hides that use exact attribute selectors with no parent walking.
