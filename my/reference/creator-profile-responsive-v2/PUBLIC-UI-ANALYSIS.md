# Public Creator Profile UI / HTML / CSS / JS Analysis

## Evidence boundary

The supplied TikTok profile URL itself is blocked from raw-page inspection by robots in this environment. The notes below therefore distinguish public evidence from engineering inference.

**Verified public mechanism:** TikTok's official Creator Profile Embed documentation says creator profiles expose profile metrics and up to ten recent videos; most elements are interactive; embedded videos autoplay on desktop on mouseover and on mobile when on-screen; the official integration is available through oEmbed / creator embed markup and an asynchronous embed script.

**Public UI observation:** desktop examples show persistent navigation, a creator header with avatar/identity/actions/metrics, creator tabs, playlists and a media grid. Mobile examples compress navigation and prioritize identity, metrics, actions, tabs and content.

**Engineering inference:** the HTML/CSS/JS in this directory is LuckRead-authored reference code that models those observable patterns. It is not TikTok source code.

## DOM model

```
body
└── AppShell
    ├── GlobalNavigation
    └── Main
        ├── CreatorHero
        │   ├── Cover
        │   ├── Avatar
        │   ├── Identity
        │   ├── Actions
        │   └── Metrics
        ├── CreatorChannelNav
        └── ContentSection
            └── ContentGrid
                └── ContentCard
```

Use semantic `header`, `nav`, `main`, `section`, `article`, `dl/dt/dd`, `button`, `a`, `time`, and dimensioned `img` elements.

## CSS model

```
Tokens
  ↓
Shell/layout
  ↓
Creator components
  ↓
Responsive breakpoints
```

Important details:

- `aspect-ratio` protects card geometry from layout shift.
- Fluid `min()/max()/clamp()` sizing avoids device-specific forks.
- Sticky channel navigation keeps the content context visible.
- Focus-visible states preserve keyboard usability.
- Reduced-motion removes hover translation.
- Large screens use a persistent side rail and a three-column content grid.
- Compact screens use a top bar, bottom navigation and a two-column/single-column content grid.
- No inline page-wide styling.

## JS model

Client JS should be thin:

```
activeChannel
following
menuOpen
share
    ↓
DOM state changes
```

It should not own business authority or create one request per content card.

For LuckRead production:

```
Profile Manifest
  → visible module
  → bounded W03 content query
  → public/edge cache
```

## Creator-channel rule

```
Creator Type
  → Default Profile Channel
  → Module Registry
  → Content Type
```

A drama creator therefore defaults to Drama rather than an undifferentiated article/image feed. Other capabilities remain available as secondary channels.

## Component simplification for LuckRead

Reuse one `CreatorContentCard` and vary its presentation by `contentType`.

```
article → title/summary
video   → cover/play
drama   → poster/episode
comic   → cover/chapter
novel   → cover/chapter
audio   → cover/play
product → cover/version/price
```

Do not create a separate page architecture for every media type.

## Security

Never trust the browser for creator capability, ownership, payment status, entitlement, product price, download URLs or license state. Protected actions remain domain-authorized server operations.
