// Performance benchmark: ryanbr v51 vs pixeltris baseline
// Run: node tests/benchmark.js
//
// Measures CPU time and memory for the hot-path functions that run
// on every m3u8 playlist fetch (~every 2s per stream).

const { performance } = require('perf_hooks');

// ============================================================
// Test payloads — realistic m3u8 content
// ============================================================

const CLEAN_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:48201
#EXTINF:2.000,live
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48201.ts
#EXTINF:2.000,live
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48202.ts
#EXTINF:2.000,live
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48203.ts
#EXTINF:2.000,live
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48204.ts
#EXTINF:2.000,live
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48205.ts
#EXTINF:2.000,live
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48206.ts`;

const AD_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:48201
#EXT-X-DATERANGE:CLASS="twitch-stitched-ad",ID="ad-1",START-DATE="2026-04-08T12:00:00Z",DURATION=30.0
#EXT-X-DATERANGE:CLASS="twitch-ad-quartile",ID="q1",START-DATE="2026-04-08T12:00:00Z"
X-TV-TWITCH-AD-URL="https://ad-track.twitch.tv/imp1"
X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://ad-track.twitch.tv/click1"
X-TV-TWITCH-AD-QUARTILE-URLS="https://ad-track.twitch.tv/q1"
#EXTINF:2.000,
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/stitched_ad_seg1.ts
#EXTINF:2.000,
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/stitched_ad_seg2.ts
#EXTINF:2.000,
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/stitched_ad_seg3.ts
#EXTINF:2.000,
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/stitched_ad_seg4.ts
#EXTINF:2.000,live
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48205.ts
#EXTINF:2.000,live
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48206.ts
#EXT-X-TWITCH-PREFETCH:https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48207.ts
#EXT-X-TWITCH-PREFETCH:https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48208.ts`;

const SCTE35_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:48201
#EXT-X-CUE-OUT:DURATION=30
SCTE35-OUT=0xFC301600000000000000FFF0140500000000010000000000000000
#EXTINF:2.000,
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/stitched_ad_seg1.ts
#EXTINF:2.000,
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/stitched_ad_seg2.ts
#EXTINF:2.000,
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/stitched_ad_seg3.ts
#EXT-X-CUE-IN
#EXTINF:2.000,live
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48204.ts
#EXTINF:2.000,live
https://video-edge-abc.fra02.abs.hls.ttvnw.net/v1/segment/CpUE_seg48205.ts`;

const ENCODINGS_M3U8 = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="avc1.64002A",RESOLUTION=1920x1080,FRAME-RATE=60.000
https://video-weaver.fra02.hls.ttvnw.net/v1/playlist/source.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="avc1.4D401F",RESOLUTION=1280x720,FRAME-RATE=30.000
https://video-weaver.fra02.hls.ttvnw.net/v1/playlist/720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,CODECS="avc1.4D401E",RESOLUTION=852x480,FRAME-RATE=30.000
https://video-weaver.fra02.hls.ttvnw.net/v1/playlist/480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=700000,CODECS="avc1.4D4015",RESOLUTION=640x360,FRAME-RATE=30.000
https://video-weaver.fra02.hls.ttvnw.net/v1/playlist/360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=400000,CODECS="avc1.4D400C",RESOLUTION=284x160,FRAME-RATE=30.000
https://video-weaver.fra02.hls.ttvnw.net/v1/playlist/160p.m3u8`;

const PARSE_ATTR_INPUT = 'BANDWIDTH=6000000,CODECS="avc1.64002A",RESOLUTION=1920x1080,FRAME-RATE=60.000';
const PARSE_ATTR_TAG = '#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="avc1.64002A",RESOLUTION=1920x1080,FRAME-RATE=60.000';

// ============================================================
// pixeltris functions (baseline)
// ============================================================

