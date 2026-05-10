/**
 * webglass.js  v1.2.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Physically-based liquid glass / lens refraction effect for any DOM element.
 * One shared WebGL2 overlay canvas renders all instances in a single frame loop.
 * Background is captured via html2canvas — each instance captures ONLY the
 * region directly behind it (using the element's bounding rect + scroll offset),
 * so the texture UV mapping is exact and capture cost scales with element size.
 *
 * ── CSS-DRIVEN API (recommended) ─────────────────────────────────────────────
 *
 *   Set --wg-render: true on any element. Children inherit all --wg-* values
 *   from their parent via normal CSS cascade — override per-child as needed.
 *
 *     .card {
 *       --wg-render:            true;
 *       --wg-shape:             squircle;
 *       --wg-refraction:        1.6;
 *       --wg-scale:             0.22;
 *       --wg-bezel:             0.30;
 *       --wg-blur:              0.005;
 *       --wg-corner-radius:     0.12;
 *       --wg-fresnel:           0.60;
 *       --wg-light-angle:      -55;
 *       --wg-specular-strength: 0.65;
 *       --wg-specular-width:    0.22;
 *       --wg-specular-edge:     0.04;
 *       --wg-specular-back:     0.18;
 *       --wg-bg-opacity:        0.08;
 *       --wg-capture-interval:  300;
 *     }
 *
 * ── JS API (optional) ────────────────────────────────────────────────────────
 *
 *   const glass = new WebGlass(element, { shape: 'squircle', refraction: 1.45, ... });
 *   glass.set({ refraction: 1.8 });
 *   glass.destroy();
 *   WebGlass.destroyAll();
 *
 * REQUIREMENTS
 * ────────────
 *   · WebGL2 browser (all modern browsers since ~2017)
 *   · html2canvas — lazy-loaded from CDN if absent
 *   · Target element must be non-static positioned (set automatically)
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (global) {
  'use strict';

  const HTML2CANVAS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  const SHAPE_MAP = { squircle: 0, circle: 1, lip: 2, concave: 3 };

  const DEFAULTS = {
    shape:            'squircle',
    refraction:       1.45,
    scale:            0.18,
    bezel:            0.28,
    blur:             0.004,
    cornerRadius:     0.12,
    fresnel:          0.60,
    lightAngle:      -55,
    specularStrength: 0.65,
    specularWidth:    0.22,
    specularEdge:     0.04,
    specularBack:     0.18,
    bgOpacity:        0.08,
    captureInterval:  300,
  };

  const CSS_PROP_MAP = [
    ['--wg-shape',             'shape',            v => v.trim()],
    ['--wg-refraction',        'refraction',       parseFloat],
    ['--wg-scale',             'scale',            parseFloat],
    ['--wg-bezel',             'bezel',            parseFloat],
    ['--wg-blur',              'blur',             parseFloat],
    ['--wg-corner-radius',     'cornerRadius',     parseFloat],
    ['--wg-fresnel',           'fresnel',          parseFloat],
    ['--wg-light-angle',       'lightAngle',       parseFloat],
    ['--wg-specular-strength', 'specularStrength', parseFloat],
    ['--wg-specular-width',    'specularWidth',    parseFloat],
    ['--wg-specular-edge',     'specularEdge',     parseFloat],
    ['--wg-specular-back',     'specularBack',     parseFloat],
    ['--wg-bg-opacity',        'bgOpacity',        parseFloat],
    ['--wg-capture-interval',  'captureInterval',  parseFloat],
  ];

  // ── GLSL ───────────────────────────────────────────────────────────────────
  const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

  // The bg texture now covers EXACTLY the element's bounding rect.
  // v_uv (0→1) in local element space maps 1:1 to texture UV — no remapping needed.
  const GLASS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform vec2  u_res;
uniform vec2  u_glassCenter;
uniform vec2  u_glassSize;
uniform float u_cornerRadius;
uniform float u_bezel;
uniform int   u_shape;
uniform float u_ior;
uniform float u_dispScale;
uniform float u_blurRadius;
uniform float u_bgOpacity;
uniform float u_fresnel;
uniform float u_lightAngle;
uniform float u_specStr;
uniform float u_specWidth;
uniform float u_specEdge;
uniform float u_specBack;
uniform sampler2D u_bg;

float h_squircle(float s){
  float t=1.0-s; float v=1.0-t*t*t*t;
  return pow(max(v,0.0),0.25);
}
float h_circle(float s){
  float t=1.0-s; return sqrt(max(0.0,1.0-t*t));
}
float sstep(float t){
  t=clamp(t,0.0,1.0); return t*t*t*(t*(t*6.0-15.0)+10.0);
}
float h_lip(float s){
  float conv=h_squircle(s); float conc=1.0-conv;
  return mix(conv,conc,sstep(s));
}
float h_concave(float s){ return 1.0-h_squircle(s); }
float heightAt(float s){
  if(u_shape==0) return h_squircle(s);
  if(u_shape==1) return h_circle(s);
  if(u_shape==2) return h_lip(s);
  return h_concave(s);
}
float dHeight(float s){
  float e=0.0008;
  return (heightAt(clamp(s+e,0.0,1.0))-heightAt(clamp(s-e,0.0,1.0)))/(2.0*e);
}

vec2 snellRefract(float s,float eta){
  float dh=dHeight(s);
  vec2 N=normalize(vec2(-dh,1.0));
  vec2 I=vec2(0.0,-1.0);
  float cosI=dot(-I,N);
  float sin2T=eta*eta*(1.0-cosI*cosI);
  if(sin2T>1.0) return vec2(0.0);
  float cosT=sqrt(1.0-sin2T);
  return eta*I+(eta*cosI-cosT)*N;
}

float rrectSDF(vec2 p,vec2 b,float r){
  vec2 q=abs(p)-b+r;
  return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r;
}
vec2 rrectOutGrad(vec2 p,vec2 b,float r){
  float e=0.003;
  float dx=rrectSDF(p+vec2(e,0.),b,r)-rrectSDF(p-vec2(e,0.),b,r);
  float dy=rrectSDF(p+vec2(0.,e),b,r)-rrectSDF(p-vec2(0.,e),b,r);
  vec2 g=vec2(dx,dy); float len=length(g);
  return len>0.0001?g/len:vec2(0.0,1.0);
}

vec4 blurSample(sampler2D tex,vec2 uv,float r){
  vec4 c=vec4(0.0); float w=0.0;
  for(int x=-3;x<=3;x++) for(int y=-3;y<=3;y++){
    vec2 o=vec2(float(x),float(y))*r/3.0;
    float ww=exp(-dot(o,o)*8.0);
    c+=texture(tex,uv+o)*ww; w+=ww;
  }
  return c/w;
}

void main(){
  // v_uv is [0,1] in local element space.
  // Texture covers exactly the element region, so bgUV = v_uv is correct.
  vec2 uv = v_uv;
  uv.y = 1.0 - uv.y;

  // Aspect-correct SDF using element pixel dimensions (u_res).
  // Center and half-extents are always 0.5 in local UV space.
  float ar  = u_res.x / u_res.y;
  vec2  asp  = vec2(ar, 1.0);
  vec2  ps   = (uv - u_glassCenter) * asp;
  vec2  bAsp = u_glassSize * asp;
  float minHalf = min(bAsp.x, bAsp.y);
  float crA     = u_cornerRadius * minHalf;

  float sdf  = rrectSDF(ps, bAsp, crA);
  float dist = -sdf;

  // bgUV must use the Y-flipped uv — html2canvas stores top at row 0 but
  // WebGL v_uv.y=0 is screen-bottom, so sampling with raw v_uv is upside-down.
  vec2 bgUV = uv;

  if(sdf > 0.005){ discard; }

  float bezelW = u_bezel * minHalf;
  float s = clamp(dist / max(bezelW, 0.0005), 0.0, 1.0);

  vec2 outGrad = rrectOutGrad(ps, bAsp, crA);
  vec2 inGrad  = -outGrad;

  float eta  = 1.0 / u_ior;
  vec2  refr = snellRefract(s, eta);
  float strength  = u_dispScale * (u_ior - 1.0) * 3.0;
  vec2  uvOffset  = (inGrad * refr.x * strength) / asp;
  vec2  uvR       = bgUV + uvOffset;

  vec4 bgR = u_blurRadius > 0.0001
    ? blurSample(u_bg, uvR, u_blurRadius)
    : texture(u_bg, uvR);

  float R0 = ((1.0 - u_ior) / (1.0 + u_ior)); R0 *= R0;
  float schlick     = R0 + (1.0 - R0) * pow(max(1.0 - s, 0.0), 5.0);
  float fresnelMask = schlick * u_fresnel;

  vec4 glass = mix(bgR, vec4(0.88, 0.94, 1.0, 1.0), fresnelMask * 0.55);
  glass = mix(glass, vec4(0.90, 0.95, 1.0, 1.0), u_bgOpacity * smoothstep(0.5, 1.0, s) * 0.35);

  float aRad   = u_lightAngle * 3.14159265 / 180.0;
  vec2  lDir   = vec2(cos(aRad), sin(aRad));
  float sEdge  = s - u_specEdge;
  float specEnv = (sEdge >= 0.0 && sEdge < u_specWidth)
    ? sin((sEdge / u_specWidth) * 3.14159265) : 0.0;
  float ndlP = max(0.0, dot(outGrad,  lDir));
  float ndlN = max(0.0, dot(outGrad, -lDir));
  float Ip   = pow(ndlP, 2.0) * specEnv * u_specStr;
  float Ib   = pow(ndlN, 2.0) * specEnv * u_specBack;
  float I    = min(1.0, Ip + Ib);
  vec3  spec = vec3(min(1.0, I * 1.05), I, I * 0.94);
  vec3  out3 = 1.0 - (1.0 - glass.rgb) * (1.0 - spec * I);

  float fade = smoothstep(0.0, 0.005, dist);
  fragColor = mix(texture(u_bg, bgUV), vec4(out3, 1.0), fade);
}`;

  // ── Shared renderer singleton ──────────────────────────────────────────────
  let _renderer = null;

  function getRenderer() {
    if (_renderer) return _renderer;
    _renderer = new Renderer();
    return _renderer;
  }

  // ── Renderer ───────────────────────────────────────────────────────────────
  class Renderer {
    constructor() {
      this.instances = new Set();
      this.capturing = false;  // global lock — one html2canvas at a time
      this.rafId     = null;

      this.canvas = document.createElement('canvas');
      Object.assign(this.canvas.style, {
        position:      'fixed',
        inset:         '0',
        width:         '100vw',
        height:        '100vh',
        pointerEvents: 'none',
        zIndex:        '2147483647',
      });
      document.body.appendChild(this.canvas);

      this.gl = this.canvas.getContext('webgl2');
      if (!this.gl) { console.error('[WebGlass] WebGL2 not supported'); return; }

      this._initGL();
      this._startLoop();
      window.addEventListener('resize', () => this._resize());
      this._resize();
    }

    _initGL() {
      const gl = this.gl;
      this.glassProg = this._mkProg(VS, GLASS_FS);

      this.qbuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.qbuf);
      gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    }

    /** Allocate a new per-instance background texture (1×1 transparent seed). */
    createTex() {
      const gl  = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      return tex;
    }

    /** Release a per-instance texture. */
    destroyTex(tex) { this.gl.deleteTexture(tex); }

    _compile(type, src) {
      const gl = this.gl;
      const s  = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('[WebGlass] shader error:', gl.getShaderInfoLog(s));
      return s;
    }

    _mkProg(vs, fs) {
      const gl = this.gl;
      const p  = gl.createProgram();
      gl.attachShader(p, this._compile(gl.VERTEX_SHADER,   vs));
      gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        console.error('[WebGlass] link error:', gl.getProgramInfoLog(p));
      return p;
    }

    _bindQuad(prog) {
      const gl  = this.gl;
      const loc = gl.getAttribLocation(prog, 'a_pos');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.qbuf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    _uni(prog, name) { return this.gl.getUniformLocation(prog, name); }

    _resize() {
      const dpr      = Math.min(devicePixelRatio, 2);
      this.W         = Math.round(window.innerWidth  * dpr);
      this.H         = Math.round(window.innerHeight * dpr);
      this.canvas.width  = this.W;
      this.canvas.height = this.H;
      // Invalidate all captures — layout may have shifted
      for (const inst of this.instances) inst.lastCapture = 0;
    }

    /**
     * Schedule a cropped background capture for a single instance.
     * Captures only rect.{left,top,width,height} of the page — not the whole body.
     * A global lock prevents concurrent html2canvas calls.
     */
    _scheduleCapture(inst, now) {
      if (this.capturing || inst.capturing) return;
      if (now - inst.lastCapture < inst.opts.captureInterval) return;

      const rect = inst.rect;
      if (!rect || rect.width === 0 || rect.height === 0) return;

      // Flags set synchronously — prevents other instances sneaking through
      // the guard before the Promise microtask resolves.
      this.capturing = true;
      inst.capturing = true;

      this._ensureHtml2Canvas().then(h2c => {

        // Hide the WebGL overlay so html2canvas sees the real page beneath
        this.canvas.style.display = 'none';

        h2c(document.body, {
          useCORS:         true,
          allowTaint:      true,
          backgroundColor: null,
          scale:           Math.min(devicePixelRatio, 2),
          logging:         false,
          // ── Crop to exactly this element's position and size ────────────
          x:      rect.left + window.scrollX,
          y:      rect.top  + window.scrollY,
          width:  rect.width,
          height: rect.height,
        }).then(captured => {
          this.canvas.style.display = '';
          const gl = this.gl;
          gl.bindTexture(gl.TEXTURE_2D, inst.bgTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
            gl.UNSIGNED_BYTE, captured);
          inst.lastCapture = performance.now();
          this.capturing   = false;
          inst.capturing   = false;
        }).catch(() => {
          this.canvas.style.display = '';
          this.capturing = false;
          inst.capturing = false;
        });
      });
    }

    _ensureHtml2Canvas() {
      if (typeof html2canvas !== 'undefined') return Promise.resolve(html2canvas);
      if (this._h2cPromise) return this._h2cPromise;
      this._h2cPromise = new Promise((resolve, reject) => {
        const s   = document.createElement('script');
        s.src     = HTML2CANVAS_CDN;
        s.onload  = () => resolve(html2canvas);
        s.onerror = reject;
        document.head.appendChild(s);
      });
      return this._h2cPromise;
    }

    _startLoop() {
      const loop = () => {
        this.rafId = requestAnimationFrame(loop);
        if (!this.instances.size) return;
        this._frame();
      };
      this.rafId = requestAnimationFrame(loop);
    }

    _frame() {
      const gl       = this.gl;
      const { W, H } = this;
      const now      = performance.now();

      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      for (const inst of this.instances) {
        this._scheduleCapture(inst, now);
        this._drawInstance(inst);
      }
    }

    _drawInstance(inst) {
      const gl       = this.gl;
      const opts     = inst.opts;
      const rect     = inst.rect;

      if (!rect || rect.width === 0 || rect.height === 0) return;

      const dpr = Math.min(devicePixelRatio, 2);
      const px  = Math.round(rect.left   * dpr);
      const py  = Math.round((window.innerHeight - rect.bottom) * dpr);
      const pw  = Math.round(rect.width  * dpr);
      const ph  = Math.round(rect.height * dpr);

      gl.viewport(px, py, pw, ph);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(px, py, pw, ph);

      // Bind this instance's own cropped background texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inst.bgTex);

      gl.useProgram(this.glassProg);
      this._bindQuad(this.glassProg);

      // u_res = element pixel dimensions (for aspect-correct SDF)
      // u_glassCenter / u_glassSize are always 0.5 in local UV space
      const u = n => this._uni(this.glassProg, n);
      gl.uniform1i(u('u_bg'),           0);
      gl.uniform2f(u('u_res'),          rect.width, rect.height);
      gl.uniform2f(u('u_glassCenter'),  0.5, 0.5);
      gl.uniform2f(u('u_glassSize'),    0.5, 0.5);
      gl.uniform1f(u('u_cornerRadius'), opts.cornerRadius);
      gl.uniform1f(u('u_bezel'),        opts.bezel);
      gl.uniform1i(u('u_shape'),        SHAPE_MAP[opts.shape] ?? 0);
      gl.uniform1f(u('u_ior'),          opts.refraction);
      gl.uniform1f(u('u_dispScale'),    opts.scale);
      gl.uniform1f(u('u_blurRadius'),   opts.blur);
      gl.uniform1f(u('u_bgOpacity'),    opts.bgOpacity);
      gl.uniform1f(u('u_fresnel'),      opts.fresnel);
      gl.uniform1f(u('u_lightAngle'),   opts.lightAngle);
      gl.uniform1f(u('u_specStr'),      opts.specularStrength);
      gl.uniform1f(u('u_specWidth'),    opts.specularWidth);
      gl.uniform1f(u('u_specEdge'),     opts.specularEdge);
      gl.uniform1f(u('u_specBack'),     opts.specularBack);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);

      gl.viewport(0, 0, this.W, this.H);
    }

    register(inst)   { this.instances.add(inst); }

    unregister(inst) {
      this.instances.delete(inst);
      if (this.instances.size === 0) this._teardown();
    }

    _teardown() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      _renderer = null;
    }
  }

  // ── WebGlass instance ──────────────────────────────────────────────────────
  class WebGlass {
    constructor(element, options = {}) {
      if (!(element instanceof HTMLElement))
        throw new TypeError('[WebGlass] first argument must be an HTMLElement');

      this.element = element;
      this.opts    = Object.assign({}, DEFAULTS, options);
      this.rect    = null;

      // Per-instance capture state
      this.bgTex       = null;
      this.lastCapture = 0;
      this.capturing   = false;

      const pos = getComputedStyle(element).position;
      if (pos === 'static') element.style.position = 'relative';

      this._ro = new ResizeObserver(() => this._updateRect());
      this._ro.observe(element);
      this._updateRect();

      this._onScroll = () => this._updateRect();
      window.addEventListener('scroll', this._onScroll, { passive: true, capture: true });

      this._renderer = getRenderer();
      this.bgTex     = this._renderer.createTex();
      this._renderer.register(this);
    }

    _updateRect() {
      this.rect = this.element.getBoundingClientRect();
      // Invalidate so the next frame re-captures at the new position
      this.lastCapture = 0;
    }

    set(partial)  { Object.assign(this.opts, partial); }

    destroy() {
      this._ro.disconnect();
      window.removeEventListener('scroll', this._onScroll, { capture: true });
      this._renderer.destroyTex(this.bgTex);
      this._renderer.unregister(this);
    }

    static destroyAll() {
      if (_renderer)
        for (const inst of [..._renderer.instances]) inst.destroy();
    }
  }

  // ── CSS Scanner ────────────────────────────────────────────────────────────
  const _managed = new WeakMap();

  function _cssOpts(el) {
    const cs   = getComputedStyle(el);
    const opts = {};
    for (const [prop, key, parse] of CSS_PROP_MAP) {
      const raw = cs.getPropertyValue(prop).trim();
      if (raw === '') continue;
      const val = parse(raw);
      if (typeof val === 'string' || !Number.isNaN(val)) opts[key] = val;
    }
    return opts;
  }

  function _wantsGlass(el) {
    return ['true','1'].includes(
      getComputedStyle(el).getPropertyValue('--wg-render').trim()
    );
  }

  function _apply(el) {
    if (!_wantsGlass(el)) { _remove(el); return; }
    const opts = _cssOpts(el);
    if (_managed.has(el)) {
      _managed.get(el).set(opts);
    } else {
      _managed.set(el, new WebGlass(el, opts));
    }
  }

  function _remove(el) {
    if (_managed.has(el)) {
      _managed.get(el).destroy();
      _managed.delete(el);
    }
  }

  function _scanAll() {
    document.querySelectorAll('*').forEach(el => {
      if (el === document.body || el === document.documentElement) return;
      if (_wantsGlass(el)) _apply(el);
    });
  }

  function _startObserver() {
    const mo = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(node => {
            if (!(node instanceof HTMLElement)) return;
            if (_wantsGlass(node)) _apply(node);
            node.querySelectorAll('*').forEach(el => { if (_wantsGlass(el)) _apply(el); });
          });
          m.removedNodes.forEach(node => {
            if (!(node instanceof HTMLElement)) return;
            _remove(node);
            node.querySelectorAll('*').forEach(_remove);
          });
        }
        if (m.type === 'attributes' && m.target instanceof HTMLElement)
          _apply(m.target);
      }
    });

    mo.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['style', 'class'],
    });
  }

  function _boot() { _scanAll(); _startObserver(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebGlass;
  } else {
    global.WebGlass = WebGlass;
  }

}(typeof globalThis !== 'undefined' ? globalThis : this));
