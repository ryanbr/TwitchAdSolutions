Originally forked from [pixeltris/TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions) (archived).

# TwitchAdSolutions

This repo aims to provide multiple solutions for blocking Twitch ads.

**Don't combine Twitch specific ad blockers.**

## Recommendations

Proxies are the most reliable way of avoiding ads ([buffering / downtime info](full-list.md#proxy-issues)).

- `TTV LOL PRO` - [chrome](https://chrome.google.com/webstore/detail/ttv-lol-pro/bpaoeijjlplfjbagceilcgbkcdjbomjd) / [firefox](https://addons.mozilla.org/addon/ttv-lol-pro/) / [code](https://github.com/younesaassila/ttv-lol-pro)

Alternatively:

- `Twitch Turbo` - https://www.twitch.tv/turbo
- `Alternate Player for Twitch.tv` - [chrome](https://chrome.google.com/webstore/detail/alternate-player-for-twit/bhplkbgoehhhddaoolmakpocnenplmhf) / [firefox](https://addons.mozilla.org/en-US/firefox/addon/twitch_5/)
- `Purple AdBlock` - [chrome](https://chrome.google.com/webstore/detail/purple-adblock/lkgcfobnmghhbhgekffaadadhmeoindg) / [firefox](https://addons.mozilla.org/en-US/firefox/addon/purpleadblock/) / [userscript](https://raw.githubusercontent.com/arthurbolsoni/Purple-adblock/refs/heads/main/platform/tampermonkey/dist/purpleadblocker.user.js) / [code](https://github.com/arthurbolsoni/Purple-adblock/)
- `AdGuard Extra` - [chrome](https://chrome.google.com/webstore/detail/adguard-extra-beta/mglpocjcjbekdckiahfhagndealpkpbj) / [firefox](https://github.com/AdguardTeam/AdGuardExtra/#firefox) / [userscript](https://userscripts.adtidy.org/release/adguard-extra/1.0/adguard-extra.user.js)
- `vaft` - see below
- `TTV Ad Mute` - [firefox](https://addons.mozilla.org/en-US/firefox/addon/twitch-tv-ad-mute/) / [code](https://github.com/drj101687/ttv-ad-mute)

[Read this for a full list and descriptions.](full-list.md)

[Also see this list maintained by @zGato.](https://github.com/zGato/ScrewTwitchAds)

## Scripts

**There are better / easier to use methods in the above recommendations.**

- vaft - [userscript](https://github.com/ryanbr/TwitchAdSolutions/raw/master/vaft/vaft.user.js) / [ublock](https://raw.githubusercontent.com/ryanbr/TwitchAdSolutions/master/vaft/vaft-ublock-origin.js) / [ublock (permalink)](https://raw.githubusercontent.com/ryanbr/TwitchAdSolutions/7c3846d6df9ce5ed78d909dcf4d5791a1efdb30a/vaft/vaft-ublock-origin.js)
  - Attempts to get a clean stream as fast as it can
  - If it fails to get a clean stream it removes ad segments (no playback until ad-free stream is found)
- video-swap-new - [userscript](https://github.com/ryanbr/TwitchAdSolutions/raw/master/video-swap-new/video-swap-new.user.js) / [ublock](https://raw.githubusercontent.com/ryanbr/TwitchAdSolutions/master/video-swap-new/video-swap-new-ublock-origin.js) / [ublock (permalink)](https://raw.githubusercontent.com/ryanbr/TwitchAdSolutions/7c3846d6df9ce5ed78d909dcf4d5791a1efdb30a/video-swap-new/video-swap-new-ublock-origin.js)
  - Attempts to get a clean stream
  - If it fails to get a clean stream it removes ad segments (no playback until ad-free stream is found)
  - Not recommended, `vaft` is a better script

## Applying a script (uBlock Origin)

- Navigate to the uBlock Origin Dashboard (the extension options)
- Under the `My filters` tab add `twitch.tv##+js(twitch-videoad)`.
- Under the `Settings` tab, enable `I am an advanced user`, then click the cog that appears. Modify the value of `userResourcesLocation` from `unset` to the full url of the solution you wish to use (if a url is already in use, add a space after the existing url). e.g. `userResourcesLocation https://raw.githubusercontent.com/ryanbr/TwitchAdSolutions/master/vaft/vaft-ublock-origin.js` 
- To ensure uBlock Origin loads the script I recommend that you disable/enable the uBlock Origin extension (or restart your browser).

To stop using a script remove the filter and make the url `unset`.

*For the sake of security it's recommended to use a permalink when using uBlock Origin (permalinks do not auto update).*

*The scripts __may randomly stop being applied by uBlock Origin__ for unknown reasons ([#200](https://github.com/ryanbr/TwitchAdSolutions/issues/200)). It's recommended to use the userscript versions instead.*

## Applying a script (userscript)

Viewing one of the userscript files should prompt the given script to be added when you have a userscript manager installed.

Userscript managers:

- https://violentmonkey.github.io/
- https://www.tampermonkey.net/
- https://apps.apple.com/us/app/userscripts/id1463298887

*Greasemonkey doesn't work with the scripts.*

## Configuration

The scripts support runtime configuration via `localStorage`. Set values in the browser console and refresh the page.

**`twitchAdSolutions_reloadPlayerAfterAd`** (default: `true`)
- `true` - full player reload after ads (slower, more reliable)
- `false` - pause/play after ads (faster, less reliable)
- Not set - uses default (`true`)

**`twitchAdSolutions_playerType`** (default: `popout`)
- Changes the player type used for access token requests
- `popout` - popout player context, tends to receive fewer ads (default)
- `embed` - embedded player context, used for third-party sites
- `site` - normal site player, standard Twitch experience (most ads)
- `autoplay` - autoplay context, lower quality (360p)
- Not set - uses default (`popout`)

**`twitchAdSolutions_hideAdOverlay`** (default: not set)
- `true` - hide the "Blocking ads" banner overlay on the video player
- Not set - banner is visible during ad blocking (default)

**`twitchAdSolutions_pinBackupPlayerType`** (default: `false`)
- `true` - remember which backup player type worked and try it first on next ad break (saves backup search time)
- `false` - always iterate through backup types fresh (default)
- ⚠ **Quality caveat**: if the pinned type is `autoplay`, backups during ad breaks stay at 360p even when a source-quality backup would have worked. Only enable if you prefer consistent ad-break experience over backup quality.

**`twitchAdSolutions_reloadCooldownSeconds`** (default: `30`)
- Minimum seconds between player reloads after ad breaks
- Prevents CSAI (client-side ad insertion) cascades where a reload triggers Twitch to serve another ad
- Set to `0` to disable cooldown

**`twitchAdSolutions_disableReloadCap`** (default: not set)
- `true` - buffer monitor reloads unlimited times (pre-v47 behavior, risk of reload loops)
- Not set - buffer monitor reloads at most once per recovery window (default)
- Only enable if you're seeing genuinely stuck playback that a single reload doesn't fix

```js
// Faster post-ad transition
localStorage.setItem('twitchAdSolutions_reloadPlayerAfterAd', 'false');

// Change player type
localStorage.setItem('twitchAdSolutions_playerType', 'embed');

// Hide ad blocking banner
localStorage.setItem('twitchAdSolutions_hideAdOverlay', 'true');

// Restore defaults
localStorage.removeItem('twitchAdSolutions_reloadPlayerAfterAd');
localStorage.removeItem('twitchAdSolutions_playerType');
localStorage.removeItem('twitchAdSolutions_hideAdOverlay');
localStorage.removeItem('twitchAdSolutions_pinBackupPlayerType');
localStorage.removeItem('twitchAdSolutions_reloadCooldownSeconds');
localStorage.removeItem('twitchAdSolutions_disableReloadCap');
```

## Known Extension Conflicts

- **7TV** — may cause black screen / infinite buffering ([#17](https://github.com/ryanbr/TwitchAdSolutions/issues/17))
- **TwitchNoSub** — handled automatically via workerStringReinsert, but older versions may conflict
- **TTV-AB** — running both simultaneously may cause duplicate ad blocking and errors. Use one or the other.
- **Purple AdBlock** — may conflict if both are active. Disable one.
- **AdGuard Extra** — operates at a different layer, can be used alongside without conflict

## Issues with the scripts

If the script doesn't work or you're experiencing freezing / buffering issues see [issues.md](issues.md)