const pixeltris = (() => {
    const AdSignifier = 'stitched';
    const AdSegmentCache = new Map();
    let AllSegmentsAreAdSegments = false;

    function hasAdTags(textStr) {
        return textStr.includes(AdSignifier);
    }

    function stripAdSegments(textStr, stripAllSegments, streamInfo) {
        let hasStrippedAdSegments = false;
        const lines = textStr.replaceAll('\r', '').split('\n');
        const newAdUrl = 'https://twitch.tv';
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            line = line
                .replaceAll(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`)
                .replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`);
            if (i < lines.length - 1 && line.startsWith('#EXTINF') && (!line.includes(',live') || stripAllSegments || AllSegmentsAreAdSegments)) {
                const segmentUrl = lines[i + 1];
                if (!AdSegmentCache.has(segmentUrl)) {
                    streamInfo.NumStrippedAdSegments++;
                }
                AdSegmentCache.set(segmentUrl, Date.now());
                hasStrippedAdSegments = true;
            }
            if (line.includes(AdSignifier)) {
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
        streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
        AdSegmentCache.forEach((value, key, map) => {
            if (value < Date.now() - 120000) {
                map.delete(key);
            }
        });
        return lines.join('\n');
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

    function reset() { AdSegmentCache.clear(); }

    return { hasAdTags, stripAdSegments, parseAttributes, reset };
})();

// ============================================================
// ryanbr v51 functions
// ============================================================

const ryanbr = (() => {
    const AdSignifiers = ['stitched', 'stitched-ad', 'maf-ad', 'X-TV-TWITCH-AD', 'EXT-X-CUE-OUT', 'EXT-X-DATERANGE:CLASS="twitch-stitched-ad"', 'EXT-X-DATERANGE:CLASS="twitch-stream-source"', 'EXT-X-DATERANGE:CLASS="twitch-trigger"', 'EXT-X-DATERANGE:CLASS="twitch-maf-ad"', 'EXT-X-DATERANGE:CLASS="twitch-ad-quartile"', 'SCTE35-OUT'];
    const AdSegmentURLPatterns = ['/adsquared/', '/_404/', '/processing'];
    const AdSegmentCache = new Map();
    let AllSegmentsAreAdSegments = false;

    function hasAdTags(textStr) {
        return AdSignifiers.some((s) => textStr.includes(s));
    }

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
                // skip console.log in benchmark
            }
        }
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (line.includes('EXT-X-CUE-OUT')) {
                inCueOut = true;
            } else if (line.includes('EXT-X-CUE-IN')) {
                inCueOut = false;
            }
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
                AdSegmentCache.set(lines[i + 1], Date.now());
                hasStrippedAdSegments = true;
                streamInfo.NumStrippedAdSegments++;
            } else if (i < lines.length - 1 && line.startsWith('#EXTINF') && isLiveSegment) {
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
            const seq = parseInt((textStr.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/) || [])[1]);
            if (!isNaN(seq)) {
                streamInfo.RecoveryStartSeq = seq + Math.max(0, liveSegments.length - streamInfo.RecoverySegments.length);
            }
        }
        if (hasStrippedAdSegments && liveSegments.length === 0 && streamInfo.RecoverySegments && streamInfo.RecoverySegments.length > 0) {
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

    function parseAttributes(str) {
        if (!str) return {};
        if (str.charCodeAt(0) === 35) {
            const idx = str.indexOf(':');
            if (idx !== -1) str = str.slice(idx + 1);
        }
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

    function reset() { AdSegmentCache.clear(); }

    return { hasAdTags, stripAdSegments, parseAttributes, reset };
})();

// ============================================================
// Benchmark harness
// ============================================================

function bench(name, fn, iterations = 50000) {
    // Warmup
    for (let i = 0; i < 1000; i++) fn();

    // Force GC if available
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage();

    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    const elapsed = performance.now() - start;

    if (global.gc) global.gc();
    const memAfter = process.memoryUsage();

    const opsPerSec = (iterations / elapsed * 1000).toFixed(0);
    const heapDelta = ((memAfter.heapUsed - memBefore.heapUsed) / 1024).toFixed(1);

    return { name, elapsed: elapsed.toFixed(2), opsPerSec, heapDelta, iterations };
}

function compare(label, pixeltrisFn, ryanbrFn, iterations) {
    const p = bench('pixeltris', pixeltrisFn, iterations);
    const r = bench('ryanbr', ryanbrFn, iterations);
    const ratio = (p.elapsed / r.elapsed).toFixed(2);
    const winner = ratio > 1 ? 'ryanbr' : ratio < 1 ? 'pixeltris' : 'tie';
    const speedup = ratio > 1 ? ratio + 'x faster' : (1/ratio).toFixed(2) + 'x slower';

    console.log(`\n--- ${label} (${p.iterations} iterations) ---`);
    console.log(`  pixeltris:  ${p.elapsed}ms  (${p.opsPerSec} ops/s, heap delta: ${p.heapDelta} KB)`);
    console.log(`  ryanbr:     ${r.elapsed}ms  (${r.opsPerSec} ops/s, heap delta: ${r.heapDelta} KB)`);
    console.log(`  result:     ryanbr is ${speedup}`);
}

