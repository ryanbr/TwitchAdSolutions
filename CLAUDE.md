# TwitchAdSolutions

Fork of [pixeltris/TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions) (archived). Remote `origin` is pixeltris (upstream), remote `master` is ryanbr (this fork).

## Critical: Worker Blob Serialization

Functions serialized via `.toString()` into the Web Worker blob **cannot reference outer-scope variables**. This includes: `processM3U8`, `stripAdSegments`, `hookWorkerFetch`, `getAccessToken`, `gqlRequest`, `hasAdTags`, `getStreamUrlForResolution`, `parseAttributes`, `getServerTimeFromM3u8`, `replaceServerTimeInM3u8`.

- Variables must be declared inside `declareOptions()` (also serialized) or in the inline blob template literal
- To pass window-scope values to the worker, inject them after `declareOptions(self)` in the blob string: `ReloadPlayerAfterAd = ${ReloadPlayerAfterAd};`
- Hoisting constants or referencing new outer-scope variables from these functions will cause `ReferenceError` at runtime

## File Structure

Scripts that must stay in sync (same logic, different format):
- `vaft/vaft.user.js` + `vaft/vaft-ublock-origin.js` (main scripts)
- `vaft/vaft_testing.user.js` + `vaft/vaft-testing-ublock-origin.js` (testing scripts)
- `video-swap-new/video-swap-new.user.js` + `video-swap-new/video-swap-new-ublock-origin.js`
- `strip/strip.user.js` (standalone)

uBlock files have `twitch-videoad.js text/javascript` as line 1 (not valid JS, it's a uBlock resource header).

## Naming Differences

- vaft uses `ForceAccessTokenPlayerType`, `AdSignifier`, `AdSignifiers`, `ReloadPlayerAfterAd`
- video-swap-new uses `OPT_FORCE_ACCESS_TOKEN_PLAYER_TYPE`, `AD_SIGNIFIER`, `AD_SIGNIFIERS`, `ReloadPlayerAfterAd`
- strip uses `ForceAccessTokenPlayerType` (defaults to `'site'` not `'popout'`)

## Version Bumping

- `@version` in userscript header — bump for functional changes, not debug logging
- `ourTwitchAdSolutionsVersion` — bump when ad-blocking behavior changes (prevents conflicts between script versions)
- Both should be bumped together

## localStorage Config

All scripts read these at init (before worker creation):
- `twitchAdSolutions_reloadPlayerAfterAd` — `'true'`/`'false'`, default `true`
- `twitchAdSolutions_playerType` — player type string, default `'popout'`

Values must be injected into the worker blob after `declareOptions(self)`.

## Debug Logging

All debug logs use `[AD DEBUG]` prefix. Logs in `.toString()` serialized functions must use `console.log` directly (no outer-scope logger references).

## Testing

- Testing files (`vaft_testing`, `vaft-testing-ublock-origin`) include experimental features (error recovery, hasInitialToken skip)
- Don't apply testing-only features to main scripts without explicit request
- Validate JS syntax: `npx acorn --ecma2022 file.js` (skip line 1 for uBlock files)
