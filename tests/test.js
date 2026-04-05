// Unit tests for TwitchAdSolutions
// Run: node tests/test.js

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
    } else {
        failed++;
        console.error('FAIL: ' + message);
    }
}

function assertEq(actual, expected, message) {
    if (actual === expected) {
        passed++;
    } else {
        failed++;
        console.error('FAIL: ' + message + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
}

function assertDeepEq(actual, expected, message) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        passed++;
    } else {
        failed++;
        console.error('FAIL: ' + message + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
}

// ============================================================
// Mock globals
// ============================================================
const AdSignifiers = ['stitched', 'stitched-ad', 'maf-ad', 'X-TV-TWITCH-AD', 'EXT-X-CUE-OUT', 'EXT-X-DATERANGE:CLASS="twitch-stitched-ad"', 'EXT-X-DATERANGE:CLASS="twitch-stream-source"', 'EXT-X-DATERANGE:CLASS="twitch-trigger"', 'EXT-X-DATERANGE:CLASS="twitch-maf-ad"', 'EXT-X-DATERANGE:CLASS="twitch-ad-quartile"', 'SCTE35-OUT'];
const AdSegmentURLPatterns = ['/adsquared/', '/_404/', '/processing'];
let AdSegmentCache = new Map();
let AllSegmentsAreAdSegments = false;
let V2API = false;

const workerStringConflicts = ['twitch', 'isVariantA'];
const workerStringReinsert = ['isVariantA', 'besuper/', '${patch_url}'];

// ============================================================
// Functions under test (copied from vaft.user.js)
// ============================================================

function hasAdTags(textStr) {
    return AdSignifiers.some((s) => textStr.includes(s));
}

function getMatchedAdSignifiers(textStr) {
    return AdSignifiers.filter((s) => textStr.includes(s));
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

function stripAdSegments(textStr, stripAllSegments, streamInfo) {
    let hasStrippedAdSegments = false;
    let inCueOut = false;
    const liveSegments = [];
    const lines = textStr.split(/\r?\n/);
    const newAdUrl = 'https://twitch.tv';
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.includes('EXT-X-CUE-OUT')) {
            inCueOut = true;
        } else if (line.includes('EXT-X-CUE-IN')) {
            inCueOut = false;
        }
        lines[i] = line
            .replaceAll(/(X-TV-TWITCH-AD(?:-[A-Z]+)*-URLS?=")[^"]*(")/g, `$1${newAdUrl}$2`);
        if (i < lines.length - 1 && line.startsWith('#EXTINF') && (!line.includes(',live') || stripAllSegments || AllSegmentsAreAdSegments || inCueOut)) {
            const segmentUrl = lines[i + 1];
            if (!AdSegmentCache.has(segmentUrl)) {
                streamInfo.NumStrippedAdSegments++;
            }
            AdSegmentCache.set(segmentUrl, Date.now());
            hasStrippedAdSegments = true;
        } else if (i < lines.length - 1 && line.startsWith('#EXTINF') && AdSegmentURLPatterns.some((p) => lines[i + 1].includes(p))) {
            AdSegmentCache.set(lines[i + 1], Date.now());
            hasStrippedAdSegments = true;
            streamInfo.NumStrippedAdSegments++;
        } else if (i < lines.length - 1 && line.startsWith('#EXTINF') && line.includes(',live')) {
            liveSegments.push({ extinf: line, url: lines[i + 1] });
        }
        if (AdSignifiers.some((s) => line.includes(s))) {
            hasStrippedAdSegments = true;
        }
    }
    if (hasStrippedAdSegments) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-TWITCH-PREFETCH:')) {
                lines[i] = '';
            }
        }
    } else {
        streamInfo.NumStrippedAdSegments = 0;
    }
    if (liveSegments.length > 0) {
        streamInfo.RecoverySegments = liveSegments.slice(-6);
    }
    if (hasStrippedAdSegments && liveSegments.length === 0 && streamInfo.RecoverySegments && streamInfo.RecoverySegments.length > 0) {
        for (let j = 0; j < streamInfo.RecoverySegments.length; j++) {
            lines.push(streamInfo.RecoverySegments[j].extinf);
            lines.push(streamInfo.RecoverySegments[j].url);
        }
    }
    streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
    return lines.join('\n');
}

