## Unreleased

## v68.3.0 (2026-05-18)

### Performance
- **Backup-retry cooldown cut 15s → 5s** — the `FailedBackupPlayerTypes` lockout (`if (failedAt && (Date.now() - failedAt) < 15000)`) kept the backup search off a contaminated player type for 15s. In the universal CSAI-flip reality a type can become clean again within seconds, so the 15s lockout left the search avoiding a now-recovered type far longer than warranted, prolonging ad-break stalling. Reduced to 5s, porting the GosuDRM/TTV-AB v8.0.0 "reduced ad-induced stalling" tuning (`_getBackupPlayerRetryCooldownMs` 15000→5000) to vaft's equivalent lockout. **Deliberate latency/load tradeoff:** a 5s cooldown means an ad-laden type is retried ~3× more often → more token/m3u8 fetches → more pressure on the `ConsecutiveTokenFetchFailures` detection/rate-limit tripwire. Shipped *with* the cold/warm token-fetch instrumentation (v68.2.0 / #228) specifically so the added cold-fetch load is visible in field logs and the tradeoff can be tuned or reverted against data. vaft-only mechanism (video-swap-new has no equivalent) (#NN)

## v68.1.0 (2026-05-18)

### Performance
- **Ad-completion spoof deferred off the playlist critical path** — `notifyAdComplete` ran synchronously inside the worker's m3u8 processing on every ad-laden poll. Its `matchAll` over the playlist + per-ad `parseAttributes` loop + 6× `JSON.stringify` delayed returning the modified m3u8 to the player, manifesting as ad-break stutter. Now wrapped in `setTimeout(…, 0)` so the playlist is returned immediately and the spoof runs next tick — the GQL beacons aren't time-critical so the one-tick delay is irrelevant to Twitch. Ported back from the GosuDRM/TTV-AB v8.0.0 field finding (their commit `68fad6c`, "defer ad spoofing beacons to next tick to prevent player stutter") on the same spoof code TwitchAdSolutions contributed upstream. `notifyAdComplete`'s own internal try/catch is unchanged (vaft) (#NN)

## v68.0.0 (2026-05-17)

