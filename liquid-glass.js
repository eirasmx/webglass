/**
 * liquid-glass.js  v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Applies a physically-based liquid glass / lens refraction effect to any DOM
 * element.  One shared WebGL2 overlay canvas renders all registered instances
 * in a single frame loop.  The background is captured via html2canvas (loaded
 * automatically on first use) so the glass genuinely refracts whatever is
 * behind it in the page.
 *
 * USAGE
 * ─────
 *   // Basic
 *   const glass = new LiquidGlass(document.querySelector('.card'));
 *
 *   // With options
 *   const glass = new LiquidGlass(element, {
 *     ior:          1.45,   // Index of refraction
 *     bezel:        0.28,   // Bezel width (0–1)
 *     dispScale:    0.18,   // Distortion strength
 *     blur:         0.004,  // Frosted-glass blur
 *     cornerRadius: 0.12,   // 0 = rectangle, 1 = circle
 *     shape:        'squircle', // 'squircle' | 'circle' | 'lip' | 'concave'
 *     fresnel:      0.60,
 *     lightAngle:  -55,
 *     specStr:      0.65,
 *     specWidth:    0.22,
 *     specEdge:     0.04,
 *     specBack:     0.18,
 *     bgOpacity:    0.08,
 *     captureInterval: 200, // ms between background re-captures (0 = every frame)
 *   });
 *
 *   // Update options at runtime
 *   glass.set({ ior: 1.8, blur: 0.01 });
 *
 *   // Remove effect
 *   glass.destroy();
 *
 * API
 * ───
 *   new LiquidGlass(element, options?)  → instance
 *   instance.set(partialOptions)        → void
 *   instance.destroy()                  → void
 *   LiquidGlass.destroyAll()            → void   (remove every instance + canvas)
 *
 * REQUIREMENTS
 * ────────────
 *   • WebGL2-capable browser (all modern browsers since ~2017)
 *   • html2canvas loaded before or after this file (lazy-loaded from CDN if absent)
 *   • Position: relative/absolute/fixed on the target element (set automatically)
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (global) {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────
  const HTML2CANVAS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  const SHAPE_MAP = { squircle: 0, circle: 1, lip: 2, concave: 3 };

  const DEFAULTS = {
    ior:             1.45,
    bezel:           0.28,
    dispScale:       0.18,
    blur:            0.004,
    cornerRadius:    0.12,
    shape:           'squircle',
    fresnel:         0.60,
    lightAngle:     -55,
    specStr:         0.65,
    specWidth:       0.22,
    specEdge:        0.04,
    specBack:        0.18,
    bgOpacity:       0.08,
    captureInterval: 300,  // ms
  };

  // ── GLSL ──────────────────────────────────────────────────────────────────
  const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

  // Renders the page-background texture onto the full canvas
  const BG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_bg;
void main(){
  fragColor = texture(u_bg, vec2(v_uv.x, 1.0 - v_uv.y));
}`;

  // Glass lens — kube.io Snell-Descartes height-field physics
  const GLASS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform vec2  u_res;
uniform vec2  u_glassCenter;  // 0-1 UV
uniform vec2  u_glassSize;    // half-extents in UV space
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

// ── Height profiles ───────────────────────────────────────────────────
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

// ── Snell-Descartes ───────────────────────────────────────────────────
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

// ── Rounded-rect SDF ──────────────────────────────────────────────────
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

// ── Gaussian blur ─────────────────────────────────────────────────────
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
  vec2 uv=v_uv;
  // Flip Y to match DOM coordinates
  uv.y = 1.0 - uv.y;

  float ar=u_res.x/u_res.y;
  vec2 asp=vec2(ar,1.0);
  vec2 ps=(uv-u_glassCenter)*asp;
  vec2 bAsp=u_glassSize*asp;
  float minHalf=min(bAsp.x,bAsp.y);
  float crA=u_cornerRadius*minHalf;

  float sdf=rrectSDF(ps,bAsp,crA);
  float dist=-sdf;

  // Sample bg in original (non-flipped) space for texture lookup
  vec2 bgUV=vec2(v_uv.x, v_uv.y);

  if(sdf>0.005){ fragColor=texture(u_bg,bgUV); return; }

  float bezelW=u_bezel*minHalf;
  float s=clamp(dist/max(bezelW,0.0005),0.0,1.0);

  vec2 outGrad=rrectOutGrad(ps,bAsp,crA);
  vec2 inGrad=-outGrad;

  float eta=1.0/u_ior;
  vec2 refr=snellRefract(s,eta);
  float lateral=refr.x;
  float strength=u_dispScale*(u_ior-1.0)*3.0;
  vec2 uvOffset=(inGrad*lateral*strength)/asp;
  vec2 uvR=bgUV+uvOffset;

  vec4 bgR=u_blurRadius>0.0001
    ?blurSample(u_bg,uvR,u_blurRadius)
    :texture(u_bg,uvR);

  float R0=((1.0-u_ior)/(1.0+u_ior)); R0*=R0;
  float schlick=R0+(1.0-R0)*pow(max(1.0-s,0.0),5.0);
  float fresnelMask=schlick*u_fresnel;

  vec4 glass=mix(bgR,vec4(0.88,0.94,1.0,1.0),fresnelMask*0.55);
  glass=mix(glass,vec4(0.90,0.95,1.0,1.0),u_bgOpacity*smoothstep(0.5,1.0,s)*0.35);

  float aRad=u_lightAngle*3.14159265/180.0;
  vec2 lDir=vec2(cos(aRad),sin(aRad));
  float sEdge=s-u_specEdge;
  float specEnv=(sEdge>=0.0&&sEdge<u_specWidth)
    ?sin((sEdge/u_specWidth)*3.14159265):0.0;
  float ndlP=max(0.0,dot(outGrad,lDir));
  float ndlN=max(0.0,dot(outGrad,-lDir));
  float Ip=pow(ndlP,2.0)*specEnv*u_specStr;
  float Ib=pow(ndlN,2.0)*specEnv*u_specBack;
  float I=min(1.0,Ip+Ib);
  vec3 spec=vec3(min(1.0,I*1.05),I,I*0.94);
  vec3 out3=1.0-(1.0-glass.rgb)*(1.0-spec*I);

  float fade=smoothstep(0.0,0.005,dist);
  fragColor=mix(texture(u_bg,bgUV),vec4(out3,1.0),fade);
}`;

  // ── Shared renderer singleton ─────────────────────────────────────────────
  let _renderer = null;

  function getRenderer() {
    if (_renderer) return _renderer;
    _renderer = new Renderer();
    return _renderer;
  }

  // ── Renderer ──────────────────────────────────────────────────────────────
  class Renderer {
    constructor() {
      this.instances   = new Set();
      this.bgTex       = null;
      this.lastCapture = 0;
      this.capturing   = false;
      this.rafId       = null;

      // Overlay canvas — sits on top of everything, pointer-events: none
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
      if (!this.gl) {
        console.error('[LiquidGlass] WebGL2 not supported');
        return;
      }

      this._initGL();
      this._startLoop();

      window.addEventListener('resize', () => this._resize());
      this._resize();
    }

    // ── GL init ──────────────────────────────────────────────────────────
    _initGL() {
      const gl = this.gl;
      this.bgProg    = this._mkProg(VS, BG_FS);
      this.glassProg = this._mkProg(VS, GLASS_FS);

      this.qbuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.qbuf);
      gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

      // Background texture (filled by html2canvas captures)
      this.bgTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // 1×1 placeholder
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    }

    _compile(type, src) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('[LiquidGlass] shader error:', gl.getShaderInfoLog(s));
      return s;
    }

    _mkProg(vs, fs) {
      const gl = this.gl;
      const p = gl.createProgram();
      gl.attachShader(p, this._compile(gl.VERTEX_SHADER,   vs));
      gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        console.error('[LiquidGlass] program link error:', gl.getProgramInfoLog(p));
      return p;
    }

    _bindQuad(prog) {
      const gl  = this.gl;
      const loc = gl.getAttribLocation(prog, 'a_pos');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.qbuf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    _uni(prog, name) {
      return this.gl.getUniformLocation(prog, name);
    }

    // ── Resize ───────────────────────────────────────────────────────────
    _resize() {
      const dpr = Math.min(devicePixelRatio, 2);
      this.W = Math.round(window.innerWidth  * dpr);
      this.H = Math.round(window.innerHeight * dpr);
      this.canvas.width  = this.W;
      this.canvas.height = this.H;
      // Force re-capture after resize
      this.lastCapture = 0;
    }

    // ── Background capture ────────────────────────────────────────────────
    _scheduleCapture(now, minInterval) {
      if (this.capturing) return;
      if (now - this.lastCapture < minInterval) return;

      this._ensureHtml2Canvas().then(h2c => {
        if (this.capturing) return;
        this.capturing = true;
        // Hide our overlay while capturing so it doesn't appear in snapshot
        this.canvas.style.display = 'none';

        h2c(document.body, {
          useCORS:         true,
          allowTaint:      true,
          backgroundColor: null,
          scale:           Math.min(devicePixelRatio, 2),
          logging:         false,
        }).then(captured => {
          this.canvas.style.display = '';
          const gl = this.gl;
          gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
            gl.UNSIGNED_BYTE, captured);
          this.lastCapture = performance.now();
          this.capturing   = false;
        }).catch(() => {
          this.canvas.style.display = '';
          this.capturing = false;
        });
      });
    }

    _ensureHtml2Canvas() {
      if (typeof html2canvas !== 'undefined')
        return Promise.resolve(html2canvas);
      if (this._h2cPromise) return this._h2cPromise;
      this._h2cPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = HTML2CANVAS_CDN;
        s.onload  = () => resolve(html2canvas);
        s.onerror = reject;
        document.head.appendChild(s);
      });
      return this._h2cPromise;
    }

    // ── Render loop ───────────────────────────────────────────────────────
    _startLoop() {
      const loop = (ms) => {
        this.rafId = requestAnimationFrame(loop);
        if (!this.instances.size) return;
        this._frame(ms);
      };
      this.rafId = requestAnimationFrame(loop);
    }

    _frame(ms) {
      const gl = this.gl;
      const { W, H } = this;

      // Find the shortest captureInterval across all instances
      let minInterval = Infinity;
      for (const inst of this.instances)
        minInterval = Math.min(minInterval, inst.opts.captureInterval);

      this._scheduleCapture(performance.now(), minInterval);

      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Draw each registered glass instance
      for (const inst of this.instances) {
        this._drawInstance(inst);
      }
    }

    _drawInstance(inst) {
      const gl   = this.gl;
      const { W, H } = this;
      const opts = inst.opts;
      const rect = inst.rect;   // updated by the instance's observer

      if (!rect || rect.width === 0 || rect.height === 0) return;

      // Convert DOM rect to UV space (0-1, Y from top)
      const scaleX  = 1 / window.innerWidth;
      const scaleY  = 1 / window.innerHeight;
      const centerX = (rect.left + rect.width  * 0.5) * scaleX;
      const centerY = (rect.top  + rect.height * 0.5) * scaleY;
      const halfW   = (rect.width  * 0.5) * scaleX;
      const halfH   = (rect.height * 0.5) * scaleY;

      // Clip the viewport to this element's pixel area for efficiency
      const dpr = Math.min(devicePixelRatio, 2);
      const px  = Math.round(rect.left   * dpr);
      const py  = Math.round((window.innerHeight - rect.bottom) * dpr);
      const pw  = Math.round(rect.width  * dpr);
      const ph  = Math.round(rect.height * dpr);

      gl.viewport(px, py, pw, ph);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(px, py, pw, ph);

      // Bind background texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);

      // Draw glass
      gl.useProgram(this.glassProg);
      this._bindQuad(this.glassProg);

      const u = (n) => this._uni(this.glassProg, n);
      gl.uniform1i(u('u_bg'),           0);
      gl.uniform2f(u('u_res'),          W, H);
      gl.uniform2f(u('u_glassCenter'),  centerX, centerY);
      gl.uniform2f(u('u_glassSize'),    halfW,   halfH);
      gl.uniform1f(u('u_cornerRadius'), opts.cornerRadius);
      gl.uniform1f(u('u_bezel'),        opts.bezel);
      gl.uniform1i(u('u_shape'),        SHAPE_MAP[opts.shape] ?? 0);
      gl.uniform1f(u('u_ior'),          opts.ior);
      gl.uniform1f(u('u_dispScale'),    opts.dispScale);
      gl.uniform1f(u('u_blurRadius'),   opts.blur);
      gl.uniform1f(u('u_bgOpacity'),    opts.bgOpacity);
      gl.uniform1f(u('u_fresnel'),      opts.fresnel);
      gl.uniform1f(u('u_lightAngle'),   opts.lightAngle);
      gl.uniform1f(u('u_specStr'),      opts.specStr);
      gl.uniform1f(u('u_specWidth'),    opts.specWidth);
      gl.uniform1f(u('u_specEdge'),     opts.specEdge);
      gl.uniform1f(u('u_specBack'),     opts.specBack);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);

      // Reset viewport to full canvas
      gl.viewport(0, 0, this.W, this.H);
    }

    // ── Instance registry ─────────────────────────────────────────────────
    register(inst) {
      this.instances.add(inst);
    }

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

  // ── LiquidGlass instance ──────────────────────────────────────────────────
  class LiquidGlass {
    /**
     * @param {HTMLElement} element
     * @param {object}      [options]
     */
    constructor(element, options = {}) {
      if (!(element instanceof HTMLElement))
        throw new TypeError('[LiquidGlass] first argument must be an HTMLElement');

      this.element = element;
      this.opts    = Object.assign({}, DEFAULTS, options);
      this.rect    = null;

      // Make sure we can overlay correctly
      const pos = getComputedStyle(element).position;
      if (pos === 'static') element.style.position = 'relative';

      // Track position/size
      this._ro = new ResizeObserver(() => this._updateRect());
      this._ro.observe(element);
      this._updateRect();

      // Also update rect on scroll (use capture so nested scrollers work)
      this._onScroll = () => this._updateRect();
      window.addEventListener('scroll', this._onScroll, { passive: true, capture: true });

      // Register with the shared renderer
      this._renderer = getRenderer();
      this._renderer.register(this);
    }

    _updateRect() {
      this.rect = this.element.getBoundingClientRect();
    }

    /**
     * Update options at runtime.
     * @param {object} partial
     */
    set(partial) {
      Object.assign(this.opts, partial);
    }

    /**
     * Remove the glass effect from this element.
     */
    destroy() {
      this._ro.disconnect();
      window.removeEventListener('scroll', this._onScroll, { capture: true });
      this._renderer.unregister(this);
    }

    /**
     * Remove every LiquidGlass instance and the overlay canvas.
     */
    static destroyAll() {
      if (_renderer) {
        for (const inst of [..._renderer.instances]) inst.destroy();
      }
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiquidGlass;
  } else {
    global.LiquidGlass = LiquidGlass;
  }

}(typeof globalThis !== 'undefined' ? globalThis : this));
