# Hive OS — Design system (v2, real brand colors)

Built on HiveSocial's actual brand palette (extracted from the site's
testimonial section), not a generic dark SaaS theme. Light-mode-first —
the brand is warm and approachable, and a near-black dashboard fights
that rather than extending it.

## Brand source

- Primary — deep purple `#4a2874`
- Secondary — warm amber/gold `#f8b144`

Both confirmed directly from the site (testimonial card + rating stars),
not guessed.

## Why light mode, not dark

Deep purple and amber are warm, high-contrast brand colors — they read
as premium and friendly on a light background (like the actual site).
Forcing them onto a near-black dashboard mutes the amber and makes the
purple fight for contrast instead of standing out. A light, airy
dashboard lets both colors do their job: purple as calm authority,
amber as the "good news" highlight.

## Color tokens

| Token | Hex | Usage |
|---|---|---|
| `primary` | `#4a2874` | Active nav, primary buttons, headings accents, chart lines |
| `primary-hover` | `#3a1f5c` | Button hover/active state |
| `primary-tint` | `#f1e9f7` | Light purple background — active nav bg, subtle highlights |
| `primary-tint-strong` | `#e0d0ec` | Selected/pressed state background |
| `secondary` | `#f8b144` | Positive deltas, badges, highlight accents, "won" states |
| `secondary-tint` | `#fef3e0` | Light amber background — badge fills |
| `on-primary` | `#ffffff` | Text/icon on top of `primary` fill |
| `on-secondary` | `#4a2874` | Text on top of `secondary` fill — deep purple reads better than white on amber |
| `danger` | `#d64545` | Overdue payments, negative deltas, errors |
| `danger-tint` | `#fbe9e9` | Danger badge background |
| `text-primary` | `#241733` | Main body text — near-black with a purple undertone, not pure black |
| `text-secondary` | `#6b6478` | Muted/supporting text |
| `text-muted` | `#a39cae` | Placeholder, disabled, hints |
| `surface-page` | `#faf7f2` | Page background — warm off-white, not stark white |
| `surface-card` | `#ffffff` | Card background |
| `surface-sidebar` | `#ffffff` | Sidebar background |
| `surface-hover` | `#f5f0fa` | Card/row hover background |
| `border` | `#e8e2ee` | Default hairline border |
| `border-strong` | `#d4cbe0` | Emphasized divider, input borders |

## Typography

Same type scale as before — Geist for headlines, Inter for body,
JetBrains Mono for eyebrow labels — recolored for light mode:

| Token | Font | Size | Weight | Color |
|---|---|---|---|---|
| `display` | Geist | 48px | 600 | `text-primary` |
| `headline-lg` | Geist | 32px | 600 | `text-primary` |
| `headline-md` | Geist | 24px | 500 | `text-primary` |
| `headline-sm` | Geist | 18px | 500 | `text-primary` |
| `body-lg` | Inter | 16px | 400 | `text-primary` |
| `body-md` | Inter | 14px | 400 | `text-secondary` |
| `label-caps` | JetBrains Mono | 12px | 500, uppercase, tracked | `text-secondary` |
| `data-tabular` | Inter | 13px | 500 | `text-primary` |

## Spacing, radius — unchanged

Same scale as before: `xs` 4px, `sm` 8px, `md` 16px, `lg` 24px, `xl`
40px. Radius: `lg` 0.5rem for buttons/inputs, `xl` 0.75rem for cards,
`full` for pills/avatars.

## Component patterns (light mode)

**Card** — `surface-card` bg, `1px solid border`, subtle shadow instead
of a hover-brightened border (dark mode's "lighten on hover" trick
doesn't read well on white — use `box-shadow` elevation on hover instead).

**Sidebar** — white bg, active nav item gets `primary-tint` background +
`primary` text + a `primary` left border accent (matches the selection
style shown in the reference screenshot).

**Badges** — status badges use the tint/on-color pairs above: danger =
`danger-tint` bg + `danger` text; positive/won = `secondary-tint` bg +
`on-secondary` (deep purple) text — never white text on the amber tint,
it disappears.

**Buttons** — primary action = solid `primary` fill + white text.
Secondary action = white bg + `border-strong` outline + `text-primary`.

**Charts** — revenue line uses `primary`; ad spend line uses `text-muted`
dashed; positive markers use `secondary`.

## Known-good pairing rule

Never place white text directly on `secondary` (amber) — contrast fails.
Always pair amber fills with `on-secondary` (`#4a2874`) text instead.

## Where this replaces the old file

This supersedes the earlier dark, mockup-derived palette. Swap every
`@theme` color in `app/globals.css` to these values and flip the base
body background from `#0A0A0A` to `surface-page` to apply this
everywhere at once.
