# ✨ Specular Lighting

The specular system controls the rim highlight — the bright line you see on the edge of real glass when light catches it. WebGlass renders this physically: it computes the angle between the surface normal and the light direction and applies a highlight band to the bezel.

There are five tokens, all working together.

---

## 🔬 How it works

Imagine a light source at a fixed position in the scene. The rim of the glass element faces partly toward that light and partly away. Where the rim faces the light, a highlight appears. On the opposite side, a fainter counter-highlight appears (the secondary reflection you see on real glass).

```
         Light ↗

    ╭──────────────╮
    │  ↑ highlight │
    │              │
    │  ↓ counter   │
    ╰──────────────╯
```

`--wg-light-angle` sets where the light is. Everything else shapes the highlight.

---

## 🎛️ The five tokens

### 💡 `--wg-light-angle`

Angle of the light source in degrees. `0` = right, `-90` = top, `90` = bottom, `180` = left.

The default `-55` puts the light at the upper-left, which matches the conventional light direction in most design systems.

```css
--wg-light-angle: -55;   /* Default — upper left */
--wg-light-angle: -90;   /* Directly above */
--wg-light-angle: 135;   /* Lower right */
```

---

### ☀️ `--wg-specular-strength`

How bright the primary highlight is. `0` turns the highlight off. `1` is maximum.

```css
--wg-specular-strength: 0.4;   /* Subtle */
--wg-specular-strength: 0.65;  /* Default */
--wg-specular-strength: 1.0;   /* Bright */
```

---

### ↔️ `--wg-specular-width`

How wide the highlight band is, as a fraction of the bezel depth. `0` is a hairline right on the edge. `1` fills the entire bezel.

```css
--wg-specular-width: 0.1;   /* Sharp line */
--wg-specular-width: 0.25;  /* Default */
--wg-specular-width: 0.7;   /* Broad diffuse glow */
```

---

### 📍 `--wg-specular-edge`

How far the highlight band is pushed inward from the physical outer edge. `0` places the peak of the band right on the rim. Higher values push it toward the centre of the bezel.

```css
--wg-specular-edge: 0;     /* Right on the rim */
--wg-specular-edge: 0.05;  /* Default — just inside the edge */
--wg-specular-edge: 0.4;   /* Noticeably inset */
```

---

### 🌒 `--wg-specular-back`

Intensity of the counter-highlight. This always appears at `light-angle + 180°` — exactly opposite the main light. Set to `0` to disable it.

```css
--wg-specular-back: 0;     /* No counter-highlight */
--wg-specular-back: 0.15;  /* Subtle secondary reflection */
--wg-specular-back: 0.20;  /* Default */
```

---

## 🎨 Presets

### 🍎 iOS tight-rim look

The characteristic Apple glass: a narrow, bright highlight sitting exactly on the physical edge, with a faint counter-highlight on the opposite side.

```css
--wg-specular-edge: 0;
--wg-specular-width: 0.15;
--wg-specular-strength: 0.75;
--wg-specular-back: 0.15;
```

---

### 🌸 Soft glow

A broader, diffuse highlight that starts slightly inset from the rim. No counter-highlight. Good for lighter, more ethereal UIs.

```css
--wg-specular-edge: 0.3;
--wg-specular-width: 0.6;
--wg-specular-strength: 0.5;
--wg-specular-back: 0;
```

---

### 👻 Barely there

Almost invisible glass — the refraction does the work, the highlight is just a hint.

```css
--wg-specular-strength: 0.2;
--wg-specular-width: 0.15;
--wg-specular-back: 0;
```

---

### 💎 Bold crystal

Dense, bright highlight with a strong counter-glow. High refraction recommended alongside this.

```css
--wg-specular-strength: 1.0;
--wg-specular-width: 0.2;
--wg-specular-edge: 0;
--wg-specular-back: 0.4;
--wg-refraction: 1.9;
```

---

## 📝 Notes

- 🔒 The counter-highlight is always locked to `light-angle + 180°`. It does not have its own angle — this is intentional. Moving the light moves both highlights together, keeping the scene physically coherent.
- ⚠️ Very wide `specular-width` values combined with high `specular-strength` can wash out the highlight. If it looks flat, reduce width or strength.
- ⚙️ The highlight is baked into the SVG filter map at render time, not computed at paint time. Changing any specular token triggers a filter rebuild — this is fast but not free, so avoid changing tokens on every animation frame.
