# Raike & Sons — Complete Brand Guide for Claude Code

## Brand Overview

**Brand Name:** Raike & Sons  
**Tagline:** "Old school hustle. New school AI."  
**Domain:** raikeandsons.ai  
**Founded:** Est. 2025  
**Products:** StriveRS (AI task manager) + ClimbRS (AI career/resume tool)  
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
| StriveRS badge | StriveRS product pages and marketing |
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

### 4. StriveRS Product Badge

```html
<!-- Light version -->
<div class="product-badge product-badge-light">
  <div class="pb-parent">Raike &amp; Sons</div>
  <div class="pb-name">Strive<span class="pb-rs">RS</span></div>
  <div class="pb-rule"></div>
  <div class="pb-tagline">Never stops striving.</div>
</div>

<!-- Dark version -->
<div class="product-badge product-badge-dark">
  <div class="pb-parent">Raike &amp; Sons</div>
  <div class="pb-name">Strive<span class="pb-rs">RS</span></div>
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

Same HTML/CSS as StriveRS badge above. Just change the text content:

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
    <a href="/strivers" class="nav-link">StriveRS</a>
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

#### StriveRS Product Header

Use the **StriveRS product badge (compact)** on the left, with a small "by Raike & Sons" attribution below.

```html
<header class="navbar navbar-product navbar-strivers">
  <!-- LEFT: Product badge — compact version -->
  <a href="/strivers" class="navbar-brand">
    <div class="product-badge-nav product-badge-nav-light">
      <div class="pbn-parent">by Raike &amp; Sons</div>
      <div class="pbn-name">Strive<span class="pbn-rs">RS</span></div>
    </div>
  </a>

  <!-- CENTER: Nav links -->
  <nav class="navbar-nav">
    <a href="/strivers/features" class="nav-link">Features</a>
    <a href="/strivers/pricing" class="nav-link">Pricing</a>
    <a href="/strivers/docs" class="nav-link">Docs</a>
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

Same structure as StriveRS, different badge.

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
| StriveRS marketing page | `navbar navbar-product navbar-strivers` | Dark, copper border, StriveRS badge |
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
│  StriveRS product page:                                          │
│  [ by Raike & Sons ]   Features  Pricing  Docs  [ Start striving]│
│  [ StriveRS       ]                                              │
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
    <div class="pb-name">Strive<span class="pb-rs">RS</span></div>
    <div class="pb-rule"></div>
    <div class="pb-tagline">Never stops striving.</div>
  </div>
  <div class="product-badge product-badge-dark">
    <div class="pb-parent">Raike &amp; Sons</div>
    <div class="pb-name">Strive<span class="pb-rs">RS</span></div>
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
- "Raike & Sons StriveRS" — never stops striving
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

For **StriveRS** specifically:
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
- StriveRS — task management
- ClimbRS — career/resume
- Future: NetworkRS, LearnRS, TrackRS, BuildRS, EarnRS...

---

### StriveRS — AI Task Manager

**Full product name:** Raike & Sons StriveRS
**Reads as:** "StriveRS" — Striver + RS (Raike & Sons)
**Tagline:** "Never stops striving."
**Sub-tagline:** "Built for people who don't sit still."
**Sub-brand color accent:** Copper `#9E6B3B`
**Domain:** strivers.ai + strivers.com

**The concept:**
A striver never settles, never sits still, never accepts "good enough." StriveRS is the AI that embodies that energy — relentless, always pushing tasks forward, never letting work pile up. The name says it: you're a striver, and this is the tool built for people like you. The RS is Raike & Sons baked right into the word.

**Voice for StriveRS:**
- Short, ambitious, restless energy
- Speaks to the person's drive, not just the tool's features
- Examples:
  - "On it."
  - "Already handled."
  - "3 tasks cleared while you were in that meeting."
  - "StriveRS never stops."
  - "Built for people who don't sit still."
  - "Put your StriveRS to work."

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
> *"StriveRS keeps you moving. ClimbRS gets you rising."*

**Extended brand narrative:**
> *At Raike & Sons, we built two tools for people who don't sit still. StriveRS keeps the work moving — relentless, handled, never piling up. ClimbRS shapes your career — taking raw experience and making something that gets you in the room. Both powered by AI. Both built by Raike & Sons. Both carry our initials — because everything we make, we stand behind.*

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
3. Product 1 (StriveRS) — cream
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
    <span class="badge-stamp">StriveRS</span>
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

*Raike & Sons Brand Guide v8.0 — Est. 2025*
*"Old school hustle. New school AI."*
*Products: StriveRS + ClimbRS*
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
- **Icons:** Marketing site: Lucide icons for UI elements; supplement with SVG versions of vintage imagery. **StriveRS app: emoji-based icons only** (see Application Design System §11)
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

*Raike & Sons Brand Guide v8.0 — Est. 2025*
*"Old school hustle. New school AI."*
*Products: StriveRS + ClimbRS*

---

## Application Design System (StriveRS)

> This section documents the design tokens, component patterns, and responsive rules used in the **StriveRS application UI**. The marketing site sections above use CSS-based styling with Tailwind classes; the app itself uses **React inline styles** with a JavaScript theme system. These are two distinct design vocabularies — this section is the single source of truth for the application.

**Source of truth files:**
- `juggler-frontend/src/theme/colors.js` — theme tokens
- `juggler-frontend/src/state/constants.js` — priority colors, status options, location tints
- `juggler-frontend/src/hooks/useIsMobile.js` — mobile breakpoint

#### Dark / Light Mode Architecture

