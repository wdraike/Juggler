# Raike & Sons — Complete Brand Guide for Claude Code

## Brand Overview

**Brand Name:** Raike & Sons  
**Tagline:** "Old school hustle. New school AI."  
**Domain:** raikeandsons.ai  
**Founded:** Est. 2025  
**Products:** StriverRS (AI task manager) + ClimbRS (AI career/resume tool)  
**Product Naming System:** RS suffix = Raike & Sons initials hidden in every product name  
**Audience:** Ambitious professionals, job seekers, busy executives  

### The Core Brand Concept
An 1800s family craftsman business name wrapped around a cutting-edge AI platform. The irony IS the brand. Think apothecary shop meets OpenAI. Nobody in the AI/productivity space is doing this — it's memorable precisely because it breaks every Silicon Valley naming convention. The contrast between vintage aesthetic and modern AI capability is the entire personality.

### Brand Personality
- Confident without being arrogant
- Warm with a knowing wink at itself
- Professional but never stuffy
- Deadpan humor — plays the vintage angle completely straight
- Trustworthy, like a family business that's been around forever (since last Tuesday)

---

## Color Palette

### Primary Colors

| Name | Hex | Usage |
|------|-----|-------|
| Deep Navy | `#1A2B4A` | Primary brand color, headings, navbar, footers |
| Warm Gold | `#C8942A` | Accent, CTAs, hover states, dividers, badges |
| Parchment | `#F5F0E8` | Page backgrounds, card backgrounds, hero sections |
| Dark Charcoal | `#2C2B28` | Body text, secondary headings |

### Secondary Colors

| Name | Hex | Usage |
|------|-----|-------|
| Copper | `#9E6B3B` | Tertiary accent, icon fills, subtle highlights |
| Aged Cream | `#FDFAF5` | Alternate background, input fields |
| Gold Light | `#E8C878` | Hover states, subtle highlights, borders |
| Navy Light | `#2E4A7A` | Hover on navy elements, secondary buttons |
| Parchment Dark | `#E8E0D0` | Card borders, dividers, input borders |

### Semantic Colors

| Name | Hex | Usage |
|------|-----|-------|
| Success | `#2D6A4F` | Success states, confirmations |
| Warning | `#C8942A` | (reuse Gold) Warnings |
| Error | `#8B2635` | Error states |
| Info | `#1A2B4A` | (reuse Navy) Info states |

### CSS Custom Properties (use these throughout)
```css
:root {
  --brand-navy: #1A2B4A;
  --brand-navy-light: #2E4A7A;
  --brand-gold: #C8942A;
  --brand-gold-light: #E8C878;
  --brand-copper: #9E6B3B;
  --brand-parchment: #F5F0E8;
  --brand-parchment-dark: #E8E0D0;
  --brand-cream: #FDFAF5;
  --brand-charcoal: #2C2B28;
  --brand-charcoal-muted: #5C5A55;
}
```

---

## Typography

### Font Stack (all from Google Fonts — free)

```html
<!-- Add to <head> -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,700;1,400;1,700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500;600&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&display=swap" rel="stylesheet">
```

### Font Roles

| Font | Google Font Name | Role | Usage |
|------|-----------------|------|-------|
| **Playfair Display** | `'Playfair Display', serif` | Display / Hero Headlines | H1, hero text, section titles, the brand name itself |
| **EB Garamond** | `'EB Garamond', serif` | Editorial Serif | H2, H3, pull quotes, product names, card titles |
| **Inter** | `'Inter', sans-serif` | Body / UI | Body copy, UI elements, navigation, buttons, forms, metadata |
| **Cormorant Garamond** | `'Cormorant Garamond', serif` | Decorative Accent | Taglines, the "& Sons" portion of the logo, ornamental captions |

### Type Scale

```css
/* Display — Hero headlines */
.text-display {
  font-family: 'Playfair Display', serif;
  font-size: clamp(2.5rem, 6vw, 4.5rem);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--brand-navy);
}

/* H1 — Page titles */
h1 {
  font-family: 'Playfair Display', serif;
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 700;
  line-height: 1.2;
  color: var(--brand-navy);
}

/* H2 — Section headings */
h2 {
  font-family: 'EB Garamond', serif;
  font-size: clamp(1.5rem, 3vw, 2.25rem);
  font-weight: 500;
  line-height: 1.3;
  color: var(--brand-navy);
}

/* H3 — Card titles, sub-sections */
h3 {
  font-family: 'EB Garamond', serif;
  font-size: clamp(1.25rem, 2vw, 1.75rem);
  font-weight: 500;
  line-height: 1.4;
  color: var(--brand-charcoal);
}

/* Body */
p, li, td {
  font-family: 'Inter', sans-serif;
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.7;
  color: var(--brand-charcoal);
}

/* Small / Metadata */
.text-small {
  font-family: 'Inter', sans-serif;
  font-size: 0.875rem;
  color: var(--brand-charcoal-muted);
}

/* Tagline / Decorative */
.text-tagline {
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  font-size: clamp(1.1rem, 2vw, 1.4rem);
  font-weight: 300;
  color: var(--brand-gold);
  letter-spacing: 0.02em;
}

/* Est. badge text */
.text-est {
  font-family: 'Inter', sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--brand-gold);
}
```

---

## Logo & Brand Mark

### Logo Suite Overview
There are five logo components. Use the right one for the right context:

| Component | Use case |
|---|---|
| Primary wordmark (light) | Hero sections, about pages, print |
| Primary wordmark (dark) | Dark headers, footers, dark backgrounds |
| Crest — large | Standalone brand moments, splash pages |
| Crest — medium | Cards, sidebars, email headers |
| Crest — small/icon | Favicon, app icon, social avatar |
| Wordmark compact | Navigation bar |
| StriverRS badge | StriverRS product pages and marketing |
| ClimbRS badge | ClimbRS product pages and marketing |

---

### Shared CSS — Add once to your stylesheet

```css
/* ── Google Fonts (add to <head>) ── */
/* <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"> */

/* ── Shared logo utilities ── */
.logo-inner-border {
  position: relative;
}
.logo-inner-border::before {
  content: '';
  position: absolute;
  inset: 6px;
  border: 0.75px solid #C8942A;
  opacity: 0.25;
  pointer-events: none;
}
```

---

### 1. Primary Wordmark — Light (on parchment)

```html
<div class="wordmark wordmark-light">
  <div class="wordmark-main">
    <span class="wm-raike">Raike</span>
    <span class="wm-amp">&amp;</span>
    <span class="wm-sons">Sons</span>
  </div>
  <div class="wm-rule"></div>
  <div class="wm-tagline">Old school hustle. New school AI.</div>
  <div class="wm-est">Est. 2025</div>
</div>
```

```css
.wordmark {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: 40px 60px;
  position: relative;
}
.wordmark::before {
  content: '';
  position: absolute;
  inset: 5px;
  border: 0.5px solid #C8942A;
  opacity: 0.3;
  pointer-events: none;
}
.wordmark::after {
  content: '';
  position: absolute;
  inset: 8px;
  border: 0.5px solid #C8942A;
  opacity: 0.15;
  pointer-events: none;
}
.wordmark-light { background: #F5F0E8; border: 1px solid #E8E0D0; }
.wordmark-dark  { background: #1A2B4A; }

.wordmark-main {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.wm-raike {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: 48px;
  color: #1A2B4A;
  line-height: 1;
  letter-spacing: -0.01em;
}
.wm-amp {
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  font-weight: 300;
  font-size: 60px;
  color: #C8942A;
  line-height: 1;
  margin: 0 2px;
}
.wm-sons {
  font-family: 'Playfair Display', serif;
  font-weight: 400;
  font-size: 48px;
  color: #1A2B4A;
  line-height: 1;
  letter-spacing: -0.01em;
}
.wm-rule {
  width: 100%;
  height: 1px;
  background: #C8942A;
  opacity: 0.4;
  margin: 8px 0 6px;
}
.wm-tagline {
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  font-weight: 300;
  font-size: 14px;
  color: #9E6B3B;
  letter-spacing: 0.08em;
}
.wm-est {
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #C8942A;
  opacity: 0.7;
  margin-top: 4px;
}

/* Dark overrides */
.wordmark-dark .wm-raike,
.wordmark-dark .wm-sons { color: #F5F0E8; }
.wordmark-dark .wm-tagline { color: #E8C878; }
```

