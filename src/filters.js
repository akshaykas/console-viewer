// Retro filters drawn with WebGL on a canvas laid over the video.
// The video keeps playing underneath, so picture in picture, screenshots
// and recordings always use the clean signal.

const FILTERS = {
  off: { label: 'Off' },
  scanlines: { label: 'Scanlines', mode: 1 },
  crt: { label: 'CRT', mode: 2 },
}

const VERTEX_SHADER = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uSrcSize;
uniform float uLines;
uniform int uMode;
varying vec2 vUv;

const float PI = 3.14159265;

// Bends the picture like the glass of an old tube TV
vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 offset = abs(uv.yx) / vec2(5.5, 4.5);
  uv = uv + uv * offset * offset;
  return uv * 0.5 + 0.5;
}

void main() {
  vec2 uv = vUv;
  bool crt = uMode == 2;

  if (crt) {
    uv = curve(uv);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }

  vec3 color = texture2D(uTex, uv).rgb;

  if (crt) {
    // Color bleed: red and blue smear slightly sideways, as on composite video
    vec2 px = vec2(1.0 / uSrcSize.x, 0.0);
    color.r = mix(color.r, texture2D(uTex, uv - px * 1.5).r, 0.45);
    color.b = mix(color.b, texture2D(uTex, uv + px * 1.5).b, 0.45);

    // Soft glow around bright areas
    vec3 glow = texture2D(uTex, uv + px * 3.0).rgb + texture2D(uTex, uv - px * 3.0).rgb;
    color += glow * 0.06;
  }

  // Darken the gaps between lines, then lift the result back up
  float line = 0.5 + 0.5 * cos(uv.y * uLines * 2.0 * PI);
  float strength = crt ? 0.42 : 0.35;
  color *= 1.0 - strength * (1.0 - line);
  color *= crt ? 1.28 : 1.18;

  if (crt) {
    // Red, green and blue phosphor stripes
    float stripe = mod(gl_FragCoord.x, 3.0);
    vec3 mask = vec3(0.86);
    if (stripe < 1.0) mask.r = 1.08;
    else if (stripe < 2.0) mask.g = 1.08;
    else mask.b = 1.08;
    color *= mask;

    // Darker corners
    float vignette = 16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
    color *= pow(vignette, 0.18);
  }

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`

class FilterRenderer {
  constructor(video, canvas) {
    this.video = video
    this.canvas = canvas
    this.filter = 'off'
    this.running = false
    this.callbackId = null
    this.onFrameDrawn = null
    this.gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      // Lets the browser show the canvas without waiting for the next page update
      desynchronized: true,
      preserveDrawingBuffer: false,
    })
    this.supported = Boolean(this.gl)
    if (this.supported) this.setup()
  }

  setup() {
    const gl = this.gl
    const compile = (type, source) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader))
      }
      return shader
    }

    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
    gl.linkProgram(program)
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    this.uniforms = {
      srcSize: gl.getUniformLocation(program, 'uSrcSize'),
      lines: gl.getUniformLocation(program, 'uLines'),
      mode: gl.getUniformLocation(program, 'uMode'),
    }
  }

  get active() {
    return this.supported && this.filter !== 'off'
  }

  setFilter(name) {
    this.filter = FILTERS[name] ? name : 'off'
    this.canvas.classList.toggle('hidden', !this.active)
    if (this.active) this.start()
    else this.stop()
  }

  // Pixel perfect scaling keeps hard pixel edges, everything else blends
  setSmooth(smooth) {
    if (!this.supported) return
    const gl = this.gl
    const mode = smooth ? gl.LINEAR : gl.NEAREST
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mode)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mode)
  }

  // Matches the canvas to the size the video is drawn at, in physical pixels
  resize(cssWidth, cssHeight) {
    const dpr = window.devicePixelRatio || 1
    this.canvas.style.width = `${cssWidth}px`
    this.canvas.style.height = `${cssHeight}px`
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr))
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr))
  }

  start() {
    if (this.running) return
    this.running = true
    this.schedule()
  }

  stop() {
    this.running = false
    if (this.callbackId !== null) {
      if ('cancelVideoFrameCallback' in this.video) this.video.cancelVideoFrameCallback(this.callbackId)
      else cancelAnimationFrame(this.callbackId)
      this.callbackId = null
    }
  }

  schedule() {
    if (!this.running) return
    if ('requestVideoFrameCallback' in this.video) {
      this.callbackId = this.video.requestVideoFrameCallback((now, meta) => this.draw(now, meta))
    } else {
      this.callbackId = requestAnimationFrame((now) => this.draw(now, null))
    }
  }

  draw(now, meta) {
    const gl = this.gl
    const v = this.video
    if (v.videoWidth && v.readyState >= 2) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v)

      // Retro games are usually 240 lines, doubled or more by the console or upscaler
      const h = v.videoHeight
      const lines = h <= 288 ? h : h <= 576 ? h / 2 : 240
      gl.uniform2f(this.uniforms.srcSize, v.videoWidth, h)
      gl.uniform1f(this.uniforms.lines, lines)
      gl.uniform1i(this.uniforms.mode, FILTERS[this.filter].mode || 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      if (this.onFrameDrawn) this.onFrameDrawn(now, meta)
    }
    this.schedule()
  }
}