function isValidWorker(worker) {
    const workerString = worker.toString();
    const hasConflict = workerStringConflicts.some((x) => workerString.includes(x));
    const hasReinsert = workerStringReinsert.some((x) => workerString.includes(x));
    return !hasConflict || hasReinsert;
}

// ============================================================
// Test: hasAdTags
// ============================================================
console.log('--- hasAdTags ---');
assert(hasAdTags('stitched-ad-12345.ts') === true, 'detects stitched-ad');
assert(hasAdTags('X-TV-TWITCH-AD-URL="http://example.com"') === true, 'detects X-TV-TWITCH-AD');
assert(hasAdTags('#EXT-X-CUE-OUT:DURATION=30') === true, 'detects EXT-X-CUE-OUT');
assert(hasAdTags('SCTE35-OUT') === true, 'detects SCTE35-OUT');
assert(hasAdTags('#EXT-X-DATERANGE:CLASS="twitch-stitched-ad"') === true, 'detects EXT-X-DATERANGE');
assert(hasAdTags('normal-segment-12345.ts') === false, 'clean segment returns false');
assert(hasAdTags('#EXTINF:2.000,live\nhttps://video.twitch.tv/segment.ts') === false, 'normal m3u8 returns false');
assert(hasAdTags('') === false, 'empty string returns false');

// ============================================================
// Test: getMatchedAdSignifiers
// ============================================================
console.log('--- getMatchedAdSignifiers ---');
assertDeepEq(getMatchedAdSignifiers('stitched-ad segment with X-TV-TWITCH-AD'), ['stitched', 'stitched-ad', 'X-TV-TWITCH-AD'], 'matches multiple signifiers');
assertDeepEq(getMatchedAdSignifiers('#EXT-X-CUE-OUT:DURATION=30'), ['EXT-X-CUE-OUT'], 'matches single CUE-OUT');
assertDeepEq(getMatchedAdSignifiers('normal content'), [], 'no matches on clean content');
assertDeepEq(getMatchedAdSignifiers('SCTE35-OUT marker'), ['SCTE35-OUT'], 'matches SCTE35-OUT');
assert(hasAdTags('maf-ad segment') === true, 'detects maf-ad');
assert(hasAdTags('#EXT-X-DATERANGE:CLASS="twitch-stream-source"') === true, 'detects twitch-stream-source');
assert(hasAdTags('#EXT-X-DATERANGE:CLASS="twitch-trigger"') === true, 'detects twitch-trigger');
assert(hasAdTags('#EXT-X-DATERANGE:CLASS="twitch-maf-ad"') === true, 'detects twitch-maf-ad');
assert(hasAdTags('#EXT-X-DATERANGE:CLASS="twitch-ad-quartile"') === true, 'detects twitch-ad-quartile');

// ============================================================
// Test: parseAttributes
// ============================================================
console.log('--- parseAttributes ---');
const attrs1 = parseAttributes('#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.4D4028",FRAME-RATE=30.0');
assertEq(attrs1['RESOLUTION'], '1920x1080', 'parses resolution');
assertEq(attrs1['FRAME-RATE'], 30, 'parses frame rate as number');
assertEq(attrs1['CODECS'], 'avc1.4D4028', 'parses quoted codecs');
// BANDWIDTH is the first attribute after the colon — parseAttributes regex splits on comma-prefixed pairs
const attrs1b = parseAttributes('BANDWIDTH=6000000,RESOLUTION=1920x1080');
assertEq(attrs1b['BANDWIDTH'], 6000000, 'parses bandwidth as number when first attribute');

const attrs2 = parseAttributes('#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=852x480,CODECS="hev1.1.6.L120",FRAME-RATE=60.0');
assertEq(attrs2['RESOLUTION'], '852x480', 'parses 480p resolution');
assertEq(attrs2['CODECS'], 'hev1.1.6.L120', 'parses HEVC codec');
assertEq(attrs2['FRAME-RATE'], 60, 'parses 60fps');

