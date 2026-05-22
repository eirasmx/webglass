# 📋 Changelog

All notable changes to WebGlass are documented here.

---

## [1.0.0] — 2026-05-09 🎉

### Initial release

**WebGlass** — Liquid Glass for the Web.

#### ✨ Features

- **Snell–Descartes refraction** via SVG `feDisplacementMap` — physically accurate light bending without canvas
- **SDF-accurate bezels** — signed distance fields adapt the refracting rim to any `border-radius` automatically
- **Specular rim lighting** — physically computed highlight band with configurable angle, width, edge, strength, and counter-highlight
- **Four surface shapes** — `squircle` (default), `circle`, `lip`, `concave`
- **CSS-first API** — all configuration via CSS custom properties (`--wg-*` tokens)
- **JS API** — `WebGlass.apply()`, `WebGlass.configure()`, `WebGlass.refresh()`, `WebGlass.destroy()`
- **Zero dependencies** — single JS file, no build step required
- **Automatic DOM observation** — MutationObserver picks up dynamically added `.glass` elements
- **Resize handling** — elements re-render automatically on size change and window resize
- **Safari support** — `-webkit-backdrop-filter` set automatically
- **Framework compatible** — works alongside React, Vue, Svelte, and any other framework that touches the real DOM

#### 🪙 CSS Tokens

| Token | Default |
|---|---|
| `--wg-render` | *(unset)* |
| `--wg-shape` | `squircle` |
| `--wg-refraction` | `1.45` |
| `--wg-bezel` | `0.28` |
| `--wg-scale` | `40` |
| `--wg-blur` | `10` |
| `--wg-light-angle` | `-55` |
| `--wg-specular-strength` | `0.65` |
| `--wg-specular-width` | `0.25` |
| `--wg-specular-edge` | `0.05` |
| `--wg-specular-back` | `0.20` |
| `--wg-bg-opacity` | `0.15` |

#### 🌐 Browser support

Requires `backdrop-filter` and SVG `feDisplacementMap`. Supported in all modern browsers (Chrome, Firefox, Safari, Edge).
