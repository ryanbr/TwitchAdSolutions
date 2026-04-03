# TwitchAdSolutions

Fork of pixeltris/TwitchAdSolutions (archived). Remote `origin` = pixeltris, remote `master` = ryanbr.

## Worker Blob Serialization (CRITICAL)

Functions serialized via `.toString()` into the Web Worker blob CANNOT reference outer-scope variables. This includes: `processM3U8`, `stripAdSegments`, `hookWorkerFetch`, `getAccessToken`, `gqlRequest`, `hasAdTags`, `getMatchedAdSignifiers`, `getStreamUrlForResolution`, `parseAttributes`, `getServerTimeFromM3u8`, `replaceServerTimeInM3u8`.

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

Bump `@version` (userscript header) and `ourTwitchAdSolutionsVersion` together for functional changes. Current: vaft 43.0.0/30, video-swap-new 1.59/27, strip 1.3/20.

## localStorage Config

All read at init, injected into worker blob:
- `twitchAdSolutions_reloadPlayerAfterAd` — `true`/`false`, default `true`
- `twitchAdSolutions_playerType` — string, default `popout`
- `twitchAdSolutions_pinBackupPlayerType` — `true`/`false`, default `false`
- `twitchAdSolutions_hideAdOverlay` — `true` to hide banner, default not set

## Debug Logging

All logs use `[AD DEBUG]` prefix. Logs in `.toString()` functions must use `console.log` directly.

## Validation

`npx acorn --ecma2022 file.js` (skip line 1 for uBlock files: `tail -n +2 file.js | npx acorn --ecma2022`). GitHub Actions validates on push/PR.

## Testing

Testing files include experimental features (error recovery, grace period, pinned backup, segment recovery). Don't apply to main scripts without explicit request.