---

### 2. Compact Wordmark — Navigation Bar

```html
<div class="wordmark-compact">
  <span class="wc-raike">Raike</span>
  <span class="wc-amp">&amp;</span>
  <span class="wc-sons">Sons</span>
</div>
```

```css
.wordmark-compact {
  display: inline-flex;
  align-items: baseline;
  gap: 0;
}
.wc-raike {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: 24px;
  color: #1A2B4A;
  letter-spacing: -0.01em;
}
.wc-amp {
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  font-weight: 300;
  font-size: 30px;
  color: #C8942A;
  margin: 0 3px;
  line-height: 1;
}
.wc-sons {
  font-family: 'Playfair Display', serif;
  font-weight: 400;
  font-size: 24px;
  color: #1A2B4A;
}
/* On dark nav: change color to #F5F0E8 for raike/sons */
```

---

### 3. Crest / Badge Mark

The crest uses the letterpress block style — R&S monogram with the faded S, diamond dots, inner border rule. Three sizes: large, medium, small.

```html
<!-- Large crest -->
<div class="crest crest-lg logo-inner-border">
  <div class="crest-top-row">
    <div class="crest-diamond"></div>
    <span class="crest-top-text">Raike &amp; Sons</span>
    <div class="crest-diamond"></div>
  </div>
  <div class="crest-monogram">
    <span class="crest-r">R</span>
    <span class="crest-amp">&amp;</span>
    <span class="crest-s">S</span>
  </div>
  <div class="crest-rule-double"></div>
  <div class="crest-brand-name">Raike &amp; Sons</div>
  <div class="crest-rule"></div>
  <div class="crest-est-row">
    <div class="crest-dot"></div>
    <span class="crest-est-text">Est. 2025</span>
    <div class="crest-dot"></div>
    <span class="crest-est-text">New school AI</span>
    <div class="crest-dot"></div>
  </div>
</div>

<!-- Medium crest -->
<div class="crest crest-md logo-inner-border">
  <div class="crest-top-row">
    <div class="crest-diamond"></div>
    <span class="crest-top-text">Raike &amp; Sons</span>
    <div class="crest-diamond"></div>
  </div>
  <div class="crest-monogram">
    <span class="crest-r">R</span>
    <span class="crest-amp">&amp;</span>
    <span class="crest-s">S</span>
  </div>
  <div class="crest-rule"></div>
  <div class="crest-brand-name">Raike &amp; Sons</div>
  <div class="crest-rule"></div>
  <div class="crest-est-row">
    <div class="crest-dot"></div>
    <span class="crest-est-text">Est. 2025</span>
    <div class="crest-dot"></div>
  </div>
</div>

<!-- Small / icon crest -->
<div class="crest crest-sm logo-inner-border">
  <div class="crest-monogram">
    <span class="crest-r">R</span>
    <span class="crest-amp">&amp;</span>
    <span class="crest-s">S</span>
  </div>
</div>
```

```css
/* ── Crest base ── */
.crest {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  background: #1A2B4A;
  position: relative;
}

/* Sizes */
.crest-lg { padding: 28px 36px; }
.crest-md { padding: 20px 26px; }
.crest-sm { padding: 12px 14px; }

/* Top row */
.crest-top-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.crest-diamond {
  width: 7px;
  height: 7px;
  background: #C8942A;
  transform: rotate(45deg);
  opacity: 0.65;
  flex-shrink: 0;
}
.crest-top-text {
  font-family: 'Inter', sans-serif;
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #C8942A;
  opacity: 0.8;
}

/* Monogram */
.crest-monogram {
  display: flex;
  align-items: baseline;
  gap: 0;
  margin: 2px 0 10px;
}
.crest-r {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: 72px; /* lg */
  color: #F5F0E8;
  line-height: 0.9;
  letter-spacing: -0.02em;
}
.crest-amp {
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  font-weight: 300;
  font-size: 46px; /* lg */
  color: #C8942A;
  line-height: 0.9;
  margin: 0 1px;
  padding-bottom: 4px;
}
.crest-s {
  font-family: 'Playfair Display', serif;
  font-weight: 400;
  font-size: 72px; /* lg */
  color: #F5F0E8;
  line-height: 0.9;
  letter-spacing: -0.02em;
  opacity: 0.28;
}

/* Medium size overrides */
.crest-md .crest-r,
.crest-md .crest-s  { font-size: 48px; }
.crest-md .crest-amp { font-size: 32px; padding-bottom: 3px; }
.crest-md .crest-top-text { font-size: 7px; letter-spacing: 0.28em; }
.crest-md .crest-top-row  { gap: 7px; margin-bottom: 10px; }
.crest-md .crest-diamond  { width: 5px; height: 5px; }
.crest-md .crest-monogram { margin: 0 0 8px; }

/* Small size overrides */
.crest-sm .crest-r,
.crest-sm .crest-s  { font-size: 28px; }
.crest-sm .crest-amp { font-size: 18px; padding-bottom: 2px; }
.crest-sm .crest-monogram { margin: 0; }

/* Rules */
.crest-rule {
  width: 100%;
  height: 1px;
  background: #C8942A;
  opacity: 0.28;
  margin: 4px 0;
}
.crest-rule-double {
  width: 100%;
  height: 3px;
  background: transparent;
  border-top: 0.75px solid rgba(200,148,42,0.28);
  border-bottom: 0.75px solid rgba(200,148,42,0.28);
  margin: 4px 0;
}

/* Brand name */
.crest-brand-name {
  font-family: 'Playfair Display', serif;
  font-weight: 400;
  font-size: 15px;
  color: #F5F0E8;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  opacity: 0.9;
  margin: 6px 0 4px;
}
.crest-md .crest-brand-name { font-size: 11px; letter-spacing: 0.2em; margin: 5px 0 3px; }

/* Est row */
.crest-est-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.crest-dot {
  width: 3px;
  height: 3px;
  background: #C8942A;
  border-radius: 50%;
  opacity: 0.5;
  flex-shrink: 0;
}
.crest-est-text {
  font-family: 'Inter', sans-serif;
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: #C8942A;
  opacity: 0.6;
}
.crest-md .crest-dot { width: 2.5px; height: 2.5px; }
.crest-md .crest-est-text { font-size: 6.5px; letter-spacing: 0.22em; }

/* Light version (parchment bg) */
.crest-light {
  background: #F5F0E8;
}
.crest-light .crest-r,
.crest-light .crest-s  { color: #1A2B4A; }
.crest-light .crest-brand-name { color: #1A2B4A; }
.crest-light .crest-top-text { color: #1A2B4A; opacity: 0.5; }
.crest-light .crest-rule,
.crest-light .crest-rule-double { background: #1A2B4A; border-color: rgba(26,43,74,0.15); }
```

---

### 4. StriverRS Product Badge

```html
<!-- Light version -->
<div class="product-badge product-badge-light">
  <div class="pb-parent">Raike &amp; Sons</div>
  <div class="pb-name">Striver<span class="pb-rs">RS</span></div>
  <div class="pb-rule"></div>
  <div class="pb-tagline">Never stops striving.</div>
</div>

<!-- Dark version -->
<div class="product-badge product-badge-dark">
  <div class="pb-parent">Raike &amp; Sons</div>
  <div class="pb-name">Striver<span class="pb-rs">RS</span></div>
  <div class="pb-rule"></div>
  <div class="pb-tagline">Never stops striving.</div>
</div>
```

