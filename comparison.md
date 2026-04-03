# Feature Comparison

Comparison of ryanbr/TwitchAdSolutions (release & testing) vs GosuDRM/TTV-AB 5.0.6 vs pixeltris/TwitchAdSolutions (archived).

## Ad Detection

| Feature | Release | Testing | TTV-AB | pixeltris |
|---|---|---|---|---|
| Multiple ad signifiers | Yes (6) | Yes (6) | Yes (6 + URL patterns) | No (1) |
| SCTE-35 CUE-OUT/CUE-IN | Yes | Yes | Yes | No |
| Ad segment URL patterns | Yes | Yes | Yes | No |

## Backup Stream

| Feature | Release | Testing | TTV-AB | pixeltris |
|---|---|---|---|---|
| Backup player type cycling | Yes | Yes | Yes | Yes |
| Failed backup type tracking | Yes | Yes | Yes | No |
| Pinned backup type | Yes (opt-in) | Yes (opt-in) | Yes (always on) | No |
| Segment recovery cache | Yes | Yes | Yes | No |

## Ad Recovery

| Feature | Release | Testing | TTV-AB | pixeltris |
|---|---|---|---|---|
| Ad-end grace period | PR | Yes | Yes | No |
| Dead backup detection | PR | Yes | No | No |
| Post-ad resume retry | PR | Yes | Yes | No |
| Muted state restore | Yes | Yes | Yes | No |
| Player error auto-recovery | No | Yes | Yes | No |

## Player Stability

| Feature | Release | Testing | TTV-AB | pixeltris |
|---|---|---|---|---|
| Visibility/hidden override | Yes | Yes | Yes | Yes |
| hasFocus override | Yes | Yes | No | No |
| Tab focus auto-play | Yes | Yes | Yes | Muted only |
| Auto-resume on tab return | Yes (muted+unmuted) | Yes (muted+unmuted) | Yes | Muted only |
| Buffering monitor | Yes | Yes | Yes | Yes |
| Quality/volume restore | Yes | Yes | Yes | Yes |
| Playback intent tracking | No | No | Yes | No |
| Stale event filtering | No | No | Yes | No |
| Worker crash recovery | No | No | Yes | No |

## Configuration

| Feature | Release | Testing | TTV-AB | pixeltris |
|---|---|---|---|---|
| ReloadPlayerAfterAd | Yes | Yes | N/A | Hardcoded |
| ForceAccessTokenPlayerType | Yes | Yes | N/A | Hardcoded |
| PinBackupPlayerType | Yes | Yes | Always on | No |
| HideAdOverlay | Yes | Yes | N/A | No |
| Config logged on load | Yes | Yes | No | No |

## Debug Logging

| Feature | Release | Testing | TTV-AB | pixeltris |
|---|---|---|---|---|
| AD DEBUG breakpoints | Yes (15+) | Yes (15+) | Minimal | No |
| Worker rejection logging | Yes | Yes | No | No |
| GQL header capture log | Yes | Yes | No | No |
| Stripped segment count | Yes | Yes | No | No |

## Null Safety

| Feature | Release | Testing | TTV-AB | pixeltris |
|---|---|---|---|---|
| Optional chaining | Yes | Yes | Yes | No |
| GQL response validation | Yes | Yes | Yes | No |

## Compatibility

| Feature | Release | Testing | TTV-AB | pixeltris |
|---|---|---|---|---|
| WebKit/iOS | Yes | Yes | N/A | Yes |
| Firefox | Yes | Yes | Yes | Yes |
| Chrome | Yes | Yes | Yes | Yes |