The app ships with **two complete visual themes** toggled by a single boolean (`darkMode`). Dark mode is the default. The toggle lives in the header bar.

**How it works:**
1. `getTheme(darkMode)` returns either `THEME_DARK` or `THEME_LIGHT` — an object with 50+ color properties
2. Every component receives `darkMode` as a prop and calls `getTheme()` to get the active theme
3. All styling references `theme.propertyName` — components never hardcode light vs dark values
4. The `BRAND` constants (gold, navy, parchment, etc.) are shared across both themes for brand identity elements

**Design philosophy by mode:**

| Aspect | Dark Mode (default) | Light Mode |
|--------|-------------------|------------|
| **Primary bg** | Deep navy `#0F1520` | Warm parchment `#F5F0E8` |
| **Card surfaces** | Dark navy `#162035` | Warm cream `#FDFAF5` |
| **Text** | Parchment `#E8E0D0` | Navy `#1A2B4A` |
| **Borders** | Navy-light `#2E4A7A` | Parchment-dark `#E8E0D0` |
| **Shadows** | Heavy `rgba(0,0,0,0.3)` | Subtle `rgba(26,43,74,0.08)` |
| **Accent** | Gold `#C8942A` (both) | Gold `#C8942A` (both) |
| **Accent hover** | Lighter gold `#E8C878` | Darker copper `#9E6B3B` |
| **Semantic colors** | Bright on dark (e.g., green `#6EE7B7` on `#0A3622`) | Dark on light (e.g., green `#2D6A4F` on `#D1FAE5`) |
| **Header** | Always dark — bg `#0F1520` | Always dark — bg `#1A2B4A` |
| **Personality** | Rich, moody, cinematic | Warm, papery, vintage office |

**Three categories of color in the app:**
1. **Theme tokens** (`theme.bg`, `theme.text`, etc.) — change between dark/light. Used for all UI chrome.
2. **BRAND constants** (`BRAND.gold`, `BRAND.navy`) — fixed regardless of theme. Used for brand identity (logo, footer, accent).
3. **Semantic constants** (`PRI_COLORS`, `STATUS_OPTIONS`, `LOC_TINT`) — fixed regardless of theme. Used for data-driven UI (priority badges, status toggles, location tints). These use paired light/dark values internally (e.g., `bg` vs `bgDark`).

---

### 1. Theme Tokens (Dark / Light)

The app supports two themes. **Dark mode is the default.** Themes are selected via `getTheme(darkMode)` from `colors.js`. All component styles reference theme properties — never raw color values (except for shared constants like `PRI_COLORS`).

#### BRAND Constants (shared between themes)

| Token | Value | Usage |
|-------|-------|-------|
| `navy` | `#1A2B4A` | Light-mode header bg, text color |
| `navyLight` | `#2E4A7A` | Borders, secondary navy |
| `gold` | `#C8942A` | Accent / brand color (both themes) |
| `goldLight` | `#E8C878` | Accent hover (dark), highlight |
| `copper` | `#9E6B3B` | Accent hover (light), secondary warm |
| `parchment` | `#F5F0E8` | Light-mode primary bg |
| `parchmentDark` | `#E8E0D0` | Light-mode borders, tertiary bg |
| `cream` | `#FDFAF5` | Light-mode card bg, input bg |
| `charcoal` | `#2C2B28` | Light-mode secondary text |
| `charcoalMuted` | `#5C5A55` | Light-mode muted text |
| `success` | `#2D6A4F` | Semantic green |
| `warning` | `#C8942A` | Semantic amber (same as gold) |
| `error` | `#8B2635` | Semantic red |

#### Dark Theme (`THEME_DARK`)

| Token | Value | Usage |
|-------|-------|-------|
| `bg` | `#0F1520` | Primary background |
| `bgSecondary` | `#162035` | Modal/panel backgrounds |
| `bgTertiary` | `#1E2D4A` | Hover states, kbd backgrounds |
| `bgCard` | `#162035` | Card surfaces |
| `bgHover` | `#1E2D4A` | Hover highlight |
| `text` | `#E8E0D0` | Primary text |
| `textSecondary` | `#B0A898` | Secondary text |
| `textMuted` | `#8A8070` | Muted / label text |
| `textDim` | `#6A6055` | Very low-contrast text |
| `muted2` | `#6B7280` | Additional muted gray |
| `border` | `#2E4A7A` | Primary borders |
| `borderLight` | `#1E2D4A` | Subtle borders |
| `accent` | `#C8942A` | Brand accent (gold) |
| `accentHover` | `#E8C878` | Accent hover state |
| `success` | `#2D6A4F` | Success semantic |
| `warning` | `#C8942A` | Warning semantic |
| `error` | `#8B2635` | Error semantic |
| `card` | `#162035` | Card background |
| `cardHover` | `#1E2D4A` | Card hover |
| `input` | `#0F1520` | Input background |
| `inputBg` | `#0F1520` | Input background (alias) |
| `inputBorder` | `#2E4A7A` | Input border |
| `inputText` | `#E8E0D0` | Input text color |
| `headerBg` | `#0F1520` | App header background |
| `shadow` | `rgba(0,0,0,0.3)` | Shadow color |
| `btnBg` | `#1E2D4A` | Button background |
| `btnBorder` | `#2E4A7A` | Button border |
| `btnText` | `#E8E0D0` | Button text |
| `blueBg` | `#1A2B4A` | Blue semantic bg |
| `blueText` | `#E8C878` | Blue semantic text |
| `blueBorder` | `#2E4A7A` | Blue semantic border |
| `greenBg` | `#0A3622` | Green semantic bg |
| `greenText` | `#6EE7B7` | Green semantic text |
| `greenBorder` | `#2D6A4F` | Green semantic border |
| `amberBg` | `#3A2A08` | Amber semantic bg |
| `amberText` | `#E8C878` | Amber semantic text |
| `amberBorder` | `#C8942A` | Amber semantic border |
| `redBg` | `#3A0A10` | Red semantic bg |
| `redText` | `#FCA5A5` | Red semantic text |
| `redBorder` | `#8B2635` | Red semantic border |
| `purpleBg` | `#2E1065` | Purple semantic bg |
| `purpleText` | `#C4B5FD` | Purple semantic text |
| `purpleBorder` | `#7C3AED` | Purple semantic border |
| `badgeBg` | `#334155` | Neutral badge background (duration, date) |
| `badgeText` | `#94A3B8` | Neutral badge text |
| `projectBadgeBg` | `#1E3A5F` | Project badge background |
| `projectBadgeText` | `#93C5FD` | Project badge text |
| `headerText` | `#F5F0E8` | Text on header (always light) |
| `headerTextMuted` | `rgba(255,255,255,0.7)` | Muted text on header |
| `headerTrack` | `rgba(255,255,255,0.15)` | Progress bar track / subtle header borders |