```css
.product-badge {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 28px;
  min-width: 160px;
  border: 1px solid #E8E0D0;
}
.product-badge-light { background: #F5F0E8; }
.product-badge-dark  { background: #1A2B4A; border-color: #2E4A7A; }

.pb-parent {
  font-family: 'Playfair Display', serif;
  font-size: 11px;
  font-weight: 400;
  color: #9E6B3B;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.product-badge-dark .pb-parent { color: #C8942A; }

.pb-name {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: 28px;
  color: #1A2B4A;
  letter-spacing: -0.02em;
}
.product-badge-dark .pb-name { color: #F5F0E8; }

.pb-rs {
  color: #C8942A;
}
.product-badge-dark .pb-rs { color: #E8C878; }

.pb-rule {
  width: 100%;
  height: 1px;
  background: #C8942A;
  opacity: 0.3;
}

.pb-tagline {
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  font-size: 12px;
  color: #9E6B3B;
  letter-spacing: 0.05em;
}
.product-badge-dark .pb-tagline { color: #C8942A; opacity: 0.8; }
```

---

### 5. ClimbRS Product Badge

Same HTML/CSS as StriverRS badge above. Just change the text content:

```html
<!-- Light version -->
<div class="product-badge product-badge-light">
  <div class="pb-parent">Raike &amp; Sons</div>
  <div class="pb-name">Climb<span class="pb-rs">RS</span></div>
  <div class="pb-rule"></div>
  <div class="pb-tagline">Always climbing.</div>
</div>

<!-- Dark version -->
<div class="product-badge product-badge-dark">
  <div class="pb-parent">Raike &amp; Sons</div>
  <div class="pb-name">Climb<span class="pb-rs">RS</span></div>
  <div class="pb-rule"></div>
  <div class="pb-tagline">Always climbing.</div>
</div>
```

---

### Ornamental Divider (use between sections)

```html
<div class="ornament-divider">
  <span class="ornament-line"></span>
  <span class="ornament-diamond">◆</span>
  <span class="ornament-line"></span>
</div>
```

```css
.ornament-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 2rem 0;
}
.ornament-line {
  flex: 1;
  height: 1px;
  background: #C8942A;
  opacity: 0.4;
}
.ornament-diamond {
  font-size: 0.5rem;
  color: #C8942A;
  letter-spacing: 4px;
}
```

---

### Logo Usage Rules

- Always use the **compact wordmark** in the navigation bar — never the full wordmark with tagline
- The **crest small** is the favicon and app icon — export as 32×32 and 180×180 PNG
- The **crest large** is a decorative element — use it once per page maximum
- Never stretch, rotate, or recolor any logo component
- Minimum clear space around all logos: equal to the height of the letter "R" in that version
- On photography or complex backgrounds: use the dark wordmark on light photos, light wordmark on dark photos — never directly on a busy image without an overlay

---

## UI Components

### Buttons

```css
/* Primary CTA */
.btn-primary {
  font-family: 'Inter', sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--brand-cream);
  background: var(--brand-navy);
  border: 1.5px solid var(--brand-navy);
  padding: 0.75rem 1.75rem;
  border-radius: 2px; /* Slightly square — craftsman feel, not pill-shaped */
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn-primary:hover {
  background: var(--brand-gold);
  border-color: var(--brand-gold);
  color: var(--brand-navy);
}

/* Secondary / Ghost */
.btn-secondary {
  font-family: 'Inter', sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  color: var(--brand-navy);
  background: transparent;
  border: 1.5px solid var(--brand-navy);
  padding: 0.75rem 1.75rem;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn-secondary:hover {
  border-color: var(--brand-gold);
  color: var(--brand-gold);
}

/* Gold accent CTA */
.btn-gold {
  background: var(--brand-gold);
  color: var(--brand-navy);
  border: 1.5px solid var(--brand-gold);
  font-weight: 700;
  /* same sizing as primary */
}
.btn-gold:hover {
  background: var(--brand-navy);
  color: var(--brand-cream);
  border-color: var(--brand-navy);
}
```

### Cards

```css
.card {
  background: var(--brand-cream);
  border: 1px solid var(--brand-parchment-dark);
  border-radius: 2px; /* Craftsman square corners, not modern pill */
  padding: 1.75rem;
  position: relative;
}

/* Gold top accent on featured cards */
.card-featured {
  border-top: 3px solid var(--brand-gold);
}

/* Subtle parchment texture feel */
.card-parchment {
  background: var(--brand-parchment);
  border: 1px solid var(--brand-parchment-dark);
}
```

### Navigation & Header

#### Header Layout Specification

There are two header contexts — the **main Raike & Sons site** and **product-specific pages**. Both follow the same structure but use different left-side logo treatments.

**Structure (all headers):**
```
[ LEFT: Logo ]          [ CENTER: Nav links ]          [ RIGHT: CTA button ]
```

---

#### Main Site Header (raikeandsons.ai)

Use the **compact wordmark** on the left.

```html
<header class="navbar">
  <!-- LEFT: Brand wordmark -->
  <a href="/" class="navbar-brand">
    <div class="wordmark-compact">
      <span class="wc-raike">Raike</span>
      <span class="wc-amp">&amp;</span>
      <span class="wc-sons">Sons</span>
    </div>
  </a>

  <!-- CENTER: Nav links -->
  <nav class="navbar-nav">
    <a href="/striverrs" class="nav-link">StriverRS</a>
    <a href="/climbrs" class="nav-link">ClimbRS</a>
    <a href="/about" class="nav-link">About</a>
    <a href="/pricing" class="nav-link">Pricing</a>
  </nav>

  <!-- RIGHT: CTA -->
  <div class="navbar-cta">
    <a href="/login" class="nav-link" style="margin-right: 1.5rem">Sign in</a>
    <button class="btn-primary btn-sm">Get started</button>
  </div>
</header>
```

---

#### StriverRS Product Header

Use the **StriverRS product badge (compact)** on the left, with a small "by Raike & Sons" attribution below.

```html
<header class="navbar navbar-product navbar-strivers">
  <!-- LEFT: Product badge — compact version -->
  <a href="/striverrs" class="navbar-brand">
    <div class="product-badge-nav product-badge-nav-light">
      <div class="pbn-parent">by Raike &amp; Sons</div>
      <div class="pbn-name">Striver<span class="pbn-rs">RS</span></div>
    </div>
  </a>

  <!-- CENTER: Nav links -->
  <nav class="navbar-nav">
    <a href="/striverrs/features" class="nav-link">Features</a>
    <a href="/striverrs/pricing" class="nav-link">Pricing</a>
    <a href="/striverrs/docs" class="nav-link">Docs</a>
  </nav>

  <!-- RIGHT: CTA -->
  <div class="navbar-cta">
    <a href="/login" class="nav-link" style="margin-right: 1.5rem">Sign in</a>
    <button class="btn-primary btn-sm">Start striving</button>
  </div>
</header>
```

---

#### ClimbRS Product Header

Same structure as StriverRS, different badge.

```html
<header class="navbar navbar-product navbar-climbrs">
  <!-- LEFT: Product badge — compact version -->
  <a href="/climbrs" class="navbar-brand">
    <div class="product-badge-nav product-badge-nav-dark">
      <div class="pbn-parent">by Raike &amp; Sons</div>
      <div class="pbn-name">Climb<span class="pbn-rs">RS</span></div>
    </div>
  </a>

  <!-- CENTER: Nav links -->
  <nav class="navbar-nav">
    <a href="/climbrs/features" class="nav-link">Features</a>
    <a href="/climbrs/pricing" class="nav-link">Pricing</a>
    <a href="/climbrs/docs" class="nav-link">Docs</a>
  </nav>

  <!-- RIGHT: CTA -->
  <div class="navbar-cta">
    <a href="/login" class="nav-link" style="margin-right: 1.5rem">Sign in</a>
    <button class="btn-primary btn-sm">Start climbing</button>
  </div>
</header>
```

---

#### Full Header CSS

