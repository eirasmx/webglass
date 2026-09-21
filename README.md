# 🪟 WebGlass

Liquid Glass for the Web. Snell–Descartes refraction, SDF-accurate bezels, and specular rim lighting rendered entirely in CSS `backdrop-filter` and SVG. No canvas at runtime, no dependencies.

---

## ⚡ Quick start

```html
<script src="webglass.js"></script>

<style>
  :root {
    --wg-render: true;
    --wg-refraction: 1.45;
    --wg-bezel: 0.28;
    --wg-light-angle: -55;
  }
</style>

<button class="glass">Click me</button>
```

That's it. Any element with `class="glass"` inside a `--wg-render: true` scope gets the glass treatment.

---

## 📚 Documentation

Full guides are in the [`docs/`](./docs) folder:

| Guide | What it covers |
|---|---|
| [🚀 Getting Started](./docs/getting-started.md) | Installation, first element, style scoping |
| [🪙 Tokens Reference](./docs/tokens.md) | Every CSS custom property with examples |
| [🔷 Shapes](./docs/shapes.md) | squircle, circle, lip, concave — when to use each |
| [✨ Specular Lighting](./docs/specular.md) | Light angle, highlights, iOS look, soft glow |
| [🧠 JS API](./docs/js-api.md) | `apply`, `configure`, `refresh`, `destroy` |

---

## 🎨 Examples

Live examples are in the [`examples/`](./examples) folder:

| Example | What it shows |
|---|---|
| [button.html](./examples/button.html) | Glass buttons in small, default, and large sizes |
| [card.html](./examples/card.html) | Feature cards on a dark background |
| [shapes.html](./examples/shapes.html) | All four surface shapes side by side |
| [specular-presets.html](./examples/specular-presets.html) | iOS, soft glow, subtle, and bold crystal presets |
| [navbar.html](./examples/navbar.html) | Floating glass navigation bar |

---

## 🌐 Browser support

Requires `backdrop-filter` and SVG `feDisplacementMap`. Works in all modern browsers. Safari requires `-webkit-backdrop-filter`, which WebGlass sets automatically.

---

## 📄 License

MIT © [Eramsus A. Junior](https://github.com/eirasmx/webglass)
