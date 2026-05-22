# 🔷 Shapes

WebGlass supports four surface profiles. Each one describes how the glass curves from the outer edge inward, which determines both how light refracts through it and how the specular highlight is shaped.

Set the shape with `--wg-shape`.

---

## 🟦 squircle *(default)*

```css
--wg-shape: squircle;
```

Based on Apple's preferred lens geometry — a fourth-power curve that transitions smoothly from a curved edge to a flat centre. This is the right choice for most UI elements: cards, buttons, dialogs, pills.

The highlight sits cleanly on the rim and fades naturally toward the centre. At typical `border-radius` values it matches the visual language of iOS and macOS closely.

**Good for:** buttons, cards, modals, nav bars, anything with rounded corners.

---

## ⭕ circle

```css
--wg-shape: circle;
```

A dome lens — a square-root profile that produces strong refraction at the centre. The glass appears to bulge outward. Works best on elements that are actually circular (`border-radius: 50%`) but can be applied to any shape.

**Good for:** avatars, icon containers, circular badges.

---

## 💋 lip

```css
--wg-shape: lip;
```

A raised outer rim with a slight inward dip toward the centre. Uses a smootherstep blend between convex and concave. The effect is a pronounced edge catch — the rim feels thick and the interior recedes.

**Good for:** decorative panels, floating elements, anything where you want the rim to read as physically solid.

---

## 🔵 concave

```css
--wg-shape: concave;
```

The inverse of squircle — the surface curves inward rather than outward, refracting background content outward instead of inward. The specular highlight appears on the inside of the rim rather than the outside.

**Good for:** pressed states, inset wells, depth effects.

---

## 🤔 Choosing a shape

| If you want… | Use |
|---|---|
| Default clean glass | `squircle` |
| Round elements / avatars | `circle` |
| Heavy physical rim | `lip` |
| Inset / pressed effect | `concave` |

---

## 📐 Shape and border-radius

The shape profile describes the *cross-section* of the glass surface — how it curves inward. The `border-radius` on your element describes the *outline* — the shape of the element itself. Both matter.

WebGlass reads `border-radius` directly from the element and uses it to build an SDF (signed distance field) that maps the bezel precisely to the actual corners. You don't need to configure this — just set `border-radius` normally in your CSS and WebGlass follows it automatically.

```css
.pill  { border-radius: 100px; }   /* WebGlass follows this */
.card  { border-radius: 20px; }    /* And this */
.round { border-radius: 50%; }     /* And this */
```