```css
/* ── Base navbar ── */
.navbar {
  background: var(--brand-navy);
  padding: 0 2rem;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid rgba(200, 148, 42, 0.15);
}

/* Product header — copper accent bottom border */
.navbar-product {
  border-bottom: 2px solid rgba(200, 148, 42, 0.3);
}

/* ── Brand link ── */
.navbar-brand {
  text-decoration: none;
  flex-shrink: 0;
}

/* ── Nav links ── */
.navbar-nav {
  display: flex;
  align-items: center;
  gap: 2rem;
}
.nav-link {
  font-family: 'Inter', sans-serif;
  font-size: 0.8rem;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--brand-parchment);
  text-decoration: none;
  opacity: 0.75;
  transition: opacity 0.2s;
  position: relative;
}
.nav-link::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 0;
  height: 1px;
  background: var(--brand-gold);
  transition: width 0.25s ease;
}
.nav-link:hover { opacity: 1; }
.nav-link:hover::after { width: 100%; }
.nav-link.active {
  color: var(--brand-gold);
  opacity: 1;
}

/* ── CTA area ── */
.navbar-cta {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

/* Small button variant for navbar */
.btn-sm {
  font-size: 0.75rem;
  padding: 0.5rem 1.25rem;
  letter-spacing: 0.08em;
}

/* ── Product badge — compact nav version ── */
.product-badge-nav {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 6px 12px;
  border-left: 2px solid #C8942A;
}
.product-badge-nav-light {
  background: transparent;
}
.product-badge-nav-dark {
  background: transparent;
}
.pbn-parent {
  font-family: 'Inter', sans-serif;
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #C8942A;
  opacity: 0.7;
}
.pbn-name {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: 22px;
  color: #F5F0E8;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.pbn-rs {
  color: #C8942A;
}

/* ── Mobile — hide center nav, keep logo + CTA ── */
@media (max-width: 768px) {
  .navbar-nav { display: none; }
  .navbar-cta .nav-link { display: none; }
  .navbar { padding: 0 1rem; }
}

/* ── Light theme header (for parchment/cream page sections) ── */
.navbar-light {
  background: var(--brand-parchment);
  border-bottom: 1px solid var(--brand-parchment-dark);
}
.navbar-light .nav-link {
  color: var(--brand-navy);
  opacity: 0.7;
}
.navbar-light .nav-link:hover { opacity: 1; color: var(--brand-navy); }
.navbar-light .nav-link.active { color: var(--brand-gold); opacity: 1; }
.navbar-light .wc-raike,
.navbar-light .wc-sons { color: var(--brand-navy); }
.navbar-light .pbn-name { color: var(--brand-navy); }

/* ── Scrolled state — darkens slightly on scroll ── */
.navbar-scrolled {
  background: rgba(26, 43, 74, 0.97);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(200, 148, 42, 0.2);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.12);
}

/* ── Transparent hero header (overlays hero section) ── */
.navbar-transparent {
  background: transparent;
  border-bottom: 1px solid rgba(200, 148, 42, 0.15);
  position: absolute;
}
/* Transitions to solid on scroll — add .navbar-scrolled via JS */

/* ── System dark mode support ── */
@media (prefers-color-scheme: dark) {
  .navbar-light {
    background: #1A2B4A;
    border-bottom-color: rgba(200, 148, 42, 0.15);
  }
  .navbar-light .nav-link { color: var(--brand-parchment); }
  .navbar-light .wc-raike,
  .navbar-light .wc-sons { color: var(--brand-parchment); }
  .navbar-light .pbn-name { color: var(--brand-parchment); }
}
```

---

#### Scroll Behavior — JavaScript

Add this snippet to automatically transition the header from transparent to solid when the user scrolls:

```javascript
// Navbar scroll state
const navbar = document.querySelector('.navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      navbar.classList.add('navbar-scrolled');
      navbar.classList.remove('navbar-transparent');
    } else {
      navbar.classList.remove('navbar-scrolled');
      navbar.classList.add('navbar-transparent');
    }
  }, { passive: true });
}
```

---

#### Theme Decision Guide — Which header to use where