// ============================================================
// Test: getServerTimeFromM3u8
// ============================================================
console.log('--- getServerTimeFromM3u8 ---');
V2API = false;
assertEq(getServerTimeFromM3u8('#EXT-X-TWITCH-ELAPSED-SECS:10.5,SERVER-TIME="1234567890.123"'), '1234567890.123', 'extracts v1 server time');
assertEq(getServerTimeFromM3u8('no server time here'), null, 'returns null when no server time');

V2API = true;
assertEq(getServerTimeFromM3u8('#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="9876543210.456"'), '9876543210.456', 'extracts v2 server time');
assertEq(getServerTimeFromM3u8('no server time here'), null, 'returns null for v2 when no match');
V2API = false;

// ============================================================
// Test: replaceServerTimeInM3u8
// ============================================================
console.log('--- replaceServerTimeInM3u8 ---');
V2API = false;
const m3u8WithTime = '#EXT-X-TWITCH-ELAPSED-SECS:10.5,SERVER-TIME="1234567890.123"';
assert(replaceServerTimeInM3u8(m3u8WithTime, '9999999999.000').includes('SERVER-TIME="9999999999.000"'), 'replaces v1 server time');
assertEq(replaceServerTimeInM3u8(m3u8WithTime, null), m3u8WithTime, 'returns original when newServerTime is null');

V2API = true;
const m3u8V2 = '#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="1234567890.123"';
assert(replaceServerTimeInM3u8(m3u8V2, '9999999999.000').includes('VALUE="9999999999.000"'), 'replaces v2 server time');
V2API = false;

// ============================================================
// Test: getStreamUrlForResolution
// ============================================================
console.log('--- getStreamUrlForResolution ---');
const encodingsM3u8 = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.4D4028",FRAME-RATE=30.0',
    'https://video.twitch.tv/1080p30.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F",FRAME-RATE=60.0',
    'https://video.twitch.tv/720p60.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=852x480,CODECS="avc1.4D401E",FRAME-RATE=30.0',
    'https://video.twitch.tv/480p30.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,CODECS="avc1.4D401E",FRAME-RATE=30.0',
    'https://video.twitch.tv/360p30.m3u8',
].join('\n');

assertEq(
    getStreamUrlForResolution(encodingsM3u8, { Resolution: '1920x1080', FrameRate: 30 }),
    'https://video.twitch.tv/1080p30.m3u8',
    'exact resolution + framerate match'
);
assertEq(
    getStreamUrlForResolution(encodingsM3u8, { Resolution: '1280x720', FrameRate: 60 }),
    'https://video.twitch.tv/720p60.m3u8',
    'exact 720p60 match'
);
assertEq(
    getStreamUrlForResolution(encodingsM3u8, { Resolution: '1280x720', FrameRate: 30 }),
    'https://video.twitch.tv/720p60.m3u8',
    'resolution match without framerate match returns closest'
);
assert(
    getStreamUrlForResolution(encodingsM3u8, { Resolution: '1600x900', FrameRate: 30 }) != null,
    'non-exact resolution returns closest match'
);

// ============================================================
// Test: stripAdSegments
// ============================================================
console.log('--- stripAdSegments ---');

// Reset cache before each test group
AdSegmentCache = new Map();

// Test: strips ad segments
const adM3u8 = [
    '#EXTM3U',
    '#EXT-X-TWITCH-PREFETCH:https://prefetch.url',
    '#EXTINF:2.000,stitched-ad',
    'https://ad-segment-1.ts',
    '#EXTINF:2.000,live',
    'https://live-segment-1.ts',
].join('\n');

let streamInfo = { NumStrippedAdSegments: 0, IsStrippingAdSegments: false, RecoverySegments: [] };
let result = stripAdSegments(adM3u8, false, streamInfo);
assertEq(streamInfo.NumStrippedAdSegments, 1, 'counts stripped ad segment');
assert(streamInfo.IsStrippingAdSegments === true, 'marks as stripping');
assert(AdSegmentCache.has('https://ad-segment-1.ts'), 'caches ad segment URL');
assert(!result.includes('https://prefetch.url'), 'removes prefetch URLs during ads');
assert(streamInfo.RecoverySegments.length === 1, 'caches live segment for recovery');