#### Light Theme (`THEME_LIGHT`)

| Token | Value | Usage |
|-------|-------|-------|
| `bg` | `#F5F0E8` | Primary background (parchment) |
| `bgSecondary` | `#FDFAF5` | Modal/panel backgrounds (cream) |
| `bgTertiary` | `#E8E0D0` | Hover states, kbd backgrounds |
| `bgCard` | `#FDFAF5` | Card surfaces |
| `bgHover` | `#E8E0D0` | Hover highlight |
| `text` | `#1A2B4A` | Primary text (navy) |
| `textSecondary` | `#2C2B28` | Secondary text (charcoal) |
| `textMuted` | `#5C5A55` | Muted / label text |
| `textDim` | `#8A8070` | Very low-contrast text |
| `muted2` | `#6B7280` | Additional muted gray |
| `border` | `#E8E0D0` | Primary borders |
| `borderLight` | `#F5F0E8` | Subtle borders |
| `accent` | `#C8942A` | Brand accent (gold) |
| `accentHover` | `#9E6B3B` | Accent hover state (copper) |
| `success` | `#2D6A4F` | Success semantic |
| `warning` | `#C8942A` | Warning semantic |
| `error` | `#8B2635` | Error semantic |
| `card` | `#FDFAF5` | Card background |
| `cardHover` | `#F5F0E8` | Card hover |
| `input` | `#FDFAF5` | Input background |
| `inputBg` | `#FDFAF5` | Input background (alias) |
| `inputBorder` | `#E8E0D0` | Input border |
| `inputText` | `#1A2B4A` | Input text color |
| `headerBg` | `#1A2B4A` | App header background (navy) |
| `shadow` | `rgba(26,43,74,0.08)` | Shadow color |
| `btnBg` | `#FDFAF5` | Button background |
| `btnBorder` | `#E8E0D0` | Button border |
| `btnText` | `#1A2B4A` | Button text |
| `blueBg` | `#E8E0D0` | Blue semantic bg |
| `blueText` | `#1A2B4A` | Blue semantic text |
| `blueBorder` | `#C8942A` | Blue semantic border |
| `greenBg` | `#D1FAE5` | Green semantic bg |
| `greenText` | `#2D6A4F` | Green semantic text |
| `greenBorder` | `#2D6A4F` | Green semantic border |
| `amberBg` | `#FEF3C7` | Amber semantic bg |
| `amberText` | `#9E6B3B` | Amber semantic text |
| `amberBorder` | `#C8942A` | Amber semantic border |
| `redBg` | `#FEE2E2` | Red semantic bg |
| `redText` | `#8B2635` | Red semantic text |
| `redBorder` | `#8B2635` | Red semantic border |
| `purpleBg` | `#EDE9FE` | Purple semantic bg |
| `purpleText` | `#5B21B6` | Purple semantic text |
| `purpleBorder` | `#7C3AED` | Purple semantic border |
| `badgeBg` | `#F1F5F9` | Neutral badge background (duration, date) |
| `badgeText` | `#64748B` | Neutral badge text |
| `projectBadgeBg` | `#DBEAFE` | Project badge background |
| `projectBadgeText` | `#1E40AF` | Project badge text |
| `headerText` | `#F5F0E8` | Text on header (always light) |
| `headerTextMuted` | `rgba(255,255,255,0.7)` | Muted text on header |
| `headerTrack` | `rgba(255,255,255,0.15)` | Progress bar track / subtle header borders |

---

### 2. App Typography Scale

The app uses a **pixel-based type scale** (not rem/clamp like the marketing site). Font sizes increase on mobile for touch readability.

#### Font Families

| Font | Usage | Where |
|------|-------|-------|
| `'Inter', sans-serif` | Primary UI font — controls, tabs, pills, labels | NavigationBar, filter pills, throughout |
| `'Playfair Display', serif` | Logo text and modal titles only | HelpModal title, ImportExportPanel title |
| `'EB Garamond', serif` | Help modal section headers | HelpModal section headings |
| `'inherit'` | Buttons and inputs (inherits Inter from body) | TaskEditForm, ConfirmDialog |
| `monospace` | Code/data display, JSON preview, kbd shortcuts | ImportExportPanel textarea, HelpModal kbd |

#### Type Scale