| Page / Context | Header style | Notes |
|---|---|---|
| Main marketing homepage | `navbar navbar-transparent` → scrolls to `navbar-scrolled` | Overlays dark hero, transitions on scroll |
| StriverRS marketing page | `navbar navbar-product navbar-strivers` | Dark, copper border, StriverRS badge |
| ClimbRS marketing page | `navbar navbar-product navbar-climbrs` | Dark, gold border, ClimbRS badge |
| Docs / blog (light bg) | `navbar navbar-light` | Parchment bg, navy text — respects light page |
| Dashboard / app shell | `navbar` (default dark) | Always dark for app UI |
| Print / PDF export | Hide navbar entirely | `@media print { .navbar { display: none; } }` |
```

---

#### Visual Header Reference

```
┌─────────────────────────────────────────────────────────────────┐
│  Main site:                                                      │
│  [ Raike & Sons ]    Features  Products  About    [ Get started ]│
├─────────────────────────────────────────────────────────────────┤
│  StriverRS product page:                                          │
│  [ by Raike & Sons ]   Features  Pricing  Docs  [ Start striving]│
│  [ StriverRS       ]                                              │
├─────────────────────────────────────────────────────────────────┤
│  ClimbRS product page:                                           │
│  [ by Raike & Sons ]   Features  Pricing  Docs  [ Start climbing]│
│  [ ClimbRS        ]                                              │
└─────────────────────────────────────────────────────────────────┘
```

The gold left border on the product badge nav version creates a visual anchor on the left edge — it's the craftsman equivalent of a product ribbon.

---

### Full Logo Suite — Standalone HTML File

Save this as `logo-suite.html` in your project root. It is a fully self-contained reference file with all logo variants rendered live. Open in any browser to see exactly how everything looks. Hand this file directly to Claude Code.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Raike &amp; Sons — Logo Suite</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:#F5F0E8;padding:40px;display:flex;flex-direction:column;gap:48px;align-items:center}
.label{font-size:10px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:#9E6B3B;margin-bottom:12px;text-align:center}
.row{display:flex;gap:32px;align-items:flex-start;justify-content:center;flex-wrap:wrap}
/* Wordmark */
.wordmark{display:inline-flex;flex-direction:column;align-items:center;gap:0;padding:40px 60px;position:relative;border:1px solid #E8E0D0;background:#F5F0E8}
.wordmark::before{content:'';position:absolute;inset:5px;border:0.5px solid #C8942A;opacity:0.3;pointer-events:none}
.wordmark::after{content:'';position:absolute;inset:8px;border:0.5px solid #C8942A;opacity:0.15;pointer-events:none}
.wordmark-dark{background:#1A2B4A;border-color:#2E4A7A}
.wordmark-main{display:flex;align-items:baseline;gap:4px}
.wm-raike,.wm-sons{font-family:'Playfair Display',serif;font-weight:700;font-size:48px;color:#1A2B4A;line-height:1;letter-spacing:-0.01em}
.wm-sons{font-weight:400}
.wm-amp{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:300;font-size:60px;color:#C8942A;line-height:1;margin:0 2px}
.wm-rule{width:100%;height:1px;background:#C8942A;opacity:0.4;margin:8px 0 6px}
.wm-tagline{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:300;font-size:14px;color:#9E6B3B;letter-spacing:0.08em}
.wm-est{font-family:'Inter',sans-serif;font-size:9px;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;color:#C8942A;opacity:0.7;margin-top:4px}
.wordmark-dark .wm-raike,.wordmark-dark .wm-sons{color:#F5F0E8}
.wordmark-dark .wm-tagline{color:#E8C878}
/* Compact */
.wordmark-compact{display:inline-flex;align-items:baseline;gap:0;padding:12px 24px;background:#1A2B4A}
.wc-raike,.wc-sons{font-family:'Playfair Display',serif;font-weight:700;font-size:24px;color:#F5F0E8;letter-spacing:-0.01em}
.wc-sons{font-weight:400}
.wc-amp{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:300;font-size:30px;color:#C8942A;margin:0 3px;line-height:1}
/* Crest */
.crest{display:inline-flex;flex-direction:column;align-items:center;gap:0;background:#1A2B4A;position:relative}
.crest::before{content:'';position:absolute;inset:6px;border:0.75px solid #C8942A;opacity:0.25;pointer-events:none}
.crest-lg{padding:28px 36px}
.crest-md{padding:20px 26px}
.crest-sm{padding:12px 14px}
.crest-top-row{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.crest-diamond{width:7px;height:7px;background:#C8942A;transform:rotate(45deg);opacity:0.65;flex-shrink:0}
.crest-top-text{font-family:'Inter',sans-serif;font-size:8.5px;font-weight:600;letter-spacing:0.32em;text-transform:uppercase;color:#C8942A;opacity:0.8}
.crest-monogram{display:flex;align-items:baseline;gap:0;margin:2px 0 10px}
.crest-r,.crest-s{font-family:'Playfair Display',serif;font-weight:700;font-size:72px;color:#F5F0E8;line-height:0.9;letter-spacing:-0.02em}
.crest-s{font-weight:400;opacity:0.28}
.crest-amp{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:300;font-size:46px;color:#C8942A;line-height:0.9;margin:0 1px;padding-bottom:4px}
.crest-md .crest-r,.crest-md .crest-s{font-size:48px}
.crest-md .crest-amp{font-size:32px;padding-bottom:3px}
.crest-md .crest-top-text{font-size:7px;letter-spacing:0.28em}
.crest-md .crest-top-row{gap:7px;margin-bottom:10px}
.crest-md .crest-diamond{width:5px;height:5px}
.crest-md .crest-monogram{margin:0 0 8px}
.crest-sm .crest-r,.crest-sm .crest-s{font-size:28px}
.crest-sm .crest-amp{font-size:18px;padding-bottom:2px}
.crest-sm .crest-monogram{margin:0}
.crest-rule{width:100%;height:1px;background:#C8942A;opacity:0.28;margin:4px 0}
.crest-rule-double{width:100%;height:3px;background:transparent;border-top:0.75px solid rgba(200,148,42,0.28);border-bottom:0.75px solid rgba(200,148,42,0.28);margin:4px 0}
.crest-brand-name{font-family:'Playfair Display',serif;font-weight:400;font-size:15px;color:#F5F0E8;letter-spacing:0.22em;text-transform:uppercase;opacity:0.9;margin:6px 0 4px}
.crest-md .crest-brand-name{font-size:11px;letter-spacing:0.2em;margin:5px 0 3px}
.crest-est-row{display:flex;align-items:center;gap:8px;margin-top:4px}
.crest-dot{width:3px;height:3px;background:#C8942A;border-radius:50%;opacity:0.5;flex-shrink:0}
.crest-est-text{font-family:'Inter',sans-serif;font-size:8px;font-weight:600;letter-spacing:0.25em;text-transform:uppercase;color:#C8942A;opacity:0.6}
.crest-md .crest-dot{width:2.5px;height:2.5px}
.crest-md .crest-est-text{font-size:6.5px;letter-spacing:0.22em}
/* Product badges */
.product-badge{display:inline-flex;flex-direction:column;align-items:center;gap:6px;padding:20px 28px;min-width:160px;border:1px solid #E8E0D0}
.product-badge-light{background:#F5F0E8}
.product-badge-dark{background:#1A2B4A;border-color:#2E4A7A}
.pb-parent{font-family:'Playfair Display',serif;font-size:11px;font-weight:400;color:#9E6B3B;letter-spacing:0.2em;text-transform:uppercase}
.product-badge-dark .pb-parent{color:#C8942A}
.pb-name{font-family:'Playfair Display',serif;font-weight:700;font-size:28px;color:#1A2B4A;letter-spacing:-0.02em}
.product-badge-dark .pb-name{color:#F5F0E8}
.pb-rs{color:#C8942A}
.product-badge-dark .pb-rs{color:#E8C878}
.pb-rule{width:100%;height:1px;background:#C8942A;opacity:0.3}
.pb-tagline{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:12px;color:#9E6B3B;letter-spacing:0.05em}
.product-badge-dark .pb-tagline{color:#C8942A;opacity:0.8}
</style>
</head>
<body>

<div><div class="label">Primary wordmark — light</div>
<div class="wordmark">
  <div class="wordmark-main"><span class="wm-raike">Raike</span><span class="wm-amp">&amp;</span><span class="wm-sons">Sons</span></div>
  <div class="wm-rule"></div>
  <div class="wm-tagline">Old school hustle. New school AI.</div>
  <div class="wm-est">Est. 2025</div>
</div></div>

<div><div class="label">Primary wordmark — dark</div>
<div class="wordmark wordmark-dark">
  <div class="wordmark-main"><span class="wm-raike">Raike</span><span class="wm-amp">&amp;</span><span class="wm-sons">Sons</span></div>
  <div class="wm-rule"></div>
  <div class="wm-tagline">Old school hustle. New school AI.</div>
  <div class="wm-est">Est. 2025</div>
</div></div>

<div><div class="label">Compact — navigation bar</div>
<div class="wordmark-compact">
  <span class="wc-raike">Raike</span><span class="wc-amp">&amp;</span><span class="wc-sons">Sons</span>
</div></div>

<div><div class="label">Crest — large</div>
<div class="crest crest-lg">
  <div class="crest-top-row"><div class="crest-diamond"></div><span class="crest-top-text">Raike &amp; Sons</span><div class="crest-diamond"></div></div>
  <div class="crest-monogram"><span class="crest-r">R</span><span class="crest-amp">&amp;</span><span class="crest-s">S</span></div>
  <div class="crest-rule-double"></div>
  <div class="crest-brand-name">Raike &amp; Sons</div>
  <div class="crest-rule"></div>
  <div class="crest-est-row"><div class="crest-dot"></div><span class="crest-est-text">Est. 2025</span><div class="crest-dot"></div><span class="crest-est-text">New school AI</span><div class="crest-dot"></div></div>
</div></div>

<div class="row">
<div><div class="label">Crest — medium</div>
<div class="crest crest-md">
  <div class="crest-top-row"><div class="crest-diamond"></div><span class="crest-top-text">Raike &amp; Sons</span><div class="crest-diamond"></div></div>
  <div class="crest-monogram"><span class="crest-r">R</span><span class="crest-amp">&amp;</span><span class="crest-s">S</span></div>
  <div class="crest-rule"></div>
  <div class="crest-brand-name">Raike &amp; Sons</div>
  <div class="crest-rule"></div>
  <div class="crest-est-row"><div class="crest-dot"></div><span class="crest-est-text">Est. 2025</span><div class="crest-dot"></div></div>
</div></div>
<div><div class="label">Crest — small / icon</div>
<div class="crest crest-sm">
  <div class="crest-monogram"><span class="crest-r">R</span><span class="crest-amp">&amp;</span><span class="crest-s">S</span></div>
</div></div>
</div>

<div><div class="label">Product sub-brands — all variants</div>
<div class="row">
  <div class="product-badge product-badge-light">
    <div class="pb-parent">Raike &amp; Sons</div>
    <div class="pb-name">Striver<span class="pb-rs">RS</span></div>
    <div class="pb-rule"></div>
    <div class="pb-tagline">Never stops striving.</div>
  </div>
  <div class="product-badge product-badge-dark">
    <div class="pb-parent">Raike &amp; Sons</div>
    <div class="pb-name">Striver<span class="pb-rs">RS</span></div>
    <div class="pb-rule"></div>
    <div class="pb-tagline">Never stops striving.</div>
  </div>
  <div class="product-badge product-badge-light">
    <div class="pb-parent">Raike &amp; Sons</div>
    <div class="pb-name">Climb<span class="pb-rs">RS</span></div>
    <div class="pb-rule"></div>
    <div class="pb-tagline">Always climbing.</div>
  </div>
  <div class="product-badge product-badge-dark">
    <div class="pb-parent">Raike &amp; Sons</div>
    <div class="pb-name">Climb<span class="pb-rs">RS</span></div>
    <div class="pb-rule"></div>
    <div class="pb-tagline">Always climbing.</div>
  </div>
</div></div>

</body>
</html>
```