// Test: no stripping on clean m3u8
AdSegmentCache = new Map();
const cleanM3u8 = [
    '#EXTM3U',
    '#EXTINF:2.000,live',
    'https://live-segment-1.ts',
    '#EXTINF:2.000,live',
    'https://live-segment-2.ts',
].join('\n');

streamInfo = { NumStrippedAdSegments: 5, IsStrippingAdSegments: false, RecoverySegments: [] };
result = stripAdSegments(cleanM3u8, false, streamInfo);
assertEq(streamInfo.NumStrippedAdSegments, 0, 'resets stripped count on clean m3u8');
assert(streamInfo.IsStrippingAdSegments === false, 'not stripping on clean m3u8');

// Test: SCTE-35 CUE-OUT/CUE-IN stripping
AdSegmentCache = new Map();
const scteM3u8 = [
    '#EXTM3U',
    '#EXT-X-CUE-OUT:DURATION=30',
    '#EXTINF:2.000,live',
    'https://cue-out-segment.ts',
    '#EXT-X-CUE-IN',
    '#EXTINF:2.000,live',
    'https://normal-segment.ts',
].join('\n');

streamInfo = { NumStrippedAdSegments: 0, IsStrippingAdSegments: false, RecoverySegments: [] };
result = stripAdSegments(scteM3u8, false, streamInfo);
assert(AdSegmentCache.has('https://cue-out-segment.ts'), 'strips segment inside CUE-OUT');
assert(!AdSegmentCache.has('https://normal-segment.ts'), 'does not strip segment after CUE-IN');

// Test: URL pattern detection
AdSegmentCache = new Map();
const urlPatternM3u8 = [
    '#EXTM3U',
    '#EXTINF:2.000,live',
    'https://cdn.twitch.tv/adsquared/ad-123.ts',
    '#EXTINF:2.000,live',
    'https://cdn.twitch.tv/normal-segment.ts',
].join('\n');

streamInfo = { NumStrippedAdSegments: 0, IsStrippingAdSegments: false, RecoverySegments: [] };
result = stripAdSegments(urlPatternM3u8, false, streamInfo);
assert(AdSegmentCache.has('https://cdn.twitch.tv/adsquared/ad-123.ts'), 'detects /adsquared/ URL pattern');
assert(!AdSegmentCache.has('https://cdn.twitch.tv/normal-segment.ts'), 'does not flag normal URL');

// Test: ad tracking URL replacement
AdSegmentCache = new Map();
const trackingM3u8 = [
    '#EXTM3U',
    '#EXTINF:2.000,stitched-ad',
    'https://ad.ts',
    'X-TV-TWITCH-AD-URL="https://tracking.example.com"',
    'X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://click.example.com"',
    'X-TV-TWITCH-AD-FIRST-QUARTILE-URL="https://q1.example.com"',
    'X-TV-TWITCH-AD-IMPRESSION-URLS="https://imp.example.com"',
    'X-TV-TWITCH-AD-COMMERCIAL-ID="abc123"',
].join('\n');

streamInfo = { NumStrippedAdSegments: 0, IsStrippingAdSegments: false, RecoverySegments: [] };
result = stripAdSegments(trackingM3u8, false, streamInfo);
assert(result.includes('X-TV-TWITCH-AD-URL="https://twitch.tv"'), 'replaces ad URL with twitch.tv');
assert(result.includes('X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://twitch.tv"'), 'replaces click tracking URL');
assert(result.includes('X-TV-TWITCH-AD-FIRST-QUARTILE-URL="https://twitch.tv"'), 'replaces quartile URL');
assert(result.includes('X-TV-TWITCH-AD-IMPRESSION-URLS="https://twitch.tv"'), 'replaces impression URLS (plural)');
assert(result.includes('X-TV-TWITCH-AD-COMMERCIAL-ID="abc123"'), 'leaves non-URL attributes alone');