| Size | Weight | Usage | Mobile Override |
|------|--------|-------|-----------------|
| 8px | 600 | Form field labels (`lStyle`) | — |
| 9px | 600–700 | Badge text (project, duration, priority, due, status) | — |
| 10px | 600–700 | Small button text (save, delete, toggle), location icons, WIP badge | — |
| 11px | 400–600 | Base input text, filter pills, nav tabs (desktop), settings tabs | — |
| 12px | 400–600 | Task card title (desktop), settings tab text, textarea, import buttons | 13px on mobile |
| 13px | 500–600 | Nav tab text (mobile), confirm dialog buttons, toast text, input text (mobile) | — |
| 14px | 400 | Confirm dialog message text | — |
| 16px | 700 | Settings panel title, section headers | — |
| 18px | 700 | Modal titles (Playfair Display), help section headers (EB Garamond) | — |
| 20px | — | Close button (×) character | 24px on mobile |

#### Letter Spacing

- `0.03em` — Navigation tabs (subtle widening for legibility at small sizes)

---

### 3. Button System

All buttons use `cursor: 'pointer'` and `fontFamily: 'inherit'`. No global button reset — all styling is inline. Button colors reference theme tokens and automatically adapt to dark/light mode. The gold accent (`theme.accent`) is the primary action color in both themes.

#### Primary Action Button
> Save, Create task

```
fontSize: 10
fontWeight: 700
padding: '4px 14px'
border: 'none'
borderRadius: 4
background: theme.accent (#C8942A)  |  #10B981 for Create
color: 'white'
```

#### Destructive Button
> Delete task

```
fontSize: 10
fontWeight: 600
padding: '4px 10px'
border: '1px solid #DC2626'
borderRadius: 4
background: theme.redBg
color: theme.redText
```

#### Cancel / Secondary Button (Dialog)
> Cancel in ConfirmDialog

```
fontSize: 13
padding: '8px 20px'
border: '1px solid ' + theme.border
borderRadius: 8
background: 'transparent'
color: theme.textSecondary
```

#### Confirm Button (Dialog)
> Destructive confirm action

```
fontSize: 13
fontWeight: 600
padding: '8px 20px'
border: 'none'
borderRadius: 8
background: theme.error
color: '#FFF'
```

#### Status Toggle Buttons
> 5-state toggle row (Open, Done, WIP, Cancel, Skip)

```
Compact:  width/height: 16, fontSize: 8, gap: 1
Desktop:  width/height: 22, fontSize: 12, gap: 3
Mobile:   width/height: 28, fontSize: 14, gap: 3
borderRadius: 4
fontWeight: 700
transition: 'background 0.1s, color 0.1s, border-color 0.1s'
Active border:   1.5px solid [status color]
Inactive border: 1px solid (dark: #475569 | light: #94A3B8)
Active bg:       [status-specific, see Status Colors section]
Inactive bg:     dark: #1E293B | light: #FFFFFF
```

#### Navigation View Tabs
> Day, Week, List, Priority, Conflicts tabs

```
fontSize: desktop 11 | mobile 13
fontWeight: 700 (active) | 400 (inactive)
padding: desktop '5px 10px' | mobile '5px 0'
borderRadius: 2
letterSpacing: '0.03em'
fontFamily: "'Inter', sans-serif"
Active:   background: theme.accent, color: '#1A2B4A'
Inactive: background: 'transparent', color: theme.textMuted
Mobile: minHeight: 32, flex: 1, textAlign: 'center'
```

#### Filter Pills
> Project filter, status filter, priority filter

```
fontSize: 11
padding: '3px 10px'
borderRadius: 2
fontFamily: "'Inter', sans-serif"
whiteSpace: 'nowrap'
Active:   border: '1px solid ' + theme.accent, background: theme.accent + '20', color: theme.accent
Inactive: border: '1px solid ' + theme.border, background: 'transparent', color: theme.textMuted
```

#### Icon / Close Button
> Modal close (×)

```
fontSize: 20
border: 'none'
background: 'transparent'
color: theme.textMuted
```

#### Settings Tabs
> Locations, Tools, Matrix, Projects, Templates, Preferences

```
fontSize: 12
fontWeight: active 600 | inactive 400
padding: '5px 12px'
borderRadius: 6
border: 'none'
fontFamily: 'inherit'
whiteSpace: 'nowrap'
Active:   background: theme.accent, color: '#FFF'
Inactive: background: 'transparent', color: theme.textSecondary
```

#### Toggle Button (Form)
> When-tags, location/tool toggles in TaskEditForm

```
height: desktop 26 | mobile 30
padding: '0 8px'
borderRadius: 4
fontSize: 10
fontWeight: on 600 | off 400
fontFamily: 'inherit'
On:  border: '2px solid [color]', background: [color] + '22', color: [color]
Off: border: '1px solid ' + theme.btnBorder, background: theme.bgCard, color: theme.textMuted
```

#### Import/Export Panel Buttons
> Export JSON, Export ICS, Import

```
fontSize: 13
fontWeight: 600
padding: '10px 20px'
borderRadius: 2
fontFamily: 'inherit'
Default:  border: '1px solid ' + theme.border, background: 'transparent', color: theme.text
Primary:  border: 'none', background: theme.accent, color: '#FFF'
Success:  border: 'none', background: theme.success, color: '#FFF' (fontSize: 12, padding: '8px 16px')
```

#### Dark/Light Note: Header Bar

