/**
 * webglass.js — Physics-based Liquid Glass for the Web
 * Version 1.1
 *
 * USAGE
 * ─────
 * Drop this script onto any page — no stylesheet required.
 * Add class="glass" to any element, then enable rendering with --wg-render: true.
 *
 * Recommended: set tokens in a <style> block or your own stylesheet.
 *
 *   <style>
 *     :root {
 *       --wg-render: true;
 *       --wg-refraction: 1.45;
 *       --wg-bezel: 0.28;
 *       --wg-scale: 40;
 *       --wg-blur: 10;
 *       --wg-light-angle: -55;
 *       --wg-specular-strength: 0.65;
 *       --wg-specular-width: 0.25;
 *       --wg-specular-edge: 0.05;
 *       --wg-specular-back: 0.20;
 *       --wg-bg-opacity: 0.15;
 *     }
 *   </style>
 *
 *   <div class="glass">Hello</div>
 *
 * AVAILABLE TOKENS
 * ────────────────
 *   --wg-render            true | (unset)   Enable glass on this element or subtree
 *   --wg-shape             squircle*        Surface profile: squircle, circle, lip, concave
 *   --wg-refraction        1.45*            Index of refraction (1.0 = none, 2.2 = dense glass)
 *   --wg-bezel             0.28*            Bezel width as fraction of element's short side
 *   --wg-scale             40*              SVG displacement map strength in pixels
 *   --wg-blur              10*              Backdrop blur radius in pixels
 *   --wg-light-angle       -55*             Light source direction in degrees
 *   --wg-specular-strength 0.65*            Primary highlight intensity (0–1)
 *   --wg-specular-width    0.25*            Highlight band width (0 = hairline, 1 = full bezel)
 *   --wg-specular-edge     0.05*            Band offset from rim (0 = tight on edge, 1 = center)
 *   --wg-specular-back     0.20*            Counter-highlight intensity at lightAngle + 180°
 *   --wg-bg-opacity        0.15*            White fill opacity behind the blur layer
 *
 *   * default value
 *
 * JS API
 * ──────
 *   WebGlass.apply(el, opts)   Write tokens + re-render one element
 *   WebGlass.configure(opts)   Set global JS defaults, re-render all
 *   WebGlass.refresh()         Force full re-render (e.g. after DOM changes)
 *   WebGlass.destroy()         Remove all layers and observers
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    shape:            'squircle',
    refraction:       1.45,
    bezel:            0.28,
    scale:            40,
    blur:             0,
    lightAngle:       -55,
    specularStrength: 0.65,
    specularWidth:    0.1,
    specularEdge:     0,
    specularBack:     0.20,
    bgOpacity:        0.15
  };

  const STATE_BLOCK = 'BLOCK';
  const STATE_OWN   = 'OWN';

  // ─── Feature detection ───────────────────────────────────────────────────────
  // backdrop-filter: url(#id) is only supported in Chromium desktop.
  // Mobile Chrome, all Safari/iOS, and Firefox drop the url() part silently.
  // We detect this once at boot and use the cloned-layer path on all other engines.
  let _backdropUrlSupported = false;

  function _detectBackdropUrl() {
    try {
      // Build a minimal SVG filter in the document
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
      const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      filter.setAttribute('id', '__wg_detect__');
      svg.appendChild(filter);
      document.body.appendChild(svg);

      // Create a probe element and apply backdrop-filter: url(#...)
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:10px;height:10px;backdrop-filter:url(#__wg_detect__);-webkit-backdrop-filter:url(#__wg_detect__);';
      document.body.appendChild(probe);

      const cs = getComputedStyle(probe);
      // If the browser accepted the url() reference, it will appear in computed style
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || '';
      const supported = bf.includes('url');

      probe.remove();
      svg.remove();
      return supported;
    } catch (e) {
      return false;
    }
  }

  // ─── Surface profiles ────────────────────────────────────────────────────────
  const Surface = {
    squircle(x) { return Math.pow(Math.max(0, 1 - Math.pow(1 - x, 4)), 0.25); },
    circle(x)   { return Math.sqrt(Math.max(0, 1 - Math.pow(1 - x, 2))); },
    concave(x)  { return 1 - Surface.squircle(x); },
    lip(x) {
      const convex = Surface.squircle(x);
      const t = _smootherstep(x);
      return convex * (1 - t) + (1 - convex) * t;
    }
  };

  function _smootherstep(x) {
    x = Math.max(0, Math.min(1, x));
    return x * x * x * (x * (x * 6 - 15) + 10);
  }

  function _surfaceNormal(x, fn) {
    const d = 0.001;
    const dy = (fn(Math.min(1, x + d)) - fn(Math.max(0, x - d))) / (2 * d);
    return { x: -dy, y: 1 };
  }

  function _snellRefract(normal, refraction) {
    const ratio = 1.0 / refraction;
    const len   = Math.sqrt(normal.x ** 2 + normal.y ** 2);
    const nx = normal.x / len, ny = normal.y / len;
    const cosT1   = -ny;
    const sin2T2  = ratio * ratio * (1 - cosT1 ** 2);
    if (sin2T2 > 1) return { x: 0, y: 1, tir: true };
    const cosT2 = Math.sqrt(1 - sin2T2);
    return {
      x: (ratio * cosT1 - cosT2) * nx,
      y: ratio + (ratio * cosT1 - cosT2) * ny,
      tir: false
    };
  }

  function _radialDisplacements(fn, bezel, refraction) {
    const N = 128;
    const mags = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const n = _surfaceNormal(t, fn);
      const r = _snellRefract(n, refraction);
      mags[i] = r.x * fn(t);
    }
    const maxMag = Math.max(...Array.from(mags).map(Math.abs), 1e-6);
    return { mags, maxMag };
  }

  // ─── SDF helpers ─────────────────────────────────────────────────────────────
  function _rrectSDF(px, py, hw, hh, r) {
    r = Math.min(r, Math.min(hw, hh));
    const qx = Math.abs(px) - hw + r;
    const qy = Math.abs(py) - hh + r;
    return Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2)
           + Math.min(Math.max(qx, qy), 0) - r;
  }

  function _rrectNormal(px, py, hw, hh, r) {
    const eps = 0.5;
    const gx = _rrectSDF(px + eps, py, hw, hh, r) - _rrectSDF(px - eps, py, hw, hh, r);
    const gy = _rrectSDF(px, py + eps, hw, hh, r) - _rrectSDF(px, py - eps, hw, hh, r);
    const len = Math.sqrt(gx * gx + gy * gy) || 1;
    return { x: gx / len, y: gy / len };
  }

  // ─── Map builders ────────────────────────────────────────────────────────────
  function _buildDisplacementMap(W, H, fn, bezel, refraction, cr) {
    const { mags, maxMag } = _radialDisplacements(fn, bezel, refraction);
    const N = mags.length;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx  = canvas.getContext('2d');
    const img  = ctx.createImageData(W, H);
    const data = img.data;
    const hw = W / 2, hh = H / 2;
    const bezelPx = bezel * Math.min(hw, hh);

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        const cx  = px - hw + 0.5, cy = py - hh + 0.5;
        const sdf = _rrectSDF(cx, cy, hw, hh, cr);
        if (sdf > 0) {
          data[idx] = data[idx+1] = data[idx+2] = 128; data[idx+3] = 255;
          continue;
        }
        const dist = -sdf;
        if (dist > bezelPx) {
          data[idx] = data[idx+1] = data[idx+2] = 128; data[idx+3] = 255;
          continue;
        }
        const t  = dist / bezelPx;
        const si = Math.min(Math.round(t * (N - 1)), N - 1);
        const nm = mags[si] / maxMag;
        const n  = _rrectNormal(cx, cy, hw, hh, cr);
        data[idx]   = Math.max(0, Math.min(255, Math.round(128 + (-nm * n.x) * 127)));
        data[idx+1] = Math.max(0, Math.min(255, Math.round(128 + (-nm * n.y) * 127)));
        data[idx+2] = 128;
        data[idx+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function _specIntensity(t, tilt, outNx, outNy, lx, ly, edge, width) {
    const tEdge = t - edge;
    if (tEdge < 0 || tEdge > width) return 0;
    const bandT = tEdge / width;
    const bandEnvelope = Math.sin(bandT * Math.PI);
    const wnx = tilt * outNx, wny = tilt * outNy;
    const wl  = Math.sqrt(wnx ** 2 + wny ** 2) || 1;
    const dot = Math.max(0, (wnx / wl) * lx + (wny / wl) * ly);
    return Math.min(1, dot ** 3 * bandEnvelope * 1.6);
  }

  function _buildSpecularMap(W, H, fn, bezel, angleDeg, strength, width, edge, back, cr) {
    const rad  = (angleDeg * Math.PI) / 180;
    const lx   = Math.cos(rad), ly = Math.sin(rad);
    const blx  = -lx, bly = -ly;

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx  = canvas.getContext('2d');
    const img  = ctx.createImageData(W, H);
    const data = img.data;
    const hw = W / 2, hh = H / 2;
    const bezelPx = bezel * Math.min(hw, hh);

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx  = (py * W + px) * 4;
        const cx   = px - hw + 0.5, cy = py - hh + 0.5;
        const sdf  = _rrectSDF(cx, cy, hw, hh, cr);
        const dist = -sdf;
        if (sdf > 0 || dist > bezelPx) {
          data[idx] = data[idx+1] = data[idx+2] = data[idx+3] = 0;
          continue;
        }
        const t      = dist / bezelPx;
        const localN = _surfaceNormal(t, fn);
        const localLen = Math.sqrt(localN.x ** 2 + localN.y ** 2);
        const tilt   = Math.abs(localN.x / localLen);
        const outN   = _rrectNormal(cx, cy, hw, hh, cr);

        const Ip = _specIntensity(t, tilt, outN.x, outN.y, lx, ly, edge, width) * strength;
        const Ib = _specIntensity(t, tilt, outN.x, outN.y, blx, bly, edge, width) * back;
        const I  = Math.min(1, Ip + Ib);

        data[idx]   = Math.round(Math.min(255, I * 270));
        data[idx+1] = Math.round(I * 255);
        data[idx+2] = Math.round(I * 238);
        data[idx+3] = Math.round(I * 220);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  // ─── SVG filter ──────────────────────────────────────────────────────────────
  const NS = 'http://www.w3.org/2000/svg';

  function _svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  function _buildFilter(svg, id, W, H, p) {
    const old = svg.getElementById(id);
    if (old) old.remove();
    const fn      = Surface[p.shape] || Surface.squircle;
    const dispUrl = _buildDisplacementMap(W, H, fn, p.bezel, p.refraction, p.cornerRadius);
    const specUrl = _buildSpecularMap(
      W, H, fn, p.bezel,
      p.lightAngle, p.specularStrength, p.specularWidth, p.specularEdge, p.specularBack,
      p.cornerRadius
    );

    if (_backdropUrlSupported) {
      // ── Chromium desktop path ─────────────────────────────────────────────
      // Full filter: displacement + specular blended together.
      // Applied via backdrop-filter: blur() url(#id) on the layer div.
      const f = _svgEl('filter', {
        id, x: '0%', y: '0%', width: '100%', height: '100%',
        'color-interpolation-filters': 'sRGB'
      });
      f.appendChild(_svgEl('feImage', {
        href: dispUrl, x: 0, y: 0, width: W, height: H,
        result: 'wg_disp', preserveAspectRatio: 'none'
      }));
      f.appendChild(_svgEl('feDisplacementMap', {
        in: 'SourceGraphic', in2: 'wg_disp',
        scale: p.scale,
        xChannelSelector: 'R', yChannelSelector: 'G',
        result: 'wg_refracted'
      }));
      f.appendChild(_svgEl('feImage', {
        href: specUrl, x: 0, y: 0, width: W, height: H,
        result: 'wg_spec', preserveAspectRatio: 'none'
      }));
      f.appendChild(_svgEl('feBlend', {
        in: 'wg_refracted', in2: 'wg_spec',
        mode: 'screen', result: 'wg_out'
      }));
      svg.appendChild(f);
    } else {
      // ── Universal path (mobile / Safari / Firefox) ────────────────────────
      // backdrop-filter: url() is not supported here.
      // Instead we create two separate SVG filters:
      //
      //   id          — displacement only, applied via filter: on a cloned
      //                 background div. filter: url() has broad support.
      //   id + '_spec' — specular only (feImage pass-through), composited
      //                  as a separate absolutely-positioned overlay div.
      //
      // The cloned background div (class="wg-bgclone") is sized/positioned to
      // match the page background and then clipped to the element's bounds,
      // so feDisplacementMap shifts the right pixels.

      // Displacement-only filter
      const fDisp = _svgEl('filter', {
        id, x: '0%', y: '0%', width: '100%', height: '100%',
        'color-interpolation-filters': 'sRGB'
      });
      fDisp.appendChild(_svgEl('feImage', {
        href: dispUrl, x: 0, y: 0, width: W, height: H,
        result: 'wg_disp', preserveAspectRatio: 'none'
      }));
      fDisp.appendChild(_svgEl('feDisplacementMap', {
        in: 'SourceGraphic', in2: 'wg_disp',
        scale: p.scale,
        xChannelSelector: 'R', yChannelSelector: 'G'
      }));
      svg.appendChild(fDisp);

      // Specular-only filter (just renders the specular image as an overlay)
      const specId = id + '_spec';
      const oldSpec = svg.getElementById(specId);
      if (oldSpec) oldSpec.remove();
      const fSpec = _svgEl('filter', {
        id: specId, x: '0%', y: '0%', width: '100%', height: '100%',
        'color-interpolation-filters': 'sRGB'
      });
      fSpec.appendChild(_svgEl('feImage', {
        href: specUrl, x: 0, y: 0, width: W, height: H,
        result: 'wg_spec', preserveAspectRatio: 'none'
      }));
      // feComposite clips the specular image to the element shape
      fSpec.appendChild(_svgEl('feComposite', {
        in: 'wg_spec', in2: 'SourceGraphic', operator: 'in'
      }));
      svg.appendChild(fSpec);
    }
  }

  // ─── Runtime state ───────────────────────────────────────────────────────────
  const _rt = {
    svg:         null,
    perEl:       new Map(),
    filterMap:   new Map(),
    queue:       new Set(),
    rafId:       null,
    mo:          null,
    rootMo:      null,
    ro:          null,
    jsDef:       { ...DEFAULTS },
    degradeLimit: 2000
  };

  function _ensureSVG() {
    if (_rt.svg && _rt.svg.isConnected) return _rt.svg;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('xmlns', NS);
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
    svg.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(svg, document.body.firstChild);
    _rt.svg = svg;
    return svg;
  }

  function _rootCS() { return getComputedStyle(document.documentElement); }

  function _toCamel(prop) {
    return prop.replace(/^--wg-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  function _readTokens(cs) {
    const rootCS = _rootCS();
    const jd = _rt.jsDef;
    function token(name) {
      const v = cs.getPropertyValue(name).trim();
      if (v) return v;
      if (cs !== rootCS) {
        const rv = rootCS.getPropertyValue(name).trim();
        if (rv) return rv;
      }
      const jk = _toCamel(name);
      return jd[jk] !== undefined ? String(jd[jk]) : '';
    }
    function num(name, def) { const v = parseFloat(token(name)); return isNaN(v) ? def : v; }
    function str(name, def) { return token(name) || def; }

    const refraction = (() => {
      const v = parseFloat(cs.getPropertyValue('--wg-refraction').trim());
      if (!isNaN(v)) return v;
      const vAlias = parseFloat(cs.getPropertyValue('--wg-ior').trim());
      if (!isNaN(vAlias)) return vAlias;
      if (cs !== rootCS) {
        const rv = parseFloat(rootCS.getPropertyValue('--wg-refraction').trim());
        if (!isNaN(rv)) return rv;
        const rva = parseFloat(rootCS.getPropertyValue('--wg-ior').trim());
        if (!isNaN(rva)) return rva;
      }
      return jd.refraction !== undefined ? jd.refraction : DEFAULTS.refraction;
    })();

    return {
      shape:            str('--wg-shape',              DEFAULTS.shape),
      refraction,
      bezel:            num('--wg-bezel',              DEFAULTS.bezel),
      scale:            num('--wg-scale',              DEFAULTS.scale),
      blur:             num('--wg-blur',               DEFAULTS.blur),
      lightAngle:       num('--wg-light-angle',        DEFAULTS.lightAngle),
      specularStrength: num('--wg-specular-strength',  DEFAULTS.specularStrength),
      specularWidth:    num('--wg-specular-width',     DEFAULTS.specularWidth),
      specularEdge:     num('--wg-specular-edge',      DEFAULTS.specularEdge),
      specularBack:     num('--wg-specular-back',      DEFAULTS.specularBack),
      bgOpacity:        num('--wg-bg-opacity',         DEFAULTS.bgOpacity)
    };
  }

  function _cornerRadius(el, W, H) {
    const raw = getComputedStyle(el).borderTopLeftRadius || '0px';
    let r = parseFloat(raw) || 0;
    if (raw.includes('%')) r = (parseFloat(raw) / 100) * Math.min(W, H) / 2;
    return Math.min(r, Math.min(W, H) / 2);
  }

  function _renderState(el) {
    const v = getComputedStyle(el).getPropertyValue('--wg-render').trim();
    if (v === 'true') return STATE_OWN;
    return STATE_BLOCK;
  }

  function _eligible(el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (el.isContentEditable) return false;
    return true;
  }

  let _elIdx = 0;

  function _filterId(el) {
    if (el.__wgId) return el.__wgId;
    let slug;
    if (el.id) {
      slug = el.id;
    } else {
      slug = Array.from(el.classList).find(c => c !== 'glass') || ('el' + _elIdx++);
    }
    slug = slug.replace(/[^a-zA-Z0-9_-]/g, '_');
    el.__wgId = 'wg-' + slug;
    return el.__wgId;
  }

  function _cacheKey(W, H, p) {
    return [
      p.shape, W, H,
      p.refraction.toFixed(3), p.bezel.toFixed(3), p.scale,
      p.lightAngle, p.specularStrength.toFixed(2),
      p.specularWidth.toFixed(3), p.specularEdge.toFixed(3), p.specularBack.toFixed(3),
      Math.round(p.cornerRadius),
      p.blur.toFixed(2),
      p.bgOpacity.toFixed(3)
    ].join('|');
  }

  // ─── Layer application ───────────────────────────────────────────────────────

  function _applyLayer(el, filterId, p) {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    if (!el.style.isolation) el.style.isolation = 'isolate';

    if (_backdropUrlSupported) {
      // ── Chromium desktop path ─────────────────────────────────────────────
      // Single layer: backdrop-filter: blur() url(#filterId)
      let layer = el.querySelector(':scope > .wg-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'wg-layer';
        layer.setAttribute('aria-hidden', 'true');
        el.insertBefore(layer, el.firstChild);
      }
      const bf = filterId
        ? `blur(${p.blur}px) url(#${filterId})`
        : `blur(${p.blur}px)`;
      layer.style.cssText = [
        'position:absolute', 'inset:0', 'border-radius:inherit',
        `backdrop-filter:${bf}`,
        `-webkit-backdrop-filter:${bf}`,
        `background:rgba(255,255,255,${p.bgOpacity})`,
        'pointer-events:none', 'z-index:-1'
      ].join(';');

      // Remove universal-path layers if any
      el.querySelector(':scope > .wg-bgclone')?.remove();
      el.querySelector(':scope > .wg-spec')?.remove();

    } else {
      // ── Universal path (mobile / Safari / Firefox) ────────────────────────
      //
      // Layer stack inside the glass element (back → front):
      //
      //   .wg-bgclone   Frozen copy of the page background behind this element,
      //                 filtered with filter: blur() url(#dispFilterId).
      //                 This achieves refraction without backdrop-filter: url().
      //
      //   .wg-layer     backdrop-filter: blur() only (no url()).
      //                 Adds the frosted glass tint/blur that the bgclone can't.
      //                 Some browsers apply blur to what's literally behind the
      //                 element in the stacking context, so this still works.
      //
      //   .wg-spec      Specular highlight overlay.
      //                 filter: url(#specFilterId) on a transparent div.

      // --- .wg-bgclone: displaced background clone ---
      let bgClone = el.querySelector(':scope > .wg-bgclone');
      if (!bgClone) {
        bgClone = document.createElement('div');
        bgClone.className = 'wg-bgclone';
        bgClone.setAttribute('aria-hidden', 'true');
        el.insertBefore(bgClone, el.firstChild);
      }

      // Position the clone to cover exactly the element's bounding box
      // relative to the page, so the background-* properties line up.
      const rect = el.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      const absTop  = rect.top  + scrollY;
      const absLeft = rect.left + scrollX;

      // Inherit the background from <body> or the nearest opaque ancestor.
      // We use a negative offset background-position so it looks like a window
      // cut into the page background.
      const bodyStyle = getComputedStyle(document.body);
      const bgImage  = bodyStyle.backgroundImage;
      const bgColor  = bodyStyle.backgroundColor;
      const bgSize   = bodyStyle.backgroundSize;
      const bgRepeat = bodyStyle.backgroundRepeat;
      const bgAttach = bodyStyle.backgroundAttachment;

      const dispFilter = filterId ? `blur(${p.blur}px) url(#${filterId})` : `blur(${p.blur}px)`;

      bgClone.style.cssText = [
        'position:absolute', 'inset:0', 'border-radius:inherit',
        `background-image:${bgImage}`,
        `background-color:${bgColor}`,
        `background-size:${bgSize === 'auto' ? 'auto' : bgSize}`,
        `background-repeat:${bgRepeat}`,
        // Shift the background so it aligns with the real page background
        `background-position:-${absLeft}px -${absTop}px`,
        `background-attachment:${bgAttach === 'fixed' ? 'fixed' : 'scroll'}`,
        `filter:${dispFilter}`,
        'pointer-events:none', 'z-index:-2'
      ].join(';');

      // --- .wg-layer: blur + tint ---
      let layer = el.querySelector(':scope > .wg-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'wg-layer';
        layer.setAttribute('aria-hidden', 'true');
        el.insertBefore(layer, bgClone.nextSibling);
      }
      const blurFilter = `blur(${p.blur}px)`;
      layer.style.cssText = [
        'position:absolute', 'inset:0', 'border-radius:inherit',
        `backdrop-filter:${blurFilter}`,
        `-webkit-backdrop-filter:${blurFilter}`,
        `background:rgba(255,255,255,${p.bgOpacity})`,
        'pointer-events:none', 'z-index:-1'
      ].join(';');

      // --- .wg-spec: specular overlay ---
      if (filterId) {
        let specLayer = el.querySelector(':scope > .wg-spec');
        if (!specLayer) {
          specLayer = document.createElement('div');
          specLayer.className = 'wg-spec';
          specLayer.setAttribute('aria-hidden', 'true');
          el.appendChild(specLayer);
        }
        specLayer.style.cssText = [
          'position:absolute', 'inset:0', 'border-radius:inherit',
          `filter:url(#${filterId}_spec)`,
          'pointer-events:none', 'z-index:1'
        ].join(';');
      } else {
        el.querySelector(':scope > .wg-spec')?.remove();
      }
    }
  }

  function _removeLayer(el) {
    el.querySelector(':scope > .wg-layer')?.remove();
    el.querySelector(':scope > .wg-bgclone')?.remove();
    el.querySelector(':scope > .wg-spec')?.remove();
  }

  // ─── Processing ──────────────────────────────────────────────────────────────
  function _processOwn(el) {
    const rect = el.getBoundingClientRect();
    const W = Math.round(rect.width);
    const H = Math.round(rect.height);
    if (W < 8 || H < 8) return;
    const cs = getComputedStyle(el);
    const p  = _readTokens(cs);
    p.cornerRadius = _cornerRadius(el, W, H);
    const key    = _cacheKey(W, H, p);
    const cached = _rt.perEl.get(el);
    if (cached && cached.key === key) return;
    const svg = _ensureSVG();
    const fid = _filterId(el);
    if (_rt.filterMap.get(fid) !== key) {
      _buildFilter(svg, fid, W, H, p);
      _rt.filterMap.set(fid, key);
    }
    _rt.perEl.set(el, { key, filterId: fid });
    _applyLayer(el, fid, p);
  }

  function _processEl(el) {
    if (!_eligible(el)) return;
    if (_renderState(el) === STATE_OWN) {
      _processOwn(el);
    } else {
      _removeLayer(el);
      _rt.perEl.delete(el);
    }
  }

  function _processBatch(els) {
    const lim  = _rt.degradeLimit;
    const norm = els.length <= lim ? els : els.slice(0, lim);
    const over = els.length >  lim ? els.slice(lim) : [];
    for (const el of norm) _processEl(el);
    for (const el of over) {
      if (!_eligible(el) || _renderState(el) === STATE_BLOCK) continue;
      _applyLayer(el, null, _readTokens(getComputedStyle(el)));
    }
  }

  function _flush() {
    _rt.rafId = null;
    const els = [..._rt.queue];
    _rt.queue.clear();
    _processBatch(els);
  }

  function _enqueue(el) {
    _rt.queue.add(el);
    if (!_rt.rafId) _rt.rafId = requestAnimationFrame(_flush);
  }

  function _scan(root) {
    const node = root || document;
    if (!node.querySelectorAll) return;
    node.querySelectorAll('.glass, [data-wg-glass]').forEach(_enqueue);
  }

  function _isCandidate(el) {
    return el.classList?.contains('glass') || el.hasAttribute?.('data-wg-glass');
  }

  // ─── Observers ───────────────────────────────────────────────────────────────
  function _startObservers() {
    if (_rt.mo) return;
    _rt.mo = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(n => {
            if (n.nodeType !== 1) return;
            if (_isCandidate(n)) { _enqueue(n); _rt.ro?.observe(n); }
            _scan(n);
            n.querySelectorAll?.('.glass, [data-wg-glass]').forEach(c => _rt.ro?.observe(c));
          });
        } else if (m.type === 'attributes' && _isCandidate(m.target)) {
          _rt.perEl.delete(m.target);
          _enqueue(m.target);
        }
      }
    });
    _rt.mo.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'data-wg-glass']
    });
    _rt.rootMo = new MutationObserver(() => {
      _rt.perEl.clear();
      _rt.filterMap.clear();
      _scan();
    });
    _rt.rootMo.observe(document.documentElement, {
      attributes: true, attributeFilter: ['style']
    });

    if (typeof ResizeObserver !== 'undefined') {
      _rt.ro = new ResizeObserver(entries => {
        for (const entry of entries) {
          const el = entry.target;
          if (!_isCandidate(el)) continue;
          const { width, height } = entry.contentRect;
          if (width < 8 || height < 8) continue;
          const cached = _rt.perEl.get(el);
          const W = Math.round(width), H = Math.round(height);
          if (!cached || !cached.key.includes(`|${W}|${H}|`)) {
            _rt.perEl.delete(el);
            _enqueue(el);
          }
        }
      });
      document.querySelectorAll('.glass, [data-wg-glass]').forEach(el => {
        _rt.ro.observe(el);
      });
    }
  }

  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      _rt.perEl.clear();
      _rt.filterMap.clear();
      _scan();
    }, 150);
  }, { passive: true });

  // On scroll, bgclone positions need to be recalculated in the universal path
  window.addEventListener('scroll', () => {
    if (_backdropUrlSupported) return;
    _rt.perEl.clear();
    _scan();
  }, { passive: true });

  // ─── Public API ──────────────────────────────────────────────────────────────
  const WebGlass = {
    apply(el, opts = {}) {
      const propMap = {
        render:           '--wg-render',
        shape:            '--wg-shape',
        refraction:       '--wg-refraction',
        bezel:            '--wg-bezel',
        scale:            '--wg-scale',
        blur:             '--wg-blur',
        lightAngle:       '--wg-light-angle',
        specularStrength: '--wg-specular-strength',
        specularWidth:    '--wg-specular-width',
        specularEdge:     '--wg-specular-edge',
        specularBack:     '--wg-specular-back',
        bgOpacity:        '--wg-bg-opacity'
      };
      for (const [k, prop] of Object.entries(propMap)) {
        if (opts[k] !== undefined) el.style.setProperty(prop, String(opts[k]));
      }
      _rt.perEl.delete(el);
      _enqueue(el);
    },

    configure(opts = {}) {
      Object.assign(_rt.jsDef, opts);
      _rt.perEl.clear();
      _rt.filterMap.clear();
      _scan();
    },

    refresh() {
      _rt.perEl.clear();
      _rt.filterMap.clear();
      _scan();
    },

    destroy() {
      _rt.mo?.disconnect();     _rt.mo     = null;
      _rt.rootMo?.disconnect(); _rt.rootMo = null;
      _rt.ro?.disconnect();     _rt.ro     = null;
      if (_rt.rafId) { cancelAnimationFrame(_rt.rafId); _rt.rafId = null; }
      document.querySelectorAll('.wg-layer, .wg-bgclone, .wg-spec').forEach(l => l.remove());
      if (_rt.svg?.isConnected) _rt.svg.remove();
      _rt.svg = null;
      _rt.perEl.clear();
      _rt.filterMap.clear();
    },

    _rt
  };

  // ─── Boot ────────────────────────────────────────────────────────────────────
  function _boot() {
    _ensureSVG();
    // Run feature detection before first render
    _backdropUrlSupported = _detectBackdropUrl();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      _scan();
      _startObservers();
    }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

  global.WebGlass = WebGlass;

})(typeof globalThis !== 'undefined' ? globalThis : window);