### Hero Section Pattern

```html
<section class="hero">
  <div class="hero-badge">Est. 2025</div>
  <h1 class="hero-headline">We handle it.</h1>
  <p class="hero-tagline">AI-powered tools for people who actually get things done.</p>
  <div class="hero-cta">
    <button class="btn-primary">Get to work</button>
    <button class="btn-secondary">See how it works</button>
  </div>
  <div class="ornament-divider">...</div>
</section>
```

```css
.hero {
  background: var(--brand-parchment);
  text-align: center;
  padding: 6rem 2rem;
  position: relative;
}
.hero::before {
  /* Subtle aged paper effect */
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  opacity: 0.4;
}
.hero-badge {
  font-family: 'Inter', sans-serif;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--brand-gold);
  border: 1px solid var(--brand-gold);
  display: inline-block;
  padding: 0.2rem 0.8rem;
  margin-bottom: 1.5rem;
}
```

---

## Copywriting Voice & Tone

### The Voice
Short, declarative, confident. Never uses jargon. The humor is in playing it completely straight — a family craftsman shop that happens to run on AI. Write like you've been in business for 150 years and you don't need to explain yourself.

### Copy Examples by Context

**Hero Headlines:**
- "We handle it."
- "Get things done. Then some."
- "Fine-crafted AI. Built to last."
- "Your tasks. Handled."

**Sub-headlines:**
- "AI-powered tools for people who actually get things done."
- "Three generations of hustle. Zero tolerance for busywork."
- "Built by hand. Powered by machine."
- "No fluff. No fuss. Just done."

**CTAs:**
- "Get to work" (primary)
- "See how it works" (secondary)  
- "Start getting things done"
- "Put us to work"

**Feature Descriptions:**
Write like a craftsman describing their product. Short, proud, no buzzwords.
- BAD: "Leverage AI-powered synergies to optimize your workflow ecosystem"
- GOOD: "Tells AI what you need. Gets it done."

**Product Names in Context:**
- "Raike & Sons StriverRS" — never stops striving
- "Raike & Sons ClimbRS" — always climbing

**The Self-Aware Wink:**
Occasionally acknowledge the irony. Very occasionally. Once per page maximum.
- "Est. 2025. Fine-crafted AI since last year."
- "Old school name. New school brains."

---

## Public Domain Artwork Sources

Use these to find vintage illustrations, engravings, and ornamental elements that reinforce the craftsman aesthetic. All are free for commercial use.

### Top Sources

**1. Rawpixel Public Domain (BEST STARTING POINT)**
- URL: `rawpixel.com/free-images/public-domain`
- Filter by: CC0 / Public Domain
- Search terms: "vintage tools", "craftsman engraving", "Victorian ornament", "vintage workshop", "antique border", "engraving illustration"
- Best for: High-quality vintage illustrations already optimized for web

**2. The Metropolitan Museum of Art Open Access**
- URL: `metmuseum.org/art/collection`
- Filter: "Open Access" in search
- Search terms: "engraving", "tools", "workshop", "craftsman", "portrait"
- Best for: Museum-quality engravings and historical portraits

**3. New York Public Library Digital Collections**
- URL: `digitalcollections.nypl.org`
- Filter: "Public Domain"
- Search terms: "trade card", "ornamental border", "vintage advertisement", "woodcut"
- Best for: Victorian trade cards and ornamental typography elements

**4. Library of Congress**
- URL: `loc.gov/pictures`
- Filter: "No known restrictions"
- Search terms: "craftsman", "workshop", "American business", "engraving"
- Best for: American historical business and craft imagery

**5. Biodiversity Heritage Library**
- URL: `biodiversitylibrary.org`
- Filter: Public Domain
- Search: Browse illustrated works 1800-1900
- Best for: Beautiful engraving-style botanical and scientific illustrations for decorative elements

**6. Smithsonian Open Access**
- URL: `si.edu/openaccess`
- Search terms: "tools", "industrial", "craftsman"
- Best for: American craft and industrial heritage imagery

**7. Public Domain Review**
- URL: `publicdomainreview.org`
- Best for: Curated, high-quality vintage imagery with context

**8. Europeana**
- URL: `europeana.eu`
- Filter: "Public Domain" rights
- Search: "craftsman", "workshop engraving", "artisan"
- Best for: European craft heritage imagery

**9. Wikimedia Commons**
- URL: `commons.wikimedia.org`
- Filter: CC0 or Public Domain license
- Best for: Everything — comprehensive, searchable

### Specific Imagery to Find

For the Raike & Sons brand, look for:
- **Workshop/craftsman scenes** — 19th century engravings of men working at benches
- **Hand tool engravings** — rakes, hammers, compass, measuring tools (ironic: rakes specifically!)
- **Victorian trade card borders** — ornamental frames used in old business cards
- **Letterpress ornaments** — small decorative elements (hands, pointing fingers, stars, flourishes)
- **Portrait engravings** — formal 19th century portraits (for team section humor)
- **Vintage business certificates** — the ornate border style
- **Woodcut-style imagery** — black and white high-contrast illustrations

For **StriverRS** specifically:
- "grindstone wheel engraving" — spinning grinding wheel with sparks
- "blacksmith workshop vintage illustration" — craftsman at work
- "spinning wheel woodcut" — circular motion, relentless turning
- "workshop tools 19th century" — tools in motion

For **ClimbRS** specifically:
- "mountain climber engraving" — upward motion, ambition
- "ladder vintage illustration" — climbing, ascent
- "blacksmith anvil hammer engraving" — making something of raw material
- "victorian career achievement engraving" — professional advancement

### How to Use Artwork

- Use as **decorative section backgrounds** at very low opacity (5-10%) on parchment sections
- Use as **hero illustrations** converted to navy/gold duotone
- Use **ornamental borders** from trade cards as section frames
- Use **tool engravings** as product feature icons (converted to SVG if possible)
- Convert to **brand colors** using CSS: `filter: sepia(100%) hue-rotate(...)` or SVG filters

### Image Treatment CSS

```css
/* Duotone effect — converts any vintage image to navy/gold palette */
.img-duotone {
  filter: grayscale(100%) sepia(40%);
  mix-blend-mode: multiply;
  opacity: 0.7;
}

/* Aged/faded look */
.img-aged {
  filter: sepia(30%) contrast(0.9) brightness(1.05);
  opacity: 0.85;
}

/* Navy tone */
.img-navy {
  filter: grayscale(100%) brightness(0.3) sepia(100%) hue-rotate(190deg) saturate(400%);
}
```

---

## Page Layout Patterns

### Overall Layout Philosophy
- Generous white space (or parchment space)
- Strong vertical rhythm
- Centered content with max-width of 1100px
- Gold accents used sparingly — they should pop, not flood

### Section Templates

```css
/* Standard section */
.section {
  padding: 5rem 2rem;
  max-width: 1100px;
  margin: 0 auto;
}

/* Parchment section (alternating) */
.section-parchment {
  background: var(--brand-parchment);
  padding: 5rem 2rem;
}
.section-parchment > div {
  max-width: 1100px;
  margin: 0 auto;
}

/* Navy section (dark) */
.section-navy {
  background: var(--brand-navy);
  color: var(--brand-cream);
  padding: 5rem 2rem;
}
.section-navy h2, .section-navy h3 {
  color: var(--brand-gold);
}
.section-navy p {
  color: var(--brand-parchment);
  opacity: 0.9;
}
```

### Footer
```css
.footer {
  background: var(--brand-charcoal);
  color: var(--brand-parchment);
  padding: 3rem 2rem;
  text-align: center;
}
.footer-logo {
  color: var(--brand-gold);
  margin-bottom: 0.5rem;
}
.footer-tagline {
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  color: var(--brand-parchment);
  opacity: 0.6;
  font-size: 0.9rem;
}
.footer-est {
  font-family: 'Inter', sans-serif;
  font-size: 0.65rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--brand-gold);
  opacity: 0.6;
  margin-top: 0.5rem;
}
```