The **header bar is always dark** regardless of theme — it uses `theme.headerBg` (dark: `#0F1520`, light: `#1A2B4A`). Text and icons inside the header use dedicated header tokens that always render as light-on-dark:
- `theme.headerText` (`#F5F0E8`) — primary text, logo
- `theme.headerTextMuted` (`rgba(255,255,255,0.7)`) — secondary text, icon buttons
- `theme.headerTrack` (`rgba(255,255,255,0.15)`) — progress bar track, subtle borders
- `theme.accent` — gold elements (logo "RS", selected day, progress fill, sync indicator)
- `BRAND.goldLight` (`#E8C878`) — today highlight in the inline week strip

Header icon buttons (settings, export, help, dark mode toggle) use `theme.headerTextMuted` for their color. The add-task button (+) keeps a bright green for visibility. The overflow menu dropdown on mobile uses standard theme tokens (it pops over the content area, not the header).

---

### 4. Dialog / Modal System

All modals use a fixed-position overlay with centered content. **On mobile, all modals go full-screen** (width/height: 100%, borderRadius: 0, no shadow). Modal backgrounds use `theme.bgSecondary` which resolves to dark navy (`#162035`) in dark mode and warm cream (`#FDFAF5`) in light mode. The backdrop overlay (`rgba(0,0,0,0.5)`) is the same in both themes.

#### Common Overlay

```
position: 'fixed'
top: 0, left: 0, right: 0, bottom: 0
background: 'rgba(0,0,0,0.5)'
display: 'flex'
alignItems: 'center'
justifyContent: 'center'
```

#### Settings Panel
> `zIndex: 300`

```
Desktop: width: 700, maxWidth: '95vw', maxHeight: '85vh', borderRadius: 12
Mobile:  width: '100%', height: '100%', borderRadius: 0
background: theme.bgSecondary
boxShadow: desktop '0 8px 32px ' + theme.shadow | mobile 'none'
overflow: 'hidden'
display: 'flex', flexDirection: 'column'
```

#### Help Modal
> `zIndex: 300`

```
Desktop: width: 560, maxWidth: '95vw', maxHeight: '85vh', borderRadius: 2
Mobile:  width: '100%', height: '100%', borderRadius: 0
background: theme.bgSecondary
boxShadow: desktop '0 2px 8px ' + theme.shadow | mobile 'none'
overflow: 'auto'
padding: 20
Title font: 'Playfair Display', serif — 18px, weight 700
Section font: 'EB Garamond', serif — 16px, weight 500
```

#### Confirm Dialog
> `zIndex: 400`

```
Desktop: width: 360, maxWidth: '90vw', borderRadius: 12
Mobile:  width: '100%', height: '100%', borderRadius: 0
background: theme.bgSecondary
boxShadow: desktop '0 8px 32px ' + theme.shadow | mobile 'none'
padding: 24
Message: fontSize 14, lineHeight 1.5
```

#### Import/Export Panel
> `zIndex: 300`

```
Desktop: width: 560, maxWidth: '95vw', maxHeight: '80vh', borderRadius: 2
Mobile:  width: '100%', height: '100%', borderRadius: 0
background: theme.bgSecondary
boxShadow: desktop '0 2px 8px ' + theme.shadow | mobile 'none'
overflow: 'auto'
padding: 20
Title font: 'Playfair Display', serif — 18px, weight 700
```

#### Task Edit Sidebar (Desktop)
> Renders inline within the layout (no overlay), embedded in the right panel

```
height: '100%'
background: theme.bgCard
overflowX: 'hidden'
overflowY: 'auto'
```

#### Task Edit Mobile Overlay
> `zIndex: 600`

```
position: 'fixed'
top: 0, left: 0, right: 0, bottom: 0
background: theme.bgCard
overflowY: 'auto'
```

#### Toast Notification
> `zIndex: 9999` — always on top

```
position: 'fixed'
bottom: desktop 20 | mobile 10
right: desktop 20 | mobile 10
left: mobile 10 | desktop undefined
padding: '10px 16px'
borderRadius: 8
fontSize: 13
fontWeight: 500
color: THEME_DARK.text
boxShadow: '0 4px 12px ' + THEME_DARK.shadow
cursor: 'pointer'

Type colors (always dark-mode styled, uses THEME_DARK/BRAND constants):
  success: bg THEME_DARK.greenBg, border THEME_DARK.greenBorder
  error:   bg THEME_DARK.redBg, border THEME_DARK.redBorder
  info:    bg BRAND.navy, border BRAND.navyLight

History panel:
  background: THEME_DARK.bgSecondary, border: '1px solid ' + THEME_DARK.border
  borderRadius: 8, padding: 8, maxHeight: 200, overflow: 'auto', fontSize: 11
  Entry color: THEME_DARK.badgeText
```

---

### 5. Form Inputs

All form inputs in the app use a base style object (`iStyle`) defined in `TaskEditForm.jsx`.

#### Base Input Style

```
fontSize: desktop 11 | mobile 13
padding: desktop '3px 4px' | mobile '6px 8px'
border: '1px solid ' + theme.inputBorder
borderRadius: 4
background: theme.inputBg
color: theme.inputText
fontFamily: 'inherit'
height: desktop 26 | mobile 30
boxSizing: 'border-box'
maxWidth: '100%'
```

#### Textarea (Import/Export)

```
width: '100%'
minHeight: 120
padding: '8px 10px'
border: '1px solid ' + theme.inputBorder
borderRadius: 2
background: theme.input
color: theme.text
fontSize: 12
fontFamily: 'monospace'
resize: 'vertical'
outline: 'none'
boxSizing: 'border-box'
```

#### Select Inputs

Same as base input style. Native `<select>` elements, no custom dropdowns (except project combobox).

#### Project Combobox

