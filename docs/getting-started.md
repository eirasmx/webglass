# 🚀 Getting Started

This guide takes you from zero to a working glass element in a few minutes.

---

## 1. 📦 Add the script

WebGlass is a single file with no dependencies. Download `webglass.js` and add it to your page:

```html
<script src="webglass.js"></script>
```

Place it anywhere — `<head>` or end of `<body>` both work. WebGlass waits for the DOM before doing anything.

---

## 2. 🏷️ Mark your elements

Add `class="glass"` to any element you want to become glass:

```html
<button class="glass">Save</button>
<div class="glass card">Hello</div>
<nav class="glass">…</nav>
```

Nothing happens yet. The class just tells WebGlass which elements to watch.

---

## 3. ✅ Enable rendering

Glass is off by default. Turn it on with `--wg-render: true`. The best place is a `<style>` block — set it on `:root` to enable sitewide, or on a container to scope it:

```html
<style>
  /* Sitewide — every .glass element gets the effect */
  :root {
    --wg-render: true;
  }
</style>
```

```html
<style>
  /* Scoped — only .glass elements inside .hero get the effect */
  .hero {
    --wg-render: true;
  }
</style>
```

---

## 4. 🎨 Set your look

Add the visual tokens to the same `:root` block. These are the defaults — a good starting point for most UIs:

```html
<style>
  :root {
    --wg-render: true;
    --wg-shape: squircle;
    --wg-refraction: 1.45;
    --wg-bezel: 0.28;
    --wg-scale: 40;
    --wg-blur: 10;
    --wg-light-angle: -55;
    --wg-specular-strength: 0.65;
    --wg-specular-width: 0.25;
    --wg-specular-edge: 0.05;
    --wg-specular-back: 0.20;
    --wg-bg-opacity: 0.15;
  }
</style>
```

You don't need all of them. Any token you omit uses its default value.

---

## 5. 🧪 Full minimal example

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My App</title>
  <style>
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #a8c8f0, #f0c8a8);
    }

    :root {
      --wg-render: true;
      --wg-refraction: 1.5;
      --wg-bezel: 0.3;
      --wg-blur: 10;
      --wg-light-angle: -55;
      --wg-specular-strength: 0.7;
      --wg-specular-width: 0.15;
      --wg-specular-edge: 0;
      --wg-specular-back: 0.15;
    }

    .btn {
      padding: 12px 28px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.4);
      font-size: 15px;
      cursor: pointer;
      background: transparent;
      color: #1a1a2e;
    }
  </style>
</head>
<body>
  <button class="glass btn">Get started</button>
  <script src="webglass.js"></script>
</body>
</html>
```

> **💡 Tip:** Glass needs something behind it to look good. A gradient, a photo, or colorful content beneath the element makes the refraction and blur visible. A plain white background won't show much.

---

## ⛔ What not to do

**Don't put tokens in inline styles** unless you're doing a one-off override. It works, but spreading configuration across every element makes your code hard to maintain:

```html
<!-- Avoid this for anything beyond a quick test -->
<div class="glass" style="--wg-render:true; --wg-refraction:1.5; --wg-blur:10; …">
```

**Do this instead:**

```html
<style>
  :root { --wg-render: true; --wg-refraction: 1.5; --wg-blur: 10; }
</style>
<div class="glass">
```

---

## 🔗 Next steps

- [Tokens Reference](./tokens.md) — see every available option
- [Shapes](./shapes.md) — pick the right surface profile
- [Specular Lighting](./specular.md) — nail the iOS rim look or a soft glow
- [JS API](./js-api.md) — programmatic control
