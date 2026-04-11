// ==UserScript==
// @name         TwitchAdSolutions (vaft-testing)
// @namespace    https://github.com/ryanbr/TwitchAdSolutions
// @version      604.0.0
// @description  Multiple solutions for blocking Twitch ads (vaft testing variant)
// @updateURL    https://github.com/ryanbr/TwitchAdSolutions/raw/master/vaft/vaft_testing.user.js
// @downloadURL  https://github.com/ryanbr/TwitchAdSolutions/raw/master/vaft/vaft_testing.user.js
// @author       https://github.com/cleanlock/VideoAdBlockForTwitch#credits
// @match        *://*.twitch.tv/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function() {
    if ( /(^|\.)twitch\.tv$/.test(document.location.hostname) === false ) { return; }
    // Skip injection in nested frames that aren't legitimate Twitch embed contexts.
    // Twitch's main channel page has 5+ hidden cross-origin iframes (auth, analytics,
    // ad SDK, etc.) and uBO injects into all matching ones. Each becomes a racing vaft
    // instance that fights for player control. Only the top frame hosts the player on
    // twitch.tv/CHANNEL; nested auxiliary frames are noise.
    // Allow-list for nested-frame injection: Twitch's three documented embed contexts
    // (https://dev.twitch.tv/docs/embed/video-and-clips/) — preserves Twitch streams
    // embedded on third-party sites where vaft runs in an iframe whose parent is on
    // a different origin.
    // Use window.frameElement to detect nested frames — null on top frame, the iframe
    // element on a same-origin nested frame, throws on a cross-origin nested frame.
    // More reliable than 'window !== window.top' because Tampermonkey wraps window in a
    // proxy where the strict comparison can return true even on the top frame.
    let _isNested = false;
    try { _isNested = window.frameElement !== null; } catch (_e) { _isNested = true; }
    if (_isNested) {
        const _host = document.location.hostname;
        const _isEmbedContext = _host === 'player.twitch.tv' || _host === 'embed.twitch.tv' || document.location.pathname.startsWith('/embed/');
        if (!_isEmbedContext) {
            console.log('[AD DEBUG] vaft-testing skipped — nested frame on ' + _host + document.location.pathname + ' (not a Twitch embed). If you see this on twitch.tv/CHANNEL top frame, please report.');
            return;
        }
    }
    'use strict';
    const ourTwitchAdSolutionsVersion = 604;// Used to prevent conflicts with outdated versions of the scripts
    console.log('[AD DEBUG] TwitchAdSolutions vaft-testing v' + ourTwitchAdSolutionsVersion + ' loading');
    if (typeof window.twitchAdSolutionsVersion !== 'undefined' && window.twitchAdSolutionsVersion >= ourTwitchAdSolutionsVersion) {
        console.log('[AD DEBUG] CONFLICT: vaft-testing v' + ourTwitchAdSolutionsVersion + ' skipped — another script already active (v' + window.twitchAdSolutionsVersion + '). Remove duplicate scripts.');
        return;
    }
    window.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
    // Configuration and state shared between window and worker scopes
    function declareOptions(scope) {
        scope.AdSignifiers = ['stitched', 'stitched-ad', 'X-TV-TWITCH-AD', 'EXT-X-CUE-OUT', 'EXT-X-DATERANGE:CLASS="twitch-stitched-ad"', 'EXT-X-DATERANGE:CLASS="twitch-stream-source"', 'EXT-X-DATERANGE:CLASS="twitch-trigger"', 'EXT-X-DATERANGE:CLASS="twitch-maf-ad"', 'EXT-X-DATERANGE:CLASS="twitch-ad-quartile"', 'SCTE35-OUT'];
        scope.AdSegmentURLPatterns = ['/adsquared/', '/_404/', '/processing'];
        scope.ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
        scope.BackupPlayerTypes = [
            'embed',//Source
            'site',//Source
            'popout',//Source
            'mobile_web',//Mobile
            // 'autoplay' (360p) removed: when committed as cycle backup, the player gets stuck
            // in an endless loading circle after the CSAI-only path releases the backup —
            // autoplay variants don't transition cleanly back to main stream variants.
            //'picture-by-picture-CACHED'//360p (-CACHED is an internal suffix and is removed)
        ];
        scope.FallbackPlayerType = 'embed';
        scope.ForceAccessTokenPlayerType = 'popout';
        scope.SkipPlayerReloadOnHevc = false;// If true this will skip player reload on streams which have 2k/4k quality (if you enable this and you use the 2k/4k quality setting you'll get error #4000 / #3000 / spinning wheel on chrome based browsers)
        scope.AlwaysReloadPlayerOnAd = false;// Always pause/play when entering/leaving ads
        scope.ReloadPlayerAfterAd = true;// After the ad finishes do a player reload instead of pause/play
        scope.ReloadCooldownSeconds = 30;// Minimum seconds between reloads — breaks CSAI cascades triggered by reload
        scope.DisableReloadCap = false;// If true, buffer monitor reloads unlimited times (pre-v47 behavior, risk of cascade)
        scope.DriftCorrectionRate = 1.1;// Playback rate for catching up to live edge after reload (0 = disable drift correction)
        scope.EarlyReloadPollThreshold = 3;// Number of consecutive all-stripped polls before triggering early reload (each poll ~2s, so 3 = ~6s, 5 = ~10s, 10 = ~20s; 0 = disable)
        scope.DisableAdSpoofing = false;// If true, skip the ad-impression spoofing GQL beacons (notifyAdComplete) — for A/B testing whether spoofing affects ad break duration
        scope.PinBackupPlayerType = true;// Remember which backup player type worked and try it first on next ad break
        scope.PlayerReloadMinimalRequestsTime = 1500;
        scope.PlayerReloadMinimalRequestsPlayerIndex = 2;//autoplay
        scope.HasTriggeredPlayerReload = false;
        scope.StreamInfos = [];
        scope.StreamInfosByUrl = [];
        scope.GQLDeviceID = null;
        scope.ClientVersion = null;
        scope.ClientSession = null;
        scope.ClientIntegrityHeader = null;
        scope.AuthorizationHeader = undefined;
        scope.SimulatedAdsDepth = 0;
        scope.PlayerBufferingFix = true;// If true this will pause/play the player when it gets stuck buffering
        scope.PlayerBufferingDelay = 600;// How often should we check the player state (in milliseconds)
        scope.PlayerBufferingSameStateCount = 3;// How many times of seeing the same player state until we trigger pause/play (it will only trigger it one time until the player state changes again)
        scope.PlayerBufferingDangerZone = 1;// The buffering time left (in seconds) when we should ignore the players playback position in the player state check
        scope.PlayerBufferingDoPlayerReload = false;// If true this will do a player reload instead of pause/play (player reloading is better at fixing the playback issues but it takes slightly longer)
        scope.PlayerBufferingMinRepeatDelay = 8000;// Minimum delay (in milliseconds) between each pause/play (this is to avoid over pressing pause/play when there are genuine buffering problems)
        scope.PlayerBufferingPrerollCheckEnabled = false;// Enable this if you're getting an immediate pause/play/reload as you open a stream (which is causing the stream to take longer to load). One problem with this being true is that it can cause the player to get stuck in some instances requiring the user to press pause/play
        scope.PlayerBufferingPrerollCheckOffset = 5;// How far the stream need to move before doing the buffering mitigation (depends on PlayerBufferingPrerollCheckEnabled being true)
        scope.V2API = false;
        scope.IsAdStrippingEnabled = true;
        scope.AdSegmentCache = new Map();
        scope.AllSegmentsAreAdSegments = false;
    }
    function maskAsNative(fn, name) {
        fn.toString = () => 'function ' + name + '() { [native code] }';
        return fn;
    }
    const loggedCsaiTypes = new Set();
    let isActivelyStrippingAds = false;
    let localStorageHookFailed = false;
    const twitchWorkers = [];
    let cachedRootNode = null;// Cached #root DOM element (never changes in React SPAs)
    let cachedPlayerRootDiv = null;// Cached .video-player element
    // Strings used to detect and handle conflicting Twitch worker overrides (e.g. TwitchNoSub)
    const workerStringConflicts = [
        'twitch',
        'isVariantA'// TwitchNoSub
    ];
    const workerStringReinsert = [
        'isVariantA',// TwitchNoSub (prior to (0.9))
        'besuper/',// TwitchNoSub (0.9)
        '${patch_url}'// TwitchNoSub (0.9.1)
    ];
    // Walk the Worker prototype chain and remove conflicting overrides
    function getCleanWorker(worker) {
        let root = null;
        let parent = null;
        let proto = worker;
        while (proto) {
            const workerString = proto.toString();
            if (workerStringConflicts.some((x) => workerString.includes(x))) {
                if (parent !== null) {
                    Object.setPrototypeOf(parent, Object.getPrototypeOf(proto));
                }
            } else {
                if (root === null) {
                    root = proto;
                }
                parent = proto;
            }
            proto = Object.getPrototypeOf(proto);
        }
        return root;
    }
    function getWorkersForReinsert(worker) {
        const result = [];
        let proto = worker;
        while (proto) {
            const workerString = proto.toString();
            if (workerStringReinsert.some((x) => workerString.includes(x))) {
                result.push(proto);
            }
            proto = Object.getPrototypeOf(proto);
        }
        return result;
    }
    function reinsertWorkers(worker, reinsert) {
        let parent = worker;
        for (let i = 0; i < reinsert.length; i++) {
            Object.setPrototypeOf(reinsert[i], parent);
            parent = reinsert[i];
        }
        return parent;
    }
    function isValidWorker(worker) {
        const workerString = worker.toString();
        const hasConflict = workerStringConflicts.some((x) => workerString.includes(x));
        const hasReinsert = workerStringReinsert.some((x) => workerString.includes(x));
        if (hasConflict && !hasReinsert) {
            console.log('[AD DEBUG] Worker rejected — conflict string found: ' + workerStringConflicts.filter((x) => workerString.includes(x)).join(', '));
        }
        return !hasConflict || hasReinsert;
    }
    // Replace window.Worker to intercept Twitch's video worker and inject ad-blocking logic
    let injectedBlobUrl = null;
    function hookWindowWorker() {
        // Prevent Twitch from revoking our injected worker blob URL
        if (!URL.revokeObjectURL.__tasMasked) {
            const originalRevokeObjectURL = URL.revokeObjectURL;
            URL.revokeObjectURL = maskAsNative(function(url) {
                if (url === injectedBlobUrl) return;
                return originalRevokeObjectURL.call(this, url);
            }, 'revokeObjectURL');
            URL.revokeObjectURL.__tasMasked = true;
        }
        const reinsert = getWorkersForReinsert(window.Worker);
        const newWorker = class Worker extends (getCleanWorker(window.Worker) || window.Worker) {
            constructor(twitchBlobUrl, options) {
                let isTwitchWorker = false;
                try {
                    isTwitchWorker = new URL(twitchBlobUrl).origin.endsWith('.twitch.tv');
                } catch {}
                if (!isTwitchWorker) {
                    super(twitchBlobUrl, options);
                    console.log('[AD DEBUG] Non-Twitch worker skipped: ' + twitchBlobUrl);
                    return;
                }
                // Pre-check: verify we can fetch the worker JS before injecting
                let prefetchedWorkerJs = null;
                try { prefetchedWorkerJs = getWasmWorkerJs(twitchBlobUrl); } catch {}
                if (!prefetchedWorkerJs) {
                    super(twitchBlobUrl, options);
                    console.log('[AD DEBUG] Failed to fetch worker JS — falling back to unmodified worker');
                    return;
                }
                console.log('[AD DEBUG] Worker intercepted — injecting ad-block hooks');
                const newBlobStr = `
                    const pendingFetchRequests = new Map();
                    ${hasAdTags.toString()}
                    ${notifyAdComplete.toString()}
                    ${getMatchedAdSignifiers.toString()}
                    ${stripAdSegments.toString()}
                    ${getStreamUrlForResolution.toString()}
                    ${processM3U8.toString()}
                    ${hookWorkerFetch.toString()}
                    ${declareOptions.toString()}
                    ${getAccessToken.toString()}
                    ${gqlRequest.toString()}
                    ${parseAttributes.toString()}
                    ${getWasmWorkerJs.toString()}
                    ${getServerTimeFromM3u8.toString()}
                    ${replaceServerTimeInM3u8.toString()}
                    const workerString = getWasmWorkerJs('${twitchBlobUrl.replaceAll("'", "%27")}');
                    declareOptions(self);
                    ReloadPlayerAfterAd = ${ReloadPlayerAfterAd};
                    ReloadCooldownSeconds = ${ReloadCooldownSeconds};
                    DisableReloadCap = ${DisableReloadCap};
                    PinBackupPlayerType = ${PinBackupPlayerType};
                    EarlyReloadPollThreshold = ${EarlyReloadPollThreshold};
                    DisableAdSpoofing = ${DisableAdSpoofing};
                    ForceAccessTokenPlayerType = '${ForceAccessTokenPlayerType}';
                    GQLDeviceID = ${GQLDeviceID ? "'" + GQLDeviceID + "'" : null};
                    AuthorizationHeader = ${AuthorizationHeader ? "'" + AuthorizationHeader + "'" : undefined};
                    ClientIntegrityHeader = ${ClientIntegrityHeader ? "'" + ClientIntegrityHeader + "'" : null};
                    ClientVersion = ${ClientVersion ? "'" + ClientVersion + "'" : null};
                    ClientSession = ${ClientSession ? "'" + ClientSession + "'" : null};
                    self.addEventListener('message', function(e) {
                        if (e.data.key == 'UpdateClientVersion') {
                            ClientVersion = e.data.value;
                        } else if (e.data.key == 'UpdateClientSession') {
                            ClientSession = e.data.value;
                        } else if (e.data.key == 'UpdateClientId') {
                            ClientID = e.data.value;
                        } else if (e.data.key == 'UpdateDeviceId') {
                            GQLDeviceID = e.data.value;
                        } else if (e.data.key == 'UpdateClientIntegrityHeader') {
                            ClientIntegrityHeader = e.data.value;
                        } else if (e.data.key == 'UpdateAuthorizationHeader') {
                            AuthorizationHeader = e.data.value;
                        } else if (e.data.key == 'FetchResponse') {
                            const responseData = e.data.value;
                            if (pendingFetchRequests.has(responseData.id)) {
                                const { resolve, reject } = pendingFetchRequests.get(responseData.id);
                                pendingFetchRequests.delete(responseData.id);
                                if (responseData.error) {
                                    reject(new Error(responseData.error));
                                } else {
                                    // Create a Response object from the response data
                                    const response = new Response(responseData.body, {
                                        status: responseData.status,
                                        statusText: responseData.statusText,
                                        headers: responseData.headers
                                    });
                                    resolve(response);
                                }
                            }
                        } else if (e.data.key == 'TriggeredPlayerReload') {
                            HasTriggeredPlayerReload = true;
                        } else if (e.data.key == 'ReloadSkipped') {
                            // Main thread refused the reload (player healthy) — clear the
                            // early-reload flags so we can re-fire if the player later stalls
                            let cleared = false;
                            for (const channel in StreamInfos) {
                                const si = StreamInfos[channel];
                                if (si && si.EarlyReloadTriggered) {
                                    si.EarlyReloadTriggered = false;
                                    si.EarlyReloadAwaitingResult = false;
                                    si.EarlyReloadCount = Math.max(0, (si.EarlyReloadCount || 0) - 1);
                                    cleared = true;
                                }
                            }
                            if (cleared) {
                                console.log('[AD DEBUG] Reload skipped by main thread (player healthy) — early reload state cleared, can retry');
                            }
                        } else if (e.data.key == 'SimulateAds') {
                            SimulatedAdsDepth = e.data.value;
                            console.log('SimulatedAdsDepth: ' + SimulatedAdsDepth);
                        } else if (e.data.key == 'AllSegmentsAreAdSegments') {
                            AllSegmentsAreAdSegments = !AllSegmentsAreAdSegments;
                            console.log('AllSegmentsAreAdSegments: ' + AllSegmentsAreAdSegments);
                        }
                    });
                    hookWorkerFetch();
                    eval(workerString);
                `;
                injectedBlobUrl = URL.createObjectURL(new Blob([newBlobStr]));
                super(injectedBlobUrl, options);
                twitchWorkers.length = 0;
                twitchWorkers.push(this);
                this.addEventListener('message', (e) => {
                    if (e.data.key == 'UpdateAdBlockBanner') {
                        updateAdblockBanner(e.data);
                        // Track backup stream switches (start and end of ad break)
                        if (e.data.hasAds !== !!playerBufferState.inAdBreak) {
                            playerBufferState.lastBackupSwitchAt = Date.now();
                            // Reset position tracking on ad-end so the stream switch gap isn't detected as a jump
                            if (!e.data.hasAds) {
                                playerBufferState.position = 0;
                            }
                        }
                        playerBufferState.inAdBreak = !!e.data.hasAds;
                        // Clear drift catch-up when ads start — don't run 1.1x during ad handling
                        if (e.data.hasAds && (driftCatchUpInterval || driftCatchUpTimeout)) {
                            if (driftCatchUpInterval) { clearInterval(driftCatchUpInterval); driftCatchUpInterval = null; }
                            if (driftCatchUpTimeout) { clearTimeout(driftCatchUpTimeout); driftCatchUpTimeout = null; }
                            try { document.querySelector('video').playbackRate = 1.0; } catch {}
                        }
                    } else if (e.data.key == 'PauseResumePlayer') {
                        doTwitchPlayerTask(true, false);
                    } else if (e.data.key == 'ReloadPlayer') {
                        doTwitchPlayerTask(false, true);
                    }
                });
                this.addEventListener('message', async event => {
                    if (event.data.key == 'FetchRequest') {
                        const fetchRequest = event.data.value;
                        const responseData = await handleWorkerFetchRequest(fetchRequest);
                        this.postMessage({
                            key: 'FetchResponse',
                            value: responseData
                        });
                    }
                });
            }
        };
        let workerInstance = reinsertWorkers(newWorker, reinsert);
        Object.defineProperty(window, 'Worker', {
            get: function() {
                return workerInstance;
            },
            set: function(value) {
                if (isValidWorker(value)) {
                    workerInstance = value;
                } else {
                    console.log('Attempt to set twitch worker denied');
                }
            }
        });
    }
    function getWasmWorkerJs(twitchBlobUrl) {
        const req = new XMLHttpRequest();
        req.open('GET', twitchBlobUrl, false);
        req.overrideMimeType("text/javascript");
        req.send();
        return req.responseText;
    }
    // Hook fetch() in the worker scope to intercept m3u8 playlist requests and ad segments
    function hookWorkerFetch() {
        console.log('hookWorkerFetch (vaft)');
        const BLANK_MP4 = new Blob([Uint8Array.from(atob('AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA'), c => c.charCodeAt(0))], {type: 'video/mp4'});
        const realFetch = fetch;
        fetch = async function(url, options) {
            if (typeof url === 'string') {
                if (AdSegmentCache.has(url)) {
                    return new Response(BLANK_MP4);
                }
                url = url.trimEnd();
                if (url.endsWith('m3u8')) {
                    return new Promise(function(resolve, reject) {
                        const processAfter = async function(response) {
                            if (response.status === 200) {
                                resolve(new Response(await processM3U8(url, await response.text(), realFetch)));
                            } else {
                                resolve(response);
                            }
                        };
                        realFetch(url, options).then(function(response) {
                            processAfter(response);
                        })['catch'](function(err) {
                            reject(err);
                        });
                    });
                } else if (url.includes('/channel/hls/') && !url.includes('picture-by-picture')) {
                    V2API = url.includes('/api/v2/');
                    const parsedUrl = new URL(url);
                    const channelName = parsedUrl.pathname.match(/([^\/]+)(?=\.\w+$)/)?.[0];
                    if (ForceAccessTokenPlayerType) {
                        // parent_domains is used to determine if the player is embeded and stripping it gets rid of fake ads
                        parsedUrl.searchParams.delete('parent_domains');
                        url = parsedUrl.toString();
                    }
                    return new Promise(function(resolve, reject) {
                        const processAfter = async function(response) {
                            if (response.status == 200) {
                                const encodingsM3u8 = await response.text();
                                const serverTime = getServerTimeFromM3u8(encodingsM3u8);
                                let streamInfo = StreamInfos[channelName];
                                if (streamInfo != null && streamInfo.EncodingsM3U8 != null && (await realFetch(streamInfo.EncodingsM3U8.match(/^https:.*\.m3u8$/m)?.[0])).status !== 200) {
                                    // The cached encodings are dead (the stream probably restarted)
                                    streamInfo = null;
                                }
                                if (streamInfo == null || streamInfo.EncodingsM3U8 == null) {
                                    console.log('[AD DEBUG] New stream session — channel: ' + channelName + ', API: ' + (V2API ? 'v2' : 'v1'));
                                    StreamInfos[channelName] = streamInfo = {
                                        ChannelName: channelName,
                                        IsShowingAd: false,
                                        LastPlayerReload: 0,
                                        EncodingsM3U8: encodingsM3u8,
                                        ModifiedM3U8: null,
                                        IsUsingModifiedM3U8: false,
                                        UsherParams: parsedUrl.search,
                                        RequestedAds: new Set(),
                                        Urls: [],// xxx.m3u8 -> { Resolution: "284x160", FrameRate: 30.0 }
                                        ResolutionList: [],
                                        BackupEncodingsM3U8Cache: [],
                                        ActiveBackupPlayerType: null,
                                        PinnedBackupPlayerType: null,
                                        HasCheckedUnknownTags: false,
                                        IsMidroll: false,
                                        IsStrippingAdSegments: false,
                                        NumStrippedAdSegments: 0,
                                        RecoverySegments: [],
                                        FailedBackupPlayerTypes: new Map(),// Map<playerType, timestamp> — failures expire after 15s for retry
                                        CleanPlaylistCount: 0,
                                        HasLoggedAdAttributes: false,
                                        LoggedBackupAdsByType: null,
                                        RecoveryStartSeq: undefined
                                    };
                                    const lines = encodingsM3u8.split(/\r?\n/);
                                    for (let i = 0; i < lines.length - 1; i++) {
                                        if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1].includes('.m3u8')) {
                                            const attributes = parseAttributes(lines[i]);
                                            const resolution = attributes['RESOLUTION'];
                                            if (resolution) {
                                                const resolutionInfo = {
                                                    Resolution: resolution,
                                                    FrameRate: attributes['FRAME-RATE'],
                                                    Codecs: attributes['CODECS'],
                                                    Url: lines[i + 1]
                                                };
                                                streamInfo.Urls[lines[i + 1]] = resolutionInfo;
                                                streamInfo.ResolutionList.push(resolutionInfo);
                                            }
                                            StreamInfosByUrl[lines[i + 1]] = streamInfo;
                                        }
                                    }
                                    if (streamInfo.ResolutionList.length === 0) {
                                        console.log('[AD DEBUG] No resolutions parsed from encodings m3u8 — Twitch may have changed the format');
                                    }
                                    const nonHevcResolutionList = streamInfo.ResolutionList.filter((element) => element.Codecs.startsWith('avc') || element.Codecs.startsWith('av0'));
                                    if (AlwaysReloadPlayerOnAd || (nonHevcResolutionList.length > 0 && streamInfo.ResolutionList.some((element) => element.Codecs.startsWith('hev') || element.Codecs.startsWith('hvc')) && !SkipPlayerReloadOnHevc)) {
                                        if (nonHevcResolutionList.length > 0) {
                                            for (let i = 0; i < lines.length - 1; i++) {
                                                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                                                    const resSettings = parseAttributes(lines[i].substring(lines[i].indexOf(':') + 1));
                                                    const codecsKey = 'CODECS';
                                                    if (resSettings[codecsKey].startsWith('hev') || resSettings[codecsKey].startsWith('hvc')) {
                                                        const oldResolution = resSettings['RESOLUTION'];
                                                        const [targetWidth, targetHeight] = oldResolution.split('x').map(Number);
                                                        const newResolutionInfo = nonHevcResolutionList.sort((a, b) => {
                                                            // TODO: Take into account 'Frame-Rate' when sorting (i.e. 1080p60 vs 1080p30)
                                                            const [streamWidthA, streamHeightA] = a.Resolution.split('x').map(Number);
                                                            const [streamWidthB, streamHeightB] = b.Resolution.split('x').map(Number);
                                                            return Math.abs((streamWidthA * streamHeightA) - (targetWidth * targetHeight)) - Math.abs((streamWidthB * streamHeightB) - (targetWidth * targetHeight));
                                                        })[0];
                                                        console.log('ModifiedM3U8 swap ' + resSettings[codecsKey] + ' to ' + newResolutionInfo.Codecs + ' oldRes:' + oldResolution + ' newRes:' + newResolutionInfo.Resolution);
                                                        lines[i] = lines[i].replace(/CODECS="[^"]+"/, `CODECS="${newResolutionInfo.Codecs}"`);
                                                        lines[i + 1] = newResolutionInfo.Url + ' '.repeat(i + 1);// The stream doesn't load unless each url line is unique
                                                    }
                                                }
                                            }
                                        }
                                        if (nonHevcResolutionList.length > 0 || AlwaysReloadPlayerOnAd) {
                                            streamInfo.ModifiedM3U8 = lines.join('\n');
                                        }
                                    }
                                }
                                // Note: do NOT set streamInfo.LastPlayerReload here. It was previously
                                // set unconditionally on new stream session creation, which caused the
                                // first end-of-break reload of every new channel to be blocked by
                                // cooldown — the cooldown check treated the session-creation timestamp
                                // as a recent reload, even though no reload had actually occurred.
                                resolve(new Response(replaceServerTimeInM3u8(streamInfo.IsUsingModifiedM3U8 ? streamInfo.ModifiedM3U8 : streamInfo.EncodingsM3U8, serverTime)));
                            } else {
                                resolve(response);
                            }
                        };
                        realFetch(url, options).then(function(response) {
                            processAfter(response);
                        })['catch'](function(err) {
                            reject(err);
                        });
                    });
                }
            }
            return realFetch.apply(this, arguments);
        };
    }
    function getServerTimeFromM3u8(encodingsM3u8) {
        if (V2API) {
            const matches = encodingsM3u8.match(/#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="([^"]+)"/);
            return matches && matches.length > 1 ? matches[1] : null;
        }
        const matches = encodingsM3u8.match(/SERVER-TIME="([0-9.]+)"/);
        return matches && matches.length > 1 ? matches[1] : null;
    }
    function replaceServerTimeInM3u8(encodingsM3u8, newServerTime) {
        if (V2API) {
            return newServerTime ? encodingsM3u8.replace(/(#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE=")[^"]+(")/, `$1${newServerTime}$2`) : encodingsM3u8;
        }
        return newServerTime ? encodingsM3u8.replace(/(SERVER-TIME=")[0-9.]+"/, `SERVER-TIME="${newServerTime}"`) : encodingsM3u8;
    }
    function hasAdTags(textStr) {
        return AdSignifiers.some((s) => textStr.includes(s));
    }
    // Spoof ad completion events to Twitch's backend to clear the ad state
    function notifyAdComplete(textStr) {
        try {
            const matches = textStr.match(/#EXT-X-DATERANGE:(ID="stitched-ad-[^\n]+)\n/);
            if (!matches || matches.length <= 1) {
                if (!notifyAdComplete.loggedNoMatch) {
                    notifyAdComplete.loggedNoMatch = true;
                    const dateRangeLine = textStr.match(/#EXT-X-DATERANGE:[^\n]{0,200}/);
                    console.log('[AD DEBUG] notifyAdComplete: no stitched-ad DATERANGE match. Sample DATERANGE: ' + (dateRangeLine ? dateRangeLine[0] : 'none found'));
                }
                return;
            }
            const attr = parseAttributes(matches[1]);
            const radToken = attr['X-TV-TWITCH-AD-RADS-TOKEN'];
            if (!radToken) {
                if (!notifyAdComplete.loggedNoToken) {
                    notifyAdComplete.loggedNoToken = true;
                    console.log('[AD DEBUG] notifyAdComplete: matched DATERANGE but no RADS token. Attributes: ' + Object.keys(attr).join(', '));
                }
                return;
            }
            const baseData = {
                stitched: true,
                ad_id: attr['X-TV-TWITCH-AD-ADVERTISER-ID'] || '',
                roll_type: (attr['X-TV-TWITCH-AD-ROLL-TYPE'] || '').toLowerCase(),
                creative_id: attr['X-TV-TWITCH-AD-CREATIVE-ID'] || '',
                order_id: attr['X-TV-TWITCH-AD-ORDER-ID'] || '',
                line_item_id: attr['X-TV-TWITCH-AD-LINE-ITEM-ID'] || '',
                player_mute: true,
                player_volume: 0.0,
                visible: false,
                duration: 0
            };
            const podLength = parseInt(attr['X-TV-TWITCH-AD-POD-LENGTH'] || '1', 10);
            for (let podPosition = 0; podPosition < podLength; podPosition++) {
                const payload = { ...baseData, ad_position: podPosition, total_ads: podLength };
                const makePacket = (event, extra) => [{
                    operationName: 'ClientSideAdEventHandling_RecordAdEvent',
                    variables: { input: { eventName: event, eventPayload: JSON.stringify({ ...payload, ...extra }), radToken } },
                    extensions: { persistedQuery: { version: 1, sha256Hash: '7e6c69e6eb59f8ccb97ab73686f3d8b7d85a72a0298745ccd8bfc68e4054ca5b' } }
                }];
                gqlRequest(makePacket('video_ad_impression')).catch(() => {});
                for (let q = 1; q <= 4; q++) {
                    gqlRequest(makePacket('video_ad_quartile_complete', { quartile: q })).catch(() => {});
                }
                gqlRequest(makePacket('video_ad_pod_complete')).catch(() => {});
            }
            console.log('[AD DEBUG] Spoofed ad completion for ' + podLength + ' ad(s) — roll: ' + baseData.roll_type);
        } catch (err) {
            console.log('[AD DEBUG] Ad completion spoof failed: ' + err.message);
        }
    }
    function getMatchedAdSignifiers(textStr) {
        return AdSignifiers.filter((s) => textStr.includes(s));
    }
    // Remove ad segments from an m3u8 playlist and cache their URLs for replacement
    function stripAdSegments(textStr, stripAllSegments, streamInfo) {
        let hasStrippedAdSegments = false;
        let inCueOut = false;
        const liveSegments = [];
        const lines = textStr.split(/\r?\n/);
        const newAdUrl = 'https://twitch.tv';
        // Log ad tracking attribute names once per stream (helps identify new beacons)
        if (!streamInfo.HasLoggedAdAttributes) {
            const adAttrs = textStr.match(/X-TV-TWITCH-AD[A-Z-]*(?==")/g);
            if (adAttrs && adAttrs.length > 0) {
                streamInfo.HasLoggedAdAttributes = true;
                console.log('[AD DEBUG] Ad tracking attributes seen: ' + [...new Set(adAttrs)].join(', '));
            }
        }
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            // Track SCTE-35 CUE-OUT/CUE-IN ad boundaries
            if (line.includes('EXT-X-CUE-OUT')) {
                if (!inCueOut) {
                    console.log('[AD DEBUG] SCTE-35 CUE-OUT — ad boundary entered');
                }
                inCueOut = true;
            } else if (line.includes('EXT-X-CUE-IN')) {
                if (inCueOut) {
                    console.log('[AD DEBUG] SCTE-35 CUE-IN — ad boundary exited');
                }
                inCueOut = false;
            }
            // Remove tracking urls which appear in the overlay UI
            lines[i] = line
                .replaceAll(/(X-TV-TWITCH-AD(?:-[A-Z]+)*-URLS?=")[^"]*(")/g, `$1${newAdUrl}$2`);
            const isLiveSegment = line.includes(',live');
            if (i < lines.length - 1 && line.startsWith('#EXTINF') && (!isLiveSegment || stripAllSegments || AllSegmentsAreAdSegments || inCueOut)) {
                const segmentUrl = lines[i + 1];
                if (!AdSegmentCache.has(segmentUrl)) {
                    streamInfo.NumStrippedAdSegments++;
                }
                AdSegmentCache.set(segmentUrl, Date.now());
                hasStrippedAdSegments = true;
            } else if (i < lines.length - 1 && line.startsWith('#EXTINF') && AdSegmentURLPatterns.some((p) => lines[i + 1].includes(p))) {
                console.log('[AD DEBUG] Ad segment detected via URL pattern: ' + lines[i + 1]);
                AdSegmentCache.set(lines[i + 1], Date.now());
                hasStrippedAdSegments = true;
                streamInfo.NumStrippedAdSegments++;
            } else if (i < lines.length - 1 && line.startsWith('#EXTINF') && isLiveSegment) {
                liveSegments.push({ extinf: line, url: lines[i + 1] });
            } else if (line.startsWith('#EXT-X-PART:')) {
                // LL-HLS part: URI is inline as an attribute. Strip if it matches a known
                // ad URL (already in cache from a parallel EXTINF strip, or matches a URL pattern).
                // Without this, the player may use the parts path to fetch ad media via low-latency.
                const partUriMatch = line.match(/URI="([^"]+)"/);
                const partUri = partUriMatch ? partUriMatch[1] : '';
                if (partUri && (AdSegmentCache.has(partUri) || AdSegmentURLPatterns.some((p) => partUri.includes(p)))) {
                    AdSegmentCache.set(partUri, Date.now());
                    lines[i] = '';
                    hasStrippedAdSegments = true;
                }
            }
            if (AdSignifiers.some((s) => line.includes(s))) {
                hasStrippedAdSegments = true;
            }
        }
        if (hasStrippedAdSegments) {
            for (let i = 0; i < lines.length; i++) {
                // No low latency during ads (otherwise it's possible for the player to prefetch and display ad segments)
                if (lines[i].startsWith('#EXT-X-TWITCH-PREFETCH:') || lines[i].startsWith('#EXT-X-PRELOAD-HINT:')) {
                    lines[i] = '';
                }
            }
        } else {
            streamInfo.NumStrippedAdSegments = 0;
        }
        // Cache live segments for recovery (plus the MEDIA-SEQUENCE of the oldest cached segment,
        // so the player accepts injected recovery segments as the correct position in the stream)
        if (liveSegments.length > 0) {
            streamInfo.RecoverySegments = liveSegments.slice(-6);
            const seq = parseInt((textStr.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/) || [])[1]);
            if (!isNaN(seq)) {
                streamInfo.RecoveryStartSeq = seq + Math.max(0, liveSegments.length - streamInfo.RecoverySegments.length);
            }
        }
        // If all segments were stripped, restore cached recovery segments to prevent black screen
        if (hasStrippedAdSegments && liveSegments.length === 0 && streamInfo.RecoverySegments && streamInfo.RecoverySegments.length > 0) {
            streamInfo.ConsecutiveAllStrippedPolls = (streamInfo.ConsecutiveAllStrippedPolls || 0) + 1;
            streamInfo.TotalAllStrippedPolls = (streamInfo.TotalAllStrippedPolls || 0) + 1;
            if (!streamInfo.FreezeStartedAt) streamInfo.FreezeStartedAt = Date.now();
            console.log('[AD DEBUG] All segments stripped — restoring ' + streamInfo.RecoverySegments.length + ' recovery segments');
            if (streamInfo.RecoveryStartSeq !== undefined) {
                for (let j = 0; j < lines.length; j++) {
                    if (lines[j].startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                        lines[j] = '#EXT-X-MEDIA-SEQUENCE:' + streamInfo.RecoveryStartSeq;
                        break;
                    }
                }
            }
            for (let j = 0; j < streamInfo.RecoverySegments.length; j++) {
                lines.push(streamInfo.RecoverySegments[j].extinf);
                lines.push(streamInfo.RecoverySegments[j].url);
            }
        } else if (liveSegments.length > 0) {
            // Reset freeze counter when live segments are available
            streamInfo.ConsecutiveAllStrippedPolls = 0;
        }
        streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
        const now = Date.now();
        AdSegmentCache.forEach((value, key, map) => {
            if (value < now - 120000) {
                map.delete(key);
            }
        });
        return lines.join('\n');
    }
    // Find the closest matching stream URL for a given resolution from a master m3u8
    function getStreamUrlForResolution(encodingsM3u8, resolutionInfo) {
        const encodingsLines = encodingsM3u8.split(/\r?\n/);
        const [targetWidth, targetHeight] = resolutionInfo.Resolution.split('x').map(Number);
        let matchedResolutionUrl = null;
        let matchedFrameRate = false;
        let closestResolutionUrl = null;
        let closestResolutionDifference = Infinity;
        for (let i = 0; i < encodingsLines.length - 1; i++) {
            if (encodingsLines[i].startsWith('#EXT-X-STREAM-INF') && encodingsLines[i + 1].includes('.m3u8')) {
                const attributes = parseAttributes(encodingsLines[i]);
                const resolution = attributes['RESOLUTION'];
                const frameRate = attributes['FRAME-RATE'];
                if (resolution) {
                    if (resolution == resolutionInfo.Resolution && (!matchedResolutionUrl || (!matchedFrameRate && frameRate == resolutionInfo.FrameRate))) {
                        matchedResolutionUrl = encodingsLines[i + 1];
                        matchedFrameRate = frameRate == resolutionInfo.FrameRate;
                        if (matchedFrameRate) {
                            return matchedResolutionUrl;
                        }
                    }
                    const [width, height] = resolution.split('x').map(Number);
                    const difference = Math.abs((width * height) - (targetWidth * targetHeight));
                    if (difference < closestResolutionDifference) {
                        closestResolutionUrl = encodingsLines[i + 1];
                        closestResolutionDifference = difference;
                    }
                }
            }
        }
        return closestResolutionUrl;
    }
    // Core ad-blocking logic: detect ads in m3u8, fetch backup streams, strip ad segments
    async function processM3U8(url, textStr, realFetch) {
        const streamInfo = StreamInfosByUrl[url];
        if (!streamInfo) {
            return textStr;
        }
        if (HasTriggeredPlayerReload) {
            HasTriggeredPlayerReload = false;
            streamInfo.LastPlayerReload = Date.now();
        }
        if (!streamInfo.HasCheckedUnknownTags) {
            streamInfo.HasCheckedUnknownTags = true;
            const unknownAdTags = textStr.match(/#EXT[^:\n]*(?:ad|cue|scte|sponsor)[^:\n]*/gi);
            if (unknownAdTags) {
                const unknown = unknownAdTags.filter(t => !AdSignifiers.some(s => t.includes(s)));
                if (unknown.length > 0) {
                    console.log('[AD DEBUG] Unknown ad-related tags found: ' + [...new Set(unknown)].join(', '));
                }
            }
        }
        const haveAdTags = hasAdTags(textStr) || SimulatedAdsDepth > 0;
        if (haveAdTags) {
            streamInfo.CleanPlaylistCount = 0;
            streamInfo.IsMidroll = textStr.includes('"MIDROLL"') || textStr.includes('"midroll"');
            if (!streamInfo.IsShowingAd) {
                streamInfo.IsShowingAd = true;
                streamInfo.AdBreakStartedAt = Date.now();
                const podLengthMatch = textStr.match(/X-TV-TWITCH-AD-POD-LENGTH="(\d+)"/);
                const podLength = podLengthMatch ? parseInt(podLengthMatch[1], 10) : 1;
                // Reset early-reload state for new ad break; allow up to one early reload per ad in pod
                streamInfo.PodLength = podLength;
                streamInfo.EarlyReloadTriggered = false;
                streamInfo.EarlyReloadCount = 0;
                streamInfo.EarlyReloadAtPoll = 0;
                streamInfo.SawCSAIFastPath = false;
                streamInfo.LastCommittedBackupPlayerType = null;
                streamInfo.FreezeStartedAt = 0;
                streamInfo.CycleRescuedThisBreak = false;
                console.log('[AD DEBUG] Ad detected — type: ' + (streamInfo.IsMidroll ? 'midroll' : 'preroll') + ', channel: ' + streamInfo.ChannelName + ', pod: ' + podLength + ' ad(s) (~' + (podLength * 30) + 's expected), signifiers: ' + getMatchedAdSignifiers(textStr).join(', '));
                if (!DisableAdSpoofing) {
                    notifyAdComplete(textStr);
                }
                postMessage({
                    key: 'UpdateAdBlockBanner',
                    isMidroll: streamInfo.IsMidroll,
                    hasAds: streamInfo.IsShowingAd,
                    isStrippingAdSegments: false
                });
            }
            if (!streamInfo.IsMidroll) {
                const lines = textStr.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.startsWith('#EXTINF') && lines.length > i + 1) {
                        if (!line.includes(',live') && !streamInfo.RequestedAds.has(lines[i + 1])) {
                            // Only request one .ts file per .m3u8 request to avoid making too many requests
                            //console.log('Fetch ad .ts file');
                            streamInfo.RequestedAds.add(lines[i + 1]);
                            fetch(lines[i + 1]).then((response)=>{response.blob()}).catch(()=>{});
                            break;
                        }
                    }
                }
            }
            const currentResolution = streamInfo.Urls[url];
            if (!currentResolution) {
                console.log('Ads will leak due to missing resolution info for ' + url);
                return stripAdSegments(textStr, false, streamInfo);
            }
            const isHevc = currentResolution.Codecs.startsWith('hev') || currentResolution.Codecs.startsWith('hvc');
            if (((isHevc && !SkipPlayerReloadOnHevc) || AlwaysReloadPlayerOnAd) && streamInfo.ModifiedM3U8 && !streamInfo.IsUsingModifiedM3U8) {
                streamInfo.IsUsingModifiedM3U8 = true;
                streamInfo.LastPlayerReload = Date.now();
                postMessage({
                    key: 'ReloadPlayer'
                });
            }
            // CSAI fast path: if all segments in the main stream are live, skip backup search.
            // CSAI ads are delivered outside the m3u8 — the main stream segments are clean.
            // Just strip tracking URLs and return the main stream directly, avoiding the
            // backup stream switch that causes a 20-40s rebuffer gap.
            const mainStreamLines = textStr.split(/\r?\n/);
            let hasNonLiveSegment = false;
            for (let i = 0; i < mainStreamLines.length; i++) {
                if (mainStreamLines[i].startsWith('#EXTINF') && !mainStreamLines[i].includes(',live')) {
                    hasNonLiveSegment = true;
                    break;
                }
            }
            if (!hasNonLiveSegment && !streamInfo.IsUsingModifiedM3U8) {
                streamInfo.SawCSAIFastPath = true;
                console.log('[AD DEBUG] CSAI fast path — all segments live, skipping backup search');
                if (IsAdStrippingEnabled) {
                    textStr = stripAdSegments(textStr, false, streamInfo);
                }
                postMessage({
                    key: 'UpdateAdBlockBanner',
                    isMidroll: streamInfo.IsMidroll,
                    hasAds: streamInfo.IsShowingAd,
                    isStrippingAdSegments: streamInfo.IsStrippingAdSegments,
                    numStrippedAdSegments: streamInfo.NumStrippedAdSegments,
                    activeBackupPlayerType: null
                });
                return textStr;
            }
            const backupSearchStart = Date.now();
            let backupPlayerType = null;
            let backupM3u8 = null;
            let fallbackM3u8 = null;
            let startIndex = 0;
            let isDoingMinimalRequests = false;
            if (streamInfo.LastPlayerReload > Date.now() - PlayerReloadMinimalRequestsTime) {
                // When doing player reload there are a lot of requests which causes the backup stream to load in slow. Briefly prefer using a single version to prevent long delays
                startIndex = PlayerReloadMinimalRequestsPlayerIndex;
                isDoingMinimalRequests = true;
            }
            // Try pinned backup player type first if available
            const playerTypesToTry = [...BackupPlayerTypes];
            if (streamInfo.PinnedBackupPlayerType) {
                const pinnedIndex = playerTypesToTry.indexOf(streamInfo.PinnedBackupPlayerType);
                if (pinnedIndex > 0) {
                    playerTypesToTry.splice(pinnedIndex, 1);
                    playerTypesToTry.unshift(streamInfo.PinnedBackupPlayerType);
                }
            }
            for (let playerTypeIndex = startIndex; !backupM3u8 && playerTypeIndex < playerTypesToTry.length; playerTypeIndex++) {
                const playerType = playerTypesToTry[playerTypeIndex];
                const realPlayerType = playerType.replace('-CACHED', '');
                const failedAt = streamInfo.FailedBackupPlayerTypes.get(realPlayerType);
                if (failedAt && (Date.now() - failedAt) < 15000) {
                    continue;
                }
                const isFullyCachedPlayerType = playerType != realPlayerType;
                for (let i = 0; i < 2; i++) {
                    // This caches the m3u8 if it doesn't have ads. If the already existing cache has ads it fetches a new version (second loop)
                    let isFreshM3u8 = false;
                    let encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType];
                    if (!encodingsM3u8) {
                        isFreshM3u8 = true;
                        try {
                            const accessTokenResponse = await getAccessToken(streamInfo.ChannelName, realPlayerType);
                            if (accessTokenResponse.status === 200) {
                                const accessToken = await accessTokenResponse.json();
                                if (!accessToken?.data?.streamPlaybackAccessToken) {
                                    console.log('[AD DEBUG] GQL response format changed — missing data.streamPlaybackAccessToken for ' + realPlayerType + '. Response keys: ' + JSON.stringify(Object.keys(accessToken?.data || accessToken || {})));
                                    continue;
                                }
                                const urlInfo = new URL('https://usher.ttvnw.net/api/' + (V2API ? 'v2/' : '') + 'channel/hls/' + streamInfo.ChannelName + '.m3u8' + streamInfo.UsherParams);
                                urlInfo.searchParams.set('sig', accessToken.data.streamPlaybackAccessToken.signature);
                                urlInfo.searchParams.set('token', accessToken.data.streamPlaybackAccessToken.value);
                                const encodingsM3u8Response = await realFetch(urlInfo.href);
                                if (encodingsM3u8Response.status === 200) {
                                    encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType] = await encodingsM3u8Response.text();
                                } else {
                                    console.log('[AD DEBUG] Usher HTTP ' + encodingsM3u8Response.status + ' for ' + realPlayerType);
                                }
                            } else {
                                let errorBody = '';
                                try { errorBody = ' — ' + (await accessTokenResponse.text()).substring(0, 200); } catch {}
                                console.log('[AD DEBUG] Access token HTTP ' + accessTokenResponse.status + ' for ' + realPlayerType + (accessTokenResponse.status === 403 ? ' (integrity: ' + (ClientIntegrityHeader ? 'present' : 'missing') + ')' : '') + errorBody);
                                streamInfo.FailedBackupPlayerTypes.set(realPlayerType, Date.now());
                            }
                        } catch (err) {
                            console.log('[AD DEBUG] Access token failed for ' + realPlayerType + ': ' + err.message);
                            streamInfo.FailedBackupPlayerTypes.set(realPlayerType, Date.now());
                        }
                    }
                    if (encodingsM3u8) {
                        try {
                            const streamM3u8Url = getStreamUrlForResolution(encodingsM3u8, currentResolution);
                            const streamM3u8Response = await realFetch(streamM3u8Url);
                            if (streamM3u8Response.status == 200) {
                                const m3u8Text = await streamM3u8Response.text();
                                if (m3u8Text) {
                                    if (playerType == FallbackPlayerType) {
                                        fallbackM3u8 = m3u8Text;
                                    }
                                    if ((!hasAdTags(m3u8Text) && (SimulatedAdsDepth == 0 || playerTypeIndex >= SimulatedAdsDepth - 1)) || (!fallbackM3u8 && playerTypeIndex >= playerTypesToTry.length - 1)) {
                                        if ((streamInfo.ConsecutiveAllStrippedPolls || 0) >= 2 && !hasAdTags(m3u8Text)) {
                                            const prevType = streamInfo.LastCommittedBackupPlayerType;
                                            if (prevType && prevType !== playerType) {
                                                console.log('[AD DEBUG] Cycle switched to different clean type (' + playerType + ', was ' + prevType + ') during freeze — recovered without reload');
                                                // Only mark as cycle-rescued when we ACTUALLY switched player types.
                                                // Natural recovery (same type became clean) still needs the end-of-break
                                                // reload to refresh the player buffer — skipping it leaves the player
                                                // stuck with low buffer and the buffer monitor unable to recover.
                                                streamInfo.CycleRescuedThisBreak = true;
                                            } else {
                                                console.log('[AD DEBUG] Same backup type (' + playerType + ') became clean during freeze — natural recovery');
                                            }
                                        }
                                        backupPlayerType = playerType;
                                        backupM3u8 = m3u8Text;
                                        break;
                                    }
                                    if (hasAdTags(m3u8Text)) {
                                        if (!streamInfo.LoggedBackupAdsByType) streamInfo.LoggedBackupAdsByType = new Set();
                                        if (!streamInfo.LoggedBackupAdsByType.has(playerType)) {
                                            streamInfo.LoggedBackupAdsByType.add(playerType);
                                            console.log('[AD DEBUG] Backup stream (' + playerType + ') also has ads');
                                        }
                                    }
                                    if (isFullyCachedPlayerType) {
                                        break;
                                    }
                                    // Keep iterating other player types in case one is clean.
                                    // Take ad-laden backup as last resort: minimal-requests window,
                                    // 3+ ad breaks with 0 strips (false positive), or final type tried.
                                    if (isDoingMinimalRequests || streamInfo.ConsecutiveZeroStripBreaks >= 3 || playerTypeIndex >= playerTypesToTry.length - 1) {
                                        if (playerTypeIndex >= playerTypesToTry.length - 1 && !isDoingMinimalRequests && streamInfo.ConsecutiveZeroStripBreaks < 3) {
                                            console.log('[AD DEBUG] All backup player types ad-laden — taking ' + playerType + ' as last-resort fallback (strip+recovery path will engage)');
                                        }
                                        backupPlayerType = playerType;
                                        backupM3u8 = m3u8Text;
                                        break;
                                    }
                                }
                            } else {
                                console.log('[AD DEBUG] Backup stream fetch failed for ' + playerType + ' (status ' + streamM3u8Response.status + ')');
                            }
                        } catch (err) {
                            console.log('[AD DEBUG] Backup stream error for ' + playerType + ': ' + err.message);
                        }
                    }
                    streamInfo.BackupEncodingsM3U8Cache[playerType] = null;
                    if (isFreshM3u8) {
                        break;
                    }
                }
            }
            if (!backupM3u8 && fallbackM3u8) {
                backupPlayerType = FallbackPlayerType;
                backupM3u8 = fallbackM3u8;
            }
            if (backupM3u8) {
                textStr = backupM3u8;
                streamInfo.LastCommittedBackupPlayerType = backupPlayerType;
                if (streamInfo.ActiveBackupPlayerType != backupPlayerType) {
                    streamInfo.ActiveBackupPlayerType = backupPlayerType;
                    // Auto-pin source-quality backup types (embed, site, popout) to skip failed types on next break.
                    // Never auto-pin low-quality types (autoplay, mobile_web) to avoid quality lock.
                    const sourceQualityTypes = ['embed', 'site', 'popout'];
                    if (PinBackupPlayerType || sourceQualityTypes.includes(backupPlayerType)) {
                        streamInfo.PinnedBackupPlayerType = backupPlayerType;
                    }
                    console.log(`Blocking${(streamInfo.IsMidroll ? ' midroll ' : ' ')}ads (${backupPlayerType}) — backup found in ${Date.now() - backupSearchStart}ms`);
                    streamInfo.LastBackupSwitch = Date.now();
                }
            } else {
                console.log('[AD DEBUG] No ad-free backup stream found — ads may leak. Tried: ' + playerTypesToTry.slice(startIndex).join(', '));
            }
            // TODO: Improve hevc stripping. It should always strip when there is a codec mismatch (both ways)
            const stripHevc = isHevc && streamInfo.ModifiedM3U8;
            if (IsAdStrippingEnabled || stripHevc) {
                textStr = stripAdSegments(textStr, stripHevc, streamInfo);
            } else if (!backupM3u8) {
                console.log('[AD DEBUG] Ad stripping disabled and no backup — ads WILL show');
            }
            // Log reload outcome on the poll after early reload triggered
            if (streamInfo.EarlyReloadAwaitingResult) {
                streamInfo.EarlyReloadAwaitingResult = false;
                if (textStr.includes(',live') && streamInfo.IsStrippingAdSegments) {
                    console.log('[AD DEBUG] Early reload result: partial — some live segments returned');
                } else if (!streamInfo.IsStrippingAdSegments) {
                    console.log('[AD DEBUG] Early reload result: clean — freeze ended');
                    // Reset trigger flag so subsequent freezes within the same pod can re-fire (bounded by EarlyReloadCount/PodLength)
                    streamInfo.EarlyReloadTriggered = false;
                } else {
                    console.log('[AD DEBUG] Early reload result: still ads — continuing recovery loop');
                }
            }
            // Early reload during prolonged freeze: if we've been looping recovery segments
            // for N+ polls, trigger a reload to attempt fresh content. Bounded to one reload
            // per ad in the pod (e.g. 2-ad pod = up to 2 early reloads).
            const maxEarlyReloads = Math.max(1, streamInfo.PodLength || 1);
            // Thin recovery cache fast path: when fewer than 3 live segments are cached
            // for fallback, the player will burn through them in seconds. Trigger early
            // reload immediately on the first all-stripped poll instead of waiting for
            // the normal threshold — the ~1-2s reload disruption is much shorter than
            // the strip+buffer-rebuild stall that would otherwise occur (~10-15s).
            const recoveryThin = (streamInfo.RecoverySegments?.length || 0) < 3;
            const effectiveThreshold = recoveryThin ? 1 : EarlyReloadPollThreshold;
            if (EarlyReloadPollThreshold > 0 && (streamInfo.ConsecutiveAllStrippedPolls || 0) >= effectiveThreshold && !streamInfo.EarlyReloadTriggered && (streamInfo.EarlyReloadCount || 0) < maxEarlyReloads) {
                streamInfo.EarlyReloadTriggered = true;
                streamInfo.EarlyReloadAwaitingResult = true;
                streamInfo.EarlyReloadCount = (streamInfo.EarlyReloadCount || 0) + 1;
                streamInfo.EarlyReloadAtPoll = streamInfo.TotalAllStrippedPolls || streamInfo.ConsecutiveAllStrippedPolls;
                const reason = recoveryThin ? ' (thin recovery cache: ' + (streamInfo.RecoverySegments?.length || 0) + ' segments)' : '';
                console.log('[AD DEBUG] Early reload triggered — ' + streamInfo.ConsecutiveAllStrippedPolls + ' consecutive all-stripped polls' + reason + ' [' + streamInfo.EarlyReloadCount + '/' + maxEarlyReloads + ']');
                postMessage({ key: 'ReloadPlayer' });
            }
        } else if (streamInfo.IsShowingAd) {
            streamInfo.CleanPlaylistCount++;
            // Check if the current playlist has live segments — if not, backup stream is dead
            const hasLiveSegments = textStr.includes(',live');
            if (streamInfo.CleanPlaylistCount >= 2 || !hasLiveSegments) {
                if (!hasLiveSegments) {
                    console.log('[AD DEBUG] Backup stream has no live segments — forcing immediate reload');
                }
                const adBreakDurationSec = streamInfo.AdBreakStartedAt ? ((Date.now() - streamInfo.AdBreakStartedAt) / 1000).toFixed(1) : '?';
                console.log('Finished blocking ads — stripped ' + streamInfo.NumStrippedAdSegments + ' ad segments, duration: ' + adBreakDurationSec + 's (IsUsingModifiedM3U8: ' + streamInfo.IsUsingModifiedM3U8 + ')');
                if (streamInfo.TotalAllStrippedPolls > 0) {
                    const reloadInfo = streamInfo.EarlyReloadAtPoll ? ', early reload at poll ' + streamInfo.EarlyReloadAtPoll : '';
                    const wallClockFreeze = streamInfo.FreezeStartedAt ? ((Date.now() - streamInfo.FreezeStartedAt) / 1000).toFixed(1) + 's wall-clock' : 'unknown';
                    console.log('[AD DEBUG] Ad break stats: ' + streamInfo.TotalAllStrippedPolls + ' all-stripped polls, freeze duration: ' + wallClockFreeze + reloadInfo);
                }
                const hadStrippedSegments = streamInfo.NumStrippedAdSegments > 0;
                // Only count toward false-positive guard if it was NOT a CSAI-only break.
                // CSAI breaks are real ads delivered outside the m3u8 — they legitimately
                // produce 0 stripped segments and should not be flagged as false positives.
                if (!hadStrippedSegments && !streamInfo.SawCSAIFastPath) {
                    if (!streamInfo.ConsecutiveZeroStripBreaks) streamInfo.ConsecutiveZeroStripBreaks = 0;
                    streamInfo.ConsecutiveZeroStripBreaks++;
                    if (streamInfo.ConsecutiveZeroStripBreaks >= 3) {
                        console.log('[AD DEBUG] Warning: ' + streamInfo.ConsecutiveZeroStripBreaks + ' consecutive non-CSAI ad breaks with 0 segments stripped — possible false positive from ad signifiers');
                    }
                } else if (hadStrippedSegments) {
                    streamInfo.ConsecutiveZeroStripBreaks = 0;
                }
                streamInfo.IsShowingAd = false;
                streamInfo.IsStrippingAdSegments = false;
                streamInfo.NumStrippedAdSegments = 0;
                streamInfo.ActiveBackupPlayerType = null;
                streamInfo.RequestedAds.clear();
                streamInfo.FailedBackupPlayerTypes.clear();
                if (streamInfo.LoggedBackupAdsByType) streamInfo.LoggedBackupAdsByType.clear();
                streamInfo.CleanPlaylistCount = 0;
                streamInfo.ConsecutiveAllStrippedPolls = 0;
                streamInfo.EarlyReloadTriggered = false;
                streamInfo.EarlyReloadAwaitingResult = false;
                streamInfo.EarlyReloadAtPoll = 0;
                streamInfo.TotalAllStrippedPolls = 0;
                // Auto-escalate cooldown: if 3+ reloads in last 2 min, triple the cooldown to reduce cascade pressure
                if (!streamInfo.ReloadTimestamps) streamInfo.ReloadTimestamps = [];
                streamInfo.ReloadTimestamps = streamInfo.ReloadTimestamps.filter(t => Date.now() - t < 300000);
                const recentReloads = streamInfo.ReloadTimestamps.filter(t => Date.now() - t < 300000).length;
                const effectiveCooldown = recentReloads >= 3 ? ReloadCooldownSeconds * 3 : ReloadCooldownSeconds;
                const tooSoonSinceLastReload = streamInfo.LastPlayerReload && (Date.now() - streamInfo.LastPlayerReload) < (effectiveCooldown * 1000);
                // CSAI-only ad break: backup was used but no segments were stripped.
                // Skip reload entirely — avoids CSAI cascade on ad-heavy channels.
                // Clearing the flag makes next m3u8 poll serve main stream seamlessly.
                if (!hadStrippedSegments) {
                    console.log('[AD DEBUG] CSAI-only ad break (stripped 0) — clearing backup without player action');
                    streamInfo.IsUsingModifiedM3U8 = false;
                } else {
                // Skip end-of-break reload when cycle rescue handled the break cleanly:
                // a freeze of ≤2 polls (~4s) was resolved by switching to a clean backup,
                // and no early reload was needed. The player is on a healthy backup stream
                // — reloading just to return to the canonical player type causes an unnecessary
                // ~1-2s loading circle.
                const cycleRescuedCleanly = streamInfo.CycleRescuedThisBreak &&
                    (streamInfo.TotalAllStrippedPolls || 0) <= 2 &&
                    (streamInfo.EarlyReloadCount || 0) === 0;
                if (cycleRescuedCleanly) {
                    console.log('[AD DEBUG] Cycle rescue handled the break cleanly — skipping end-of-break reload');
                }
                // Reload if backup was used AND segments were stripped (need clean state). Otherwise, respect ReloadPlayerAfterAd + cooldown.
                const shouldReload = streamInfo.IsUsingModifiedM3U8 || (ReloadPlayerAfterAd && hadStrippedSegments && !tooSoonSinceLastReload && !cycleRescuedCleanly);
                console.log('[AD DEBUG] Reload decision: shouldReload=' + shouldReload + ' IsUsingModifiedM3U8=' + streamInfo.IsUsingModifiedM3U8 + ' hadStripped=' + hadStrippedSegments + ' tooSoon=' + tooSoonSinceLastReload + ' cooldown=' + effectiveCooldown + 's');
                if (shouldReload) {
                    streamInfo.ReloadTimestamps.push(Date.now());// Only track actual reloads, not skipped ones
                    streamInfo.IsUsingModifiedM3U8 = false;
                    streamInfo.LastPlayerReload = Date.now();
                    postMessage({
                        key: 'ReloadPlayer'
                    });
                } else {
                    if (tooSoonSinceLastReload) {
                        console.log('[AD DEBUG] Skipping reload — last reload was ' + ((Date.now() - streamInfo.LastPlayerReload) / 1000).toFixed(0) + 's ago (cooldown: ' + effectiveCooldown + 's' + (recentReloads >= 3 ? ', auto-escalated from ' + recentReloads + ' reloads in 5min' : '') + ')');
                    }
                    postMessage({
                        key: 'PauseResumePlayer'
                    });
                }
                }// end else (non-CSAI path)
            }
        }
        postMessage({
            key: 'UpdateAdBlockBanner',
            isMidroll: streamInfo.IsMidroll,
            hasAds: streamInfo.IsShowingAd,
            isStrippingAdSegments: streamInfo.IsStrippingAdSegments,
            numStrippedAdSegments: streamInfo.NumStrippedAdSegments,
            activeBackupPlayerType: streamInfo.ActiveBackupPlayerType
        });
        return textStr;
    }
    function parseAttributes(str) {
        return Object.fromEntries(
            str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/)
            .filter(Boolean)
            .map(x => {
                const idx = x.indexOf('=');
                const key = x.substring(0, idx);
                const value = x.substring(idx + 1);
                const num = Number(value);
                return [key, Number.isNaN(num) ? value.startsWith('"') ? JSON.parse(value) : value : num];
            }));
    }
    // Request a playback access token from Twitch GQL using the given player type
    function getAccessToken(channelName, playerType) {
        const body = {
            operationName: 'PlaybackAccessToken',
            variables: {
                isLive: true,
                login: channelName,
                isVod: false,
                vodID: "",
                playerType: playerType,
                platform: playerType == 'autoplay' ? 'android' : 'web'
            },
            extensions: {
                persistedQuery: {
                    version:1,
                    sha256Hash:"ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"
                }
            }
        };
        return gqlRequest(body, playerType);
    }
    // Send a GQL request to Twitch via the main thread (workers can't make credentialed requests)
    function gqlRequest(body, playerType) {
        if (!GQLDeviceID) {
            GQLDeviceID = '';
            const dcharacters = 'abcdefghijklmnopqrstuvwxyz0123456789';
            const dcharactersLength = dcharacters.length;
            for (let i = 0; i < 32; i++) {
                GQLDeviceID += dcharacters.charAt(Math.floor(Math.random() * dcharactersLength));
            }
        }
        let headers = {
            'Client-ID': ClientID,
            'X-Device-Id': GQLDeviceID,
            'Authorization': AuthorizationHeader,
            ...(ClientIntegrityHeader && {'Client-Integrity': ClientIntegrityHeader}),
            ...(ClientVersion && {'Client-Version': ClientVersion}),
            ...(ClientSession && {'Client-Session-Id': ClientSession})
        };
        return new Promise((resolve, reject) => {
            const requestId = Math.random().toString(36).substring(2, 15);
            const fetchRequest = {
                id: requestId,
                url: 'https://gql.twitch.tv/gql',
                options: {
                    method: 'POST',
                    body: JSON.stringify(body),
                    headers
                }
            };
            pendingFetchRequests.set(requestId, {
                resolve,
                reject
            });
            postMessage({
                key: 'FetchRequest',
                value: fetchRequest
            });
        });
    }
    let playerForMonitoringBuffering = null;
    let driftCatchUpInterval = null;
    let driftCatchUpTimeout = null;
    function startDriftCorrection(videoElement) {
        if (DriftCorrectionRate <= 1) return;
        if (driftCatchUpInterval) { clearInterval(driftCatchUpInterval); driftCatchUpInterval = null; }
        if (driftCatchUpTimeout) { clearTimeout(driftCatchUpTimeout); driftCatchUpTimeout = null; }
        videoElement.playbackRate = DriftCorrectionRate;
        console.log('[AD DEBUG] Drift correction: catching up at ' + DriftCorrectionRate + 'x');
        driftCatchUpInterval = setInterval(() => {
            try {
                const vid = document.querySelector('video');
                if (vid && vid.buffered.length > 0) {
                    if (vid.buffered.end(vid.buffered.length - 1) - vid.currentTime <= 1) {
                        vid.playbackRate = 1.0;
                        console.log('[AD DEBUG] Drift correction complete — resumed normal playback speed');
                        clearInterval(driftCatchUpInterval); driftCatchUpInterval = null;
                        if (driftCatchUpTimeout) { clearTimeout(driftCatchUpTimeout); driftCatchUpTimeout = null; }
                    }
                }
            } catch { clearInterval(driftCatchUpInterval); driftCatchUpInterval = null; }
        }, 500);
        driftCatchUpTimeout = setTimeout(() => {
            try { videoElement.playbackRate = 1.0; } catch {}
            if (driftCatchUpInterval) { clearInterval(driftCatchUpInterval); driftCatchUpInterval = null; }
            driftCatchUpTimeout = null;
        }, 30000);
    }
    const playerBufferState = {
        channelName: null,
        hasStreamStarted: false,
        position: 0,
        bufferedPosition: 0,
        bufferDuration: 0,
        numSame: 0,
        fixAttempts: 0,
        lastFixTime: 0,
        isLive: true
    };
    // Poll the player state to detect and fix buffering caused by ad stream switching
    function monitorPlayerBuffering() {
        // Fresh player lookup every tick (avoids stale ref when Twitch restarts its own player)
        playerForMonitoringBuffering = null;
        {
            const playerAndState = getPlayerAndState();
            if (playerAndState && playerAndState.player && playerAndState.state) {
                playerForMonitoringBuffering = {
                    player: playerAndState.player,
                    state: playerAndState.state
                };
                // Track user pause intent on the video element (once per element)
                const video = playerAndState.player.getHTMLVideoElement?.();
                if (video && !video.__tasIntentHooked) {
                    video.__tasIntentHooked = true;
                    video.addEventListener('pause', () => {
                        if (!playerBufferState.weJustPaused || (Date.now() - playerBufferState.weJustPaused) > 2000) {
                            playerBufferState.userPauseIntent = true;
                        }
                    });
                    video.addEventListener('play', () => {
                        playerBufferState.userPauseIntent = false;
                        playerBufferState.loggedPauseIntent = false;
                    });
                }
            }
        }
        if (playerForMonitoringBuffering) {
            try {
                const player = playerForMonitoringBuffering.player;
                const state = playerForMonitoringBuffering.state;
                if (!player.core) {
                    playerForMonitoringBuffering = null;
                } else if (state.props?.content?.type === 'live' && !player.isPaused() && !player.getHTMLVideoElement()?.ended && (player.getHTMLVideoElement()?.readyState ?? 0) >= 1 && playerBufferState.lastFixTime <= Date.now() - PlayerBufferingMinRepeatDelay && !isActivelyStrippingAds && !playerBufferState.inAdBreak && (!playerBufferState.lastReloadAt || Date.now() - playerBufferState.lastReloadAt >= 15000) && (!playerBufferState.lastBackupSwitchAt || Date.now() - playerBufferState.lastBackupSwitchAt >= 10000)) {
                    const m3u8Url = player.core?.state?.path;
                    if (m3u8Url) {
                      const lastSlash = m3u8Url.lastIndexOf('/');
                      const queryStart = m3u8Url.indexOf('?', lastSlash);
                      const fileName = m3u8Url.substring(lastSlash + 1, queryStart !== -1 ? queryStart : undefined);
                      if (fileName?.endsWith('.m3u8')) {
                          const channelName = fileName.slice(0, -5);
                          if (playerBufferState.channelName != channelName) {
                              playerBufferState.channelName = channelName;
                              playerBufferState.hasStreamStarted = false;
                              playerBufferState.numSame = 0;
                              playerBufferState.fixAttempts = 0;
                              playerBufferState.recoveryReloadUsed = false;
                              playerBufferState.userPauseIntent = false;
                        playerBufferState.loggedPauseIntent = false;
                              //console.log('Channel changed to ' + channelName);
                          }
                      }
                    }
                    if (player.getState() === 'Playing') {
                        playerBufferState.hasStreamStarted = true;
                    }
                    const position = player.core?.state?.position;
                    const bufferedPosition = player.core?.state?.bufferedPosition;
                    const bufferDuration = player.getBufferDuration();
                    if (position !== undefined && bufferedPosition !== undefined) {
                        //console.log('position:' + position + ' bufferDuration:' + bufferDuration + ' bufferPosition:' + bufferedPosition + ' state: ' + player.core?.state?.state + ' started: ' + playerBufferState.hasStreamStarted);
                        // NOTE: This could be improved. It currently lets the player fully eat the full buffer before it triggers pause/play
                        if (playerBufferState.hasStreamStarted &&
                            (!PlayerBufferingPrerollCheckEnabled || position > PlayerBufferingPrerollCheckOffset) &&
                            (playerBufferState.position == position || bufferDuration < PlayerBufferingDangerZone)  &&
                            playerBufferState.bufferedPosition == bufferedPosition &&
                            playerBufferState.bufferDuration >= bufferDuration &&
                            (position != 0 || bufferedPosition != 0 || bufferDuration != 0)
                        ) {
                            playerBufferState.numSame++;
                            if (playerBufferState.numSame == PlayerBufferingSameStateCount) {
                                playerBufferState.fixAttempts++;
                                // Cap: at most ONE reload per recovery window. After reloading once,
                                // stay on pause/play until playback recovers. Prevents reload cascades.
                                const wouldEscalate = playerBufferState.fixAttempts >= 3;
                                const escalateToReload = wouldEscalate && (DisableReloadCap || !playerBufferState.recoveryReloadUsed);
                                const reloadCapNote = wouldEscalate && !escalateToReload ? ' (reload cap reached, pause/play only — set twitchAdSolutions_disableReloadCap=true to bypass)' : (escalateToReload ? ' (escalating to reload)' : '');
                                console.log('Attempt to fix buffering position:' + playerBufferState.position + ' bufferedPosition:' + playerBufferState.bufferedPosition + ' bufferDuration:' + playerBufferState.bufferDuration + reloadCapNote);
                                // Seek past buffer gap instead of stalling
                                const video = player.getHTMLVideoElement?.();
                                if (video && video.buffered.length > 1) {
                                    for (let bi = 0; bi < video.buffered.length; bi++) {
                                        if (video.buffered.start(bi) > video.currentTime + 0.5) {
                                            console.log('[AD DEBUG] Seeking past ' + (video.buffered.start(bi) - video.currentTime).toFixed(1) + 's buffer gap');
                                            video.currentTime = video.buffered.start(bi);
                                            startDriftCorrection(video);
                                            break;
                                        }
                                    }
                                }
                                if (video) {
                                    console.log('[AD DEBUG] Video state: readyState=' + video.readyState + ' networkState=' + video.networkState + ' buffered=' + (video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1).toFixed(1) : 0) + ' currentTime=' + video.currentTime.toFixed(1) + ' paused=' + video.paused);
                                }
                                const isPausePlay = escalateToReload ? false : !PlayerBufferingDoPlayerReload;
                                const isReload = escalateToReload ? true : PlayerBufferingDoPlayerReload;
                                doTwitchPlayerTask(isPausePlay, isReload);
                                playerBufferState.lastFixTime = Date.now();
                                playerBufferState.numSame = 0;
                                if (escalateToReload) {
                                    playerBufferState.fixAttempts = 0;
                                    playerBufferState.recoveryReloadUsed = true;
                                }
                            }
                        } else {
                            playerBufferState.numSame = 0;
                            playerBufferState.fixAttempts = 0;
                            playerBufferState.recoveryReloadUsed = false;
                        }
                        // Detect position jump (native gap recovery) — drift to catch up
                        // Skip during ad breaks and 10s after: backup stream switching causes buffer gaps that trigger false jumps
                        if (playerBufferState.position > 0 && position - playerBufferState.position > 5 && !playerBufferState.inAdBreak && (!playerBufferState.lastBackupSwitchAt || Date.now() - playerBufferState.lastBackupSwitchAt >= 10000)) {
                            console.log('[AD DEBUG] Position jumped ' + (position - playerBufferState.position).toFixed(1) + 's — starting drift correction');
                            startDriftCorrection(player.getHTMLVideoElement?.());
                        }
                        playerBufferState.position = position;
                        playerBufferState.bufferedPosition = bufferedPosition;
                        playerBufferState.bufferDuration = bufferDuration;
                    } else {
                        playerBufferState.numSame = 0;
                    }
                }
            } catch (err) {
                console.error('error when monitoring player for buffering: ' + err);
                playerForMonitoringBuffering = null;
            }
        }
        // Loading-circle health check: during an ad strip+recovery loop the normal buffer monitor
        // is gated off (isActivelyStrippingAds), so a visibly stalled player would otherwise wait
        // for the worker's poll-based early reload (~10s). This catches the visible stall ~3s after
        // it starts and triggers a reload directly, eliminating most of the loading-circle window.
        if (isActivelyStrippingAds && playerForMonitoringBuffering) {
            try {
                const player = playerForMonitoringBuffering.player;
                const video = player?.getHTMLVideoElement?.();
                if (video && !video.ended && !playerBufferState.userPauseIntent) {
                    // Track whether the player has ever had data — distinguishes a real stall
                    // (had data, lost data) from initial player init (never had data yet).
                    // Without this, fresh page load + preroll causes PR #96 to misfire repeatedly
                    // because readyState=0 is normal during init.
                    if (video.readyState >= 3) {
                        playerBufferState.hasHadData = true;
                    }
                    const isStalled = video.readyState < 3 && (video.paused || video.networkState === 2);
                    const stallReloadCooldown = 15000;
                    const cooldownExpired = !playerBufferState.lastAdStallReloadAt || (Date.now() - playerBufferState.lastAdStallReloadAt) > stallReloadCooldown;
                    if (isStalled && cooldownExpired && playerBufferState.hasHadData) {
                        if (!playerBufferState.adStallStartAt) {
                            playerBufferState.adStallStartAt = Date.now();
                        } else if ((Date.now() - playerBufferState.adStallStartAt) > 3000) {
                            console.log('[AD DEBUG] Loading circle detected during ad break (' + ((Date.now() - playerBufferState.adStallStartAt) / 1000).toFixed(1) + 's stall, readyState=' + video.readyState + ') — early reload');
                            playerBufferState.lastAdStallReloadAt = Date.now();
                            playerBufferState.adStallStartAt = 0;
                            doTwitchPlayerTask(false, true);
                        }
                    } else if (!isStalled) {
                        playerBufferState.adStallStartAt = 0;
                    }
                }
            } catch {}
        } else if (!isActivelyStrippingAds && playerBufferState.adStallStartAt) {
            playerBufferState.adStallStartAt = 0;
        }
        const isLive = playerForMonitoringBuffering?.state?.props?.content?.type === 'live';
        if (playerBufferState.isLive && !isLive) {
            updateAdblockBanner({
                hasAds: false
            });
        }
        playerBufferState.isLive = isLive;
        // Force immediate tick when tab becomes visible so stalls are caught fast on return
        if (typeof document !== 'undefined' && !monitorPlayerBuffering.visibilityHooked) {
            monitorPlayerBuffering.visibilityHooked = true;
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && !monitorPlayerBuffering.pendingTick) {
                    monitorPlayerBuffering.pendingTick = true;
                    setTimeout(() => { monitorPlayerBuffering.pendingTick = false; monitorPlayerBuffering(); }, 100);
                }
            });
        }
        // Visibility-aware backoff: poll 3x slower when tab is hidden (but NOT during PiP — user is still watching)
        const shouldThrottle = typeof document !== 'undefined' && document.hidden && !document.pictureInPictureElement;
        const nextDelay = shouldThrottle ? PlayerBufferingDelay * 3 : PlayerBufferingDelay;
        setTimeout(monitorPlayerBuffering, nextDelay);
    }
    // Hide Twitch's ad break / Turbo promo overlay when we're already blocking ads
    function hideTwitchAdOverlays() {
        if (!cachedPlayerRootDiv || !cachedPlayerRootDiv.isConnected) return;
        const promoLinks = cachedPlayerRootDiv.querySelectorAll(
            'a[href*="/how-to-allow-ads-browser"], a[href="https://www.twitch.tv/turbo"]'
        );
        for (let i = 0; i < promoLinks.length; i++) {
            const overlay = promoLinks[i].closest('.player-overlay-background');
            if (overlay && !overlay.dataset.tasHidden) {
                overlay.dataset.tasHidden = '';
                overlay.style.setProperty('display', 'none', 'important');
                console.log('[AD DEBUG] Hidden Twitch ad/Turbo promo overlay');
            }
        }
    }
    function updateAdblockBanner(data) {
        if (!cachedPlayerRootDiv || !cachedPlayerRootDiv.isConnected) {
            cachedPlayerRootDiv = document.querySelector('.video-player');
        }
        const playerRootDiv = cachedPlayerRootDiv;
        if (playerRootDiv != null) {
            let adBlockDiv = null;
            adBlockDiv = playerRootDiv.querySelector('.tas-adblock-overlay');
            if (adBlockDiv == null) {
                adBlockDiv = document.createElement('div');
                adBlockDiv.className = 'tas-adblock-overlay';
                adBlockDiv.innerHTML = '<div class="player-adblock-notice" style="color: white; background-color: rgba(0, 0, 0, 0.8); position: absolute; top: 0px; left: 0px; padding: 5px;"><p></p></div>';
                adBlockDiv.style.display = 'none';
                adBlockDiv.P = adBlockDiv.querySelector('p');
                playerRootDiv.appendChild(adBlockDiv);
            }
            if (adBlockDiv != null) {
                isActivelyStrippingAds = data.isStrippingAdSegments;
                adBlockDiv.P.textContent = 'Blocking' + (data.isMidroll ? ' midroll' : '') + ' ads' + (data.isStrippingAdSegments ? ' (stripping)' : '') + (data.activeBackupPlayerType ? ' (' + data.activeBackupPlayerType + ')' : '');
                adBlockDiv.style.display = data.hasAds && playerBufferState.isLive ? 'block' : 'none';
            }
            if (data.hasAds) {
                hideTwitchAdOverlays();
            }
        }
    }
    // Traverse React's fiber tree to find Twitch's player and player state instances
    function getPlayerAndState() {
        function findReactNode(root, constraint) {
            if (root.stateNode && constraint(root.stateNode)) {
                return root.stateNode;
            }
            let node = root.child;
            while (node) {
                const result = findReactNode(node, constraint);
                if (result) {
                    return result;
                }
                node = node.sibling;
            }
            return null;
        }
        function findReactRootNode() {
            let reactRootNode = null;
            if (!cachedRootNode) {
                cachedRootNode = document.querySelector('#root');
            }
            const rootNode = cachedRootNode;
            if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
                reactRootNode = rootNode._reactRootContainer._internalRoot.current;
            }
            if (reactRootNode == null && rootNode != null) {
                const containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
                if (containerName != null) {
                    reactRootNode = rootNode[containerName];
                }
            }
            return reactRootNode;
        }
        const reactRootNode = findReactRootNode();
        if (!reactRootNode) {
            return null;
        }
        let player = findReactNode(reactRootNode, node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
        player = player && player.props && player.props.mediaPlayerInstance ? player.props.mediaPlayerInstance : null;
        if (player?.playerInstance) {
            player = player.playerInstance;
        }
        const playerState = findReactNode(reactRootNode, node => node.setSrc && node.setInitialPlaybackSettings);
        if (!player && !getPlayerAndState.loggedNoPlayer) {
            getPlayerAndState.loggedNoPlayer = true;
            console.log('[AD DEBUG] Player not found — Twitch may have renamed setPlayerActive/mediaPlayerInstance');
        }
        if (!playerState && !getPlayerAndState.loggedNoState) {
            getPlayerAndState.loggedNoState = true;
            console.log('[AD DEBUG] Player state not found — Twitch may have renamed setSrc/setInitialPlaybackSettings');
        }
        return  {
            player: player,
            state: playerState
        };
    }
    // Pause/play or fully reload the Twitch player, preserving quality/volume settings
    function doTwitchPlayerTask(isPausePlay, isReload) {
        const playerAndState = getPlayerAndState();
        if (!playerAndState) {
            return;
        }
        const player = playerAndState.player;
        const playerState = playerAndState.state;
        if (!player) {
            console.log('Could not find player');
            return;
        }
        if (!playerState) {
            console.log('Could not find player state');
            return;
        }
        const wasPaused = player.isPaused() || player.core?.paused;
        // Only block pause/play toggle if already paused — still allow reloads
        if (isPausePlay && wasPaused) {
            // User deliberately paused — respect their intent, don't auto-resume
            if (playerBufferState.userPauseIntent) {
                if (!playerBufferState.loggedPauseIntent) {
                    playerBufferState.loggedPauseIntent = true;
                    console.log('[AD DEBUG] Respecting user pause intent — skipping auto-resume');
                }
                return;
            }
            // If WE recently called pause/play and player is still paused, retry play (stuck from autoplay policy or ad-state interference)
            if (playerBufferState.weJustPaused && (Date.now() - playerBufferState.weJustPaused) < 10000) {
                try { player.play()?.catch?.(() => {}); } catch {}
            }
            return;
        }
        if (!wasPaused) {
            playerBufferState.weJustPaused = 0;
        }
        playerBufferState.lastFixTime = Date.now();
        playerBufferState.numSame = 0;
        if (isPausePlay) {
            player.pause();
            player.play()?.catch?.(() => {});
            playerBufferState.weJustPaused = Date.now();
            return;
        }
        if (isReload) {
            // Skip reload if the player is already healthy — avoids disrupting smooth playback
            const video = player.getHTMLVideoElement?.();
            if (video && video.readyState >= 3 && !video.paused && !video.ended) {
                console.log('[AD DEBUG] Skipping reload — player healthy (readyState=' + video.readyState + ', playing)');
                postTwitchWorkerMessage('ReloadSkipped');
                return;
            }
        }
        if (isReload) {
            const lsKeyQuality = 'video-quality';
            const lsKeyMuted = 'video-muted';
            const lsKeyVolume = 'volume';
            let currentQualityLS = null;
            let currentMutedLS = null;
            let currentVolumeLS = null;
            try {
                currentQualityLS = localStorage.getItem(lsKeyQuality);
                currentMutedLS = localStorage.getItem(lsKeyMuted);
                currentVolumeLS = localStorage.getItem(lsKeyVolume);
                if (localStorageHookFailed && player?.core?.state) {
                    localStorage.setItem(lsKeyMuted, JSON.stringify({default:player.core.state.muted}));
                    localStorage.setItem(lsKeyVolume, player.core.state.volume);
                }
                if (player?.core?.state?.quality?.group) {
                    localStorage.setItem(lsKeyQuality, JSON.stringify({default:player.core.state.quality.group}));
                }
            } catch {}
            playerBufferState.lastReloadAt = Date.now();
            playerBufferState.userPauseIntent = false;
            playerBufferState.loggedPauseIntent = false;
            // playerForMonitoringBuffering re-acquired fresh every tick — no manual invalidation needed
            console.log('Reloading Twitch player');
            playerState.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
            postTwitchWorkerMessage('TriggeredPlayerReload');
            // Resume playback with retry — only if user hadn't manually paused
            if (!wasPaused) {
                player.play()?.catch?.(() => {});
                // Retry resume if play() didn't take effect
                setTimeout(() => {
                    try {
                        if (player.isPaused() && !player.core?.paused) {
                            player.play()?.catch?.(() => {});
                        }
                    } catch {}
                }, 1500);
            }
            // Always restore muted/volume state after reload — Chrome autoplay policy can force muted
            if (currentQualityLS || currentMutedLS || currentVolumeLS) {
                setTimeout(() => {
                    try {
                        if (currentQualityLS) {
                            localStorage.setItem(lsKeyQuality, currentQualityLS);
                        }
                        if (currentMutedLS) {
                            localStorage.setItem(lsKeyMuted, currentMutedLS);
                        }
                        if (currentVolumeLS) {
                            localStorage.setItem(lsKeyVolume, currentVolumeLS);
                        }
                        const videos = document.getElementsByTagName('video');
                        if (videos.length > 0 && videos[0].muted) {
                            videos[0].muted = false;
                        }
                        // Correct live drift after reload
                        if (videos.length > 0 && videos[0].buffered.length > 0 && videos[0].readyState >= 3) {
                            const liveEdge = videos[0].buffered.end(videos[0].buffered.length - 1);
                            const drift = liveEdge - videos[0].currentTime;
                            if (drift > 2) {
                                console.log('[AD DEBUG] Post-reload live drift correction: ' + drift.toFixed(1) + 's behind');
                                startDriftCorrection(videos[0]);
                            }
                        }
                    } catch {}
                }, 3000);
            }
            return;
        }
    }
    window.reloadTwitchPlayer = () => {
        doTwitchPlayerTask(false, true);
    };
    function postTwitchWorkerMessage(key, value) {
        twitchWorkers.forEach((worker) => {
            worker.postMessage({key: key, value: value});
        });
    }
    async function handleWorkerFetchRequest(fetchRequest) {
        try {
            const response = await window.realFetch(fetchRequest.url, fetchRequest.options);
            const responseBody = await response.text();
            const responseObject = {
                id: fetchRequest.id,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body: responseBody
            };
            return responseObject;
        } catch (error) {
            return {
                id: fetchRequest.id,
                error: error.message
            };
        }
    }
    // Hook fetch() in the window scope to capture auth headers and modify player type requests
    function hookFetch() {
        console.log('[AD DEBUG] Window fetch hook installed');
        let hasLoggedHeaders = false;
        const realFetch = window.fetch;
        window.realFetch = realFetch;
        window.fetch = maskAsNative(function(url, init, ...args) {
            if (typeof url === 'string') {
                if (url.includes('gql')) {
                    let deviceId = init.headers['X-Device-Id'];
                    if (typeof deviceId !== 'string') {
                        deviceId = init.headers['Device-ID'];
                    }
                    if (typeof deviceId === 'string' && GQLDeviceID != deviceId) {
                        GQLDeviceID = deviceId;
                        postTwitchWorkerMessage('UpdateDeviceId', GQLDeviceID);
                    }
                    if (typeof init.headers['Client-Version'] === 'string' && init.headers['Client-Version'] !== ClientVersion) {
                        postTwitchWorkerMessage('UpdateClientVersion', ClientVersion = init.headers['Client-Version']);
                    }
                    if (typeof init.headers['Client-Session-Id'] === 'string' && init.headers['Client-Session-Id'] !== ClientSession) {
                        postTwitchWorkerMessage('UpdateClientSession', ClientSession = init.headers['Client-Session-Id']);
                    }
                    if (typeof init.headers['Client-Integrity'] === 'string' && init.headers['Client-Integrity'] !== ClientIntegrityHeader) {
                        postTwitchWorkerMessage('UpdateClientIntegrityHeader', ClientIntegrityHeader = init.headers['Client-Integrity']);
                    }
                    if (typeof init.headers['Authorization'] === 'string' && init.headers['Authorization'] !== AuthorizationHeader) {
                        postTwitchWorkerMessage('UpdateAuthorizationHeader', AuthorizationHeader = init.headers['Authorization']);
                    }
                    if (!hasLoggedHeaders && GQLDeviceID && AuthorizationHeader) {
                        hasLoggedHeaders = true;
                        console.log('[AD DEBUG] GQL headers captured — DeviceId: ' + (GQLDeviceID ? 'yes' : 'no') + ', Auth: ' + (AuthorizationHeader ? 'yes' : 'no') + ', Integrity: ' + (ClientIntegrityHeader ? 'yes' : 'no'));
                    }
                    // Get rid of mini player above chat - TODO: Reject this locally instead of having server reject it
                    if (init && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken') && init.body.includes('picture-by-picture')) {
                        init.body = '';
                    }
                    if (ForceAccessTokenPlayerType && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken')) {
                        let replacedPlayerType = '';
                        const newBody = JSON.parse(init.body);
                        if (Array.isArray(newBody)) {
                            for (let i = 0; i < newBody.length; i++) {
                                if (newBody[i]?.variables?.playerType && newBody[i]?.variables?.playerType !== ForceAccessTokenPlayerType) {
                                    replacedPlayerType = newBody[i].variables.playerType;
                                    newBody[i].variables.playerType = ForceAccessTokenPlayerType;
                                }
                            }
                        } else {
                            if (newBody?.variables?.playerType && newBody?.variables?.playerType !== ForceAccessTokenPlayerType) {
                                replacedPlayerType = newBody.variables.playerType;
                                newBody.variables.playerType = ForceAccessTokenPlayerType;
                            }
                        }
                        if (replacedPlayerType) {
                            console.log(`Replaced '${replacedPlayerType}' player type with '${ForceAccessTokenPlayerType}' player type`);
                            init.body = JSON.stringify(newBody);
                        }
                    }
                }
            }
            return realFetch.apply(this, arguments);
        }, 'fetch');
    }
    // Set up visibility overrides and localStorage hooks to preserve player state across reloads
    function onContentLoaded() {
        if (document.getElementById('seventv-extension')) {
            console.log('[AD DEBUG] Warning: 7TV extension detected — may cause black screen or buffering issues. If you experience problems, try disabling 7TV.');
        }
        // This stops Twitch from pausing the player when in another tab and an ad shows.
        // Taken from https://github.com/saucettv/VideoAdBlockForTwitch/blob/cefce9d2b565769c77e3666ac8234c3acfe20d83/chrome/content.js#L30
        try {
            Object.defineProperty(document, 'visibilityState', {
                get() {
                    return 'visible';
                }
            });
        }catch{}
        let hidden = document.__lookupGetter__('hidden');
        try {
            Object.defineProperty(document, 'hidden', {
                get() {
                    return false;
                }
            });
        }catch{}
        const block = e => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
        let wasVideoPlaying = true;
        const visibilityChange = e => {
            const videos = document.getElementsByTagName('video');
            if (videos.length > 0) {
                if (hidden && hidden.apply(document) === true) {
                    wasVideoPlaying = !videos[0].paused && !videos[0].ended;
                } else {
                    if (!playerBufferState.hasStreamStarted) {
                        //console.log('Tab focused. Stream should be active');
                        playerBufferState.hasStreamStarted = true;
                    }
                    if (wasVideoPlaying && !videos[0].ended && videos[0].paused) {
                        videos[0].play()?.catch?.(() => {});
                    }
                }
            }
            block(e);
        };
        document.addEventListener('visibilitychange', visibilityChange, true);
        try { document.hasFocus = () => true; } catch{}
        // Hooks for preserving volume / resolution
        try {
            const keysToCache = [
                'video-quality',
                'video-muted',
                'volume',
                'lowLatencyModeEnabled',// Low Latency
                'persistenceEnabled',// Mini Player
            ];
            const cachedValues = new Map();
            for (let i = 0; i < keysToCache.length; i++) {
                cachedValues.set(keysToCache[i], localStorage.getItem(keysToCache[i]));
            }
            const realSetItem = localStorage.setItem;
            localStorage.setItem = maskAsNative(function(key, value) {
                if (cachedValues.has(key)) {
                    cachedValues.set(key, value);
                }
                realSetItem.apply(this, arguments);
            }, 'setItem');
            const realGetItem = localStorage.getItem;
            localStorage.getItem = maskAsNative(function(key) {
                if (cachedValues.has(key)) {
                    return cachedValues.get(key);
                }
                return realGetItem.apply(this, arguments);
            }, 'getItem');
            if (localStorage.getItem === realGetItem) {
                // These hooks are useful to preserve player state on player reload
                // Firefox doesn't allow hooking of localStorage functions but chrome does
                localStorageHookFailed = true;
            }
        } catch (err) {
            console.log('localStorageHooks failed ' + err)
            localStorageHookFailed = true;
        }
    }
    declareOptions(window);
    try {
        const lsReloadAfterAd = localStorage.getItem('twitchAdSolutions_reloadPlayerAfterAd');
        if (lsReloadAfterAd !== null) {
            ReloadPlayerAfterAd = lsReloadAfterAd === 'true';
        }
        const lsReloadCooldown = parseInt(localStorage.getItem('twitchAdSolutions_reloadCooldownSeconds'));
        if (!isNaN(lsReloadCooldown) && lsReloadCooldown >= 0) {
            ReloadCooldownSeconds = lsReloadCooldown;
        }
        const lsDisableReloadCap = localStorage.getItem('twitchAdSolutions_disableReloadCap');
        if (lsDisableReloadCap !== null) {
            DisableReloadCap = lsDisableReloadCap === 'true';
        }
        const lsDriftRate = parseFloat(localStorage.getItem('twitchAdSolutions_driftCorrectionRate'));
        if (!isNaN(lsDriftRate) && lsDriftRate >= 0) {
            DriftCorrectionRate = lsDriftRate;
        }
        const lsEarlyReload = parseInt(localStorage.getItem('twitchAdSolutions_earlyReloadPollThreshold'));
        if (!isNaN(lsEarlyReload) && lsEarlyReload >= 0) {
            EarlyReloadPollThreshold = lsEarlyReload;
        }
        const lsDisableAdSpoofing = localStorage.getItem('twitchAdSolutions_disableAdSpoofing');
        if (lsDisableAdSpoofing !== null) {
            DisableAdSpoofing = lsDisableAdSpoofing === 'true';
        }
        const lsPlayerType = localStorage.getItem('twitchAdSolutions_playerType');
        if (lsPlayerType !== null) {
            ForceAccessTokenPlayerType = lsPlayerType;
        }
        const lsPinBackup = localStorage.getItem('twitchAdSolutions_pinBackupPlayerType');
        if (lsPinBackup !== null) {
            PinBackupPlayerType = lsPinBackup === 'true';
        }
        const lsHideAdOverlay = localStorage.getItem('twitchAdSolutions_hideAdOverlay');
        if (lsHideAdOverlay === 'true') {
            const style = document.createElement('style');
            style.textContent = '.tas-adblock-overlay { display: none !important; }';
            (document.head || document.documentElement).appendChild(style);
        }
    } catch {}
    console.log('[AD DEBUG] Config: ReloadPlayerAfterAd = ' + ReloadPlayerAfterAd + ', ForceAccessTokenPlayerType = ' + ForceAccessTokenPlayerType + ', PinBackupPlayerType = ' + PinBackupPlayerType);
    hookWindowWorker();
    hookFetch();
    if (PlayerBufferingFix) {
        monitorPlayerBuffering();
    }
    if (document.readyState === "complete" || document.readyState === "interactive") {
        onContentLoaded();
    } else {
        window.addEventListener("DOMContentLoaded", function() {
            onContentLoaded();
        });
    }
    window.simulateAds = (depth) => {
        if (depth === undefined || depth < 0) {
            console.log('Ad depth parameter required (0 = no simulated ad, 1+ = use backup player for given depth)');
            return;
        }
        postTwitchWorkerMessage('SimulateAds', depth);
    };
    window.allSegmentsAreAdSegments = () => {
        postTwitchWorkerMessage('AllSegmentsAreAdSegments');
    };
})();