Text input with a dropdown suggestion list. The dropdown appears as an absolute-positioned div below the input with:

```
background: theme.bgCard
border: '1px solid ' + theme.inputBorder
borderRadius: 4
boxShadow: '0 2px 8px ' + theme.shadow
maxHeight: 120, overflow: 'auto'
Each item: padding '3px 8px', fontSize 11, cursor 'pointer'
Hover: background theme.bgHover
```

#### Form Labels

```
fontSize: 8
fontWeight: 600
color: theme.textMuted
display: 'flex'
flexDirection: 'column'
gap: 2
```

---

### 6. Card / Tile System

#### TaskCard

The primary card component used in List, Priority, and Conflicts views. Cards use `theme.bgCard` for their surface — dark navy (`#162035`) in dark mode, warm cream (`#FDFAF5`) in light mode. All badge colors within cards use theme tokens that automatically adapt to the active theme.

```
borderRadius: 6
padding: desktop '6px 10px' | mobile '8px 10px'
background: theme.bgCard (all states — active and done use the same card surface)
boxShadow: '0 1px 3px ' + theme.shadow
transition: 'box-shadow 0.15s'
cursor: 'pointer'
overflow: 'hidden'

Border styles (left border is always 3px solid):
  Normal task:  '1px solid [priColor]40' (40 = 25% alpha hex suffix)
  Habit task:   '1px dashed [priColor]40'
  Marker task:  '1px dotted #8B5CF640'
  Done task:    '1px [style] ' + theme.border

Left accent: '3px solid [priColor]'  (marker: #8B5CF6)
Opacity: done 0.5, marker 0.7, normal 1
Done title: textDecoration 'line-through'
```

**Row 1 — Title + Badges:**
```
fontSize: desktop 12 | mobile 13, lineHeight: 1.3
Title: fontWeight 600, color: theme.text, ellipsis overflow
```

**Badge Sub-Elements (all badges):**

All badges use theme tokens rather than hardcoded colors.

| Badge | fontSize | fontWeight | Theme tokens | borderRadius | padding |
|-------|----------|------------|-------------|--------------|---------|
| Project | 9 | 600 | bg `theme.projectBadgeBg`, text `theme.projectBadgeText` | 3 | `1px 5px` |
| Duration | 10 | 600 | bg `theme.badgeBg`, text `theme.badgeText` | 3 | `1px 5px` |
| Priority | 9 | 700 | bg `[priColor]18`, text `[priColor]` | 3 | `0 4px` |
| Due date | 9 | 600 | bg `theme.amberBg`, text `theme.amberText` | 3 | `1px 4px` |
| Overdue | 9 | 600 | bg `theme.error`, text `#FFF` | 3 | `1px 4px` |
| Reminder | 9 | 600 | bg `theme.purpleBg`, text `theme.purpleText` | 3 | `1px 4px` |
| Flexed | 9 | 600 | bg `theme.amberBg`, text `theme.amberText` | 3 | `1px 4px` |
| WIP remaining | 9 | 700 | bg `theme.amberBg`, text `theme.amberText` | 3 | `1px 5px` |
| Blocked | 10 | 600 | text `theme.redText` | — | — |
| Date | 9 | 600 | bg `theme.badgeBg`, text `theme.badgeText` | 3 | `1px 4px` |

**Blocker Row (overdue dependencies):**
```
marginTop: 4, paddingTop: 4
borderTop: '1px dashed ' + theme.borderLight
fontSize: desktop 10 | mobile 11
Link color: theme.projectBadgeText
textDecoration: 'underline', textDecorationStyle: 'dotted'
Quick-complete button: fontSize desktop 9 | mobile 10, borderRadius 3, padding '0 5px'
  border: '1px solid ' + theme.greenBorder
  background: theme.greenBg
  color: theme.greenText
```

#### Schedule Blocks (Day/Week views)

Schedule blocks in the timeline use absolute positioning within the time grid. They share the card's left-border accent pattern and badge system but are positioned and sized based on time calculations.

#### Unscheduled Entries

Appear below the scheduled timeline. Same card styling as TaskCard but may use a lighter border treatment to visually separate from scheduled items.

---

### 7. Status & State Colors

This section covers colors that are **semantic** — they represent data states (priority, status, location) rather than UI chrome. These colors are defined in `constants.js` and `StatusToggle.jsx`, not in the theme system. Priority colors and location tints are the same in both themes. Status colors and StatusToggle buttons have explicit light/dark variants built into their own definitions (separate from the theme tokens).

#### Priority Colors (`PRI_COLORS`)

| Priority | Color | Usage |
|----------|-------|-------|
| P1 | `#DC2626` | Critical — red |
| P2 | `#D97706` | High — amber |
| P3 | `#2563EB` | Medium — blue (default) |
| P4 | `#6B7280` | Low — gray |

Priority colors are used for the card left border, priority badge bg (at 18 hex alpha = ~9% opacity), and priority badge text.

#### Task Status Colors (`STATUS_OPTIONS`)

| Status | Light bg | Dark bg | Light text | Dark text | Icon |
|--------|----------|---------|------------|-----------|------|
| Open (empty) | `#FFFFFF` | `#1E293B` | `#9CA3AF` | `#7E8FA6` | `—` |
| Done | `#D1FAE5` | `#064E3B` | `#065F46` | `#6EE7B7` | `✓` |
| WIP | `#FEF3C7` | `#78350F` | `#92400E` | `#FCD34D` | `⌛` |
| Cancel | `#FEE2E2` | `#7F1D1D` | `#991B1B` | `#FCA5A5` | `✕` |
| Skip | `#F1F5F9` | `#334155` | `#64748B` | `#94A3B8` | `⏭` |