function makeStreamInfo() {
    return {
        NumStrippedAdSegments: 0,
        IsStrippingAdSegments: false,
        HasLoggedAdAttributes: false,
        RecoverySegments: [],
        RecoveryStartSeq: undefined
    };
}

// ============================================================
// Run benchmarks
// ============================================================

console.log('=== TwitchAdSolutions Performance Benchmark ===');
console.log(`Node ${process.version}, ${process.platform} ${process.arch}`);
console.log(`GC exposed: ${typeof global.gc === 'function' ? 'yes' : 'no (run with --expose-gc for memory data)'}`);

// 1. hasAdTags — clean playlist (common case, no ads)
compare(
    'hasAdTags (clean playlist)',
    () => pixeltris.hasAdTags(CLEAN_PLAYLIST),
    () => ryanbr.hasAdTags(CLEAN_PLAYLIST),
    200000
);

// 2. hasAdTags — ad playlist (ads present)
compare(
    'hasAdTags (ad playlist)',
    () => pixeltris.hasAdTags(AD_PLAYLIST),
    () => ryanbr.hasAdTags(AD_PLAYLIST),
    200000
);

// 3. stripAdSegments — clean playlist
compare(
    'stripAdSegments (clean playlist)',
    () => { pixeltris.reset(); pixeltris.stripAdSegments(CLEAN_PLAYLIST, false, makeStreamInfo()); },
    () => { ryanbr.reset(); ryanbr.stripAdSegments(CLEAN_PLAYLIST, false, makeStreamInfo()); },
    50000
);

// 4. stripAdSegments — ad playlist (the hot path during ads)
compare(
    'stripAdSegments (ad playlist)',
    () => { pixeltris.reset(); pixeltris.stripAdSegments(AD_PLAYLIST, false, makeStreamInfo()); },
    () => { ryanbr.reset(); ryanbr.stripAdSegments(AD_PLAYLIST, false, makeStreamInfo()); },
    50000
);

// 5. stripAdSegments — SCTE-35 playlist (ryanbr-only detection)
compare(
    'stripAdSegments (SCTE-35 playlist)',
    () => { pixeltris.reset(); pixeltris.stripAdSegments(SCTE35_PLAYLIST, false, makeStreamInfo()); },
    () => { ryanbr.reset(); ryanbr.stripAdSegments(SCTE35_PLAYLIST, false, makeStreamInfo()); },
    50000
);

// 6. parseAttributes — plain attribute string
compare(
    'parseAttributes (attribute string)',
    () => pixeltris.parseAttributes(PARSE_ATTR_INPUT),
    () => ryanbr.parseAttributes(PARSE_ATTR_INPUT),
    100000
);

// 7. parseAttributes — full HLS tag line (ryanbr strips prefix)
compare(
    'parseAttributes (full HLS tag)',
    () => pixeltris.parseAttributes(PARSE_ATTR_TAG),
    () => ryanbr.parseAttributes(PARSE_ATTR_TAG),
    100000
);

// 8. parseAttributes — null/empty input (ryanbr guards, pixeltris crashes)
compare(
    'parseAttributes (null input)',
    () => { try { pixeltris.parseAttributes(null); } catch {} },
    () => ryanbr.parseAttributes(null),
    200000
);

// 9. Combined: hasAdTags + stripAdSegments (simulates one m3u8 cycle with ads)
compare(
    'full ad cycle (hasAdTags + stripAdSegments)',
    () => {
        pixeltris.reset();
        if (pixeltris.hasAdTags(AD_PLAYLIST)) {
            pixeltris.stripAdSegments(AD_PLAYLIST, false, makeStreamInfo());
        }
    },
    () => {
        ryanbr.reset();
        if (ryanbr.hasAdTags(AD_PLAYLIST)) {
            ryanbr.stripAdSegments(AD_PLAYLIST, false, makeStreamInfo());
        }
    },
    50000
);

// 10. Dictionary lookup — StreamInfosByUrl pattern
compare(
    'dictionary lookup (Object.create(null) vs [])',
    () => {
        const dict = [];
        for (let i = 0; i < 20; i++) dict['key' + i] = { v: i };
        for (let i = 0; i < 20; i++) { const _ = dict['key' + i]; }
    },
    () => {
        const dict = Object.create(null);
        for (let i = 0; i < 20; i++) dict['key' + i] = { v: i };
        for (let i = 0; i < 20; i++) { const _ = dict['key' + i]; }
    },
    100000
);

console.log('\n=== Done ===');
