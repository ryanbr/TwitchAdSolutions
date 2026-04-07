# TwitchAdSolutions

Fork of pixeltris/TwitchAdSolutions (archived). Remote `origin` = pixeltris, remote `master` = ryanbr.

## Worker Blob Serialization (CRITICAL)

Functions serialized via `.toString()` into the Web Worker blob CANNOT reference outer-scope variables. This includes: `processM3U8`, `stripAdSegments`, `hookWorkerFetch`, `getAccessToken`, `gqlRequest`, `hasAdTags`, `getMatchedAdSignifiers`, `getStreamUrlForResolution`, `parseAttributes`, `getServerTimeFromM3u8`, `replaceServerTimeInM3u8`, `pruneStreamInfos`, `getWasmWorkerJs`.

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

Bump `@version` (userscript header) and `ourTwitchAdSolutionsVersion` together for functional changes. Current: vaft 51.0.0/38, video-swap-new 1.65/33, strip 1.9/26.

## localStorage Config

All read at init, injected into worker blob:
- `twitchAdSolutions_reloadPlayerAfterAd` — `true`/`false`, default `true`
- `twitchAdSolutions_playerType` — string, default `popout`
- `twitchAdSolutions_pinBackupPlayerType` — `true`/`false`, default `false`
- `twitchAdSolutions_hideAdOverlay` — `true` to hide banner, default not set
- `twitchAdSolutions_reloadCooldownSeconds` — number, default `30` (0 to disable)
- `twitchAdSolutions_disableReloadCap` — `true` to revert to unlimited reloads
- `twitchAdSolutions_driftCorrectionRate` — number, default `1.1` (0 to disable)

## CSAI vs SSAI

- **SSAI** (Server-Side Ad Insertion) — ads embedded in m3u8 segments. Blockable by stripping.
- **CSAI** (Client-Side Ad Insertion) — ads delivered via `edge.ads.twitch.tv`, outside m3u8. Not blockable at m3u8 level. Detected via fetch/XHR hooks for logging only.
- When `hadStrippedSegments === false` (CSAI-only), skip reload entirely to prevent cascade.

## Key Architecture (vaft)

- **Buffer monitor** (`monitorPlayerBuffering`) — polls player state every 1-3s (visibility-aware). Detects stalls, fires pause/play or reload.
- **Reload cooldown** — 30s default, auto-escalates to 90s if 3+ reloads in 5 minutes.
- **Reload cap** — buffer monitor reloads at most once per recovery window (`recoveryReloadUsed`).
- **Grace periods** — 15s after reload, 10s after backup switch. Buffer monitor skips fixes during these.
- **Drift correction** — `startDriftCorrection(videoElement)` shared function. 1.1× playback rate, 30s safety timeout. Used by post-reload drift and buffer gap seek.
- **User pause intent** — tracks video pause/play events to distinguish user vs script pauses.
- **Stale player ref** — `playerForMonitoringBuffering = null` on reload to force re-acquisition.

## Debug Logging

All logs use `[AD DEBUG]` prefix. Logs in `.toString()` functions must use `console.log` directly. Some logs are deduped (once per ad break or once per page load) to prevent console spam.

## Validation

`npx acorn --ecma2022 file.js` (skip line 1 for uBlock files: `tail -n +2 file.js | npx acorn --ecma2022`). GitHub Actions validates on push/PR.

## Testing

Testing files include experimental features (error recovery, grace period, pinned backup, segment recovery, drift correction refactor). Don't apply to main scripts without explicit request. Testing-script-only changes commit directly to master; PRs are for release scripts.
