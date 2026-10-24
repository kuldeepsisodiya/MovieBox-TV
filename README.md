# MovieBox TV — Samsung Tizen 4K QLED Edition

A premium, cinematic Samsung Tizen TV application adapted from the upstream [MovieBox-TUI](https://github.com/mesamirh/MovieBox-Tui) project. Designed specifically for Samsung Smart TVs (Target: 55-inch 4K QLED `QA55Q7FAAULXL`, layout 3840×2160, 10-foot viewing distance) and distributed as a valid `.wgt` package.

---

## 1. Architectural Overview

The upstream `MovieBox-TUI` is a terminal application written in Rust using Ratatui, Crossterm, and Tokio, delegating desktop playback to external spawned binaries (`mpv`, `vlc`, `iina`, Android Intent).

Because Samsung Tizen Smart TVs execute Web Applications in a hardware-accelerated web runtime (WebKit/Chromium) without arbitrary terminal or desktop shell process execution, this project translates the core architecture into a modular TV-native application:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Samsung Tizen TV Frontend                       │
│                                                                        │
│  ┌───────────────────────┐  ┌───────────────────────────────────────┐  │
│  │   TV Remote Engine    │  │       Cinematic TV UI (10-foot)       │  │
│  │ D-pad, Back, MediaKey │  │ Home, Search, Details, Player, Settings│  │
│  └───────────┬───────────┘  └───────────────────┬───────────────────┘  │
│              │                                  │                      │
│  ┌───────────▼──────────────────────────────────▼───────────────────┐  │
│  │                  Search Aggregator (Parallel)                    │  │
│  │      Timeouts • Error Isolation • Deduplication • Normalization  │  │
│  └───────┬──────────────┬──────────────┬──────────────┬─────────────┘  │
│          │              │              │              │                │
│  ┌───────▼──────┐┌──────▼──────┐┌──────▼──────┐┌──────▼─────────────┐  │
│  │  Open Cinema ││  MovieBox   ││ 4KHDHub     ││  Stremio Addons    │  │
│  │  (Authorized)││  (Direct)   ││ (UHD Scrap.)││  (Cinemeta/Stream) │  │
│  └───────┬──────┘└──────┬──────┘└──────┬──────┘└──────┬─────────────┘  │
│          │              │              │              │                │
│  ┌───────▼──────────────▼──────────────▼──────────────▼─────────────┐  │
│  │                 Intelligent Quality Selector                     │  │
│  │  Auto • Fastest Start • Best Quality • Most Reliable • Overrides │  │
│  └──────────────────────────────┬───────────────────────────────────┘  │
│                                 │                                      │
│  ┌──────────────────────────────▼───────────────────────────────────┐  │
│  │                  Master Playback Adapter                         │  │
│  │       Samsung webapis.avplay API (with HTML5 Video Fallback)     │  │
│  │     Hardware Video • Dynamic Subtitles • Watch History Sync      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
                                  │
                 Optional Backend Proxy (server/server.js)
```

---

## 2. Directory Structure

```
Moviebox/
├── config.xml                  # Tizen TV Web application manifest
├── .tproject                   # Tizen Studio project configuration (tv-samsung-3.0)
├── icon.png                    # 512x512 High-DPI application icon
├── index.html                  # TV UI markup (4K layout, safe margins, dialogs)
├── styles.css                  # Emil Kowalski design engineering system
├── package.json                # Project manifest, automated test runner
├── build.sh                    # Reproducible packaging script producing .wgt
├── .env.example                # Companion backend configuration template
├── src/
│   ├── app.js                  # Master application controller and view routing
│   ├── config.js               # Application configuration constants
│   ├── catalog/
│   │   └── catalog.js          # Curated rows (Trending, 4K Showcase, Sci-Fi)
│   ├── providers/
│   │   ├── provider-base.js    # Standard provider contract interface
│   │   ├── provider-registry.js# Adapter registry & health check manager
│   │   ├── aggregator.js       # Concurrent multi-provider search aggregator
│   │   └── adapters/
│   │       ├── public-domain-adapter.js # Verified 4K/1080p open streams
│   │       ├── moviebox-adapter.js      # Port of upstream Rust client
│   │       ├── stremio-addon-adapter.js # Stremio Cinemeta / Addon protocol
│   │       ├── fourkhd-adapter.js       # 4KHDHub stream adapter
│   │       └── dramachi-adapter.js      # Dramachi drama adapter
│   ├── playback/
│   │   ├── playback-adapter.js # Unified playback coordinator
│   │   ├── avplay-engine.js    # Samsung official webapis.avplay implementation
│   │   ├── html5-engine.js     # HTML5 video fallback engine
│   │   └── quality-selector.js # Multi-strategy ranking & failure avoidance
│   ├── subtitles/
│   │   └── subtitle-manager.js # SRT/VTT parser, sync offset, language selector
│   ├── remote/
│   │   └── remote-controller.js# D-pad spatial navigation & Tizen remote keys
│   ├── storage/
│   │   └── storage-manager.js  # Favorites, watch history, settings persistence
│   └── utils/
│       ├── formatters.js       # Duration, timecode, resolution, sanitization
│       └── logger.js           # Leveled logger with in-app TV diagnostics
├── server/
│   └── server.js               # Companion Node.js backend proxy
└── tests/
    ├── aggregator.test.js      # Unit tests: parallel search, timeouts, dedupe
    ├── quality-selector.test.js# Unit tests: 4K, fastest-start, failure penalization
    ├── storage-and-subtitles.test.js # Unit tests: SRT parsing, resume points
    └── remote-and-player.test.js     # Unit tests: TV keys, formatters
```

---

## 3. Emil Kowalski Design Engineering System

The interface was refined following Emil Kowalski's design engineering principles:
- **Spatial Consistency & Restraint**: Deep near-black background (`#08090d`), subtle elevated panels (`#11141c`), high-contrast typography, and generous 60px TV safe margins.
- **Card Focus Dynamics**: Smooth 180ms ease-out transitions (`cubic-bezier(0.23, 1, 0.32, 1)`), 1.06x scale, sharp white focus ring with subtle 20px blur halo.
- **Tactile Feedback**: Press state `transform: scale(0.97)` on `.tv-pressed` / `:active`.
- **Interruptible Motion**: Modal entries start from `transform: scale(0.95); opacity: 0;` settling smoothly to `scale(1); opacity: 1;`—never from `scale(0)`.
- **Hardware Acceleration**: Only `transform` and `opacity` are animated to ensure 60fps rendering without main-thread jank.

---

## 4. Concurrent Provider Discovery (One Search)

When a user searches:
1. Every enabled provider receives the query **simultaneously** via `Promise.allSettled`.
2. Each provider is bounded by an **independent timeout** (default 7.5 seconds).
3. If one provider fails or times out, successful results from other providers are immediately displayed without stalling the application.
4. Titles are normalized across providers (stripping release tags, year discrepancies, and brackets). Matching titles are deduplicated into a single canonical entry with all candidate sources linked.
5. In-flight searches are cleanly aborted via `AbortController` when new remote keystrokes arrive.

---

## 5. Intelligent Quality Selection Strategies

The quality selector scores candidates based on display profile (Samsung 4K QLED) and user strategy:

| Strategy | Scoring Logic | Best For |
|---|---|---|
| **Fastest Start** *(Default)* | Awards highest score to low latency (30-100ms) and buffer-friendly bitrates (4-12 Mbps). | Instant playback on remote press |
| **Best Quality** | Strictly prioritizes 2160p (4K UHD) > 1080p > 720p > 480p, plus high-bitrate audio. | Cinematic 4K QLED showcase |
| **Most Reliable** | Strongly weights verified CDN sources and provider reliability ratings. | Fluctuating connections |
| **Manual Override** | Targets user-chosen resolution (4K, 1080p, 720p, 480p) with graceful nearest-neighbor fallback. | Fixed bandwidth environments |

**Failure Avoidance**: If a stream URL or host experiences playback errors, it is penalized in ranking for 15 minutes, automatically directing playback to healthy alternative mirrors.

---

## 6. Samsung AVPlay & HTML5 Playback

The playback engine dynamically selects the optimal backend:
- **Samsung Tizen TV**: Initializes `webapis.avplay`:
  - `webapis.avplay.open(url)`
  - `webapis.avplay.setDisplayRect(0, 0, 1920, 1080)`
  - `webapis.avplay.setListener({...})` (buffering, timecode, subtitles, error, completion)
  - `webapis.avplay.prepareAsync()` -> `play()`, `pause()`, `seekTo()`, `stop()`, `close()`
- **Development & Simulator Fallback**: Gracefully degrades to HTML5 `<video>` for local browser development and testing.

---

## 7. Subtitle Support

- **Languages**: Default `Off`, `English`, `हिन्दी (Hindi)`, or auto-detected provider tracks.
- **Parsing**: Built-in `parseSrtToCues()` handles standard `.srt` timecodes (`00:01:20,500`) and `.vtt`.
- **Sync Adjustments**: Remote-controlled sync tuning (-5s to +5s in 0.25s steps).
- **Legibility**: High-contrast dark backing box with crisp white font rendered over the video stream.

---

## 8. Development & Testing

Run the automated test suite:
```bash
npm test
```
Outputs 17 comprehensive unit tests testing parallel search, deduplication, stream ranking, quality selection, failure avoidance, subtitle cue parsing, and remote key codes.

Syntax validation:
```bash
npm run lint
```

Start the companion backend:
```bash
npm run server
```

---

## 9. Building the WGT Package

Run the reproducible build script:
```bash
./build.sh
```

This outputs:
1. **Unsigned WGT Archive**:
   `build/MovieBoxTV-unsigned.wgt` (Standard zip structure with `config.xml` at root, ready for external Homebrew or CI signing workflows).
2. **Tizen Packaged WGT**:
   `build/MovieBoxTV.wgt` (Generated using Tizen Studio CLI `tizen package`).

### Integration with Existing Homebrew Signing & Installation Workflow

Your macOS environment contains pre-configured signing certificates in `~/.tizen-certs/` (`author.p12`, `distributor.p12`).

To sign and install using your existing Homebrew/Tizen workflow:
```bash
# 1. Package unsigned WGT
./build.sh

# 2. Sign using your security profile (if using Tizen CLI)
/Users/kuldeep/tizen-studio/tools/ide/bin/tizen package -t wgt -s <YOUR_PROFILE_NAME> -o build/signed -- build/staging

# 3. Install to connected Samsung TV
/Users/kuldeep/tizen-studio/tools/sdb connect <TV_IP_ADDRESS>:26101
/Users/kuldeep/tizen-studio/tools/sdb install build/signed/MovieBoxTV.wgt
```
*Note: The build script never modifies or overwrites your existing certificate profiles or keys.*

---

## 10. Status & Limitations

- **Working Integrations**:
  - Full Samsung Remote D-pad navigation, focus trap, and back-button lifecycle.
  - Concurrent multi-provider search aggregator with timeout isolation and deduplication.
  - Multi-strategy quality selector (Auto, Fastest Start, Best Quality, Most Reliable).
  - Public Domain 4K/1080p authorized streaming with English and Hindi subtitles.
  - Local persistence (Favorites, Watch History with resume position, Settings).
  - Samsung `webapis.avplay` hardware player integration + HTML5 fallback.
  - Automated tests and reproducible packaging.
- **Backend Assisted**:
  - Upstream scrapers (`FourKHdHub`, `Dramachi`, MovieBox direct HMAC signing) require running `server/server.js` when CORS or Cloudflare browser protections prevent direct TV webview requests.
- **Physical Hardware Testing**:
  - Full AVPlay hardware decoding verification and TV remote input latency testing require physical deployment to the Samsung QA55Q7FAAULXL TV via SDB.

---

## 11. License & Attribution

Dual licensed under **MIT OR Apache-2.0** in compliance with the original upstream project:
- Upstream Author: Samir Halder ([mesamirh](https://github.com/mesamirh/MovieBox-Tui))
- Open Media Showcase: Blender Foundation Open Projects ([blender.org](https://www.blender.org))
