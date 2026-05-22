# 🧠 JS API

WebGlass is CSS-first — most of the time you won't need the JS API at all. But it's there when you need to control glass programmatically: toggling it on a specific element, updating tokens from a theme picker, or integrating with a JS framework.

The API is exposed on the global `WebGlass` object.

---

## 🎯 `WebGlass.apply(el, opts)`

Writes CSS custom properties onto a single element and triggers a re-render of that element.

```js
const el = document.querySelector('.my-card');

WebGlass.apply(el, {
  render: 'true',
  shape: 'squircle',
  refraction: 1.6,
  bezel: 0.3,
  blur: 12,
  lightAngle: -90,
  specularStrength: 0.8,
  specularWidth: 0.15,
  specularEdge: 0,
  specularBack: 0.15,
  bgOpacity: 0.1
});
```

You don't need to pass every option — only the ones you want to set. Anything omitted keeps its current value (from CSS or the defaults).

**🗺️ Option names map to tokens:**

| Option | Token |
|---|---|
| `render` | `--wg-render` |
| `shape` | `--wg-shape` |
| `refraction` | `--wg-refraction` |
| `bezel` | `--wg-bezel` |
| `scale` | `--wg-scale` |
| `blur` | `--wg-blur` |
| `lightAngle` | `--wg-light-angle` |
| `specularStrength` | `--wg-specular-strength` |
| `specularWidth` | `--wg-specular-width` |
| `specularEdge` | `--wg-specular-edge` |
| `specularBack` | `--wg-specular-back` |
| `bgOpacity` | `--wg-bg-opacity` |

`apply` writes these as inline styles on the element. If you later remove the inline style (e.g. `el.style.removeProperty('--wg-refraction')`), the value falls back to whatever your CSS or the global defaults say.

---

## 🌐 `WebGlass.configure(opts)`

Sets global JS-level defaults and triggers a full re-render of all glass elements. Use this for theme-level changes that should affect everything.

```js
// Switch to a dark-mode light direction
WebGlass.configure({
  lightAngle: 45,
  bgOpacity: 0.08,
  specularStrength: 0.5
});
```

These JS defaults sit below CSS in the priority order:

1. 🥇 Inline `style=` attribute (highest — set by `apply`)
2. 🥈 Your stylesheet / `:root` tokens
3. 🥉 JS defaults set by `configure`
4. 🏅 Built-in defaults (lowest)

So `configure` is the right tool for app-wide theming when you're not using CSS variables — for example in a fully JS-driven component system.

---

## 🔄 `WebGlass.refresh()`

Forces a full re-render of all glass elements, clearing the internal cache. Use this after you've manually changed CSS custom properties on elements and want WebGlass to pick them up immediately.

```js
// You've changed a token directly...
document.documentElement.style.setProperty('--wg-refraction', '1.8');

// ...force WebGlass to rebuild
WebGlass.refresh();
```

You usually don't need this — WebGlass watches for DOM mutations and `style` attribute changes automatically. `refresh()` is for edge cases where the automatic detection misses something, or when you're changing tokens on `:root` via JS.

---

## 💥 `WebGlass.destroy()`

Removes all glass layers, disconnects all observers, and clears the SVG filter elements. Leaves the DOM otherwise untouched.

```js
WebGlass.destroy();
```

Use this when unmounting a page or component entirely, or when you want to cleanly disable WebGlass without a page reload.

> ⚠️ WebGlass can't be restarted after `destroy()` without re-loading the script.

---

## 🔌 Usage with frameworks

WebGlass works fine alongside React, Vue, Svelte, etc. — it watches the real DOM, not a virtual one.

**⚛️ React example:**

```jsx
import { useEffect, useRef } from 'react';

function GlassCard({ children, refraction = 1.5 }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      WebGlass.apply(ref.current, {
        render: 'true',
        refraction,
        blur: 10,
        lightAngle: -55
      });
    }
  }, [refraction]);

  return (
    <div ref={ref} className="glass card">
      {children}
    </div>
  );
}
```

**💚 Vue example:**

```vue
<template>
  <div ref="el" class="glass card">
    <slot />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const el = ref(null);

onMounted(() => {
  WebGlass.apply(el.value, {
    render: 'true',
    refraction: 1.5,
    blur: 10
  });
});
</script>
```

---

## 👁️ Automatic observation

You don't need to call anything to initialise WebGlass — it boots automatically on `DOMContentLoaded` and scans for `.glass` elements. It also observes:

- 🧩 **DOM mutations** — new `.glass` elements added dynamically are picked up automatically
- 🏷️ **Attribute changes** — changes to `class` or `style` on glass elements trigger a re-render
- 📐 **Resize** — elements that change size are re-rendered with a new filter sized to match
- 🖥️ **Window resize** — all elements are re-rendered after the window stops resizing