// Test: recovery segments restore when all stripped
AdSegmentCache = new Map();
const allAdM3u8 = [
    '#EXTM3U',
    '#EXTINF:2.000,stitched-ad',
    'https://ad-1.ts',
    '#EXTINF:2.000,stitched-ad',
    'https://ad-2.ts',
].join('\n');

streamInfo = {
    NumStrippedAdSegments: 0,
    IsStrippingAdSegments: false,
    RecoverySegments: [
        { extinf: '#EXTINF:2.000,live', url: 'https://recovery-1.ts' },
        { extinf: '#EXTINF:2.000,live', url: 'https://recovery-2.ts' }
    ]
};
result = stripAdSegments(allAdM3u8, false, streamInfo);
assert(result.includes('https://recovery-1.ts'), 'restores recovery segment 1');
assert(result.includes('https://recovery-2.ts'), 'restores recovery segment 2');

// Test: stripAllSegments mode
AdSegmentCache = new Map();
const mixedM3u8 = [
    '#EXTM3U',
    '#EXTINF:2.000,live',
    'https://live-segment.ts',
].join('\n');

streamInfo = { NumStrippedAdSegments: 0, IsStrippingAdSegments: false, RecoverySegments: [] };
result = stripAdSegments(mixedM3u8, true, streamInfo);
assert(AdSegmentCache.has('https://live-segment.ts'), 'strips live segments when stripAllSegments is true');

// Test: /_404/ and /processing URL patterns
AdSegmentCache = new Map();
const urlPattern404M3u8 = [
    '#EXTM3U',
    '#EXTINF:2.000,live',
    'https://cdn.twitch.tv/_404/placeholder.ts',
    '#EXTINF:2.000,live',
    'https://cdn.twitch.tv/processing/ad-init.ts',
    '#EXTINF:2.000,live',
    'https://cdn.twitch.tv/normal-segment.ts',
].join('\n');

streamInfo = { NumStrippedAdSegments: 0, IsStrippingAdSegments: false, RecoverySegments: [] };
result = stripAdSegments(urlPattern404M3u8, false, streamInfo);
assert(AdSegmentCache.has('https://cdn.twitch.tv/_404/placeholder.ts'), 'detects /_404/ URL pattern');
assert(AdSegmentCache.has('https://cdn.twitch.tv/processing/ad-init.ts'), 'detects /processing URL pattern');
assert(!AdSegmentCache.has('https://cdn.twitch.tv/normal-segment.ts'), 'does not flag normal segment');

// Test: multiple signifiers in same m3u8
AdSegmentCache = new Map();
const multiSignifierM3u8 = [
    '#EXTM3U',
    '#EXT-X-CUE-OUT:DURATION=30',
    '#EXTINF:2.000,stitched-ad',
    'https://ad-1.ts',
    'X-TV-TWITCH-AD-URL="https://example.com"',
    '#EXT-X-CUE-IN',
    '#EXTINF:2.000,live',
    'https://live-1.ts',
].join('\n');

streamInfo = { NumStrippedAdSegments: 0, IsStrippingAdSegments: false, RecoverySegments: [] };
result = stripAdSegments(multiSignifierM3u8, false, streamInfo);
assert(streamInfo.IsStrippingAdSegments === true, 'detects ads with multiple signifiers');
assert(AdSegmentCache.has('https://ad-1.ts'), 'strips segment with multiple signifiers present');

// Test: AdSegmentCache deduplication
AdSegmentCache = new Map();
const dupeM3u8 = [
    '#EXTM3U',
    '#EXTINF:2.000,stitched-ad',
    'https://same-ad.ts',
].join('\n');

streamInfo = { NumStrippedAdSegments: 0, IsStrippingAdSegments: false, RecoverySegments: [] };
stripAdSegments(dupeM3u8, false, streamInfo);
assertEq(streamInfo.NumStrippedAdSegments, 1, 'first strip increments count');
streamInfo2 = { NumStrippedAdSegments: 0, IsStrippingAdSegments: false, RecoverySegments: [] };
stripAdSegments(dupeM3u8, false, streamInfo2);
assertEq(streamInfo2.NumStrippedAdSegments, 0, 'duplicate URL does not increment count (already cached)');