---

## Product-Specific Branding

### The RS Naming System
Every Raike & Sons product ends in **RS** — the initials of Raike & Sons hidden inside a plain English word. The RS suffix makes every product name instantly recognizable as part of the family, while the word itself tells you exactly what the product does.

**The system scales infinitely:**
- StriverRS — task management
- ClimbRS — career/resume
- Future: NetworkRS, LearnRS, TrackRS, BuildRS, EarnRS...

---

### StriverRS — AI Task Manager

**Full product name:** Raike & Sons StriverRS
**Reads as:** "StriverRS" — Striver + RS (Raike & Sons)
**Tagline:** "Never stops striving."
**Sub-tagline:** "Built for people who don't sit still."
**Sub-brand color accent:** Copper `#9E6B3B`
**Domain:** striverrs.ai + striverrs.com

**The concept:**
A striver never settles, never sits still, never accepts "good enough." StriverRS is the AI that embodies that energy — relentless, always pushing tasks forward, never letting work pile up. The name says it: you're a striver, and this is the tool built for people like you. The RS is Raike & Sons baked right into the word.

**Voice for StriverRS:**
- Short, ambitious, restless energy
- Speaks to the person's drive, not just the tool's features
- Examples:
  - "On it."
  - "Already handled."
  - "3 tasks cleared while you were in that meeting."
  - "Strivers never stop."
  - "Built for people who don't sit still."
  - "Put your StriverRS to work."

**Icon concept:** A vintage figure in motion — always moving forward. Or a craftsman's hand tools arranged in a working pattern. Look for public domain workshop engravings showing craftsmen at work.

---

### ClimbRS — AI Resume & Career Tool

**Full product name:** Raike & Sons ClimbRS
**Reads as:** "Climbers"
**Tagline:** "Always climbing."
**Sub-tagline:** "Raw experience. Refined results."
**Sub-brand color accent:** Warm Gold `#C8942A`
**Domain:** climbrs.ai + climbrs.com

**The concept:**
ClimbRS takes your raw experience and shapes it into something that gets you hired. Always moving upward. The name says it: you're a climber, and ClimbRS is how you get to the top. The RS is Raike & Sons baked right in.

**Voice for ClimbRS:**
- Precise, confident, upward-looking
- Examples:
  - "Your story, sharpened."
  - "Raw experience. Refined results."
  - "We've seen your material. Here's what we can make."
  - "Always climbing."
  - "Make something of yourself."

**Icon concept:** A vintage mountain or ladder — upward motion. Or a craftsman's compass pointing up. Look for public domain engravings of mountain climbers or architectural ladders.

---

### Product Pairing (when showing both together)

**Combined tagline:**
> *"StriverRS keeps you moving. ClimbRS gets you rising."*

**Extended brand narrative:**
> *At Raike & Sons, we built two tools for people who don't sit still. StriverRS keeps the work moving — relentless, handled, never piling up. ClimbRS shapes your career — taking raw experience and making something that gets you in the room. Both powered by AI. Both built by Raike & Sons. Both carry our initials — because everything we make, we stand behind.*

**Future product reserve:**
- **EarnRS** — earnings/financial tracking (earnrs.ai available)
- **NetworkRS** — AI networking tool
- **LearnRS** — AI learning platform
- **TrackRS** — AI analytics

---

## Visual Enhancement Guide

The base brand (navy, parchment, gold) is strong but can feel flat without the right visual treatments. Here's how to add depth, warmth and life without going overboard. The rule: **one dramatic element per section, everything else restrained.**

---

### 1. Subtle Texture — The "Aged Paper" Effect

Add a faint noise/grain texture to parchment backgrounds. This single change makes flat color sections feel warm and handcrafted.

```css
/* Parchment texture overlay — add to any parchment section */
.section-parchment {
  position: relative;
  background-color: var(--brand-parchment);
}
.section-parchment::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.035;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 200px 200px;
}

/* Darker texture for navy sections */
.section-navy::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.05;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 200px 200px;
}
```

---

### 2. Gold Rule Lines — The Letterpress Effect

Thin gold horizontal rules between sections give the page a printed, letterpress-quality feel. More elegant than dividers.

```css
/* Gold rule — use between major sections */
.gold-rule {
  border: none;
  height: 1px;
  background: linear-gradient(
    to right,
    transparent,
    var(--brand-gold) 20%,
    var(--brand-gold) 80%,
    transparent
  );
  opacity: 0.5;
  margin: 0;
}

/* Double gold rule — for extra emphasis */
.gold-rule-double {
  border: none;
  border-top: 1px solid var(--brand-gold);
  border-bottom: 1px solid var(--brand-gold);
  height: 3px;
  opacity: 0.3;
  margin: 0;
}
```

---

### 3. Large Decorative Initials — Drop Caps

Use an oversized first letter on hero sections or section openers. Classic editorial, very craftsman press.

```css
/* Drop cap — first letter of a section */
.drop-cap::first-letter {
  font-family: 'Playfair Display', serif;
  font-size: 5rem;
  font-weight: 700;
  color: var(--brand-gold);
  float: left;
  line-height: 0.8;
  margin-right: 0.1em;
  margin-top: 0.05em;
}

/* Giant decorative background letter */
.section-with-letter {
  position: relative;
  overflow: hidden;
}
.section-with-letter::before {
  content: attr(data-letter); /* set data-letter="R" on the element */
  position: absolute;
  font-family: 'Playfair Display', serif;
  font-size: 40vw;
  font-weight: 700;
  color: var(--brand-navy);
  opacity: 0.03;
  top: -10%;
  right: -5%;
  line-height: 1;
  pointer-events: none;
  user-select: none;
}
```

Usage: `<section class="section-with-letter" data-letter="R">`

---

### 4. Engraving-Style Borders — Victorian Frame Effect

Thin double-rule borders around cards and feature blocks. Reminiscent of Victorian trade cards and certificates.

```css
/* Engraving double-border card */
.card-engraved {
  background: var(--brand-cream);
  padding: 2rem;
  position: relative;
  border: 1px solid var(--brand-gold);
  box-shadow: inset 0 0 0 4px var(--brand-parchment),
              inset 0 0 0 5px var(--brand-gold);
}

/* Corner ornaments on featured cards */
.card-cornered {
  position: relative;
  padding: 2.5rem;
  background: var(--brand-cream);
  border: 1px solid var(--brand-parchment-dark);
}
.card-cornered::before,
.card-cornered::after {
  content: '✦';
  position: absolute;
  color: var(--brand-gold);
  font-size: 0.7rem;
  opacity: 0.6;
}
.card-cornered::before { top: 0.5rem; left: 0.5rem; }
.card-cornered::after  { bottom: 0.5rem; right: 0.5rem; }
```

---

### 5. Stamp / Badge Elements

Vintage rubber stamp style badges — use for "Est. 2025", product labels, status indicators.

```css
/* Stamp badge */
.badge-stamp {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  font-family: 'Inter', sans-serif;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--brand-gold);
  border: 1.5px solid var(--brand-gold);
  padding: 0.25rem 0.75rem;
  border-radius: 1px;
  opacity: 0.85;
}

/* Circular stamp */
.badge-stamp-circle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: 2px solid var(--brand-gold);
  box-shadow: inset 0 0 0 4px var(--brand-parchment),
              inset 0 0 0 6px var(--brand-gold);
  font-family: 'Inter', sans-serif;
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--brand-gold);
  text-align: center;
  line-height: 1.3;
}
```

---

### 6. Hover Interactions — Subtle Life

Add gentle hover states that feel hand-crafted, not tech-startup bouncy.