### Detection Evasion
- **Ad-completion spoofing: full multi-ad pod coverage** — follow-up to the spoofing lift below. The spoof previously fired once at break-start, but Twitch only discloses each ad's `#EXT-X-DATERANGE` when that ad starts playing — so a 6-ad pod surfaced one ad per m3u8 poll and only ad #1 ever got spoofed (`1/6` observed in field logs on peach / hadi_ow). `notifyAdComplete` now runs on every ad-laden poll (not just the break-start transition) and dedups via a new per-streamInfo `SpoofedAdIds` set, so each ad in the pod is spoofed exactly once as its DATERANGE appears — full N/N coverage. `total_ads` now derived from the `X-TV-TWITCH-AD-POD-LENGTH` attribute (true pod size) instead of the per-poll visible-match count. `SpoofedAdIds` cleared at break end. `video_ad_pod_complete` now fires **once per pod** (attached to the ad that completes the true pod size) instead of per-ad — a real player sends one pod_complete; emitting it 6× for a 6-ad pod would itself be a fingerprint, and if the pod never fully surfaces it is correctly never sent. Log reports cumulative progress plus debug context: `Spoofed ad completion for N new ad(s) (M/POD pod) — roll: midroll, src: <primary|backup-player-type>, pod-complete: <yes|no>` — `src` surfaces the stream-swap ad-ID-mixing limitation (a pod spoofed across primary+backup shows src changing mid-pod); `pod-complete` confirms the single pod_complete fired explicitly instead of inferring it from the M/POD ratio. Hot-path optimised since `notifyAdComplete` now runs every ad-laden poll (~hundreds per long multi-ad break): early-return once the dedup set covers the pod (skips the per-match parse loop on every post-completion poll), and a cheap `^ID="..."` pre-extract gates the dedup check before the full `parseAttributes()` so already-spoofed ads aren't re-parsed each poll. Failure-mode + response-status surveillance unchanged (vaft) (#225)
- **Ad completion spoofing lifted from testing → release** — when an ad break is detected, vaft now fires the GQL ad-tracking beacons (`video_ad_impression`, `video_ad_quartile_complete` × 4, `video_ad_pod_complete`) that Twitch's player would have sent if the ad had played normally. Spoof completes the ad-tracking signal Twitch expects, mimicking a "normal viewer" session. RADS-token extracted from the stitched-ad DATERANGE line. Per-pod, fires once per ad break at detection. Failures swallowed (never blocks normal ad-block flow). Default on; set `twitchAdSolutions_disableAdSpoofing=true` to opt out (for A/B testing whether spoofing affects ad break duration or detection behavior). Has been running in testing scripts for months without issues (vaft) (#223)

### Behavior Changes
- **`FastAutoplayFirstTry` now default-on** — previously opt-in via `twitchAdSolutions_fastAutoplayFirstTry=true`. Field surveillance from 2026-05 (memory: `project_all_channels_csai_only_marked`) confirmed every observed channel ends every ad break with `stripped 0` — Twitch migrated to CSAI delivery while keeping SSAI markers, so the "real SSAI" channel class where Source-tier backups occasionally succeed appears to no longer exist. With Source-tier exhaustion on every break, the full probe loop wastes ~1.5-2s of buffering on every break before committing to autoplay 360p via the escape hatch — `FastAutoplayFirstTry` skips that loop when the prior break already exhausted Source-tier. Auto-reset semantics unchanged: if Twitch ever brings back non-ad-laden Source backups and one wins, `LastBreakUsedEscapeHatch` clears and the next break runs the full probe again. Set `twitchAdSolutions_fastAutoplayFirstTry=false` to force the legacy full-probe path on every break (vaft) (#222)

### Robustness
- **Fast-autoplay periodic re-probe** — companion to the default-on flip above. Once a channel hits fast-autoplay, vaft would otherwise never re-test Source-tier for the rest of the session — if Twitch ever reverses universal CSAI delivery mid-session, the user would stay on 360p until they switched channels or refreshed. New `FastAutoplayConsecutive` counter increments on each fast-autoplay win (autoplay committed without testing Source-tier). After 5 consecutive wins, the next break forces a full Source-tier probe to detect channel recovery. If Source-tier still all ad-laden → autoplay wins as last-resort, `LastBreakUsedEscapeHatch` re-asserts, counter resets, fast-autoplay resumes. If Source-tier wins → flag clears, normal iteration resumes. Costs ~1.5-2s of probe-loop once every ~5 breaks (~25-50min interval at typical break density). Logs `[AD DEBUG] Fast-autoplay re-probe — testing Source-tier after N consecutive fast-autoplay breaks (channel-recovery check)` when it fires (vaft) (#222)

## v67.0.0 (2026-05-14)

### Bug Fixes
- **Worker early-reload state wedged after main-thread healthy-skip** — when the main thread skipped a reload because the player was healthy (`Skipping reload — player healthy (readyState=..., playing, latency=...s)` path), it returned silently without notifying the worker. The worker's `EarlyReloadTriggered` / `EarlyReloadAwaitingResult` flags stayed set, blocking subsequent early-reload firings in the same break even if a later poll legitimately called for one. Now sends `postTwitchWorkerMessage('ReloadSkipped')` before returning; worker-side handler clears the flags on receipt and decrements `EarlyReloadCount` so budget is preserved. Mirrors the testing variant's behavior. Logs `[AD DEBUG] Reload skipped by main thread (player healthy) — early reload state cleared, can retry` when the worker clears (vaft) (#NN)

### Diagnostics
- **Hard reload backstop SKIPPED log** — when the 5500ms backstop sees the element still muted but `userPauseIntent` is set, it silently no-ops to preserve user mute intent. Previously this branch produced no log, making it indistinguishable from "backstop never armed" in field traces. Now logs `[AD DEBUG] Hard reload backstop SKIPPED — element muted at 5500ms but userPauseIntent set (likely false-positive pause event during MSE teardown — issue #200 follow-up)` so future stuck-mute reports can be diagnosed conclusively (vaft) (#NN)
- **Backstop unmute fired log includes initial-mute state** — `Hard reload backstop unmute fired — element was still muted at 5500ms` now annotated with `(initial: unmuted, we pre-muted)` vs `(initial: already-muted on entry — recovering from silent Twitch re-mute)` to immediately distinguish the standard pre-mute path from the issue #200 recovery path in logs (vaft) (#NN)

## v66.2.0 (2026-05-14)

### Detection Improvements
- **Offline / channel-ended m3u8 shape detector** — log once per stream when the m3u8 transitions to a final shape (`#EXT-X-ENDLIST` present, no `#EXTINF:` segments). Distinguishes natural broadcast end from possible Twitch detection responses where the access token suddenly returns no segments. Helps disambiguate "is the stream really over?" from "did Twitch revoke our session mid-watch?" in field logs (vaft + video-swap-new) (#209)
- **Consecutive token-fetch failure tracker** — count consecutive failures across the backup player-type fetch loop (HTTP non-200, GQL response missing `streamPlaybackAccessToken`, exception during fetch). When the streak reaches 3+ — meaning none of the configured player types produced a usable Usher m3u8 in a single backup-search cycle — log once with the count. Resets to zero on the next Usher 200. Captures the signal for detection / integrity-rotation / rate-limiting events that previously only surfaced as generic "Found ads, switch to backup" timing anomalies or a silent fallthrough into autoplay (vaft + video-swap-new) (#209)

### Robustness
- **5s timeout on worker → main GQL fetch path** — `handleWorkerFetchRequest` (main-thread bridge for worker GQL requests: `getAccessToken` PlaybackAccessToken queries + ad-spoof beacons) previously had no explicit timeout, relying on the browser's default ~30s. If Twitch's GQL endpoint hangs, the worker's backup-search loop blocks on a single iteration for the full ~30s, manifesting as multi-second player freezes during ad breaks. `AbortController` with 5s timeout: well above normal Twitch GQL response (<1s typical) but bounds the worst-case wait. `AbortError` flows through the existing catch path → returns to the worker as a fetch error → `FailedBackupPlayerTypes` 15s lockout naturally kicks in, backup search continues to next type. Logs `'GQL fetch timeout (5s)'` to disambiguate from generic fetch failures (vaft + video-swap-new) (#217)

### Bug Fixes
- **Recover from silent Twitch re-mute across hard reloads (issue #200)** — field-confirmed via Tgod1991's v637 testing log: after vaft successfully unmutes a hard reload, Twitch can silently re-mute the element between ad breaks (after the existing 5500ms backstop window has expired). Previously, the pre-mute block's `if (v && !v.muted)` guard skipped setup entirely when the element was already muted, leaving AFK users with persistently-muted streams. New `vaftEverUnmuted` session flag tracks whether vaft has ever unmuted this session; combined with `RecoverFromSilentMute=true` default, the pre-mute / restore / backstop pipeline now also engages when `v.muted=true` *and* vaftEverUnmuted is true — strong signal of Twitch's silent re-mute pattern rather than user-initiated mute. First-session-mute users have vaftEverUnmuted=false → backstop never engages → mute respected. `weJustPaused` is set before `setSrc` so the pause-listener filters out the MSE-teardown pause event Twitch dispatches on the old `<video>` (without this, `userPauseIntent` could falsely flip to true during the reload, blocking the backstop's unmute). Disable via `twitchAdSolutions_recoverFromSilentMute=false` for users who deliberately mute mid-session (vaft) (#219)

## v66.1.0 (2026-05-09)

### Bug Fixes
- **Buffer-stall trigger cascading on thin-but-functional buffer at live edge** — field log on v66.0.0 captured a 4-fire cascade of `Attempt to fix buffering` on a heavy SSAI-uniform / autoplay-360p watch session. All four fires had `bufferDuration` legitimately under the 1s `PlayerBufferingDangerZone` (0.866 / 0.798 / 0.924 / 0.290) — PR #199's AND check was correctly identifying real momentary stalls (positionFrozen + thin buffer), but the pause/play "fix" interacts destructively with Twitch's playback-monitor: after the pause/play, Twitch responds with `Play - moving to buffered region 0.04xxx`, snapping the player back to near-zero on the new buffered region. Each cycle's currentTime ends up *lower* than the previous (`17.2 → 15.6 → 13.1 → 7.6` across 4 fires in 38s). Lowered `PlayerBufferingDangerZone` from 1 → 0.5 to restrict firing to truly-drained buffer (<0.5s) where pause/play recovery is unambiguously beneficial. The 0.5-1s "thin but functional" range now self-recovers without our intervention. Three of the four cascade fires above would now be skipped; the remaining 0.290 fire is a single intervention with no follow-up cascade (vaft) (#208)

## v66.0.0 (2026-05-09)

### Bug Fixes
- **Pre-mute restore on hard reload still left users muted on Edge** — followup to PR #201 in v65.4.0. Field reports on issue [#200](https://github.com/ryanbr/TwitchAdSolutions/issues/200) confirmed the regression was *reduced* but not eliminated: Edge's MSE init occasionally exceeded the 2500ms safety net, OR Twitch's own LS-restore at ~3000ms re-muted after our successful canplay-driven unmute. Three-layer fix: (1) listen for `loadeddata` and `playing` alongside `canplay` — Edge dispatches these independently, first-fired wins via the existing idempotent `done` guard; (2) safety setTimeout bumped 2500ms → 4000ms; (3) (vaft only) backstop force-unmute at 5500ms — if the element is *still* muted at that point AND `playerBufferState.userPauseIntent` isn't set, force one more unmute (idempotent, preserves user-mute intent). Logs `[AD DEBUG] Hard reload backstop unmute fired — element was still muted at 5500ms` when the backstop path engages, so future failures can be diagnosed conclusively (vaft + video-swap-new) (#206)

### Detection Improvements
- **`EXT-X-DATERANGE:CLASS="twitch-trigger"` recognized as ad signifier** — the "Potential ad markers seen but not in AdSignifiers" diagnostic logged this DATERANGE class consistently across multiple SSAI-uniform channels (`mande`, `nicewigg`, `thatmartinkidtv`, `fifakillvizualz`, `warn`, `slvm`, `imnio`, `timthetatman`) for several weeks of organic surveillance. Always observed in ad-detected polls, never seen outside an active ad break. Adding it to `AdSignifiers` lets `hasAdTags()` recognize ad m3u8s on the first poll, eliminating a previously-observed false-recovery loop on these channels (site appeared clean on poll 1 because recognized markers hadn't materialized yet, then dirty on poll 2 — the FastAutoplayFirstTry hybrid recovery path was firing falsely as a result). Sibling DATERANGE classes (`twitch-session`, `twitch-stream-source`) are session/source metadata and remain in the candidates list as non-ad markers (vaft + video-swap-new) (#207)

### Robustness
- **Worker prototype manipulation per-link try-catch** — `getCleanWorker()` and `reinsertWorkers()` walk the `Worker` prototype chain calling `Object.setPrototypeOf()` on each link. If a foreign extension or page script has frozen `Worker.prototype` or made `[[Prototype]]` non-configurable, those calls throw `TypeError`, propagate up out of `hookWindowWorker`, and ad blocking silently fails for the session. Per-link try-catch lets the chain walk continue past a single foreign-frozen link instead of aborting entirely. Mirrors TTV-AB v7.0.1's "Worker Hook Crash Resilience" fix (vaft + video-swap-new) (#203)
- **Worker `eval(workerString)` crash guard** — inside the worker blob, `eval(workerString)` executes Twitch's fetched player logic. If the workerString is malformed (Twitch ships a blob format change, network corruption returns partial JS), the throw goes uncaught inside the worker — fires an `error` event but doesn't kill the worker per HTML spec, so vaft's hooks stay alive but Twitch's logic never runs, producing weird init issues with no diagnostic. Wrap the eval in try-catch with `console.error('[AD DEBUG] Worker eval failed — Twitch player logic not loaded:', e)` so the failure mode surfaces. Mirrors TTV-AB v6.8.0's "Worker eval Crash Guard" fix (vaft + video-swap-new) (#204)

## v65.4.0 (2026-05-08)

### Bug Fixes
- **Pre-mute restore listener targeting wrong `<video>` element** — PR #189 (v64.1.0) added a pre-mute through hard reload to hide the MSE-teardown audio click, with the unmute restore wired via `v.addEventListener('canplay', restore, { once: true })` on the current `<video>` element and a 1500ms safety setTimeout backstop. But `setSrc({ isNewMediaPlayerInstance: true })` tears down MSE and Twitch creates a NEW `<video>` element — the canplay listener was on the now-detached original, so the event fired on the new element with no listener attached. Only the safety setTimeout restored unmute, which on slower MSE init (Edge especially) could land before the new element was attached/decoded, leaving the player muted until manually toggled. Field-reported on [#200](https://github.com/ryanbr/TwitchAdSolutions/issues/200) — Edge user on heavy SSAI-uniform channels (`fifakillvizualz`, `imnio`) reported "self-mute every few minutes" as every post-escape hard reload triggered the bug, requiring "unmute and mute and unmute" to recover audio (the classic Twitch-after-setSrc audio-state desync). Listen on `document` (capture phase) so the `canplay` event from any `<video>` element triggers the restore, plus an idempotent guard preventing the safety setTimeout from re-applying unmute if the listener already fired. Safety net bumped 1500ms → 2500ms for Edge/MSE-init slack (vaft + video-swap-new) (#201)

## v65.3.0 (2026-05-03)

### New Features
- **`FastAutoplayFirstTry` (opt-in) — skip Source-tier probe loop on SSAI-uniform channels** — on channels like warn / emongg / mande / slvm where every midroll break ends the same way (all 4 Source-tier types contaminated, autoplay 360p committed via `PreferLowQualityBackup` escape hatch), the probe loop spends ~1.5-2s every break confirming what the prior break already proved. New `streamInfo.LastBreakUsedEscapeHatch` signal: set when a break commits autoplay via the escape hatch with all 4 Source types contaminated, cleared as soon as a Source-tier type wins again. When `FastAutoplayFirstTry=true` and `LastBreakUsedEscapeHatch=true`, the next break's iteration prepends `autoplay` to position 0 of `playerTypesToTry`, trying it first. If autoplay is contaminated this break too, iteration falls through to Source-tier as normal — no behavior change. Self-healing: one break of "wrong choice" is the worst case, then the signal clears. Default off; enable via `localStorage.setItem('twitchAdSolutions_fastAutoplayFirstTry', 'true')`. Addresses [#197](https://github.com/ryanbr/TwitchAdSolutions/issues/197) (vaft) (#198)

### Bug Fixes
- **Buffer-stall detector firing on healthy thin-buffer breathing** — the trigger was `(positionFrozen || bufferDuration < PlayerBufferingDangerZone)`, so a healthy livestream at the live edge with ~1-2s of buffered headroom would fire whenever `state.position` and `video.currentTime` happened to be equal across two consecutive polls (typically a brief ~1s segment-fetch idle). Field log on Firefox 150 showed three consecutive false fires (`bufferDuration` 1.10 / 1.71 / 2.13 — all above the 1s `DangerZone`), each running `pause/play`, which knocked the player back to `readyState=1` / `currentTime=0` / `paused=true` — at which point the trigger then escalated to a real reload, the post-reload thin-buffer state matched again, and the cycle repeated as user-visible 6-8s pauses. Tightened the trigger to AND: real stalls (frozen position AND draining buffer) still fire on the same poll cadence, but healthy thin-buffer feeds where `bufferDuration` stays at or above `DangerZone` no longer trip the detector (vaft) (#199)
- **FFZ video-element-recreate cascading into buffer-stall escalation** — FrankerFaceZ's audio compressor wraps `player.load()` and creates a fresh `<video>` element on every load (`src/sites/shared/player.jsx` `replaceVideoElement`); Twitch's own playback-monitor then snaps the new element to `"buffered region 0.04xxx"` while the buffer rebuilds. During that brief ramp-up window `state.position` and `video.currentTime` plateau together — exactly the `positionFrozen` shape — and `playerBufferState`'s previous-element snapshots still match across polls. Track the `<video>` element identity each tick and clear `numSame`/`fixAttempts`/`recoveryReloadUsed` whenever the element reference changes, so a video-element swap is treated like a fresh reload regardless of whether we initiated it. Generalizes to any non-VAFT video swap (FFZ now, future userscripts later) (vaft) (#199)
- **Orphaned worker blob URLs leaking on every worker replacement** — each time Twitch creates a new Web Worker (channel switch, player reload), `hookWindowWorker` produced a fresh blob via `URL.createObjectURL` and overwrote `injectedBlobUrl` without revoking the previous URL. Twitch's own `revokeObjectURL` ignores our blobs (we mask their entry from its bookkeeping), so each unrevoked blob (~100KB) sat in browser memory until page unload — a multi-hour channel-hopping session could retain 1-5 MB of orphaned blobs. Captured `originalRevokeObjectURL` is now promoted to module scope so the Worker constructor can revoke the prior blob via the original (un-masked) function before creating the new one (vaft + video-swap-new) (#139)

## v65.2.0 (2026-05-02)

### Changed
- **`EarlyReloadPollThreshold` default lowered 5 → 3** — release now matches the testing variant. The threshold gates how many consecutive all-stripped polls (each ~2s) must elapse before firing an early reload during heavy SSAI freezes. Previously `5` (~10s stuck), now `3` (~6s stuck). Field reports indicated testing felt smoother on SSAI-uniform channels (warn / emongg / mande / dafran) where every break exhausts the Source-tier backup search; this brings release in line. Existing safeguards (1-reload-per-recovery cap, 30s cooldown auto-escalating to 90s on 3+ rapid reloads, recent buffer-stall false-positive fixes) bound the downside of more aggressive triggering. Override via `localStorage.setItem('twitchAdSolutions_earlyReloadPollThreshold', '5')` to restore the old default (vaft) (#196)

## v65.1.0 (2026-05-02)

### Bug Fixes
- **Buffer-stall detector reload cascade in post-MSE-init state** — followup to v65.0.0's fix. The previous condition required both `state.position` and `video.currentTime` to be frozen before declaring stalled, but post-reload MSE init has both genuinely frozen at 0 (`currentTime=0` because nothing's decoded yet, `state.position=0` because the player just torn down, `paused=true` because the element isn't trying to advance, `readyState<2` because no current data is available). The detector counted these as same-state polls, escalated to another reload, the new MSE init produced the same 0/0/paused state, and the trigger fired again — reload loop. Added a top-level skip when `videoEl.readyState < 2 || videoEl.paused` — holds counters (neither increments nor resets) so a real stall sequence interrupted by a brief init dip resumes counting on the next active poll. Also catches the IVS-player-wrapper-vs-`<video>`.paused race during reload teardown / autoplay-policy mute toggles (vaft) (#195)

## v65.0.0 (2026-05-02)

### Bug Fixes
- **Buffer-stall detector misfiring every 8s on healthy playback** — the stall trigger compared `playerBufferState.position == position` where `position = player.core.state.position`. Twitch updates `state.position` in batches on reload-heavy / low-latency channels (frozen ~12s at a time while `video.currentTime` advances continuously). After 3 same-state polls, the trigger latched and `Attempt to fix buffering` fired every 8s (= `PlayerBufferingMinRepeatDelay`), each escalation eventually causing a real reload → user-visible pause/skip cascade. Stall trigger now requires BOTH `state.position` AND `video.currentTime` to be unchanged before declaring stalled — `currentTime` is the source of truth for actual playback progress. Real stalls (both frozen) and critical buffer drains (`bufferDuration < 1`) still trigger as before. Field-validated against [#193](https://github.com/ryanbr/TwitchAdSolutions/issues/193) and a second user report (vaft) (#194)
- **`autoplay` getting auto-pinned as backup player type, breaking last-resort fallback** — `PinBackupPlayerType=true` (vaft default) was pinning every committed type including `autoplay`. `PreferLowQualityBackup` keeps autoplay as the LAST entry of `playerTypesToTry` so the iteration-end last-resort branch commits it when all Source types are ad-laden, producing the intended 360p clean fallback. When autoplay got pinned, the next break's pin-reorder moved it to position 0, leaving `mobile_web` (or whichever) at the end position — the last-resort branch then committed THAT ad-marked type instead of autoplay's clean 360p backup, engaging strip+recovery on Source-tier ad-marked content. Single-condition fix: skip pinning when `backupPlayerType === 'autoplay'`. Source-tier types still pin as before (vaft) (#192)
- **Post-ad HEVC reload-loop on stitched-ad transitions** — at end of an ad break, `_resetStreamAdState` clears `IsUsingModifiedM3U8` to false. Post-ad continuation markers arriving within ~8s re-fired the HEVC reload because the `!IsUsingModifiedM3U8` condition was satisfied again — redundant teardown/rebuild a few seconds after the previous reload settled. Added `Date.now() - streamInfo.LastPlayerReload < 8000` guard so the backup-stream path takes over for post-ad-continuation breaks instead (vaft) (#191)
- **`AdSegmentCache` unbounded growth on long sessions** — each entry is a URL string + `Date.now()` timestamp (~200-300 bytes); over a multi-hour session with frequent ad breaks, the Map could reach MB-scale. The existing diagnostic at this site logged `[AD DEBUG] AdSegmentCache crossed 1000 entries — possible cache bloat` but did nothing about it. Converted to a self-healing FIFO bound: when `size > 1000`, evict the oldest 200 entries (Map iteration order is insertion order). Old ad URLs are unlikely to be requested again; if they are, they get re-cached via the strip path normally (vaft) (#191)

## v64.1.0 (2026-05-01)

### Bug Fixes
- **Audio click on hard reload at end of CSAI ad break** — field-observed on warn channel: hard reload to restore Source quality after autoplay (360p) escape-hatch backup produced an audible click/pop as the new MediaSource crossed a discontinuity boundary on first audio frames. Added a pre-mute right before `setSrc()`, restored on the `<video>` element's `canplay` event with a 1500ms safety cap. Trades the click for a brief silence (~100-300ms typical) that ends as soon as audio is decodable. Skipped if user was already muted, so user-mute intent is preserved. The existing 3000ms LS-restore timer remains as a backstop. (vaft hard reload only via `kind: 'early'`; video-swap-new every reload since `setSrc` always tears down MSE) (vaft + video-swap-new) (#189)
- **video-swap-new reload cooldown defeating thin-cache early reload** — worker-triggered early-reload (`UboReloadPlayer`) was passing through the same `reloadTwitchPlayer` cooldown gate as buffer-monitor reloads, so the freeze-recovery fast path got blocked for the remainder of the cooldown window. Added `kind: 'early'` to the worker's postMessage; main-thread message handler threads it through to `reloadTwitchPlayer(isPausePlay, reloadKind)`; cooldown gate now bypasses on `kind === 'early'` while bookkeeping (timestamp, 90s auto-escalation on 3+ rapid reloads) still runs. Mirrors vaft's existing routing pattern (video-swap-new) (#188)
- **video-swap-new misleading CSAI fast-path log** — `[AD DEBUG] CSAI fast path — all segments live, skipping backup search` was emitted once per break and read like a permanent state, but only described the poll on which it fired. When Twitch shifted mid-break from CSAI tracking pixels to SSAI stitched segments, the backup search legitimately fired — making field logs read as a contradiction. Reworded to be poll-scoped, added a new `[AD DEBUG] Playlist now contains stitched ad segments — CSAI fast path no longer applies, falling through to backup search` transition log that fires the first time the SSAI branch is taken in a break where the CSAI fast path log had previously fired. Pre-existing bug fixed: `HasLoggedCsaiFastPath` was never reset at end-of-break in the testing variant; now reset alongside the new `HasLoggedCsaiToSsaiTransition` flag (video-swap-new) (#188)

## v64.0.0 (2026-05-01)

### New Features
- **Bounce-tolerant ad-end detection + slow-path max-wait gate** — adds `PendingAdEndAt` + `AdEndBounceCount` to StreamInfo. The first clean poll of a break sets the timestamp; subsequent ad-marker bounces within a 12s staleness window keep it alive (incrementing the bounce counter) instead of resetting. Independent slow-path escalation: if `>= 12s` has elapsed since first clean poll, the ad cycle ends regardless of `CleanPlaylistCount`. Without this, channels where Twitch flips markers in/out faster than the poll cadence could wedge the player on backup indefinitely. Mirrors TTV-AB v6.6.7 #1/#4. Logs `[AD DEBUG] Slow-path ad-end escalation` with bounce count + elapsed when the gate fires below threshold (vaft + video-swap-new) (#186)
- **Real-time contamination-aware backup reorder** — at start of backup search, if `LoggedBackupAdsByType` has entries from earlier in the same break, move those types to the end of `playerTypesToTry` so untried/clean types get tried first on subsequent polls. Field-validated on `warn` channel where `site` was the first-tried (and contaminated) type (vaft) (#177)
- **Clip editor + visibility de-spoof sync from TTV-AB** — early-return on `clips.twitch.tv` host or `/<channel>/clip/<slug>` path so the clip editor preview isn't frozen by ad-block hooks. Removed the `document.hidden` / `visibilityState` / `hasFocus` getter spoofs and the capture-stage `visibilitychange` swallow listener; replaced with a plain bubble-phase resume-on-focus listener. **BetterTTV's "Mute Invisible Player" works again** along with any other visibility-driven page script (vaft + video-swap-new) (#185)

### Bug Fixes
- **Require 3 consecutive clean polls before declaring ad-end** — was conditional `1 if NumStrippedAdSegments==0 else 2`. On SSAI-uniform channels (warn/pge4/dafran/emongg) where the backup-swap path commonly produces `NumStrippedAdSegments==0`, a single brief clean window mid-break would flip `IsShowingAd` false, then ad markers would re-inject and the worker would re-enter ad blocking 1-3 seconds later. TTV-AB hit the same false-positive at 2 probes and bumped to 3 in v6.6.7 ("Ad-End Re-Entry Stability") (vaft) (#184)
- **HEVC fallback: copy AUDIO/VIDEO/SUBTITLES groups onto rewritten variant** — when 1440p HEVC variants are swapped for the closest non-HEVC URL in `ModifiedM3U8`, only the `CODECS` attribute was being rewritten. The `EXT-X-STREAM-INF` line kept the HEVC variant's `AUDIO`, `VIDEO`, and `SUBTITLES` group identifiers — pointing at media tracks the AVC backup may not actually carry, causing audio mismatch / desync / black screen at the HEVC→AVC handoff. Mirrors TTV-AB v6.7.5's parser fix (vaft) (#187)
- **Lockout backup types that return GQL `server error`** — the `!spat` branch was the only failure mode that didn't mark `FailedBackupPlayerTypes`. Field-observed on `warn`: embed and autoplay returned `server error` ~34 times each per break before. Now the same 15s lockout applies, reducing in-break retries to ~4 per type and saving ~30 GQL round-trips per affected break (vaft) (#178)
- **Reset `ConsecutiveZeroStripBreaks` on any positive signal** — the reset branch only fired on `hadStrippedSegments`, but the increment guard covers both `hadStrippedSegments` and `HasConfirmedAdAttrs`. Asymmetric — a real confirmed ad cleanly blocked via backup-swap (0 stripped + confirmed attrs) didn't reset prior suspicious history, leading to misleading false-positive warnings on subsequent breaks (vaft) (#180)
- **Rate-limit position-jump drift detector to once per 30s** — repeated `[AD DEBUG] Drift correction: catching up at 1.1x` logs were firing on tight intervals during recovery, with each invocation re-arming an interval that overlapped previous ones. Wall-clock guard ensures at most one rearm per 30s (vaft) (#183)
- **Preserve `lowLatencyModeEnabled` and `persistenceEnabled` across reloads** — these localStorage keys were missing from the post-reload preservation snapshot. Reloading reset them to defaults, breaking low-latency mode and persistence preferences for users who had explicitly toggled them (vaft + video-swap-new) (#172)

### Performance
- **Convert SERVER-TIME `.match(string)` and regex to literal** — two perf passes through `getServerTimeFromM3u8` and the SERVER-TIME parsing path. Both use compiled regex literals instead of string-arg `.match()` and `new RegExp(...)`, freeing the regex compiler from re-parsing on each m3u8 fetch (vaft + video-swap-new) (#174, #175)

### Diagnostic Logging
- **Differentiate autoplay pinned vs fallback in commit message** — when autoplay backup commits, the log now distinguishes "autoplay pinned (last-resort fallback)" from "autoplay (PreferLowQualityBackup escape hatch)" so post-mortems on field logs can tell which path engaged (vaft) (#181)

### Tests
- **Sync signifier tests + add benchmark harness** — keeps test fixtures aligned with the runtime AdSignifiers list, and adds a benchmark suite for hot-path m3u8 parsing so future perf changes can be measured (#176)

## v63.0.0 (2026-04-22)

### New Features
- **BackupSwapFirst default-on (architectural shift to TTV-AB-style ad-blocking)** — on ad detect, immediately swap to a backup player-type m3u8 instead of stripping native. Avoids MediaSource mixing from strip + BLANK_MP4 + recovery activity (the root cause of A/V desync and loading-circle symptoms). Field-tested across winton_ow2, warn, aspen, karq, jwantedl, hiimsky, junothemartian — fewer loading circles, faster backup commit times (415-861ms after warm cache). Preserves opt-out via `twitchAdSolutions_backupSwapFirst=false` for anyone who wants the legacy sticky CSAI strip path. Cost: extra token fetches per ad break (bandwidth tradeoff for smoother UX) (vaft) (#168)
- **Log GraphQL errors field in access-token diagnostic** — when `streamPlaybackAccessToken` is missing from a GQL response, log the `errors` field content (truncated to 300 chars) alongside response keys. Enabled field diagnosis of the embed-specific `server error` response confirmed by #171 (vaft + video-swap-new) (#170)

### Bug Fixes
- **Broaden twitch-stitched-* DATERANGE coverage via prefix signifier** — replace exact `EXT-X-DATERANGE:CLASS="twitch-stitched-ad"` with the prefix `twitch-stitched`. Catches `-ad`, `-mid`, `-pod`, and any future `twitch-stitched-*` variant. Twitch-prefixed so no false-positive regression from PR #120's bare-`stitched` substring issue (vaft + video-swap-new) (#166)
- **Unknown-signifier diagnostic substring-match** — the diagnostic was doing exact-string comparison against `AdSignifiers`, so it reported `twitch-stitched-ad` as "unknown" even though the `twitch-stitched` prefix covers it. Match `hasAdTags`'s substring semantics — a candidate is "known" if any AdSignifier appears within it (vaft + video-swap-new) (#167)
- **Accept both `streamPlaybackAccessToken` GQL response shapes** — Twitch returns the token at either `response.data.streamPlaybackAccessToken` (most player types) or `response.streamPlaybackAccessToken` (observed on embed). Only the first shape was handled; embed was silently dropped as a backup option. Accept either shape via optional-chaining fallback (vaft + video-swap-new) (#169)
- **Reorder BackupPlayerTypes (embed last) + change FallbackPlayerType** — embed's GQL access-token consistently returns `"server error"` when requested from `twitch.tv` origin (confirmed via PR #170 diagnostic). Previously embed was first-try, wasting ~200-400ms per break on the failed round-trip. Move embed to end of `BackupPlayerTypes` (site first now), change `FallbackPlayerType` from `'embed'` to `'site'`. Faster backup commit + more reliable last-resort fallback (vaft + video-swap-new) (#171)

## v62.1.0 (2026-04-21)

### Bug Fixes
- **Don't fire loading-circle reload during in-flight reload** — triple-reload scenario observed on aspen: early reload 1/2 fired, then the buffer monitor detected `readyState=0` (the expected transient state during reload teardown) and fired a redundant loading-circle reload, then early reload 2/2 fired. Three hard reloads within seconds. Gate the loading-circle detector on `playerBufferState.lastReloadAt` (set by any reload path, not just loading-circle's own). Also reset `adStallStartAt` in `doTwitchPlayerTask` so stall measurements don't carry stale values across reload boundaries (vaft) (#164)
- **Force reload after ANY committed backup (A/V desync prevention)** — field observation: audio-ahead-of-video desync compounds across escape-hatch breaks. Each escape-hatch break leaves MediaSource with mixed-source segments (backup-fetched via alternate-token access + native-fetched post-flip), causing audio/video decoder tracks to drift, which accumulates across breaks. PR #163 added the post-escape reload for the autoplay (360p) case; this extends it to any committed backup (Source-quality types included). Cost: ~1-2s black screen after every escape-hatch break (tradeoff for clean audio). Pure CSAI-only breaks with no backup commit unchanged (vaft) (#165)

## v62.0.0 (2026-04-21)

### New Features
- **`PreferLowQualityBackup` default-on** — flip the hybrid safety net from opt-in (default `false`) to default on (default `true`). Field-tested across winton_ow2, aspen, junothemartian, august, karq, jwantedl, l0ok_at_me. Clean CSAI-path breaks pass through untouched (no regression); heavy-SSAI 2-ad pods that would otherwise freeze ~36s now recover via escape hatch + backup search. Preserves opt-out via `twitchAdSolutions_preferLowQualityBackup=false`. Also reduces support burden — users hitting SSAI freezes no longer need to discover the flag (vaft) (#159)
- **Worker crash recovery for IVS WASM worker** — IVS WASM worker can fire `RuntimeError: index out of bounds` and die silently. Single crash produces multiple error events; add dedupe flag pattern (borrowed from TTV-AB v6.3.4). On first error, trigger hard reload via the main reload path — Twitch re-spawns the worker as part of the new player instance. Reuses existing reload cooldown for loop prevention (vaft + video-swap-new) (#160)

### Bug Fixes
- **Lower sticky CSAI escape hatch threshold from 6 to 4 polls** — field logs showed 2-ad heavy-SSAI breaks exhausting the early-reload budget then sitting in the recovery loop for 3+ more polls, ending naturally at poll 5 before the old threshold of 6 could fire. Lower to 4 polls (~8s stuck) — budget-exhausted recovery is clearly unproductive by that point, fall through to backup search sooner (vaft) (#158)
- **Full Response shape in worker-bridge fetch** — fabricated Response objects in the worker-bridge FetchResponse path were missing native `url`, `ok`, `redirected`, `type` properties. IVS WASM validates these on Spade/tracking requests and throws internal NetworkError when they're missing, halting playback. Add the four fields to the payload; apply via `Object.defineProperty` on the reconstructed Response. Ported from TTV-AB v6.3.5 (vaft + video-swap-new) (#161)
- **Exempt post-ad reload from CSAI cascade cooldown** — post-ad reload fires once per break at natural break end; the ad break cycle itself rate-limits the path. Field case on karq: loading-circle reload fired mid-break at t=0, break ended at t=27, post-ad reload was blocked by 30s cooldown, player stalled at `readyState=2 paused=true` until buffer monitor seeked. Drop the cooldown check from the post-ad path; cascade-risk paths (buffer monitor auto-reload, in-break retries) still respect it (vaft) (#162)
- **Reload to restore Source quality after autoplay (360p) fallback** — first field observation on l0ok_at_me preroll: all 4 Source types were ad-laden, autoplay committed as last-resort backup, but the end-of-break CSAI-only path cleared the backup flag without triggering a reload. Player's access token stayed autoplay-scoped (variant ladder is 360p-only), so viewer stayed stuck at 360p until a future break forced a reload. Add an autoplay-specific post-break hard reload to refresh the token and restore Source variant ladder (vaft) (#163)

## v61.0.0 (2026-04-21)

### Bug Fixes
- **Narrow AdSignifiers to 4 markers to reduce post-ad residual false positives** — TTV-AB's CHANGELOG flagged that broad ad-marker detection caused false re-entry into ad-blocking state: residual metadata tags briefly persist after ad-end, and any one would trigger a new ad cycle. Dropped 5 signifiers known to linger post-ad (`X-TV-TWITCH-AD`, `SCTE35-OUT`, `twitch-stream-source`, `twitch-trigger`, `twitch-ad-quartile`); kept 4 ad-start markers (`stitched-ad`, `EXT-X-CUE-OUT`, `twitch-stitched-ad`, `twitch-maf-ad`). URL-pattern detection unchanged (vaft + video-swap-new) (#152)
- **Hard-seek to live edge after hard reload when drift > 5s** — post-ad hard reload fires correctly (new MediaSource + token) but drift correction at 1.1x playback would take 5-10 minutes to catch up 30-60s of A/V timestamp desync accumulated from strip+BLANK_MP4+recovery activity. When `liveEdge - currentTime > 5s`, hard-seek `video.currentTime = seekable.end` to instantly re-align audio and video decoder state. Small drift still uses gradual 1.1x catch-up; soft reloads unchanged (vaft) (#154)
- **Always run post-reload recovery (unmute fix)** — the post-reload setTimeout was gated on captured localStorage values; if Twitch hadn't written `video-quality`/`video-muted`/`volume` at reload time (fresh session, private mode, cleared cache), the entire recovery block skipped — including the Chrome-autoplay unmute. Remove the outer guard so recovery always runs; LS restore stays individually guarded inside the callback (vaft + video-swap-new) (#155)
- **Respect user mute intent in post-reload unmute** — the force-unmute (`videos[0].muted = false`) was unconditional. If a user intentionally muted the stream before an ad break, a reload would override their intent and unmute them. Check `currentMutedLS` for Twitch's `'{"default":true}'` marker (written when user mutes via UI); if present, skip the unmute. Chrome autoplay mute still clears because no-LS / `'{"default":false}'` cases don't match the marker (vaft + video-swap-new) (#156)

### Diagnostic Logging
- **Log potential ad markers not in AdSignifiers** — scans playlist during ad-break processing for `EXT-X-DATERANGE:CLASS="twitch-*"` classes and `SCTE35-*`/`EXT-X-CUE-*` tags. Candidates not in the active signifier list are logged once per break as `[AD DEBUG] Potential ad markers seen but not in AdSignifiers: ... (candidates for future inclusion)`. Helps identify new markers Twitch introduces without guessing — add them only after observing real usage. Tracked via `HasLoggedUnknownSignifiers` (mirrors `HasLoggedAdAttributes` once-per-break pattern), reset at end-of-break (vaft + video-swap-new) (#153)

## v60.4.0 (2026-04-20)

### Bug Fixes
- **De-escalate auto-boosted reload cooldown when burst subsides** — auto-escalation from 30s → 90s (triggered by 3+ reloads in 5 minutes) was permanent for the page lifetime; `ReloadCooldownSeconds` never reverted even after `reloadTimestamps` aged out. A transient bad period (e.g. one SSAI-heavy 2-minute window) permanently stiffened the cooldown for the rest of the session, blocking legitimate freeze-recovery reloads on subsequent breaks. Track the pre-escalation value and revert when the sliding-window count drops below 3 (video-swap-new) (#150)
- **Match sticky path's thin-cache early-reload budget on normal path** — PR #134 bumped the sticky CSAI path's early-reload budget to `max(2, PodLength)` when the recovery cache has <3 segments, but the normal backup-search path was left at `max(1, PodLength)` with the same thin-cache threshold. On a 1-ad pod with thin cache, a single misdirected reload would exhaust the budget; now gets a second chance to match sticky-path behavior (vaft) (#151)

## v60.3.0 (2026-04-20)

### New Features
- **`PreferLowQualityBackup` hybrid safety net** — opt-in via `localStorage.twitchAdSolutions_preferLowQualityBackup = 'true'`. Keeps the sticky CSAI fast path (default behavior, no regression on clean breaks), but adds two safety nets for SSAI-heavy freezes: (1) sticky escape hatch — after 6 consecutive all-stripped polls (~12s) inside the sticky path with the early-reload budget exhausted, fall through to backup search instead of staying stuck; (2) autoplay (360p) appended as a last-resort backup player type when all Source types (embed/site/popout/mobile_web) are ad-laden. Autoplay stays last so the 360p quality hit only occurs when no Source backup is available. Includes diagnostic logs for escape hatch firing and post-escape backup commit (vaft) (#149)

### Bug Fixes
- **Loading-circle health check now uses hard reload** — PR #96's health-check reload was still soft after the PR #144 soft-reload switch, meaning a loading-circle recovery kept the same dirty MediaSource buffer that caused the circle. Route via `kind: 'early'` so the health check gets a fresh MediaSource and access token. Matches the early-reload path's hard-reload behavior (vaft) (#149)



### Bug Fixes
- **Audio/video desync after ad breaks** — PR #144's universal soft reload preserved the MediaSource buffer across reloads, so timestamp weirdness from `BLANK_MP4` injection and recovery segment replay accumulated over time, causing audio/video drift after several ad breaks. Post-ad reload now uses hard reload (new MediaSource, fresh access token) whenever strip or modify activity occurred. HEVC force reload stays soft (codec change only, no strip). Pure CSAI breaks still skip the reload entirely (vaft) (#148)

## v60.1.0 (2026-04-18)

### Bug Fixes
- **Increase early reload budget when recovery cache is thin** — when `RecoverySegments.length < 3`, budget is now `max(2, PodLength)` instead of `max(1, PodLength)`. Gives Twitch a second chance to stop serving ads before giving up. Critical fix for heavy SSAI breaks reported in issue #129 (vaft) (#134)
- **Reset `EarlyReloadTriggered` on 'still ads' result** — the flag was never reset after an early reload landed back in ads, blocking the budget from ever firing a second reload. Applied to both sticky CSAI path and normal backup-search path (vaft) (#134, #147)
- **Use hard reload for mid-break early reloads** — PR #144's universal soft reload reused the cached access token, meaning all N reloads landed in the same ad-decision session. Split by reload kind: `'early'` → hard reload (fresh session, new ad bucket), post-ad → soft reload (smooth transition). Restores SSAI-escape capability that the soft-reload switch accidentally removed (vaft) (#146)

## v60.0.0 (2026-04-17)

### New Features
- **Soft reload for post-ad player restart** — replace hard reload (`isNewMediaPlayerInstance: true, refreshAccessToken: true`) with soft reload (both `false`). Keeps the player instance and cached access token alive; just nudges the player to refetch the m3u8. Reduces post-ad transition from ~1-3s black screen to ~0.5-1s with no visible teardown. Ported from TTV-AB's v6.3.9 / v6.4.3 pattern (vaft) (#144)
- **Early reload on prolonged freeze + reload cooldown** — port vaft's freeze mitigation to video-swap-new. When all segments stripped for N polls (default 5, or 1 when recovery cache is thin), trigger an early reload. 30s reload cooldown with auto-escalation to 90s after 3+ reloads in 5 minutes. Configurable via `twitchAdSolutions_earlyReloadPollThreshold` / `twitchAdSolutions_reloadCooldownSeconds` localStorage (video-swap-new) (#133)

### Bug Fixes
- **Remove promo/Turbo overlay hide** — last remaining use of `.player-overlay-background`. That class is Twitch's generic modal scrim used for content gates, mature warnings, subscription gates, and error dialogs — not just ad promos. The href pre-filter narrowed the trigger, but not safely enough. User reports of "black screen + controls disappear + stream freeze" pointed to overlay-hide false positives. SDA wrapper hide (exact `[data-test-selector]`) retained (vaft) (#143)
- **Remove ad-break-card text-match hide** — scanned `span/p/h1/h2/h3` for "taking an ad break"/"stick around" phrases, then walked up via fuzzy `[class*="overlay"]` + `parentElement` fallback. Could hide player controls if Twitch rendered those phrases inside the controls container. TTV-AB doesn't match this text at all; no upstream precedent to mirror safely (vaft) (#141)
- **Remove `autoplay` from video-swap-new backup player types** — same issue vaft fixed in PR #110: autoplay variants get stuck in loading circles when transitioning back. Replaced with `embed, popout, mobile_web` (video-swap-new) (#132)
- **Guard null `lowResInf` in HEVC→AVC codec substitution** — optional-chain regex match could return `undefined`, and the next line called `.substring()` without a guard, throwing `TypeError` and aborting the substitution loop. Skip the iteration instead (video-swap-new) (#135)
- **Clear `RequestedAds` Set on end-of-break** — without clearing, the Set accumulated every ad URL seen across a session. On long streams with many breaks, grew unboundedly. vaft already cleared it; video-swap-new was missing the cleanup (video-swap-new) (#137)
- **Fix unhandled promise rejection in ad .ts prefetch** — `fetch().then(r => { r.blob() })` discarded the inner promise; `blob()` rejections surfaced as unhandled. Also video-swap-new was missing `.catch()` entirely. Return `response.blob()` so both rejections funnel to the outer catch (vaft + video-swap-new) (#136)
- **Reset `HasLoggedAdAttributes` on end-of-break** — flag was set `true` on first detection but never reset. Only the first ad break of a session logged the attribute list. If Twitch adds a new tracking attribute mid-session, it went unnoticed. Now logs once per break (vaft + video-swap-new) (#138)
- **Silence benign cancel errors in video-swap-new fetch hook** — backup stream switches cancel in-flight fetches. Chrome surfaces `AbortError`, Firefox's IVS wrapper surfaces `Error('Request cancelled')`. Both are lifecycle noise, not errors. Filter covers `err.name === 'AbortError'` and message matching `/cancel|abort/i` (video-swap-new) (#140, #142)

## v59.1.0 (2026-04-17)

### Bug Fixes
- **Fire early reload immediately when recovery cache is thin** — when fewer than 3 recovery segments are cached (common on prerolls), lower the early reload threshold from 5 polls (~10s) to 1 poll (~2s). With only 1 recovery segment the player loops decode errors; reloading immediately saves ~8s of freeze time. Applied to both sticky CSAI and normal backup-search paths (vaft) (#130)
- **Restart drift correction on re-entry** — `startDriftCorrection` now clears stale interval/timeout when called while already running instead of silently returning. Fixes cases where a second drift trigger (e.g. position jump during post-reload drift) was ignored, leaving the player at 1.1x with a partially elapsed safety timeout (vaft) (#131)
- **Guard pause intent reset** — only reset `weJustPaused` tracking when the player wasn't already paused. Prevents the play() retry from firing against user intent when the user pauses during a stall recovery window (vaft) (#131)

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