#### StatusToggle Button Colors (visual button states)

| Status | Light activeBg | Dark activeBg | Light color | Dark color |
|--------|---------------|---------------|-------------|------------|
| Open | `#E5E7EB` | `#374151` | `#4B5563` | `#9CA3AF` |
| Done | `#BBF7D0` | `#064E3B` | `#15803D` | `#6EE7B7` |
| WIP | `#FDE68A` | `#78350F` | `#B45309` | `#FCD34D` |
| Cancel | `#FECACA` | `#7F1D1D` | `#DC2626` | `#FCA5A5` |
| Skip | `#E2E8F0` | `#334155` | `#475569` | `#94A3B8` |

Inactive button: bg `dark: #1E293B | light: #FFFFFF`, color `dark: #64748B | light: #6B7280`, border `dark: #475569 | light: #94A3B8`

#### Location Tints (`LOC_TINT`)

| Location | Color | Alpha | Usage |
|----------|-------|-------|-------|
| Home | `#3B82F6` | `18` (hex) | Blue tint for home blocks |
| Work | `#F59E0B` | `18` | Amber tint for work blocks |
| Transit | `#9CA3AF` | `18` | Gray tint for transit |
| Downtown | `#10B981` | `18` | Green tint for downtown |
| Gym | `#EF4444` | `18` | Red tint for gym |
| Unknown/other | `#8B5CF6` | `18` | Purple fallback |

Alpha is appended as a 2-character hex suffix to the color (e.g., `#3B82F618` = ~9% opacity). Used via `locBgTint(locId, alpha)`.

#### Special State Colors

All special states use theme tokens for automatic dark/light support.

| State | Indicator | Theme Tokens |
|-------|-----------|-------------|
| Blocked | `🚫 blocked` text | `theme.redText` |
| Overdue | `OVERDUE [date]` badge | bg `theme.error`, text `#FFF` |
| Due (not overdue) | `Due [date]` badge | bg `theme.amberBg`, text `theme.amberText` |
| Reminder/Marker | `◇ reminder` badge | bg `theme.purpleBg`, text `theme.purpleText` |
| Flexed | `~ flexed` badge | bg `theme.amberBg`, text `theme.amberText` |
| Marker task | Dotted border, purple accent | borderColor `#8B5CF6`, opacity 0.7 |
| Habit task | Dashed border | Normal priority color, dashed border style |

---

### 8. Spacing System

The app does not use a formal spacing scale — values are chosen per-component. However, these sizes recur consistently:

| Token | Value | Typical Usage |
|-------|-------|---------------|
| xs | 1–2px | StatusToggle gap (compact), badge internal padding |
| sm | 3–4px | Input padding (desktop), badge padding, small gaps |
| md | 6–8px | Card padding, input padding (mobile), inter-element gaps |
| lg | 10–12px | Section padding, card internal padding, modal content spacing |
| xl | 16px | Modal/panel content padding, settings content padding |
| 2xl | 20px | Modal padding (Help, Import/Export) |
| 3xl | 24px | Confirm dialog padding |
| 4xl | 32px | Large layout spacing (rare) |

Common gap values: `1, 2, 3, 4, 6, 8` (used in flex layouts via `gap` property).

---

### 9. Animation / Transition System

All transitions use inline `transition` properties. No CSS keyframe animations.

| Duration | Easing | Property | Usage |
|----------|--------|----------|-------|
| 0.1s | default (ease) | `background`, `color`, `border-color` | StatusToggle button state changes |
| 0.15s | default | `background` | Card/button hover feedback |
| 0.15s | default | `box-shadow` | Card elevation change on hover |
| 0.15s | default | `transform` | Scale/rotation micro-interactions |
| 0.15s | ease | `all` | General smooth transitions |
| 0.2s | default | `all` | Slightly slower all-property transitions |
| 0.2s | default | `background` | Slower background color transitions |
| 0.2s | default | `left` | Positional slide animations |
| 0.3s | default | `width` | Expansion/collapse animations |
| 0.3s | ease | `transform` | Drag-and-drop movement effects |

**Rule:** No transition exceeds 0.3s in the app UI. Use `transition: 'none'` during active drag operations to prevent lag.

---

### 10. Responsive / Mobile System

The app uses a **single breakpoint at 600px** defined via `matchMedia` in `useIsMobile.js`:

```js
var QUERY = '(max-width: 600px)';
```

**This is NOT CSS media queries.** The `isMobile` boolean is passed as a prop throughout the component tree. All responsive behavior is prop-driven in inline styles.

#### Mobile Adaptations

| Pattern | Desktop | Mobile |
|---------|---------|--------|
| Input height | 26px | 30px |
| Input font size | 11px | 13px |
| Input padding | `3px 4px` | `6px 8px` |
| Card title font | 12px | 13px |
| Nav tab font | 11px | 13px |
| Nav tab padding | `5px 10px` | `5px 0` (flex: 1) |
| Nav tab height | auto | minHeight: 32 |
| StatusToggle size | 22×22, font 12 | 28×28, font 14 |
| Close button font | 20px | 24px |
| Blocker row font | 10px | 11px |
| Card padding | `6px 10px` | `8px 10px` |
| Toast position | bottom: 20, right: 20 | bottom: 10, right: 10, left: 10 |

#### Mobile Modal Behavior

All modals and dialogs become **full-screen** on mobile:
- `width: '100%'`, `height: '100%'`
- `borderRadius: 0`
- `boxShadow: 'none'`