// ============================================================
// Test: isValidWorker
// ============================================================
console.log('--- isValidWorker ---');
assert(isValidWorker({ toString: () => 'function Worker() { /* twitch worker */ }' }) === false, 'rejects worker with twitch conflict');
assert(isValidWorker({ toString: () => 'function Worker() { isVariantA }' }) === true, 'allows worker with reinsert pattern (TwitchNoSub)');
assert(isValidWorker({ toString: () => 'function Worker() { besuper/ }' }) === true, 'allows worker with besuper reinsert');
assert(isValidWorker({ toString: () => 'function Worker() { /* clean */ }' }) === true, 'allows clean worker without conflicts');
assert(isValidWorker({ toString: () => 'function Worker() { twitch isVariantA }' }) === true, 'allows conflict + reinsert combination');
assert(isValidWorker({ toString: () => 'function Worker() { ${patch_url} }' }) === true, 'allows worker with ${patch_url} reinsert');

// ============================================================
// Test: AdSegmentCache TTL cleanup
// ============================================================
console.log('--- AdSegmentCache TTL ---');
AdSegmentCache = new Map();
AdSegmentCache.set('old-segment.ts', Date.now() - 130000);
AdSegmentCache.set('new-segment.ts', Date.now());
const now = Date.now();
AdSegmentCache.forEach((value, key, map) => {
    if (value < now - 120000) {
        map.delete(key);
    }
});
assert(!AdSegmentCache.has('old-segment.ts'), 'removes segments older than 120s');
assert(AdSegmentCache.has('new-segment.ts'), 'keeps recent segments');

// ============================================================
// Test: hasAdTags — each signifier individually
// ============================================================
console.log('--- hasAdTags (individual signifiers) ---');
assert(hasAdTags('stitched') === true, 'detects stitched alone');
assert(hasAdTags('stitched-ad') === true, 'detects stitched-ad alone');
assert(hasAdTags('X-TV-TWITCH-AD') === true, 'detects X-TV-TWITCH-AD alone');
assert(hasAdTags('EXT-X-CUE-OUT') === true, 'detects EXT-X-CUE-OUT alone');
assert(hasAdTags('EXT-X-DATERANGE:CLASS="twitch-stitched-ad"') === true, 'detects EXT-X-DATERANGE alone');
assert(hasAdTags('SCTE35-OUT') === true, 'detects SCTE35-OUT alone');

// ============================================================
// Test: getStreamUrlForResolution — edge cases
// ============================================================
console.log('--- getStreamUrlForResolution (edge cases) ---');
assertEq(getStreamUrlForResolution('#EXTM3U\n', { Resolution: '1920x1080', FrameRate: 30 }), null, 'returns null for empty m3u8');
assertEq(getStreamUrlForResolution('', { Resolution: '1920x1080', FrameRate: 30 }), null, 'returns null for empty string');

// ============================================================
// Test: getServerTimeFromM3u8 — edge cases
// ============================================================
console.log('--- getServerTimeFromM3u8 (edge cases) ---');
V2API = false;
assertEq(getServerTimeFromM3u8('SERVER-TIME=""'), null, 'returns null for empty server time');
assertEq(getServerTimeFromM3u8('SERVER-TIME="abc"'), null, 'returns null for non-numeric v1 time');
V2API = true;
assertEq(getServerTimeFromM3u8('#EXT-X-SESSION-DATA:DATA-ID="OTHER",VALUE="123"'), null, 'returns null for wrong DATA-ID');
V2API = false;

// ============================================================
// Test: parseAttributes — edge cases
// ============================================================
console.log('--- parseAttributes (edge cases) ---');
const attrsEmpty = parseAttributes('');
assert(typeof attrsEmpty === 'object', 'returns object for empty string');

// ============================================================
// Results
// ============================================================
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
