// ==UserScript==
// @name         TwitchAdSolutions (vaft) — anon backup mod
// @namespace    https://github.com/ryanbr/TwitchAdSolutions
// @version      72.1.0
// @description  vaft with anonymous token: unauthorized 1080p stream at all times
// @match        *://*.twitch.tv/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function() {
    if ( /(^|\.)twitch\.tv$/.test(document.location.hostname) === false ) { return; }
    let _isNested = false;
    try { _isNested = window.frameElement !== null; } catch (_e) { _isNested = true; }
    if (_isNested) {
        const _host = document.location.hostname;
        const _isEmbedContext = _host === 'player.twitch.tv' || _host === 'embed.twitch.tv' || document.location.pathname.startsWith('/embed/');
        if (!_isEmbedContext) { return; }
    }
    {
        const _clipHost = document.location.hostname;
        const _clipPath = document.location.pathname || '';
        if (_clipHost === 'clips.twitch.tv' || /^\/[^/]+\/clip\/[^/]+/.test(_clipPath)) { return; }
    }
    'use strict';
    const ourTwitchAdSolutionsVersion = 72;
    console.log('[AD] TwitchAdSolutions vaft v' + ourTwitchAdSolutionsVersion + ' (anon-backup mod) loading');
    if (typeof window.twitchAdSolutionsVersion !== 'undefined' && window.twitchAdSolutionsVersion >= ourTwitchAdSolutionsVersion) {
        console.log('[AD] CONFLICT: skipped — another script already active (v' + window.twitchAdSolutionsVersion + ').');
        return;
    }
    window.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;

    function declareOptions(scope) {
        scope.AdSignifiers = ['stitched-ad', 'EXT-X-CUE-OUT', 'twitch-stitched', 'EXT-X-DATERANGE:CLASS="twitch-maf-ad"'];
        scope.AdSegmentURLPatterns = ['/adsquared/', '/_404/', '/processing'];
        scope.TwitchAdUrlRewriteRegex = /(X-TV-TWITCH-AD(?:-[A-Z]+)*-URLS?=")[^"]*(")/g;
        scope.UriAttributeRegex = /URI="([^"]+)"/;
        scope.ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

        // --- KEY SETTINGS ---
        // Single backup type: anonymous request with 'site' — Twitch returns 1080p without ads
        scope.BackupPlayerTypes = 'mobile_web';
        scope.FallbackPlayerType = ['site', 'popout', 'mobile_web', 'embed'];
        // Leave the main authorized token request untouched — Twitch handles it natively
        scope.ForceAccessTokenPlayerType = '';
        // No need for 360p fallback — anonymous backup provides 1080p
        scope.PreferLowQualityBackup = false;
        // --------------------

        scope.FastAutoplayFirstTry = false;
        scope.BackupSwapFirst = true;
        scope.SkipPlayerReloadOnHevc = false;
        scope.AlwaysReloadPlayerOnAd = false;
        scope.ReloadPlayerAfterAd = true;
        scope.ReloadCooldownSeconds = 30;
        scope.DisableReloadCap = false;
        scope.DriftCorrectionRate = 1.1;
        scope.EarlyReloadPollThreshold = 3;
        scope.PinBackupPlayerType = true;
        scope.PlayerReloadMinimalRequestsTime = 1500;
        scope.PlayerReloadMinimalRequestsPlayerIndex = 2;
        scope.HasTriggeredPlayerReload = false;
        scope.StreamInfos = Object.create(null);
        scope.StreamInfosByUrl = Object.create(null);
        scope.GQLDeviceID = null;
        scope.ClientVersion = null;
        scope.ClientSession = null;
        scope.ClientIntegrityHeader = null;
        scope.AuthorizationHeader = undefined;
        scope.SimulatedAdsDepth = 0;
        scope.PlayerBufferingFix = true;
        scope.PlayerBufferingDelay = 600;
        scope.PlayerBufferingSameStateCount = 3;
        scope.PlayerBufferingDangerZone = 1;
        scope.PlayerBufferingDoPlayerReload = false;
        scope.PlayerBufferingMinRepeatDelay = 8000;
        scope.PlayerBufferingPrerollCheckEnabled = false;
        scope.PlayerBufferingPrerollCheckOffset = 5;
        scope.V2API = false;
        scope.IsAdStrippingEnabled = true;
        scope.AdSegmentCache = new Map();
        scope.AllSegmentsAreAdSegments = false;
        scope.StreamInfoMaxAgeMs = 30 * 60 * 1000;
    }

    function pruneStreamInfos() {
        const now = Date.now();
        for (const channelName in StreamInfos) {
            const streamInfo = StreamInfos[channelName];
            if (!streamInfo || !streamInfo.LastSeenAt || (now - streamInfo.LastSeenAt) > StreamInfoMaxAgeMs) {
                if (streamInfo && streamInfo.Urls) {
                    for (const url in streamInfo.Urls) { delete StreamInfosByUrl[url]; }
                }
                delete StreamInfos[channelName];
            }
        }
    }

    function createStreamInfo(channelName, encodingsM3u8, usherParams) {
        return {
            ChannelName: channelName, LastSeenAt: Date.now(), EncodingsM3U8: encodingsM3u8, UsherParams: usherParams,
            Urls: Object.create(null), ResolutionList: [], RequestedAds: new Set(),
            ModifiedM3U8: null, IsUsingModifiedM3U8: false,
            IsShowingAd: false, IsMidroll: false, AdBreakStartedAt: 0, PodLength: 1,
            HasConfirmedAdAttrs: false, CleanPlaylistCount: 0, PendingAdEndAt: 0, AdEndBounceCount: 0,
            ConsecutiveZeroStripBreaks: 0, CsaiOnlyThisBreak: false,
            IsStrippingAdSegments: false, NumStrippedAdSegments: 0, RecoverySegments: [],
            RecoveryStartSeq: undefined, FreezeStartedAt: 0, ConsecutiveAllStrippedPolls: 0, TotalAllStrippedPolls: 0,
            LastCleanNativeM3U8: null, LastCleanNativePlaylistAt: 0,
            BackupEncodingsM3U8Cache: [], ActiveBackupPlayerType: null, PinnedBackupPlayerType: null,
            LastCommittedBackupPlayerType: null, FailedBackupPlayerTypes: new Map(), LoggedBackupAdsByType: null,
            CycleRescuedThisBreak: false, EarlyReloadCount: 0, EarlyReloadAtPoll: 0,
            EarlyReloadTriggered: false, EarlyReloadAwaitingResult: false,
            EscapeHatchFired: false, LastBreakUsedEscapeHatch: false,
            LastPlayerReload: 0, ReloadTimestamps: [],
            HasCheckedUnknownTags: false, HasLoggedAdAttributes: false, HasLoggedUnknownSignifiers: false,
            BackupContaminationCount: 0, BackupGaveUp: false,
        };
    }

    function maskAsNative(fn, name) {
        fn.toString = () => 'function ' + name + '() { [native code] }';
        return fn;
    }

    const loggedCsaiTypes = new Set();
    let isActivelyStrippingAds = false;
    let localStorageHookFailed = false;
    const twitchWorkers = [];
    let cachedRootNode = null;
    let cachedPlayerRootDiv = null;
    let loggedSdaHide = false;
    const workerStringConflicts = ['twitch', 'isVariantA'];
    const workerStringReinsert = ['isVariantA', 'besuper/', '${patch_url}'];

    function getCleanWorker(worker) {
        let root = null, parent = null, proto = worker;
        while (proto) {
            const workerString = proto.toString();
            if (workerStringConflicts.some((x) => workerString.includes(x))) {
                if (parent !== null) Object.setPrototypeOf(parent, Object.getPrototypeOf(proto));
            } else {
                if (root === null) root = proto;
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
            if (workerStringReinsert.some((x) => workerString.includes(x))) result.push(proto);
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
        return !hasConflict || hasReinsert;
    }

    let injectedBlobUrl = null;
    let originalRevokeObjectURL = null;

    function hookWindowWorker() {
        if (!URL.revokeObjectURL.__tasMasked) {
            originalRevokeObjectURL = URL.revokeObjectURL;
            URL.revokeObjectURL = maskAsNative(function(url) {
                if (url === injectedBlobUrl) return;
                return originalRevokeObjectURL.call(this, url);
            }, 'revokeObjectURL');
            URL.revokeObjectURL.__tasMasked = true;
        }
        const reinsert = getWorkersForReinsert(window.Worker);
        const cleanWorker = getCleanWorker(window.Worker) || window.Worker;
        const newWorker = class Worker extends cleanWorker {
            constructor(twitchBlobUrl, options) {
                let isTwitchWorker = false;
                try { isTwitchWorker = new URL(twitchBlobUrl).origin.endsWith('.twitch.tv'); } catch {}
                if (!isTwitchWorker) { super(twitchBlobUrl, options); return; }
                let prefetchedWorkerJs = null;
                try { prefetchedWorkerJs = getWasmWorkerJs(twitchBlobUrl); } catch {}
                if (!prefetchedWorkerJs) { super(twitchBlobUrl, options); return; }
                console.log('[AD] Worker intercepted — injecting anon-backup ad-block');
                const newBlobStr = `
                    const pendingFetchRequests = new Map();
                    ${hasAdTags.toString()}
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
                    ${pruneStreamInfos.toString()}
                    ${createStreamInfo.toString()}
                    const workerString = getWasmWorkerJs('${twitchBlobUrl.replaceAll("'", "%27")}');
                    declareOptions(self);
                    if (!self.__tasPruneInterval) {
                        self.__tasPruneInterval = setInterval(pruneStreamInfos, 5 * 60 * 1000);
                    }
                    ReloadPlayerAfterAd = ${ReloadPlayerAfterAd};
                    ReloadCooldownSeconds = ${ReloadCooldownSeconds};
                    DisableReloadCap = ${DisableReloadCap};
                    EarlyReloadPollThreshold = ${EarlyReloadPollThreshold};
                    PinBackupPlayerType = ${PinBackupPlayerType};
                    PreferLowQualityBackup = ${PreferLowQualityBackup};
                    FastAutoplayFirstTry = ${FastAutoplayFirstTry};
                    BackupSwapFirst = ${BackupSwapFirst};
                    ForceAccessTokenPlayerType = '${ForceAccessTokenPlayerType}';
                    GQLDeviceID = ${GQLDeviceID ? "'" + GQLDeviceID + "'" : null};
                    AuthorizationHeader = ${AuthorizationHeader ? "'" + AuthorizationHeader + "'" : undefined};
                    ClientIntegrityHeader = ${ClientIntegrityHeader ? "'" + ClientIntegrityHeader + "'" : null};
                    ClientVersion = ${ClientVersion ? "'" + ClientVersion + "'" : null};
                    ClientSession = ${ClientSession ? "'" + ClientSession + "'" : null};
                    self.addEventListener('message', function(e) {
                        if (e.data.key == 'UpdateClientVersion') { ClientVersion = e.data.value; }
                        else if (e.data.key == 'UpdateClientSession') { ClientSession = e.data.value; }
                        else if (e.data.key == 'UpdateClientId') { ClientID = e.data.value; }
                        else if (e.data.key == 'UpdateDeviceId') { GQLDeviceID = e.data.value; }
                        else if (e.data.key == 'UpdateClientIntegrityHeader') { ClientIntegrityHeader = e.data.value; }
                        else if (e.data.key == 'UpdateAuthorizationHeader') { AuthorizationHeader = e.data.value; }
                        else if (e.data.key == 'FetchResponse') {
                            const responseData = e.data.value;
                            if (pendingFetchRequests.has(responseData.id)) {
                                const { resolve, reject, timeoutId } = pendingFetchRequests.get(responseData.id);
                                clearTimeout(timeoutId);
                                pendingFetchRequests.delete(responseData.id);
                                if (responseData.error) {
                                    reject(new Error(responseData.error));
                                } else {
                                    const response = new Response(responseData.body, {
                                        status: responseData.status, statusText: responseData.statusText, headers: responseData.headers
                                    });
                                    try {
                                        Object.defineProperty(response, 'url', { value: responseData.url || '', configurable: true });
                                        Object.defineProperty(response, 'redirected', { value: !!responseData.redirected, configurable: true });
                                        Object.defineProperty(response, 'type', { value: responseData.type || 'basic', configurable: true });
                                    } catch {}
                                    resolve(response);
                                }
                            }
                        } else if (e.data.key == 'TriggeredPlayerReload') { HasTriggeredPlayerReload = true; }
                        else if (e.data.key == 'SimulateAds') { SimulatedAdsDepth = e.data.value; }
                        else if (e.data.key == 'AllSegmentsAreAdSegments') { AllSegmentsAreAdSegments = !AllSegmentsAreAdSegments; }
                    });
                    hookWorkerFetch();
                    eval(workerString);
                `;
                if (injectedBlobUrl && originalRevokeObjectURL) {
                    try { originalRevokeObjectURL.call(URL, injectedBlobUrl); } catch {}
                }
                injectedBlobUrl = URL.createObjectURL(new Blob([newBlobStr]));
                super(injectedBlobUrl, options);
                twitchWorkers.length = 0;
                twitchWorkers.push(this);
                this.addEventListener('message', (e) => {
                    if (e.data.key == 'UpdateAdBlockBanner') {
                        updateAdblockBanner(e.data);
                        if (e.data.hasAds !== !!playerBufferState.inAdBreak) {
                            playerBufferState.lastBackupSwitchAt = Date.now();
                            if (!e.data.hasAds) playerBufferState.position = 0;
                        }
                        playerBufferState.inAdBreak = !!e.data.hasAds;
                        if (e.data.hasAds && (driftCatchUpInterval || driftCatchUpTimeout)) {
                            if (driftCatchUpInterval) { clearInterval(driftCatchUpInterval); driftCatchUpInterval = null; }
                            if (driftCatchUpTimeout) { clearTimeout(driftCatchUpTimeout); driftCatchUpTimeout = null; }
                            try { document.querySelector('video').playbackRate = 1.0; } catch {}
                        }
                    } else if (e.data.key == 'PauseResumePlayer') {
                        doTwitchPlayerTask(true, false);
                    } else if (e.data.key == 'ReloadPlayer') {
                        doTwitchPlayerTask(false, true, e.data.kind);
                    }
                });
                this.addEventListener('message', async event => {
                    if (event.data.key == 'FetchRequest') {
                        const fetchRequest = event.data.value;
                        const responseData = await handleWorkerFetchRequest(fetchRequest);
                        this.postMessage({ key: 'FetchResponse', value: responseData });
                    }
                });
                let crashed = false;
                this.addEventListener('error', (e) => {
                    if (crashed) return;
                    crashed = true;
                    try { doTwitchPlayerTask(false, true, 'early'); } catch {}
                });
            }
        };
        let workerInstance = reinsertWorkers(newWorker, reinsert);
        Object.defineProperty(window, 'Worker', {
            get: function() { return workerInstance; },
            set: function(value) {
                if (isValidWorker(value)) workerInstance = value;
            }
        });
    }

    function getWasmWorkerJs(twitchBlobUrl) {
        if (!getWasmWorkerJs.cache) getWasmWorkerJs.cache = Object.create(null);
        if (getWasmWorkerJs.cache[twitchBlobUrl]) return getWasmWorkerJs.cache[twitchBlobUrl];
        const req = new XMLHttpRequest();
        req.open('GET', twitchBlobUrl, false);
        req.overrideMimeType("text/javascript");
        req.send();
        getWasmWorkerJs.cache[twitchBlobUrl] = req.responseText;
        return req.responseText;
    }

    function hookWorkerFetch() {
        const BLANK_MP4 = new Blob([Uint8Array.from(atob('AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA'), c => c.charCodeAt(0))], {type: 'video/mp4'});
        const realFetch = fetch;
        fetch = async function(url, options) {
            if (typeof url === 'string') {
                if (AdSegmentCache.has(url)) return new Response(BLANK_MP4);
                url = url.trimEnd();
                if (url.endsWith('m3u8')) {
                    return new Promise(function(resolve, reject) {
                        realFetch(url, options).then(async function(response) {
                            if (response.status === 200) {
                                resolve(new Response(await processM3U8(url, await response.text(), realFetch)));
                            } else { resolve(response); }
                        })['catch'](reject);
                    });
                } else if (url.includes('/channel/hls/') && !url.includes('picture-by-picture')) {
                    V2API = url.includes('/api/v2/');
                    const parsedUrl = new URL(url);
                    const channelName = parsedUrl.pathname.match(/([^\/]+)(?=\.\w+$)/)?.[0];
                    return new Promise(function(resolve, reject) {
                        realFetch(url, options).then(async function(response) {
                            if (response.status == 200) {
                                const encodingsM3u8 = await response.text();
                                const serverTime = getServerTimeFromM3u8(encodingsM3u8);
                                let streamInfo = StreamInfos[channelName];
                                if (streamInfo != null && streamInfo.EncodingsM3U8 != null && (await realFetch(streamInfo.EncodingsM3U8.match(/^https:.*\.m3u8$/m)?.[0])).status !== 200) {
                                    streamInfo = null;
                                }
                                if (streamInfo == null || streamInfo.EncodingsM3U8 == null) {
                                    HasTriggeredPlayerReload = false;
                                    StreamInfos[channelName] = streamInfo = createStreamInfo(channelName, encodingsM3u8, parsedUrl.search);
                                    const lines = encodingsM3u8.split('\n');
                                    for (let i = 0; i < lines.length - 1; i++) {
                                        if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1].includes('.m3u8')) {
                                            const attributes = parseAttributes(lines[i]);
                                            const resolution = attributes['RESOLUTION'];
                                            if (resolution) {
                                                const resolutionInfo = {
                                                    Resolution: resolution, FrameRate: attributes['FRAME-RATE'],
                                                    Codecs: attributes['CODECS'], Audio: attributes['AUDIO'] || '',
                                                    Video: attributes['VIDEO'] || '', Subtitles: attributes['SUBTITLES'] || '',
                                                    Url: lines[i + 1]
                                                };
                                                streamInfo.Urls[lines[i + 1]] = resolutionInfo;
                                                streamInfo.ResolutionList.push(resolutionInfo);
                                            }
                                            StreamInfosByUrl[lines[i + 1]] = streamInfo;
                                        }
                                    }
                                    const nonHevcResolutionList = streamInfo.ResolutionList.filter((e) => e.Codecs.startsWith('avc') || e.Codecs.startsWith('av0'));
                                    if (AlwaysReloadPlayerOnAd || (nonHevcResolutionList.length > 0 && streamInfo.ResolutionList.some((e) => e.Codecs.startsWith('hev') || e.Codecs.startsWith('hvc')) && !SkipPlayerReloadOnHevc)) {
                                        const replaceOrAppendStreamInfAttr = (line, key, value) => {
                                            if (typeof value !== 'string' || !value) return line;
                                            const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                                            const next = key + '="' + escaped + '"';
                                            const pattern = new RegExp('(^|,)' + key + '=("[^"]*"|[^,]*)');
                                            return pattern.test(line) ? line.replace(pattern, '$1' + next) : line + ',' + next;
                                        };
                                        if (nonHevcResolutionList.length > 0) {
                                            for (let i = 0; i < lines.length - 1; i++) {
                                                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                                                    const resSettings = parseAttributes(lines[i].substring(lines[i].indexOf(':') + 1));
                                                    const codecsKey = 'CODECS';
                                                    if (resSettings[codecsKey].startsWith('hev') || resSettings[codecsKey].startsWith('hvc')) {
                                                        const oldResolution = resSettings['RESOLUTION'];
                                                        const [targetWidth, targetHeight] = oldResolution.split('x').map(Number);
                                                        const targetArea = targetWidth * targetHeight;
                                                        let newResolutionInfo = null, closestDiff = Infinity;
                                                        for (let j = 0; j < nonHevcResolutionList.length; j++) {
                                                            const candidate = nonHevcResolutionList[j];
                                                            const [sw, sh] = candidate.Resolution.split('x').map(Number);
                                                            const diff = Math.abs((sw * sh) - targetArea);
                                                            if (diff < closestDiff) { closestDiff = diff; newResolutionInfo = candidate; }
                                                        }
                                                        lines[i] = lines[i].replace(/CODECS="[^"]+"/, `CODECS="${newResolutionInfo.Codecs}"`);
                                                        lines[i] = replaceOrAppendStreamInfAttr(lines[i], 'AUDIO', newResolutionInfo.Audio);
                                                        lines[i] = replaceOrAppendStreamInfAttr(lines[i], 'VIDEO', newResolutionInfo.Video);
                                                        lines[i] = replaceOrAppendStreamInfAttr(lines[i], 'SUBTITLES', newResolutionInfo.Subtitles);
                                                        lines[i + 1] = newResolutionInfo.Url + ' '.repeat(i + 1);
                                                    }
                                                }
                                            }
                                        }
                                        if (nonHevcResolutionList.length > 0 || AlwaysReloadPlayerOnAd) {
                                            streamInfo.ModifiedM3U8 = lines.join('\n');
                                        }
                                    }
                                }
                                streamInfo.LastSeenAt = Date.now();
                                resolve(new Response(replaceServerTimeInM3u8(streamInfo.IsUsingModifiedM3U8 ? streamInfo.ModifiedM3U8 : streamInfo.EncodingsM3U8, serverTime)));
                            } else { resolve(response); }
                        })['catch'](reject);
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

    function hasAdTags(textStr) { return AdSignifiers.some((s) => textStr.includes(s)); }
    function getMatchedAdSignifiers(textStr) { return AdSignifiers.filter((s) => textStr.includes(s)); }

    function stripAdSegments(textStr, stripAllSegments, streamInfo) {
        let hasStrippedAdSegments = false;
        let inCueOut = false;
        const liveSegments = [];
        const lines = textStr.split(/\r?\n/);
        const newAdUrl = 'https://twitch.tv';
        if (!streamInfo.HasLoggedAdAttributes) {
            const adAttrs = textStr.match(/X-TV-TWITCH-AD[A-Z-]*(?==")/g);
            if (adAttrs && adAttrs.length > 0) {
                streamInfo.HasLoggedAdAttributes = true;
                console.log('[AD] Ad tracking attributes: ' + [...new Set(adAttrs)].join(', '));
            }
        }
        if (!streamInfo.HasLoggedUnknownSignifiers) {
            const candidates = new Set();
            let sm;
            const classRe = /EXT-X-DATERANGE:[^\n]*CLASS="(twitch-[^"]+)"/g;
            while ((sm = classRe.exec(textStr)) !== null) candidates.add('EXT-X-DATERANGE:CLASS="' + sm[1] + '"');
            const tagRe = /(SCTE35-[A-Z-]+|EXT-X-CUE-[A-Z-]+)/g;
            while ((sm = tagRe.exec(textStr)) !== null) candidates.add(sm[1]);
            const unknown = [...candidates].filter(c => !AdSignifiers.some(s => c.includes(s)));
            if (unknown.length > 0) {
                streamInfo.HasLoggedUnknownSignifiers = true;
                console.log('[AD] Unknown ad markers: ' + unknown.join(', '));
            }
        }
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (line.includes('EXT-X-CUE-OUT')) { inCueOut = true; }
            else if (line.includes('EXT-X-CUE-IN')) { inCueOut = false; }
            lines[i] = line.replaceAll(TwitchAdUrlRewriteRegex, `$1${newAdUrl}$2`);
            const isLiveSegment = line.includes(',live');
            if (i < lines.length - 1 && line.startsWith('#EXTINF') && (!isLiveSegment || stripAllSegments || AllSegmentsAreAdSegments || inCueOut)) {
                const segmentUrl = lines[i + 1];
                if (!AdSegmentCache.has(segmentUrl)) streamInfo.NumStrippedAdSegments++;
                AdSegmentCache.set(segmentUrl, Date.now());
                hasStrippedAdSegments = true;
            } else if (i < lines.length - 1 && line.startsWith('#EXTINF') && AdSegmentURLPatterns.some((p) => lines[i + 1].includes(p))) {
                AdSegmentCache.set(lines[i + 1], Date.now());
                hasStrippedAdSegments = true;
                streamInfo.NumStrippedAdSegments++;
            } else if (i < lines.length - 1 && line.startsWith('#EXTINF') && isLiveSegment) {
                liveSegments.push({ extinf: line, url: lines[i + 1] });
            } else if (line.startsWith('#EXT-X-PART:')) {
                const partUriMatch = line.match(UriAttributeRegex);
                const partUri = partUriMatch ? partUriMatch[1] : '';
                if (partUri && (AdSegmentCache.has(partUri) || AdSegmentURLPatterns.some((p) => partUri.includes(p)))) {
                    AdSegmentCache.set(partUri, Date.now());
                    lines[i] = '';
                    hasStrippedAdSegments = true;
                }
            } else if (line.startsWith('#EXT-X-TWITCH-PREFETCH:') || line.startsWith('#EXT-X-PRELOAD-HINT:')) {
                let hintUrl = '';
                if (line.startsWith('#EXT-X-TWITCH-PREFETCH:')) {
                    hintUrl = line.substring('#EXT-X-TWITCH-PREFETCH:'.length).trim();
                } else {
                    const hintMatch = line.match(/URI="([^"]+)"/);
                    hintUrl = hintMatch ? hintMatch[1] : '';
                }
                if (hintUrl && (AdSegmentCache.has(hintUrl) || AdSegmentURLPatterns.some((p) => hintUrl.includes(p)))) {
                    AdSegmentCache.set(hintUrl, Date.now());
                    hasStrippedAdSegments = true;
                }
            }
        }
        if (!hasStrippedAdSegments && AdSignifiers.some((s) => textStr.includes(s))) hasStrippedAdSegments = true;
        if (hasStrippedAdSegments) {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-TWITCH-PREFETCH:') || lines[i].startsWith('#EXT-X-PRELOAD-HINT:')) lines[i] = '';
            }
        } else { streamInfo.NumStrippedAdSegments = 0; }
        if (liveSegments.length > 0) {
            streamInfo.RecoverySegments = liveSegments.slice(-6);
            const seq = parseInt((textStr.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/) || [])[1]);
            if (!isNaN(seq)) streamInfo.RecoveryStartSeq = seq + Math.max(0, liveSegments.length - streamInfo.RecoverySegments.length);
        }
        if (hasStrippedAdSegments && liveSegments.length === 0) {
            streamInfo.ConsecutiveAllStrippedPolls = (streamInfo.ConsecutiveAllStrippedPolls || 0) + 1;
            streamInfo.TotalAllStrippedPolls = (streamInfo.TotalAllStrippedPolls || 0) + 1;
            if (!streamInfo.FreezeStartedAt) streamInfo.FreezeStartedAt = Date.now();
            const snapshotAge = streamInfo.LastCleanNativePlaylistAt ? (Date.now() - streamInfo.LastCleanNativePlaylistAt) : Infinity;
            if (streamInfo.LastCleanNativeM3U8 && snapshotAge <= 1500 && !hasAdTags(streamInfo.LastCleanNativeM3U8)) {
                streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
                return streamInfo.LastCleanNativeM3U8;
            }
            if (streamInfo.RecoverySegments && streamInfo.RecoverySegments.length > 0) {
                if (streamInfo.RecoveryStartSeq !== undefined) {
                    for (let j = 0; j < lines.length; j++) {
                        if (lines[j].startsWith('#EXT-X-MEDIA-SEQUENCE:')) { lines[j] = '#EXT-X-MEDIA-SEQUENCE:' + streamInfo.RecoveryStartSeq; break; }
                    }
                }
                for (let j = 0; j < streamInfo.RecoverySegments.length; j++) {
                    lines.push(streamInfo.RecoverySegments[j].extinf);
                    lines.push(streamInfo.RecoverySegments[j].url);
                }
            }
        } else if (liveSegments.length > 0) { streamInfo.ConsecutiveAllStrippedPolls = 0; }
        streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
        const now = Date.now();
        if (!streamInfo.LastAdCachePruneAt || now - streamInfo.LastAdCachePruneAt > 60000) {
            streamInfo.LastAdCachePruneAt = now;
            AdSegmentCache.forEach((value, key, map) => { if (value < now - 120000) map.delete(key); });
            if (AdSegmentCache.size > 1000) {
                let evicted = 0;
                for (const url of AdSegmentCache.keys()) { AdSegmentCache.delete(url); if (++evicted >= 200) break; }
            }
        }
        return lines.join('\n');
    }

    function getStreamUrlForResolution(encodingsM3u8, resolutionInfo) {
        const encodingsLines = encodingsM3u8.split(/\r?\n/);
        const [targetWidth, targetHeight] = resolutionInfo.Resolution.split('x').map(Number);
        let matchedResolutionUrl = null, matchedFrameRate = false, closestResolutionUrl = null, closestResolutionDifference = Infinity;
        for (let i = 0; i < encodingsLines.length - 1; i++) {
            const nextLine = encodingsLines[i + 1]?.trim();
            if (encodingsLines[i].startsWith('#EXT-X-STREAM-INF') && nextLine && !nextLine.startsWith('#') && (nextLine.includes('.m3u8') || nextLine.includes('://'))) {
                const attributes = parseAttributes(encodingsLines[i]);
                const resolution = attributes['RESOLUTION'];
                const frameRate = attributes['FRAME-RATE'];
                if (resolution) {
                    if (resolution == resolutionInfo.Resolution && (!matchedResolutionUrl || (!matchedFrameRate && frameRate == resolutionInfo.FrameRate))) {
                        matchedResolutionUrl = encodingsLines[i + 1];
                        matchedFrameRate = frameRate == resolutionInfo.FrameRate;
                        if (matchedFrameRate) return matchedResolutionUrl;
                    }
                    const [width, height] = resolution.split('x').map(Number);
                    const difference = Math.abs((width * height) - (targetWidth * targetHeight));
                    if (difference < closestResolutionDifference) { closestResolutionUrl = encodingsLines[i + 1]; closestResolutionDifference = difference; }
                }
            }
        }
        return closestResolutionUrl;
    }

    async function processM3U8(url, textStr, realFetch) {
        const streamInfo = StreamInfosByUrl[url];
        if (!streamInfo) return textStr;
        streamInfo.LastSeenAt = Date.now();
        if (HasTriggeredPlayerReload) { HasTriggeredPlayerReload = false; streamInfo.LastPlayerReload = Date.now(); }
        if (!streamInfo.HasCheckedUnknownTags) {
            streamInfo.HasCheckedUnknownTags = true;
            const unknownAdTags = textStr.match(/#EXT[^:\n]*(?:ad|cue|scte|sponsor)[^:\n]*/gi);
            if (unknownAdTags) {
                const unknown = unknownAdTags.filter(t => !AdSignifiers.some(s => t.includes(s)));
                if (unknown.length > 0) console.log('[AD] Unknown ad-related tags: ' + [...new Set(unknown)].join(', '));
            }
        }
        const haveAdTags = hasAdTags(textStr) || SimulatedAdsDepth > 0;
        if (!haveAdTags && !streamInfo.IsShowingAd && textStr.indexOf('#EXTINF') !== -1) {
            streamInfo.LastCleanNativeM3U8 = textStr;
            streamInfo.LastCleanNativePlaylistAt = Date.now();
        }
        if (haveAdTags) {
            const adEndStalenessMs = 12000;
            if (streamInfo.PendingAdEndAt && (Date.now() - streamInfo.PendingAdEndAt) < adEndStalenessMs) {
                streamInfo.AdEndBounceCount = (streamInfo.AdEndBounceCount || 0) + 1;
            } else { streamInfo.PendingAdEndAt = 0; streamInfo.AdEndBounceCount = 0; }
            streamInfo.CleanPlaylistCount = 0;
            streamInfo.IsMidroll = textStr.includes('"MIDROLL"') || textStr.includes('"midroll"');
            if (!streamInfo.IsShowingAd) {
                streamInfo.IsShowingAd = true;
                streamInfo.AdBreakStartedAt = Date.now();
                const podLengthMatch = textStr.match(/X-TV-TWITCH-AD-POD-LENGTH="(\d+)"/);
                const podLength = podLengthMatch ? parseInt(podLengthMatch[1], 10) : 1;
                streamInfo.PodLength = podLength;
                streamInfo.EarlyReloadTriggered = false;
                streamInfo.EarlyReloadCount = 0;
                streamInfo.EarlyReloadAtPoll = 0;
                streamInfo.HasConfirmedAdAttrs = textStr.includes('X-TV-TWITCH-AD-AD-SESSION-ID') || textStr.includes('X-TV-TWITCH-AD-RADS-TOKEN');
                streamInfo.CycleRescuedThisBreak = false;
                streamInfo.LastCommittedBackupPlayerType = null;
                streamInfo.FreezeStartedAt = 0;
                streamInfo.CsaiOnlyThisBreak = false;
                console.log('[AD] Ad detected — ' + (streamInfo.IsMidroll ? 'midroll' : 'preroll') + ', fetching backup token (mobile client)...');
                postMessage({ key: 'UpdateAdBlockBanner', isMidroll: streamInfo.IsMidroll, hasAds: true, isStrippingAdSegments: false });
            }
            if (!streamInfo.IsMidroll) {
                const lines = textStr.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.startsWith('#EXTINF') && lines.length > i + 1 && !line.includes(',live') && !streamInfo.RequestedAds.has(lines[i + 1])) {
                        streamInfo.RequestedAds.add(lines[i + 1]);
                        fetch(lines[i + 1]).then((r) => r.blob()).catch(() => {});
                        break;
                    }
                }
            }
            const currentResolution = streamInfo.Urls[url];
            if (!currentResolution) {
                console.log('[AD] Missing resolution info for ' + url);
                return stripAdSegments(textStr, false, streamInfo);
            }
            const isHevc = currentResolution.Codecs.startsWith('hev') || currentResolution.Codecs.startsWith('hvc');
            const postAdReentryGuardMs = 8000;
            const recentlyReloaded = streamInfo.LastPlayerReload && (Date.now() - streamInfo.LastPlayerReload) < postAdReentryGuardMs;
            if (((isHevc && !SkipPlayerReloadOnHevc) || AlwaysReloadPlayerOnAd) && streamInfo.ModifiedM3U8 && !streamInfo.IsUsingModifiedM3U8 && !recentlyReloaded) {
                streamInfo.IsUsingModifiedM3U8 = true;
                streamInfo.LastPlayerReload = Date.now();
                postMessage({ key: 'ReloadPlayer' });
            }
            if (streamInfo.CsaiOnlyThisBreak && !streamInfo.IsUsingModifiedM3U8) {
                if (IsAdStrippingEnabled) textStr = stripAdSegments(textStr, false, streamInfo);
                postMessage({ key: 'UpdateAdBlockBanner', isMidroll: streamInfo.IsMidroll, hasAds: streamInfo.IsShowingAd, isStrippingAdSegments: streamInfo.IsStrippingAdSegments, numStrippedAdSegments: streamInfo.NumStrippedAdSegments, activeBackupPlayerType: null });
                return textStr;
            }
            const mainStreamLines = textStr.split(/\r?\n/);
            let hasNonLiveSegment = false;
            for (let i = 0; i < mainStreamLines.length; i++) {
                if (mainStreamLines[i].startsWith('#EXTINF') && !mainStreamLines[i].includes(',live')) { hasNonLiveSegment = true; break; }
            }
            if (!hasNonLiveSegment && !streamInfo.IsUsingModifiedM3U8 && !BackupSwapFirst) {
                streamInfo.CsaiOnlyThisBreak = true;
                if (IsAdStrippingEnabled) textStr = stripAdSegments(textStr, false, streamInfo);
                postMessage({ key: 'UpdateAdBlockBanner', isMidroll: streamInfo.IsMidroll, hasAds: streamInfo.IsShowingAd, isStrippingAdSegments: streamInfo.IsStrippingAdSegments, numStrippedAdSegments: streamInfo.NumStrippedAdSegments, activeBackupPlayerType: null });
                return textStr;
            }

            // If all CDN nodes are in a universal ad-break state, skip expensive GQL+Usher
            // requests — no new token will produce a clean stream until the break ends.
            if (streamInfo.BackupGaveUp) {
                if (IsAdStrippingEnabled) textStr = stripAdSegments(textStr, false, streamInfo);
                postMessage({ key: 'UpdateAdBlockBanner', isMidroll: streamInfo.IsMidroll, hasAds: streamInfo.IsShowingAd, isStrippingAdSegments: streamInfo.IsStrippingAdSegments, numStrippedAdSegments: streamInfo.NumStrippedAdSegments, activeBackupPlayerType: null });
                return textStr;
            }

            // tStart declared here so it's in scope for all GQL/Usher timing logs below
            const tStart = Date.now();

            let backupPlayerType = null, backupM3u8 = null, fallbackM3u8 = null;
            const playerTypesToTry = [...BackupPlayerTypes];
            if (streamInfo.PinnedBackupPlayerType) {
                const pinnedIndex = playerTypesToTry.indexOf(streamInfo.PinnedBackupPlayerType);
                if (pinnedIndex > 0) { playerTypesToTry.splice(pinnedIndex, 1); playerTypesToTry.unshift(streamInfo.PinnedBackupPlayerType); }
            }
            for (let playerTypeIndex = 0; !backupM3u8 && playerTypeIndex < playerTypesToTry.length; playerTypeIndex++) {
                const playerType = playerTypesToTry[playerTypeIndex];
                const failedAt = streamInfo.FailedBackupPlayerTypes.get(playerType);
                if (failedAt && (Date.now() - failedAt) < 15000) continue;
                for (let i = 0; i < 2; i++) {
                    let isFreshM3u8 = false;
                    let encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType];
                    if (!encodingsM3u8) {
                        isFreshM3u8 = true;
                        try {
                            const accessTokenResponse = await getAccessToken(streamInfo.ChannelName, playerType);
                            if (accessTokenResponse.status === 200) {
                                const accessToken = await accessTokenResponse.json();
                                const spat = accessToken?.data?.streamPlaybackAccessToken || accessToken?.streamPlaybackAccessToken;
                                if (spat) {
                                    try {
                                        const tok = JSON.parse(spat.value);
                                        console.log('[VAFT-ANON] GQL response in ' + (Date.now() - tStart) + 'ms');
                                        console.log('[VAFT-ANON] Token: user_ip=' + tok.user_ip + ' show_ads=' + tok.show_ads + ' max_res=' + tok.maximum_resolution + ' user_id=' + tok.user_id + ' expires=' + new Date(tok.expires * 1000).toISOString());
                                    } catch(e) {}
                                }
                                if (!spat) {
                                    streamInfo.FailedBackupPlayerTypes.set(playerType, Date.now());
                                    continue;
                                }
                                const urlInfo = new URL('https://usher.ttvnw.net/api/' + (V2API ? 'v2/' : '') + 'channel/hls/' + streamInfo.ChannelName + '.m3u8' + streamInfo.UsherParams);
                                urlInfo.searchParams.set('sig', spat.signature);
                                urlInfo.searchParams.set('token', spat.value);
                                console.log('[VAFT-ANON] Usher URL: ' + urlInfo.href.replace(/token=[^&]+/, 'token=<redacted>'));
                                const uStart = Date.now();
                                const encodingsM3u8Response = await realFetch(urlInfo.href);
                                if (encodingsM3u8Response.status === 200) {
                                    encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType] = await encodingsM3u8Response.text();
                                    console.log('[VAFT-ANON] Usher response in ' + (Date.now() - uStart) + 'ms, status=' + encodingsM3u8Response.status);
                                    // Log available qualities and codecs from backup encodings
                                    const bLines = encodingsM3u8.split('\n');
                                    const variants = [];
                                    for (let bi = 0; bi < bLines.length - 1; bi++) {
                                        if (bLines[bi].startsWith('#EXT-X-STREAM-INF')) {
                                            const rm = bLines[bi].match(/RESOLUTION=([^,]+)/);
                                            const cm = bLines[bi].match(/CODECS="([^"]+)"/);
                                            const fm = bLines[bi].match(/FRAME-RATE=([^,]+)/);
                                            if (rm) variants.push((rm[1]||'?') + '@' + (fm?fm[1]:'?') + 'fps ' + (cm?cm[1].split('.')[0]:'?'));
                                        }
                                    }
                                    console.log('[VAFT-ANON] Backup variants: [' + variants.join(', ') + ']');
                                }
                            } else {
                                streamInfo.FailedBackupPlayerTypes.set(playerType, Date.now());
                            }
                        } catch (err) {
                            console.log('[AD] Token failed for ' + playerType + ': ' + err.message);
                            streamInfo.FailedBackupPlayerTypes.set(playerType, Date.now());
                        }
                    }
                    if (encodingsM3u8) {
                        try {
                            const streamM3u8Url = getStreamUrlForResolution(encodingsM3u8, currentResolution);
                            console.log('[VAFT-ANON] Selected backup URL: ' + streamM3u8Url);
                            console.log('[VAFT-ANON] Wanted resolution: ' + currentResolution.Resolution + ' codecs: ' + currentResolution.Codecs);
                            const mStart = Date.now();
                            const streamM3u8Response = await realFetch(streamM3u8Url);
                            if (streamM3u8Response.status == 200) {
                                const m3u8Text = await streamM3u8Response.text();
                                if (m3u8Text) {
                                    const mLines = m3u8Text.split('\n');
                                    const segs = mLines.filter(l => l.startsWith('#EXTINF'));
                                    const liveSegs = segs.filter(l => l.includes(',live'));
                                    const segUrls = mLines.filter(l => l.startsWith('https'));
                                    const firstSeg = segUrls[0] || 'none';
                                    console.log('[VAFT-ANON] Media playlist in ' + (Date.now() - mStart) + 'ms: ' + segs.length + ' segments (' + liveSegs.length + ' live), hasAdTags=' + hasAdTags(m3u8Text));
                                    console.log('[VAFT-ANON] First segment: ' + firstSeg.split('/').slice(-2).join('/').split('?')[0]);
                                    if (playerType == FallbackPlayerType) fallbackM3u8 = m3u8Text;
                                    if (!hasAdTags(m3u8Text) || playerTypeIndex >= playerTypesToTry.length - 1) {
                                        backupPlayerType = playerType;
                                        backupM3u8 = m3u8Text;
                                        break;
                                    }
                                }
                            }
                        } catch (err) {
                            console.log('[AD] Backup stream error: ' + err.message);
                        }
                    }
                    streamInfo.BackupEncodingsM3U8Cache[playerType] = null;
                    if (isFreshM3u8) break;
                }
            }
            if (!backupM3u8 && fallbackM3u8) { backupPlayerType = FallbackPlayerType; backupM3u8 = fallbackM3u8; }

            // If the backup playlist contains ad tags, the CDN is serving ads to all new
            // sessions simultaneously. Invalidate cache so the next poll gets a fresh token.
            // After 5 consecutive contaminated polls stop trying: the CDN is in a universal
            // ad-break state and no new token will help until the break ends.
            if (backupM3u8 && hasAdTags(backupM3u8)) {
                streamInfo.BackupEncodingsM3U8Cache[backupPlayerType] = null;
                streamInfo.BackupContaminationCount = (streamInfo.BackupContaminationCount || 0) + 1;
                if (streamInfo.BackupContaminationCount >= 1 && !streamInfo.BackupGaveUp) {
                    streamInfo.BackupGaveUp = true;
                    console.log('[VAFT-ANON] Backup consistently contaminated (' + streamInfo.BackupContaminationCount + 'x) — stripping only for rest of ad break');
                } else if (!streamInfo.BackupGaveUp) {
                    console.log('[VAFT-ANON] Backup contaminated (' + streamInfo.BackupContaminationCount + '/1) — retrying next poll');
                }
                backupM3u8 = null;
            } else if (backupM3u8) {
                // Clean backup found — reset contamination counter.
                streamInfo.BackupContaminationCount = 0;
                streamInfo.BackupGaveUp = false;
            }

            if (backupM3u8 && streamInfo.IsShowingAd) {
                textStr = backupM3u8;
                streamInfo.LastCommittedBackupPlayerType = backupPlayerType;
                if (streamInfo.ActiveBackupPlayerType != backupPlayerType) {
                    streamInfo.ActiveBackupPlayerType = backupPlayerType;
                    if (PinBackupPlayerType) streamInfo.PinnedBackupPlayerType = backupPlayerType;
                    console.log('[AD] Blocking' + (streamInfo.IsMidroll ? ' midroll' : '') + ' ads — backup found in ' + (Date.now() - tStart) + 'ms');
                }
            } else if (!backupM3u8 && !streamInfo.BackupGaveUp) {
                console.log('[AD] No backup found — stripping segments');
            }
            const stripHevc = isHevc && streamInfo.ModifiedM3U8;
            if (IsAdStrippingEnabled || stripHevc) textStr = stripAdSegments(textStr, stripHevc, streamInfo);
            if (streamInfo.EarlyReloadAwaitingResult) {
                streamInfo.EarlyReloadAwaitingResult = false;
                if (!streamInfo.IsStrippingAdSegments) streamInfo.EarlyReloadTriggered = false;
                else streamInfo.EarlyReloadTriggered = false;
            }
            const recoveryThin = (streamInfo.RecoverySegments?.length || 0) < 3;
            const maxEarlyReloads = recoveryThin ? Math.max(2, streamInfo.PodLength || 1) : Math.max(1, streamInfo.PodLength || 1);
            const effectiveThreshold = recoveryThin ? 1 : EarlyReloadPollThreshold;
            if (EarlyReloadPollThreshold > 0 && (streamInfo.ConsecutiveAllStrippedPolls || 0) >= effectiveThreshold && !streamInfo.EarlyReloadTriggered && (streamInfo.EarlyReloadCount || 0) < maxEarlyReloads) {
                streamInfo.EarlyReloadTriggered = true;
                streamInfo.EarlyReloadAwaitingResult = true;
                streamInfo.EarlyReloadCount = (streamInfo.EarlyReloadCount || 0) + 1;
                streamInfo.EarlyReloadAtPoll = streamInfo.TotalAllStrippedPolls || streamInfo.ConsecutiveAllStrippedPolls;
                postMessage({ key: 'ReloadPlayer', kind: 'early' });
            }
        } else if (streamInfo.IsShowingAd) {
            if (!streamInfo.PendingAdEndAt) streamInfo.PendingAdEndAt = Date.now();
            streamInfo.CleanPlaylistCount++;
            const hasLiveSegments = textStr.includes(',live');
            const adEndMaxWaitMs = 12000;
            const elapsedSinceCandidate = Date.now() - streamInfo.PendingAdEndAt;
            const slowPathReady = streamInfo.PendingAdEndAt > 0 && elapsedSinceCandidate >= adEndMaxWaitMs;
            if (streamInfo.CleanPlaylistCount >= 3 || !hasLiveSegments || slowPathReady) {
                const adBreakDurationSec = streamInfo.AdBreakStartedAt ? ((Date.now() - streamInfo.AdBreakStartedAt) / 1000).toFixed(1) : '?';
                console.log('[AD] Finished blocking ads — duration: ' + adBreakDurationSec + 's. Reloading to restore authorized stream...');
                const hadStrippedSegments = streamInfo.NumStrippedAdSegments > 0;
                if (!hadStrippedSegments && !streamInfo.HasConfirmedAdAttrs) {
                    streamInfo.ConsecutiveZeroStripBreaks++;
                } else { streamInfo.ConsecutiveZeroStripBreaks = 0; }
                streamInfo.IsShowingAd = false;
                streamInfo.IsStrippingAdSegments = false;
                streamInfo.NumStrippedAdSegments = 0;
                streamInfo.ActiveBackupPlayerType = null;
                streamInfo.RequestedAds?.clear?.();
                streamInfo.FailedBackupPlayerTypes?.clear?.();
                if (streamInfo.LoggedBackupAdsByType) streamInfo.LoggedBackupAdsByType.clear();
                streamInfo.LoggedContamReorderThisBreak = false;
                streamInfo.CleanPlaylistCount = 0;
                streamInfo.PendingAdEndAt = 0;
                streamInfo.AdEndBounceCount = 0;
                streamInfo.ConsecutiveAllStrippedPolls = 0;
                streamInfo.EarlyReloadTriggered = false;
                streamInfo.EarlyReloadAwaitingResult = false;
                streamInfo.EarlyReloadAtPoll = 0;
                streamInfo.TotalAllStrippedPolls = 0;
                streamInfo.CsaiOnlyThisBreak = false;
                streamInfo.EscapeHatchFired = false;
                streamInfo.HasLoggedAdAttributes = false;
                streamInfo.HasLoggedUnknownSignifiers = false;
                streamInfo.BackupContaminationCount = 0;
                streamInfo.BackupGaveUp = false;
                // Hard reload with refreshAccessToken=true — Twitch will issue a new
                // authorized token, restoring the full-quality subscribed stream (1440p etc.)
                const shouldReload = streamInfo.IsUsingModifiedM3U8 || (ReloadPlayerAfterAd && hadStrippedSegments);
                streamInfo.IsUsingModifiedM3U8 = false;
                if (shouldReload || streamInfo.LastCommittedBackupPlayerType) {
                    if (!streamInfo.ReloadTimestamps) streamInfo.ReloadTimestamps = [];
                    streamInfo.ReloadTimestamps.push(Date.now());
                    streamInfo.LastPlayerReload = Date.now();
                    postMessage({ key: 'ReloadPlayer', kind: 'early' });
                } else {
                    postMessage({ key: 'PauseResumePlayer' });
                }
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
        if (!str) return {};
        if (str.charCodeAt(0) === 35) { const idx = str.indexOf(':'); if (idx !== -1) str = str.slice(idx + 1); }
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

    function getAccessToken(channelName, playerType) {
        const body = {
            operationName: 'PlaybackAccessToken',
            variables: {
                isLive: true, login: channelName, isVod: false, vodID: "",
                playerType: playerType, platform: 'web'
            },
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash: "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"
                }
            }
        };
        return gqlRequest(body, playerType);
    }

    // Backup GQL request mirrors Xtra's loadStreamPlaybackAccessToken exactly:
    // user Authorization (if captured) + mobile Client-ID + random X-Device-Id per request.
    // The random device ID prevents "Commercial break in progress".
    // Authorization allows Twitch to resolve user entitlements (sub, Turbo, etc.).
    function gqlRequest(body, playerType) {
        const MOBILE_CLIENT_ID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp';
        // Random UUID-style device ID — same format as Xtra (32 hex chars, no dashes)
        const deviceId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
        const login = body?.variables?.login || '?';
        const ptype = body?.variables?.playerType || '?';
        const platform = body?.variables?.platform || '?';
        console.log('[VAFT-ANON] GQL → POST https://gql.twitch.tv/gql');
        console.log('[VAFT-ANON] GQL headers: Client-ID=' + MOBILE_CLIENT_ID + ' X-Device-Id=' + deviceId + (AuthorizationHeader ? ' Authorization=Bearer...' : ' (no auth)'));
        console.log('[VAFT-ANON] GQL body: login=' + login + ' playerType=' + ptype + ' platform=' + platform + ' isLive=' + (body?.variables?.isLive));
        const headers = {
            'Client-ID': MOBILE_CLIENT_ID,
            'X-Device-Id': deviceId
        };
        // Include the user's Authorization header if available — same as Xtra does.
        // Without it user_id=null and Twitch cannot apply subscription/entitlement ad rules.
        if (AuthorizationHeader) headers['Authorization'] = AuthorizationHeader;
        return new Promise((resolve, reject) => {
            const requestId = Math.random().toString(36).substring(2, 15);
            const fetchRequest = {
                id: requestId,
                url: 'https://gql.twitch.tv/gql',
                options: { method: 'POST', body: JSON.stringify(body), headers }
            };
            const timeoutId = setTimeout(() => {
                if (pendingFetchRequests.has(requestId)) { pendingFetchRequests.delete(requestId); reject(new Error('GQL timeout')); }
            }, 15000);
            pendingFetchRequests.set(requestId, { resolve, reject, timeoutId });
            postMessage({ key: 'FetchRequest', value: fetchRequest });
        });
    }

    let playerForMonitoringBuffering = null;
    let driftCatchUpInterval = null;
    let driftCatchUpTimeout = null;

    // Tracks anonymous initial stream load per channel.
    // On first load for a channel we use mobile client ID + no auth to skip preroll,
    // then reload with the real authorized token once the stream is confirmed playing.
    const initialLoadState = { channelName: null, reloadTimer: null };

    function startDriftCorrection(videoElement) {
        if (DriftCorrectionRate <= 1) return;
        if (driftCatchUpInterval) { clearInterval(driftCatchUpInterval); driftCatchUpInterval = null; }
        if (driftCatchUpTimeout) { clearTimeout(driftCatchUpTimeout); driftCatchUpTimeout = null; }
        videoElement.playbackRate = DriftCorrectionRate;
        driftCatchUpInterval = setInterval(() => {
            try {
                const vid = document.querySelector('video');
                if (vid && vid.buffered.length > 0 && vid.buffered.end(vid.buffered.length - 1) - vid.currentTime <= 1) {
                    vid.playbackRate = 1.0;
                    clearInterval(driftCatchUpInterval); driftCatchUpInterval = null;
                    if (driftCatchUpTimeout) { clearTimeout(driftCatchUpTimeout); driftCatchUpTimeout = null; }
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
        channelName: null, hasStreamStarted: false, position: 0, bufferedPosition: 0, bufferDuration: 0,
        numSame: 0, fixAttempts: 0, lastFixTime: 0, isLive: true, lastBackupSwitchAt: 0, lastReloadAt: 0,
        recoveryReloadUsed: false, userPauseIntent: false, loggedPauseIntent: false, weJustPaused: 0, inAdBreak: false
    };

    function monitorPlayerBuffering() {
        playerForMonitoringBuffering = null;
        {
            const playerAndState = getPlayerAndState();
            if (playerAndState && playerAndState.player && playerAndState.state) {
                playerForMonitoringBuffering = { player: playerAndState.player, state: playerAndState.state };
                const video = playerAndState.player.getHTMLVideoElement?.();
                if (video && !video.__tasIntentHooked) {
                    video.__tasIntentHooked = true;
                    video.addEventListener('pause', () => {
                        if (!playerBufferState.weJustPaused || (Date.now() - playerBufferState.weJustPaused) > 2000) playerBufferState.userPauseIntent = true;
                    });
                    video.addEventListener('play', () => { playerBufferState.userPauseIntent = false; playerBufferState.loggedPauseIntent = false; });
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
                            }
                        }
                    }
                    if (player.getState() === 'Playing') playerBufferState.hasStreamStarted = true;
                    const position = player.core?.state?.position;
                    const bufferedPosition = player.core?.state?.bufferedPosition;
                    const bufferDuration = player.getBufferDuration();
                    const videoEl = player.getHTMLVideoElement?.();
                    const videoCurrentTime = videoEl?.currentTime;
                    if (position !== undefined && bufferedPosition !== undefined) {
                        const playerNotActivelyPlaying = videoEl && (videoEl.readyState < 2 || videoEl.paused);
                        if (videoEl && playerBufferState.videoElement && playerBufferState.videoElement !== videoEl) {
                            playerBufferState.numSame = 0; playerBufferState.fixAttempts = 0; playerBufferState.recoveryReloadUsed = false;
                        }
                        playerBufferState.videoElement = videoEl;
                        const positionFrozen = (playerBufferState.position == position) && (playerBufferState.videoCurrentTime === undefined || playerBufferState.videoCurrentTime === videoCurrentTime);
                        if (playerNotActivelyPlaying) {
                            // hold
                        } else if (playerBufferState.hasStreamStarted && (!PlayerBufferingPrerollCheckEnabled || position > PlayerBufferingPrerollCheckOffset) && (positionFrozen && bufferDuration < PlayerBufferingDangerZone) && playerBufferState.bufferedPosition == bufferedPosition && playerBufferState.bufferDuration >= bufferDuration && (position != 0 || bufferedPosition != 0 || bufferDuration != 0)) {
                            playerBufferState.numSame++;
                            if (playerBufferState.numSame == PlayerBufferingSameStateCount) {
                                playerBufferState.fixAttempts++;
                                const wouldEscalate = playerBufferState.fixAttempts >= 3;
                                const escalateToReload = wouldEscalate && (DisableReloadCap || !playerBufferState.recoveryReloadUsed);
                                const video = player.getHTMLVideoElement?.();
                                if (video && video.buffered.length > 1) {
                                    for (let bi = 0; bi < video.buffered.length; bi++) {
                                        if (video.buffered.start(bi) > video.currentTime + 0.5) { video.currentTime = video.buffered.start(bi); startDriftCorrection(video); break; }
                                    }
                                }
                                doTwitchPlayerTask(!escalateToReload, escalateToReload);
                                playerBufferState.lastFixTime = Date.now();
                                playerBufferState.numSame = 0;
                                if (escalateToReload) { playerBufferState.fixAttempts = 0; playerBufferState.recoveryReloadUsed = true; }
                            }
                        } else {
                            playerBufferState.numSame = 0; playerBufferState.fixAttempts = 0; playerBufferState.recoveryReloadUsed = false;
                        }
                        if (playerBufferState.position > 0 && position - playerBufferState.position > 5 && !playerBufferState.inAdBreak && (!playerBufferState.lastBackupSwitchAt || Date.now() - playerBufferState.lastBackupSwitchAt >= 10000) && (!playerBufferState.lastDriftStartedAt || Date.now() - playerBufferState.lastDriftStartedAt >= 30000)) {
                            startDriftCorrection(player.getHTMLVideoElement?.());
                            playerBufferState.lastDriftStartedAt = Date.now();
                        }
                        playerBufferState.position = position;
                        playerBufferState.videoCurrentTime = videoCurrentTime;
                        playerBufferState.bufferedPosition = bufferedPosition;
                        playerBufferState.bufferDuration = bufferDuration;
                    } else { playerBufferState.numSame = 0; }
                }
            } catch (err) { playerForMonitoringBuffering = null; }
        }
        if (isActivelyStrippingAds && playerForMonitoringBuffering) {
            try {
                const player = playerForMonitoringBuffering.player;
                const video = player?.getHTMLVideoElement?.();
                if (video && !video.ended && !playerBufferState.userPauseIntent) {
                    if (video.readyState >= 3) playerBufferState.hasHadData = true;
                    const isStalled = video.readyState < 3 && (video.paused || video.networkState === 2);
                    const stallReloadCooldown = 15000;
                    const cooldownExpired = !playerBufferState.lastAdStallReloadAt || (Date.now() - playerBufferState.lastAdStallReloadAt) > stallReloadCooldown;
                    const recentReload = playerBufferState.lastReloadAt && (Date.now() - playerBufferState.lastReloadAt) < stallReloadCooldown;
                    if (isStalled && cooldownExpired && !recentReload && playerBufferState.hasHadData) {
                        if (!playerBufferState.adStallStartAt) { playerBufferState.adStallStartAt = Date.now(); }
                        else if ((Date.now() - playerBufferState.adStallStartAt) > 3000) {
                            playerBufferState.lastAdStallReloadAt = Date.now();
                            playerBufferState.adStallStartAt = 0;
                            doTwitchPlayerTask(false, true, 'early');
                        }
                    } else if (!isStalled) { playerBufferState.adStallStartAt = 0; }
                }
            } catch {}
        } else if (!isActivelyStrippingAds && playerBufferState.adStallStartAt) { playerBufferState.adStallStartAt = 0; }
        const isLive = playerForMonitoringBuffering?.state?.props?.content?.type === 'live';
        if (playerBufferState.isLive && !isLive) updateAdblockBanner({ hasAds: false });
        playerBufferState.isLive = isLive;
        if (typeof document !== 'undefined' && !monitorPlayerBuffering.visibilityHooked) {
            monitorPlayerBuffering.visibilityHooked = true;
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && !monitorPlayerBuffering.pendingTick) {
                    monitorPlayerBuffering.pendingTick = true;
                    setTimeout(() => { monitorPlayerBuffering.pendingTick = false; monitorPlayerBuffering(); }, 100);
                }
            });
        }
        try { hideTwitchAdOverlays(); } catch {}
        const shouldThrottle = typeof document !== 'undefined' && document.hidden && !document.pictureInPictureElement;
        setTimeout(monitorPlayerBuffering, shouldThrottle ? PlayerBufferingDelay * 3 : PlayerBufferingDelay);
    }

    function hideTwitchAdOverlays() {
        if (!cachedPlayerRootDiv || !cachedPlayerRootDiv.isConnected) return;
        const sdaElements = document.querySelectorAll('[data-test-selector="sda-wrapper"]');
        for (let i = 0; i < sdaElements.length; i++) {
            if (!sdaElements[i].dataset.tasHidden) {
                sdaElements[i].dataset.tasHidden = '';
                sdaElements[i].style.setProperty('display', 'none', 'important');
                if (!loggedSdaHide) { loggedSdaHide = true; }
            }
        }
    }

    function updateAdblockBanner(data) {
        if (!cachedPlayerRootDiv || !cachedPlayerRootDiv.isConnected) cachedPlayerRootDiv = document.querySelector('.video-player');
        const playerRootDiv = cachedPlayerRootDiv;
        if (playerRootDiv != null) {
            let adBlockDiv = playerRootDiv.querySelector('.tas-adblock-overlay');
            if (adBlockDiv == null) {
                adBlockDiv = document.createElement('div');
                adBlockDiv.className = 'tas-adblock-overlay';
                adBlockDiv.innerHTML = '<div style="color:white;background:rgba(0,0,0,0.8);position:absolute;top:0;left:0;padding:5px;font-size:12px"><p></p></div>';
                adBlockDiv.style.display = 'none';
                adBlockDiv.P = adBlockDiv.querySelector('p');
                playerRootDiv.appendChild(adBlockDiv);
            }
            isActivelyStrippingAds = data.isStrippingAdSegments;
            adBlockDiv.P.textContent = 'Blocking' + (data.isMidroll ? ' midroll' : '') + ' ads — mobile token' + (data.isStrippingAdSegments ? ' (stripping)' : '');
            adBlockDiv.style.display = data.hasAds && playerBufferState.isLive ? 'block' : 'none';
            if (data.hasAds) hideTwitchAdOverlays();
        }
    }

    function getPlayerAndState() {
        function findReactNode(root, constraint) {
            if (root.stateNode && constraint(root.stateNode)) return root.stateNode;
            let node = root.child;
            while (node) { const result = findReactNode(node, constraint); if (result) return result; node = node.sibling; }
            return null;
        }
        function findReactRootNode() {
            let reactRootNode = null;
            if (!cachedRootNode) cachedRootNode = document.querySelector('#root');
            const rootNode = cachedRootNode;
            if (rootNode && rootNode._reactRootContainer?._internalRoot?.current) reactRootNode = rootNode._reactRootContainer._internalRoot.current;
            if (reactRootNode == null && rootNode != null) {
                const containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer') || x.startsWith('__reactFiber'));
                if (containerName != null) reactRootNode = rootNode[containerName];
            }
            return reactRootNode;
        }
        const reactRootNode = findReactRootNode();
        if (!reactRootNode) return null;
        let player = findReactNode(reactRootNode, node => node.setPlayerActive && node.props?.mediaPlayerInstance);
        player = player?.props?.mediaPlayerInstance ?? null;
        if (player?.playerInstance) player = player.playerInstance;
        if (!player) player = findReactNode(reactRootNode, node => node.getHTMLVideoElement && node.getBufferDuration && node.core?.state);
        const playerState = findReactNode(reactRootNode, node => node.setSrc && node.setInitialPlaybackSettings);
        const playerStateFallback = !playerState ? findReactNode(reactRootNode, node => node.setSrc && node.setStreamManagerNode && !node.getHTMLVideoElement) : null;
        const playerStateFallback2 = !playerState && !playerStateFallback ? findReactNode(reactRootNode, node => node.state?.videoPlayerInstance?.playerMode !== undefined)?.state?.videoPlayerInstance : null;
        return { player, state: playerState || playerStateFallback || playerStateFallback2 };
    }

    function doTwitchPlayerTask(isPausePlay, isReload, reloadKind) {
        const playerAndState = getPlayerAndState();
        if (!playerAndState) return;
        const player = playerAndState.player;
        const playerState = playerAndState.state;
        if (!player || !playerState) return;
        const wasPaused = player.isPaused() || player.core?.paused;
        if (wasPaused) {
            if (playerBufferState.userPauseIntent) return;
            if (playerBufferState.weJustPaused && (Date.now() - playerBufferState.weJustPaused) < 10000) {
                try { player.play()?.catch?.(() => {}); } catch {}
            }
            return;
        }
        playerBufferState.weJustPaused = 0;
        playerBufferState.lastFixTime = Date.now();
        playerBufferState.numSame = 0;
        if (isPausePlay) { player.pause(); player.play()?.catch?.(() => {}); playerBufferState.weJustPaused = Date.now(); return; }
        if (isReload && document.pictureInPictureElement) { player.pause(); player.play()?.catch?.(() => {}); return; }
        if (isReload) {
            const video = player.getHTMLVideoElement?.();
            if (video && video.readyState >= 3 && !video.paused && !video.ended) {
                let latencySec = 0, latencyKnown = false;
                try {
                    if (video.seekable && video.seekable.length > 0) {
                        const seekableEnd = video.seekable.end(video.seekable.length - 1);
                        if (Number.isFinite(seekableEnd)) { const calc = Math.max(0, seekableEnd - video.currentTime); if (calc < 3600) { latencySec = calc; latencyKnown = true; } }
                    }
                } catch {}
                if (latencyKnown && latencySec <= 7) { console.log('[AD] Skipping reload — player healthy'); return; }
            }
        }
        if (isReload) {
            const lsKeys = ['video-quality', 'video-muted', 'volume', 'lowLatencyModeEnabled', 'persistenceEnabled'];
            const savedLS = {};
            try {
                lsKeys.forEach(k => savedLS[k] = localStorage.getItem(k));
                if (player?.core?.state?.quality?.group) localStorage.setItem('video-quality', JSON.stringify({default: player.core.state.quality.group}));
            } catch {}
            playerBufferState.lastReloadAt = Date.now();
            playerBufferState.adStallStartAt = 0;
            playerBufferState.userPauseIntent = false;
            const hardReload = reloadKind === 'early';
            if (hardReload) {
                try {
                    const v = document.querySelector('video');
                    if (v && !v.muted) {
                        v.muted = true;
                        const restore = () => { try { document.querySelector('video').muted = false; } catch {} };
                        v.addEventListener('canplay', restore, { once: true });
                        setTimeout(restore, 1500);
                    }
                } catch {}
            }
            // refreshAccessToken: true — Twitch issues a new authorized GQL request,
            // restoring the full-quality subscribed stream after the ad break
            playerState.setSrc({ isNewMediaPlayerInstance: hardReload, refreshAccessToken: hardReload });
            postTwitchWorkerMessage('TriggeredPlayerReload');
            player.play()?.catch?.(() => {});
            setTimeout(() => {
                try {
                    lsKeys.forEach(k => { if (savedLS[k] != null) localStorage.setItem(k, savedLS[k]); });
                    const videos = document.getElementsByTagName('video');
                    const userIntendedMute = savedLS['video-muted']?.includes('"default":true');
                    if (videos.length > 0 && videos[0].muted && !userIntendedMute) videos[0].muted = false;
                    if (videos.length > 0 && videos[0].buffered.length > 0 && videos[0].readyState >= 3) {
                        const liveEdge = videos[0].buffered.end(videos[0].buffered.length - 1);
                        const drift = liveEdge - videos[0].currentTime;
                        if (hardReload && drift > 5 && Number.isFinite(liveEdge) && liveEdge < 3600) { videos[0].currentTime = liveEdge; }
                        else if (drift > 2) startDriftCorrection(videos[0]);
                    }
                } catch {}
            }, 3000);
        }
    }

    window.reloadTwitchPlayer = () => { doTwitchPlayerTask(false, true); };

    function postTwitchWorkerMessage(key, value) {
        twitchWorkers.forEach((worker) => { worker.postMessage({key, value}); });
    }

    async function handleWorkerFetchRequest(fetchRequest) {
        try {
            const response = await window.realFetch(fetchRequest.url, fetchRequest.options);
            const responseBody = await response.text();
            return {
                id: fetchRequest.id, status: response.status, statusText: response.statusText,
                ok: response.ok, redirected: response.redirected, type: response.type, url: response.url,
                headers: Object.fromEntries(response.headers.entries()), body: responseBody
            };
        } catch (error) { return { id: fetchRequest.id, error: error.message }; }
    }

    function hookFetch() {
        const realFetch = window.fetch;
        window.realFetch = realFetch;
        window.fetch = maskAsNative(function(url, init, ...args) {
            if (typeof url === 'string' && url.includes('gql') && init?.headers) {
                // Capture session headers for the worker (used for non-backup GQL requests)
                let deviceId = init.headers['X-Device-Id'] || init.headers['Device-ID'];
                if (typeof deviceId === 'string' && GQLDeviceID != deviceId) {
                    GQLDeviceID = deviceId;
                    postTwitchWorkerMessage('UpdateDeviceId', GQLDeviceID);
                }
                if (typeof init.headers['Client-Version'] === 'string' && init.headers['Client-Version'] !== ClientVersion)
                    postTwitchWorkerMessage('UpdateClientVersion', ClientVersion = init.headers['Client-Version']);
                if (typeof init.headers['Client-Session-Id'] === 'string' && init.headers['Client-Session-Id'] !== ClientSession)
                    postTwitchWorkerMessage('UpdateClientSession', ClientSession = init.headers['Client-Session-Id']);
                if (typeof init.headers['Client-Integrity'] === 'string' && init.headers['Client-Integrity'] !== ClientIntegrityHeader)
                    postTwitchWorkerMessage('UpdateClientIntegrityHeader', ClientIntegrityHeader = init.headers['Client-Integrity']);
                if (typeof init.headers['Authorization'] === 'string' && init.headers['Authorization'] !== AuthorizationHeader)
                    postTwitchWorkerMessage('UpdateAuthorizationHeader', AuthorizationHeader = init.headers['Authorization']);
                // Mini-player fix: suppress picture-by-picture access token requests
                if (typeof init.body === 'string' && init.body.includes('PlaybackAccessToken') && init.body.includes('picture-by-picture'))
                    init.body = '';
                // Handle every PlaybackAccessToken request (skip picture-by-picture).
                if (typeof init.body === 'string' && init.body.includes('PlaybackAccessToken') && !init.body.includes('picture-by-picture')) {
                    // Always inject a fresh random X-Device-Id — same format as Xtra (32 hex chars).
                    // Prevents "Commercial break in progress" on every session.
                    const randomId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                        .map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
                    if ('X-Device-Id' in init.headers) init.headers['X-Device-Id'] = randomId;
                    else if ('Device-ID' in init.headers) init.headers['Device-ID'] = randomId;
                    else init.headers['X-Device-Id'] = randomId;

                    // Detect channel name from request body to track per-channel initial load.
                    let _channelName = null;
                    try { _channelName = JSON.parse(init.body)?.variables?.login || null; } catch {}

                    if (_channelName && _channelName !== initialLoadState.channelName) {
                        // New channel — reset initial load state.
                        initialLoadState.channelName = _channelName;
                        if (initialLoadState.reloadTimer) { clearTimeout(initialLoadState.reloadTimer); initialLoadState.reloadTimer = null; }
                        initialLoadState.done = false;
                    }

                    if (!initialLoadState.done) {
                        // First token request for this channel: go anonymous to skip preroll.
                        // Mirrors Xtra's anonymous/fresh-install flow:
                        // mobile Client-ID + no Authorization + random device ID.
                        initialLoadState.done = true;
                        // Replace Client-Id/Client-ID with mobile client ID regardless of case.
                        // Must delete the original key first — adding a new casing makes a duplicate → 400.
                        const _clientIdKey = Object.keys(init.headers).find(k => k.toLowerCase() === 'client-id');
                        if (_clientIdKey) delete init.headers[_clientIdKey];
                        init.headers['Client-Id'] = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp';
                        // Remove Authorization and any integrity headers that are invalid without auth.
                        for (const k of Object.keys(init.headers)) {
                            const kl = k.toLowerCase();
                            if (kl === 'authorization' || kl === 'client-integrity') delete init.headers[k];
                        }
                        console.log('[AD] Initial load for ' + _channelName + ' — anonymous token to skip preroll');
                        // After 15s of clean playback reload with the real authorized token.
                        // By then the preroll window has passed and the authorized stream
                        // will not be assigned a new preroll for the same session.
                        initialLoadState.reloadTimer = setTimeout(() => {
                            initialLoadState.reloadTimer = null;
                            if (!playerBufferState.inAdBreak) {
                                console.log('[AD] Switching to authorized stream after anonymous start');
                                doTwitchPlayerTask(false, true, 'early');
                            }
                        }, 15000);
                    }
                }
            }
            if (typeof url === 'string' && url.includes('edge.ads.twitch.tv')) {
                const csaiType = url.includes('bp=midroll') ? 'midroll' : url.includes('bp=preroll') ? 'preroll' : 'unknown';
                if (!loggedCsaiTypes.has(csaiType)) { loggedCsaiTypes.add(csaiType); }
            }
            return realFetch.apply(this, arguments);
        }, 'fetch');
    }

    function onContentLoaded() {
        let wasVideoPlaying = true;
        document.addEventListener('visibilitychange', () => {
            const videos = document.getElementsByTagName('video');
            if (videos.length === 0) return;
            if (document.hidden) { wasVideoPlaying = !videos[0].paused && !videos[0].ended; return; }
            if (!playerBufferState.hasStreamStarted) playerBufferState.hasStreamStarted = true;
            if (wasVideoPlaying && !videos[0].ended && videos[0].paused) videos[0].play()?.catch?.(() => {});
        });
        try {
            const keysToCache = ['video-quality', 'video-muted', 'volume', 'lowLatencyModeEnabled', 'persistenceEnabled'];
            const cachedValues = new Map();
            keysToCache.forEach(k => cachedValues.set(k, localStorage.getItem(k)));
            const realSetItem = localStorage.setItem;
            localStorage.setItem = maskAsNative(function(key, value) {
                if (cachedValues.has(key)) cachedValues.set(key, value);
                realSetItem.apply(this, arguments);
            }, 'setItem');
            const realGetItem = localStorage.getItem;
            localStorage.getItem = maskAsNative(function(key) {
                if (cachedValues.has(key)) return cachedValues.get(key);
                return realGetItem.apply(this, arguments);
            }, 'getItem');
            if (localStorage.getItem === realGetItem) localStorageHookFailed = true;
        } catch { localStorageHookFailed = true; }
    }

    declareOptions(window);
    console.log('[AD] Mode: authorized main stream + mobile-client-ID backup during ads (show_ads=false)');
    hookWindowWorker();
    hookFetch();
    const realXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = maskAsNative(function(method, url) {
        return realXHROpen.apply(this, arguments);
    }, 'open');
    if (PlayerBufferingFix) monitorPlayerBuffering();
    if (document.readyState === "complete" || document.readyState === "interactive") {
        onContentLoaded();
    } else {
        window.addEventListener("DOMContentLoaded", onContentLoaded);
    }
})();