The TaskEditForm uses a dedicated full-screen overlay (`zIndex: 600`) on mobile instead of the sidebar panel used on desktop.

#### Touch Targets

Minimum interactive element sizes on mobile:
- StatusToggle buttons: 28×28px
- Nav tabs: minHeight 32px, flex: 1 (full-width)
- Input fields: height 30px
- Toggle buttons: height 30px

---

### 11. Icon System

The app uses **emoji characters** for all icons — there is no icon library (Lucide, FontAwesome, etc.). This keeps the bundle size zero for icons and ensures cross-platform rendering.

> **Note:** The "Lucide icons" recommendation in the Implementation Notes section above applies to the **marketing site only**, not the StriveRS application.

#### Status Icons

| Icon | Character | Unicode | Usage |
|------|-----------|---------|-------|
| Open | ○ | U+25CB | StatusToggle open state |
| Done | ✓ | U+2713 | StatusToggle done state |
| WIP | ⌛ | U+231B | StatusToggle WIP state |
| Cancel | ✕ | U+2715 | StatusToggle cancel state |
| Skip | ⏭ | U+23ED | StatusToggle skip state (STATUS_OPTIONS) |
| Skip (alt) | ⇭ | U+21ED | StatusToggle skip state (StatusToggle.jsx) |
| Dash | — | U+2014 | Open status label |

#### Navigation & Action Icons

| Icon | Character | Usage |
|------|-----------|-------|
| × | &times; | Close button (modal/panel) |
| → | U+2192 | Direction indicator |
| ◇ | U+25C7 | Reminder/marker badge |
| ~ | Tilde | Flexed badge prefix |
| 🚫 | U+1F6AB | Blocked indicator |
| 📌 | U+1F4CC | Fixed time tag |

#### Location Icons

| Icon | Character | Location |
|------|-----------|----------|
| 🏠 | U+1F3E0 | Home |
| 🏢 | U+1F3E2 | Work |
| 🚗 | U+1F697 | Transit / Car |
| 🏙️ | U+1F3D9+FE0F | Downtown |
| 🏋️ | U+1F3CB+FE0F | Gym |

#### Tool Icons

| Icon | Character | Tool |
|------|-----------|------|
| 📱 | U+1F4F1 | Phone / Tablet |
| 💻 | U+1F4BB | Personal PC / Work PC |
| 🖥️ | U+1F5A5+FE0F | Work PC (alt) |
| 🖨️ | U+1F5A8+FE0F | Printer |

#### Time Block Icons

| Icon | Character | Block |
|------|-----------|-------|
| ☀️ | U+2600+FE0F | Morning |
| 💼 | U+1F4BC | Business/Biz |
| 🍽️ | U+1F37D+FE0F | Lunch |
| 🌤️ | U+1F324+FE0F | Afternoon |
| 🌙 | U+1F319 | Evening |
| 🌑 | U+1F311 | Night |

---

### 12. Z-Index System

Layering is managed via inline `zIndex` values. The scale ensures predictable stacking.

| Layer | Z-Index Range | Usage |
|-------|---------------|-------|
| Base content | 0–2 | Default flow, minimal stacking |
| Task blocks | 10–20 | Schedule grid items, timeline blocks |
| Elevated content | 30–60 | Tooltips within content, dropdown triggers |
| Header / Nav | 100 | App header, navigation bar |
| Elevated nav | 150 | Sticky/floating nav elements |
| Dropdowns | 200 | Combobox dropdowns, context menus |
| Modals (standard) | 300 | HelpModal, ImportExportPanel, SettingsPanel |
| Modals (confirm) | 400 | ConfirmDialog (must overlay other modals) |
| Modals (high) | 500 | Stacked/nested modal scenarios |
| Full-screen overlays | 600 | TaskEditForm mobile overlay |
| Toast notifications | 9999 | Always on top |
| System-critical | 10000 | Highest priority (rare) |

**Rule:** Modals requiring user confirmation (ConfirmDialog) must layer above content modals. The TaskEditForm mobile overlay at 600 sits above standard modals because it replaces the entire view. Toasts at 9999 are always visible.

---

### 13. Shadow / Elevation System

Shadows use `theme.shadow` for theme-aware opacity. Dark theme shadows are more opaque (`rgba(0,0,0,0.3)`) than light theme (`rgba(26,43,74,0.08)`).

| Level | Shadow Value | Usage |
|-------|-------------|-------|
| **Level 0** — Flat | `none` | Mobile modals, disabled states |
| **Level 1** — Card | `0 1px 3px [theme.shadow]` | TaskCard, small elements |
| **Level 2** — Dropdown | `0 2px 8px [theme.shadow]` | HelpModal, ImportExportPanel, combobox dropdown |
| **Level 3** — Modal | `0 8px 32px [theme.shadow]` | SettingsPanel, ConfirmDialog |
| **Level 4** — Toast | `0 4px 12px THEME_DARK.shadow` | Toast notifications (always dark-styled) |

Additional shadow values used in specific contexts:
- `0 1px 2px [theme.shadow]` — Minimal depth
- `0 1px 4px [theme.shadow]` — Subtle elevation
- `0 4px 16px [theme.shadow]` — Prominent floating elements
- `0 6px 20px [theme.shadow]` — Highly elevated elements
- `inset 0 0 0 4px #F5F0E8, inset 0 0 0 5px #C8942A` — Focus ring (marketing site pattern)

**Rule:** On mobile, all modals use `boxShadow: 'none'` since they go full-screen and don't need depth cues.

---

*End of Application Design System section*
