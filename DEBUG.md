# Debugging TwitchAdSolutions

## Opening the Browser Console

### Chrome / Edge
1. Press `F12` or `Ctrl+Shift+J` (Windows/Linux) / `Cmd+Option+J` (Mac)
2. Click the **Console** tab

### Firefox
1. Press `F12` or `Ctrl+Shift+K` (Windows/Linux) / `Cmd+Option+K` (Mac)
2. Click the **Console** tab

### Safari
1. Enable Developer Tools: Settings > Advanced > Show Develop menu
2. Press `Cmd+Option+C`
3. Click the **Console** tab

## What to Look For

### Startup (should appear on every page load)

```
[AD DEBUG] TwitchAdSolutions vaft v44 loading
[AD DEBUG] Config: ReloadPlayerAfterAd = true, ForceAccessTokenPlayerType = popout, PinBackupPlayerType = true
[AD DEBUG] Window fetch hook installed
[AD DEBUG] GQL headers captured — DeviceId: yes, Auth: yes, Integrity: no
[AD DEBUG] Worker intercepted — injecting ad-block hooks
[AD DEBUG] New stream session — channel: <channel>, API: v2
```

If you don't see `vaft v<number> loading`, the script isn't running. Check your userscript manager or uBO resource override.

### Normal Ad Break (CSAI-only, most common)

```
[AD DEBUG] Ad detected — type: midroll, channel: <channel>, signifiers: stitched, stitched-ad, X-TV-TWITCH-AD
Blocking midroll ads (embed) — backup found in 137ms
Finished blocking ads — stripped 0 ad segments
[AD DEBUG] CSAI-only ad break (stripped 0) — clearing backup without player action
```

This is the ideal case. No reload, no drift correction, no disruption.

### Normal Ad Break (SSAI, segments stripped)

```
[AD DEBUG] Ad detected — type: midroll, channel: <channel>, signifiers: stitched, stitched-ad, X-TV-TWITCH-AD
Blocking midroll ads (embed) — backup found in 773ms
[AD DEBUG] All segments stripped — restoring 1 recovery segments
Finished blocking ads — stripped 16 ad segments
Reloading Twitch player
[AD DEBUG] Post-reload live drift correction: 2.9s behind
[AD DEBUG] Drift correction: catching up at 1.1x
[AD DEBUG] Drift correction complete — resumed normal playback speed
```

Real ad segments were removed. Player reloads after the ad break and catches up to live.

### CSAI Fast Path (no backup switch)

```
[AD DEBUG] Ad detected — type: midroll, channel: <channel>, signifiers: stitched, stitched-ad, X-TV-TWITCH-AD
[AD DEBUG] CSAI fast path — all segments live, skipping backup search
Finished blocking ads — stripped 0 ad segments
[AD DEBUG] CSAI-only ad break (stripped 0) — clearing backup without player action
```

Best case — no backup stream switch, no rebuffer gap. The main stream plays uninterrupted.

## Common Issues

### Script not loading

| Console message | Meaning |
|---|---|
| No `[AD DEBUG]` messages at all | Script not injected. Check userscript manager is enabled for twitch.tv |
| `Failed to fetch worker JS — falling back to unmodified worker` | Sync XHR blocked (iOS Safari). Stream plays but ads won't be blocked |
| `CONFLICT: vaft v<X> skipped — another script already active (v<Y>)` | Duplicate scripts installed. Remove one |

### Ads leaking through

| Console message | Meaning |
|---|---|
| `No ad-free backup stream found` | All backup player types also have ads. Ads may show briefly |
| `Ads will leak due to missing resolution info` | Stream resolution not found. Rare edge case |
| `signifiers:` (empty after signifiers:) | Ad detection mismatch. Update to latest version |

### Player issues

| Console message | Meaning |
|---|---|
| `Attempt to fix buffering position:X bufferedPosition:Y bufferDuration:Z` | Buffer monitor detected a stall and is attempting pause/play |
| `Video state: readyState=2 networkState=2 ... paused=true` | Player stalled with insufficient data. May self-recover |
| `Position jumped Xs — starting drift correction` | Player jumped ahead. Drift correction speeds up to catch live edge |
| `Downgraded reload to pause/play to preserve PiP` | PiP mode active. Using lighter recovery to keep PiP open |

### Twitch API issues

| Console message | Meaning |
|---|---|
| `Access token HTTP 403 for embed (integrity: missing)` | Twitch may be enforcing Client-Integrity. Report this issue |
| `Access token HTTP 403 for embed (integrity: present)` | Twitch rejected the token despite having integrity. Report this |
| `Usher HTTP 403 for embed` | Twitch rejected the stream URL request |
| `GQL response format changed — missing data.streamPlaybackAccessToken` | Twitch changed their API. Script needs updating |
| `FetchRequest timed out` | GQL request took >15s. Network issue or Twitch outage |

## Reporting a Bug

When reporting an issue, include:

1. **Script version** — the `vaft v<number>` from the first console line
2. **Browser and install method** — e.g. Chrome + Tampermonkey, Firefox + uBO
3. **Console log** — copy the full `[AD DEBUG]` output. Use a paste service like [logpasta.com](https://logpasta.com) for long logs
4. **What happened** — describe what you saw (loading circle, video pause, ad shown, etc.)
5. **Channel** — which Twitch channel you were watching

## localStorage Configuration

You can change settings via the browser console:

```js
// Disable reload after ads (use pause/play instead)
localStorage.setItem('twitchAdSolutions_reloadPlayerAfterAd', 'false');

// Change reload cooldown (seconds, default 30)
localStorage.setItem('twitchAdSolutions_reloadCooldownSeconds', '60');

// Disable drift correction
localStorage.setItem('twitchAdSolutions_driftCorrectionRate', '0');

// Disable reload cap (allow unlimited reloads)
localStorage.setItem('twitchAdSolutions_disableReloadCap', 'true');

// Hide the "Blocking ads" banner
localStorage.setItem('twitchAdSolutions_hideAdOverlay', 'true');
```

Refresh the page after changing settings.
