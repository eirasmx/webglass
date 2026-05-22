# 🪙 Tokens Reference

All WebGlass configuration is done through CSS custom properties (tokens). Set them in a `<style>` block or your stylesheet — not in inline `style=` attributes.

---

## ⚡ Quick reference

| Token | Default | Range |
|---|---|---|
| `--wg-render` | *(unset)* | `true` or unset |
| `--wg-shape` | `squircle` | `squircle` `circle` `lip` `concave` |
| `--wg-refraction` | `1.45` | `1.0` – `2.2` |
| `--wg-bezel` | `0.28` | `0.05` – `0.55` |
| `--wg-scale` | `40` | `5` – `120` |
| `--wg-blur` | `10` | `0` – `30` |
| `--wg-light-angle` | `-55` | `-180` – `180` |
| `--wg-specular-strength` | `0.65` | `0` – `1` |
| `--wg-specular-width` | `0.25` | `0` – `1` |
| `--wg-specular-edge` | `0.05` | `0` – `1` |
| `--wg-specular-back` | `0.20` | `0` – `1` |
| `--wg-bg-opacity` | `0.15` | `0` – `1` |

---

## 🔍 Token details

### `--wg-render`

Enables the glass effect. Must be set to `true` — the effect is off by default.

CSS cascades normally, so setting it on `:root` enables every `.glass` element on the page. Set it on a specific container to limit the scope.

```css
/* Enable sitewide */
:root { --wg-render: true; }

/* Enable only inside .hero */
.hero { --wg-render: true; }
```

---

### 🔷 `--wg-shape`

The surface profile used to compute refraction and the specular highlight shape.

```css
--wg-shape: squircle;  /* Default. Apple-style, smooth curvature */
--wg-shape: circle;    /* Dome lens, strongest central refraction */
--wg-shape: lip;       /* Raised rim with shallow interior dip */
--wg-shape: concave;   /* Inverted — refracts outward */
```

See [Shapes](./shapes.md) for a full comparison.

---

### 🌊 `--wg-refraction`

How strongly the glass bends light. `1.0` is air (no bending). Real glass is around `1.5`. Higher values produce a more dramatic fish-eye distortion.

```css
--wg-refraction: 1.2;   /* Subtle */
--wg-refraction: 1.45;  /* Default — natural glass */
--wg-refraction: 1.8;   /* Strong */
--wg-refraction: 2.2;   /* Maximum — dense crystal */
```

---

### 📐 `--wg-bezel`

How wide the refracting rim is, as a fraction of the element's shorter side. `0.0` means no bezel (no effect visible). `0.5` means the bezel covers half the element on each side.

```css
--wg-bezel: 0.15;  /* Thin rim */
--wg-bezel: 0.28;  /* Default */
--wg-bezel: 0.45;  /* Wide, dome-like */
```

---

### 📏 `--wg-scale`

The pixel magnitude of the SVG displacement map — how far background pixels get shifted. Higher values make the refraction more visible but can look distorted if overdone.

```css
--wg-scale: 20;   /* Gentle */
--wg-scale: 40;   /* Default */
--wg-scale: 80;   /* Strong shift */
```

---

### 🌫️ `--wg-blur`

The `backdrop-filter: blur()` radius in pixels. Blurs whatever is behind the element.

```css
--wg-blur: 0;   /* No blur — just refraction */
--wg-blur: 10;  /* Default */
--wg-blur: 24;  /* Heavy frost */
```

---

### 💡 `--wg-light-angle`

The angle of the light source in degrees, measured clockwise from the right. Controls where the specular highlight appears on the rim. The counter-highlight (`--wg-specular-back`) is always exactly 180° opposite.

```css
--wg-light-angle: -55;   /* Default — upper left */
--wg-light-angle: 0;     /* Right */
--wg-light-angle: 90;    /* Bottom */
--wg-light-angle: -90;   /* Top */
```

---

### ✨ `--wg-specular-strength`

Intensity of the primary rim highlight. `0` turns it off entirely.

```css
--wg-specular-strength: 0.3;   /* Subtle */
--wg-specular-strength: 0.65;  /* Default */
--wg-specular-strength: 1.0;   /* Full brightness */
```

---

### ↔️ `--wg-specular-width`

How wide the highlight band is across the bezel. `0` is a hairline. `1` fills the entire bezel width.

```css
--wg-specular-width: 0.1;   /* Tight line */
--wg-specular-width: 0.25;  /* Default */
--wg-specular-width: 0.6;   /* Broad glow */
```

---

### 📍 `--wg-specular-edge`

How far the highlight band is pushed inward from the outer rim. `0` places it right on the physical edge. `1` pushes it to the inner edge of the bezel.

```css
--wg-specular-edge: 0;     /* On the rim — iOS style */
--wg-specular-edge: 0.05;  /* Default — just off the edge */
--wg-specular-edge: 0.3;   /* Inset glow */
```

---

### 🔆 `--wg-specular-back`

Intensity of the counter-highlight on the opposite side of the light source. Simulates the faint secondary reflection you see on real glass. Set to `0` to disable.

```css
--wg-specular-back: 0;     /* Off */
--wg-specular-back: 0.15;  /* Subtle — iOS style */
--wg-specular-back: 0.20;  /* Default */
```

---

### 🎨 `--wg-bg-opacity`

Opacity of the thin white fill layer behind the blur. Gives the glass a frosted-white tint. `0` is fully transparent.

```css
--wg-bg-opacity: 0;     /* No tint — pure blur */
--wg-bg-opacity: 0.15;  /* Default */
--wg-bg-opacity: 0.4;   /* Noticeably white */
```

---

## 🔗 Cascading and overrides

Tokens follow normal CSS cascade rules. You can set defaults on `:root` and override on specific elements:

```css
:root {
  --wg-render: true;
  --wg-refraction: 1.45;
  --wg-blur: 10;
}

/* This card gets stronger glass */
.featured-card {
  --wg-refraction: 1.8;
  --wg-specular-strength: 0.9;
}

/* This section uses a different light direction */
.dark-section {
  --wg-light-angle: 45;
  --wg-bg-opacity: 0.08;
}
```