```css
/* Card lift on hover — very subtle */
.card-lift {
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}
.card-lift:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(26, 43, 74, 0.1);
}

/* Gold underline on text links */
.link-gold {
  color: var(--brand-charcoal);
  text-decoration: none;
  background-image: linear-gradient(var(--brand-gold), var(--brand-gold));
  background-size: 0% 1px;
  background-repeat: no-repeat;
  background-position: left bottom;
  transition: background-size 0.3s ease;
}
.link-gold:hover {
  background-size: 100% 1px;
  color: var(--brand-navy);
}

/* Button press effect */
.btn-primary:active {
  transform: translateY(1px);
}

/* Nav link gold sweep */
.nav-link {
  position: relative;
}
.nav-link::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 0;
  height: 1px;
  background: var(--brand-gold);
  transition: width 0.25s ease;
}
.nav-link:hover::after { width: 100%; }
```

---

### 7. Section Backgrounds — Layered Depth

Alternate between three background treatments to create visual rhythm without using color:

```css
/* Treatment 1 — Pure parchment (with texture) */
.bg-parchment { background: var(--brand-parchment); }

/* Treatment 2 — Deep navy (with texture) */
.bg-navy { background: var(--brand-navy); }

/* Treatment 3 — Cream white (clean, breathable) */
.bg-cream { background: var(--brand-cream); }

/* Treatment 4 — Navy with diagonal line pattern */
.bg-navy-lined {
  background-color: var(--brand-navy);
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 20px,
    rgba(200, 148, 42, 0.03) 20px,
    rgba(200, 148, 42, 0.03) 21px
  );
}

/* Treatment 5 — Parchment with subtle grid */
.bg-parchment-grid {
  background-color: var(--brand-parchment);
  background-image:
    linear-gradient(rgba(26,43,74,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(26,43,74,0.04) 1px, transparent 1px);
  background-size: 40px 40px;
}
```

**Recommended page section order:**
1. Hero — navy with texture
2. Features — parchment with grid
3. Product 1 (StriverRS) — cream
4. Product 2 (ClimbRS) — parchment
5. Testimonials — navy lined
6. CTA — navy solid
7. Footer — charcoal

---

### 8. Typography Enhancements

```css
/* Oversized decorative quote marks */
.pull-quote {
  position: relative;
  font-family: 'EB Garamond', serif;
  font-size: clamp(1.2rem, 2.5vw, 1.6rem);
  font-style: italic;
  color: var(--brand-navy);
  padding: 1.5rem 2rem;
  border-left: 3px solid var(--brand-gold);
}
.pull-quote::before {
  content: '\201C';
  font-family: 'Playfair Display', serif;
  font-size: 5rem;
  color: var(--brand-gold);
  position: absolute;
  top: -1rem;
  left: 0.5rem;
  line-height: 1;
  opacity: 0.4;
}

/* Highlighted text — gold marker effect */
.text-highlight {
  background: linear-gradient(
    to bottom,
    transparent 60%,
    rgba(200, 148, 42, 0.25) 60%
  );
  padding-bottom: 0.1em;
}

/* Spaced caps — for section labels */
.text-label {
  font-family: 'Inter', sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--brand-gold);
}
```

---

### 9. The Hero Section — Full Treatment

The hero is the one place you can be bold. Navy background, large Playfair headline, gold accent, parchment texture, badge.

```html
<section class="hero bg-navy section-navy">
  <!-- Est. badge -->
  <div class="badge-stamp" style="margin-bottom: 2rem">Est. 2025</div>

  <!-- Main headline — massive -->
  <h1 class="hero-headline">
    Old school hustle.<br>
    <em style="color: var(--brand-gold)">New school AI.</em>
  </h1>

  <!-- Ornamental divider -->
  <div class="ornament-divider" style="max-width: 300px; margin: 1.5rem auto">
    <span class="ornament-line"></span>
    <span style="color: var(--brand-gold); font-size: 0.5rem">◆</span>
    <span class="ornament-line"></span>
  </div>

  <!-- Sub-headline in Cormorant italic -->
  <p class="text-tagline">
    AI-powered tools for people who don't sit still.
  </p>

  <!-- Product badges -->
  <div style="display: flex; gap: 1rem; justify-content: center; margin: 2rem 0">
    <span class="badge-stamp">StriverRS</span>
    <span class="badge-stamp">ClimbRS</span>
  </div>

  <!-- CTAs -->
  <div class="hero-cta">
    <button class="btn-gold">Put us to work</button>
    <button class="btn-secondary" style="color: var(--brand-parchment); border-color: var(--brand-parchment); opacity: 0.7">
      See how it works
    </button>
  </div>
</section>
```

---

### 10. Visual Do's and Don'ts (Addendum)

**DO add visual interest with:**
- Texture overlays (noise/grain) at very low opacity
- Gold rule lines between sections
- Oversized decorative letterforms in backgrounds
- Double-border engraving effect on featured cards
- Stamp badges for labels and callouts
- Subtle card lift on hover (3px max)
- Gold underline sweep on text links
- Pull quotes with oversized quotation marks
- Alternating section backgrounds (navy / parchment / cream)

**DON'T:**
- Add drop shadows heavier than `0 4px 12px rgba(0,0,0,0.08)`
- Use more than one animated element per section
- Use background images that compete with text
- Add color gradients (keep backgrounds flat + texture)
- Use more than 3 background treatments on one page
- Make hover animations faster than 0.2s or slower than 0.4s
- Use the circular stamp badge more than once per page — it loses impact

---

*Raike & Sons Brand Guide v7.1 — Est. 2025*
*"Old school hustle. New school AI."*
*Products: StriverRS + ClimbRS*
*RS suffix = Raike & Sons in every product name*

---

## Do's and Don'ts

### DO:
- Use Playfair Display for all major headlines
- Keep corners slightly square (border-radius: 2px-4px max for most elements)
- Use gold sparingly — it's an accent, not a primary color
- Let parchment backgrounds breathe with generous padding
- Write short, declarative sentences
- Lean into the vintage/craftsman aesthetic in illustrations and imagery
- Use "Est. 2025" as a recurring self-aware joke element

### DON'T:
- Use rounded pill-shaped buttons (too modern/SaaS-y)
- Use gradients — flat colors only (except very subtle background texture)
- Use bright/saturated colors from outside the palette
- Write marketing speak or use AI buzzwords in copy
- Use more than 2-3 fonts in any single component
- Make everything gold — it loses impact
- Use sans-serif for any headline over 1.5rem
- Use shadows heavier than `box-shadow: 0 2px 8px rgba(26,43,74,0.08)`

---

## Implementation Notes for Claude Code

### Tech Stack Recommendations
- **CSS Framework:** Tailwind CSS (configure with custom colors) or vanilla CSS with the custom properties above
- **Font Loading:** Use Google Fonts with `display=swap` for performance
- **Icons:** Lucide icons for UI elements; supplement with SVG versions of vintage imagery
- **Images:** WebP format, lazy loading, with fallback to vintage-treated JPG

### Key Files to Create
1. `brand.css` or `tokens.css` — CSS custom properties (all colors, fonts, spacing)
2. `components.css` — reusable component styles (buttons, cards, badges)
3. `logo.svg` — the brand mark SVG
4. `divider.svg` — the ornamental divider element

### Responsive Breakpoints
```css
/* Mobile first */
/* sm: 640px, md: 768px, lg: 1024px, xl: 1280px */
/* Content max-width: 1100px */
/* Typography uses clamp() for fluid scaling */
```

### Accessibility Notes
- Navy on parchment: ✅ WCAG AA compliant (contrast 8.5:1)
- Gold on navy: ✅ WCAG AA compliant (contrast 5.2:1)
- Gold on parchment: ⚠️ Check — use darker gold `#A07820` if needed for text
- All decorative elements should have `aria-hidden="true"`
- Maintain minimum 44px touch targets on mobile

---

*Raike & Sons Brand Guide v2.0 — Est. 2025*  
*"Old school hustle. New school AI."*  
*Products: StriverRS + ClimbRS*
