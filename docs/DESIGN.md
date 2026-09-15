# Design system

Every colour in the product is defined once, in `src/app/globals.css`.
Components reference semantic tokens (`bg-header`, `text-accent-fg`,
`border-line`), never hex values — so a rebrand is an edit to one file.

## The palette

### The core three

| Token | Value | Role |
| --- | --- | --- |
| `--coral-pastel` | `#FFD9C9` | screen headers, passive surfaces, avatars |
| `--mint-pastel` | `#CFF0E8` | status pills, success states, tags |
| `--white` | `#FFFFFF` | backgrounds, cards, everything else |

### Supporting shades

| Token | Value | Role |
| --- | --- | --- |
| `--coral-deep` | `#D85A30` | buttons and CTAs |
| `--coral-text` | `#7A3A1F` | titles on coral headers |
| `--teal-text` | `#1F5F4F` | text on mint |
| `--border` | `#E2E2E2` | borders |
| `--muted` | `#8A8A8A` | muted text |
| `--ink` | `#1A1A1A` | primary text |

## The contrast rule

**The pastels are surfaces, never buttons.**

`#FFD9C9` on white is about 1.3:1 — a coral-pastel button is effectively
invisible in daylight on a phone, which is exactly where this app gets used.
That is why `--coral-deep` exists and owns every action.

Measured ratios (WCAG 2.1, computed — not estimated):

| Foreground on background | Ratio | Verdict |
| --- | --- | --- |
| `#1A1A1A` on `#FFFFFF` | 17.40:1 | ✅ AAA |
| `#1A1A1A` on `#CFF0E8` | 14.32:1 | ✅ AAA |
| `#1A1A1A` on `#FFD9C9` | 13.28:1 | ✅ AAA |
| `#7A3A1F` on `#FFD9C9` | 6.53:1 | ✅ AA — headers can carry real information |
| `#1F5F4F` on `#CFF0E8` | 6.15:1 | ✅ AA |
| `#B3261E` on `#FDECEA` | 5.72:1 | ✅ AA |
| `#8F5708` on `#FDF3E3` | 5.41:1 | ✅ AA |
| `#FFFFFF` on `#C24F29` | 4.73:1 | ✅ AA |
| **`#FFFFFF` on `#D85A30`** | **3.87:1** | ⚠️ **large/bold only — see below** |
| `#8A8A8A` on `#FFFFFF` | 3.45:1 | ⚠️ secondary text only, never below 14px |

Note that ink on either pastel is comfortably AAA. `--coral-text` and
`--teal-text` are used on those surfaces for warmth and brand cohesion, not
because ink would fail — either is safe.

### ⚠️ One open item: white on coral-deep

White text on `#D85A30` measures **3.87:1**. That clears AA for large text
(≥18.66px bold or ≥24px regular) but falls short of the 4.5:1 required for
normal-size labels. Button labels are therefore set at 16px semibold, which is
the boundary case.

Three ways to close it, in order of preference:

1. **Darken the CTA to `#C24F29`** — 4.73:1, passes outright, and it is already
   in the palette as `--coral-deep-hover`. Visually near-identical.
2. **Keep `#D85A30` and set all button labels to ≥18px bold** — passes as large
   text, but makes every button physically larger.
3. **Accept the deviation** — document it, and expect it to be raised in any
   accessibility audit.

Recommendation: option 1. Change one line in `globals.css`
(`--primary: var(--coral-deep-hover)`) and the whole app complies. It needs a
brand call, so it has been left as-is pending a decision.

## Three additions to the brief

The supplied palette had gaps that showed up as soon as real screens were built:

1. **`--danger` `#B3261E` and `--warning` `#8F5708`.** There was no failure
   colour, and coral is already spoken for by primary actions. A cancelled
   order and a Place Order button must not be the same hue.
2. **`--mint-mark` `#5CC9AB`.** The pastel mint disappears at icon scale. This
   is the mint from the logo, used for marks and accents only.
3. **`--surface` `#FAFAFA` and `--surface-raised` `#F4F4F4`.** Every
   card-on-card layout needs one step between white and the `#E2E2E2` border.

## Dark mode

The pastels are built for white; over a dark ground they turn muddy. So the
*roles* are preserved and the *values* re-derived — `--coral-pastel` becomes a
deep coral-brown that still reads as "the coral surface", and `--coral-text`
flips to a light tint of the same hue.

`--coral-deep` is unchanged, because it reads as the brand on either ground.
Its contrast caveat (3.87:1 with white) applies equally in both themes and is
covered above.

Three states are handled: explicit light (`[data-theme="light"]`), explicit dark
(`[data-theme="dark"]`), and system default (`prefers-color-scheme`, with no
attribute set).

## Colour is never the only signal

Roughly 1 in 12 men cannot reliably separate the coral from the mint. Every
status pill therefore carries a dot **and** a word, never a hue alone — often
the only thing distinguishing "delivered" from "cancelled" in a list of forty
rows.

## Type

**Plus Jakarta Sans** — a geometric sans in the same family of shapes as the
logo wordmark, so headings sit next to the mark without a visible seam. Loaded
via `next/font` with `display: swap`.

Inputs are 16px minimum: iOS Safari zooms the viewport when a focused input is
smaller, and never zooms back out.

## Components

| Component | Notes |
| --- | --- |
| `Button` | 5 variants. 44px minimum height — riders tap one-handed holding a bag. |
| `Card` | White on white; separation from a 1px border plus a soft shadow, not a grey fill. |
| `Pill` / `OrderStatusPill` | Mint's home. Wording changes by audience — see below. |
| `ScreenHeader` | The coral band. Anything inside it must use `header-fg`. |
| `Field` / `Input` | Errors wired via `aria-describedby`, not just red text underneath. |
| `Logo` | Both artworks in the DOM, CSS picks one — no hydration flash. |
| `EmptyState` | Always names a reason and offers a next step. |

### One status, four wordings

`src/lib/domain/order-status.ts` maps each of the eleven order statuses to four
strings. The same `preparing` order reads:

- **customer** — "Your food is being prepared"
- **merchant** — "Preparing — mark ready when packed"
- **rider** — "Wait at the store"
- **ops** — "Preparing"

A customer wants reassurance, a merchant wants an instruction, a rider wants the
next physical action, ops wants the state name. Scattering those strings across
four route groups is how one word ends up meaning two things.

## Replacing the logo

Drop the final artwork over these three files; no code changes needed.

```
public/brand/fooddash-light.svg   full lockup, light grounds  (428×200)
public/brand/fooddash-dark.svg    full lockup, dark grounds   (428×200)
public/brand/fooddash-mark.svg    icon only — favicon, PWA    (210×200)
```

The files currently in the repo are **placeholders** built from the brand
colours. They approximate the wing-and-D mark but are not the supplied artwork.
