// Bridge from preload.js. Missing when the page runs as the website.
const api = window.consoleViewer
const isWeb = !api
const isWindows =
  navigator.userAgentData?.platform === 'Windows' || /Windows/.test(navigator.userAgent)

const video = document.getElementById('video')
const overlay = document.getElementById('overlay')
const statusTitle = document.getElementById('status-title')
const statusDetail = document.getElementById('status-detail')
const overlayActions = document.getElementById('overlay-actions')
const connectBtn = document.getElementById('connect')
const downloadLink = document.getElementById('download')
const getAppLink = document.getElementById('get-app')
const soundHint = document.getElementById('sound-hint')
const deviceSelect = document.getElementById('device')
const resSelect = document.getElementById('resolution')
const fpsSelect = document.getElementById('framerate')
const scaleSelect = document.getElementById('scaling')
const volume = document.getElementById('volume')
const pipBtn = document.getElementById('pip')
const statsBtn = document.getElementById('stats')
const fullscreenBtn = document.getElementById('fullscreen')
const hud = document.getElementById('hud')
const hudLatency = document.getElementById('hud-latency')
const hudFps = document.getElementById('hud-fps')
const hudDropped = document.getElementById('hud-dropped')
const hudAudio = document.getElementById('hud-audio')
const hudSignal = document.getElementById('hud-signal')
const hudScale = document.getElementById('hud-scale')

// Names and USB IDs that cheap HDMI to USB dongles usually report.
// 345f and 534d are the vendor IDs of the MacroSilicon chips inside most of them.
const CAPTURE_PATTERNS = [
  /usb\s?\d?\.?\d?\s?video/i,
  /ms21\d\d/i,
  /\(345f:/i,
  /\(534d:/i,
  /capture/i,
  /hdmi/i,
  /cam link/i,
  /uvc/i,
]
const looksLikeCapture = (label) => CAPTURE_PATTERNS.some((p) => p.test(label))

// Highest first, so the first enabled option is always the best supported one
const RESOLUTIONS = [
  ['3840x2160', '4K'],
  ['2560x1440', '1440p'],
  ['1920x1080', '1080p'],
  ['1280x720', '720p'],
  ['1024x768', '1024x768'],
  ['720x576', '576p'],
  ['720x480', '480p'],
  ['640x480', '640x480'],
]
const FRAME_RATES = [60, 50, 30]
const SCALE_MODES = ['fit', 'stretch', 'integer', 'aspect43']

for (const [value, label] of RESOLUTIONS) resSelect.add(new Option(label, value))
for (const fps of FRAME_RATES) fpsSelect.add(new Option(`${fps} fps`, String(fps)))

let stream = null
let audioCtx = null
let gainNode = null
let statsOn = false
let scaleText = ''

// The download link only makes sense on the website, for Windows visitors
const offerDownload = isWeb && isWindows

function showStatus(title, detail = '', { connect = false, download = false } = {}) {
  statusTitle.textContent = title
  statusDetail.textContent = detail
  connectBtn.classList.toggle('hidden', !connect)
  downloadLink.classList.toggle('hidden', !(download && offerDownload))
  overlayActions.classList.toggle('hidden', !connect && !(download && offerDownload))
  overlay.classList.remove('hidden')
}

function hideStatus() {
  overlay.classList.add('hidden')
}

function stop() {
  soundHint.classList.add('hidden')
  if (stream) stream.getTracks().forEach((t) => t.stop())
  if (audioCtx) audioCtx.close()
  stream = null
  audioCtx = null
  gainNode = null
  video.srcObject = null
  latencySamples.length = 0
}

async function getDevices() {
  let devices = await navigator.mediaDevices.enumerateDevices()

  // Device names stay blank until camera access is granted once
  if (devices.some((d) => d.kind === 'videoinput' && !d.label)) {
    try {
      const temp = await navigator.mediaDevices.getUserMedia({ video: true })
      temp.getTracks().forEach((t) => t.stop())
      devices = await navigator.mediaDevices.enumerateDevices()
    } catch {}
  }

  return {
    videos: devices.filter((d) => d.kind === 'videoinput'),
    audios: devices.filter((d) => d.kind === 'audioinput'),
  }
}

async function refreshDevices() {
  const { videos } = await getDevices()
  const saved = localStorage.getItem('videoDevice')

  deviceSelect.innerHTML = ''

  // Placeholder so picking any real device counts as a change
  const placeholder = new Option('Choose a device', '')
  placeholder.disabled = true
  placeholder.selected = true
  deviceSelect.add(placeholder)

  for (const v of videos) deviceSelect.add(new Option(v.label || 'Unknown camera', v.deviceId))

  // Prefer the last used device, then anything that looks like a dongle.
  // Never auto-start the laptop webcam.
  const pick =
    videos.find((v) => v.deviceId === saved) ||
    videos.find((v) => looksLikeCapture(v.label)) ||
    null

  if (pick) deviceSelect.value = pick.deviceId
  return pick
}

// Grey out modes the dongle can't do, and move off one if it's selected
function applyCapabilities(track) {
  const caps = track.getCapabilities ? track.getCapabilities() : {}
  const maxW = caps.width?.max ?? Infinity
  const maxH = caps.height?.max ?? Infinity
  const maxFps = caps.frameRate?.max ?? Infinity

  for (const opt of resSelect.options) {
    const [w, h] = opt.value.split('x').map(Number)
    opt.disabled = w > maxW || h > maxH
  }
  for (const opt of fpsSelect.options) {
    opt.disabled = Number(opt.value) > Math.round(maxFps)
  }

  for (const select of [resSelect, fpsSelect]) {
    if (select.selectedOptions[0]?.disabled) {
      const best = [...select.options].find((o) => !o.disabled)
      if (best) select.value = best.value
    }
  }
}

async function start(deviceId) {
  stop()
  showStatus('Connecting')

  const [width, height] = resSelect.value.split('x').map(Number)
  const frameRate = Number(fpsSelect.value)
  const { videos, audios } = await getDevices()
  const vid = videos.find((v) => v.deviceId === deviceId)

  if (!vid) {
    showStatus('Capture device not found', 'Plug in your HDMI dongle and it will connect automatically.')
    return
  }

  // The dongle's audio input shares a groupId with its video input
  const aud =
    audios.find(
      (a) =>
        a.groupId === vid.groupId &&
        a.deviceId !== 'default' &&
        a.deviceId !== 'communications'
    ) || audios.find((a) => looksLikeCapture(a.label))

  const audio = aud
    ? {
        deviceId: { exact: aud.deviceId },
        // These are on by default for webcams and ruin game audio
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      }
    : false

  // For games, frame rate matters more than resolution. Start at the chosen
  // resolution and step down until the dongle offers the chosen frame rate.
  const startIndex = Math.max(0, RESOLUTIONS.findIndex(([value]) => value === resSelect.value))
  const candidates = RESOLUTIONS.slice(startIndex).map(([value]) => value)
  let usedResolution = null
  let lastError = null

  for (const value of candidates) {
    const [w, h] = value.split('x').map(Number)
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { exact: w },
          height: { exact: h },
          frameRate: { min: frameRate - 1, ideal: frameRate },
          // Use the dongle's real modes instead of letting Chrome rescale
          resizeMode: 'none',
        },
        audio,
      })
      usedResolution = value
      break
    } catch (err) {
      lastError = err
      if (err.name !== 'OverconstrainedError') break
    }
  }

  // Nothing matched, so let the browser pick the closest mode it can
  if (!stream && lastError?.name === 'OverconstrainedError') {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: frameRate },
        },
        audio,
      })
    } catch (err) {
      lastError = err
    }
  }

  if (!stream) {
    const err = lastError || new Error('Unknown error')
    if (err.name === 'NotAllowedError') {
      showStatus(
        'Camera access is turned off',
        api?.platform === 'darwin'
          ? 'Your Mac treats the HDMI dongle as a camera. Open System Settings, go to Privacy & Security, and turn on Console Viewer under Camera and Microphone. Then reopen the app.'
          : 'Turn on camera and microphone access for Console Viewer in your privacy settings, then reopen the app.'
      )
    } else {
      showStatus(
        'Could not open the capture device',
        `${err.name}: ${err.message}\nClose other apps that might be using it (OBS, Discord, Teams) or try another USB port.`
      )
    }
    return
  }

  // Show the resolution that is actually running
  if (usedResolution && usedResolution !== resSelect.value) {
    resSelect.value = usedResolution
  }

  localStorage.setItem('videoDevice', deviceId)
  video.srcObject = new MediaStream(stream.getVideoTracks())

  if (aud) {
    audioCtx = new AudioContext({ latencyHint: 'interactive' })
    gainNode = audioCtx.createGain()
    gainNode.gain.value = Number(volume.value)
    audioCtx
      .createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
      .connect(gainNode)
      .connect(audioCtx.destination)
    watchAudioState(audioCtx)
  }

  const track = stream.getVideoTracks()[0]
  track.onended = () => showStatus('Capture device disconnected', 'Plug it back in to reconnect.')

  applyCapabilities(track)
  hideStatus()
  layoutVideo()
}

async function autoConnect() {
  if (stream && stream.active) return
  const pick = await refreshDevices()
  if (pick) {
    start(pick.deviceId)
  } else {
    showStatus(
      'No capture device found',
      'Plug in your HDMI to USB dongle, or choose a device from the menu below.',
      { download: true }
    )
  }
}

// On the website, nothing touches the camera until the visitor asks,
// unless they already allowed it on an earlier visit
let allowedToConnect = !isWeb

async function cameraAlreadyAllowed() {
  try {
    const status = await navigator.permissions.query({ name: 'camera' })
    return status.state === 'granted'
  } catch {
    return false
  }
}

function showWelcome() {
  showStatus(
    'Play your console in your browser',
    'Plug your HDMI capture dongle into this computer, then connect it. Your browser will ask for camera and microphone access, because that is how it sees the dongle.',
    { connect: true, download: true }
  )
}

connectBtn.onclick = () => {
  allowedToConnect = true
  autoConnect()
}

// Browsers keep audio paused until the visitor clicks or presses a key on the page.
// Show a prompt until then, and resume on the first interaction.

function watchAudioState(ctx) {
  const update = () => soundHint.classList.toggle('hidden', ctx.state !== 'suspended')
  ctx.onstatechange = update
  ctx.resume().catch(() => {})
  update()
}

function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
}

window.addEventListener('pointerdown', resumeAudio)
window.addEventListener('keydown', resumeAudio)
soundHint.onclick = resumeAudio

// Scaling

function setVideoSize(width, height, fit) {
  video.style.width = width
  video.style.height = height
  video.style.objectFit = fit
}

function layoutVideo() {
  const mode = scaleSelect.value
  const winW = window.innerWidth
  const winH = window.innerHeight
  const srcW = video.videoWidth
  const srcH = video.videoHeight

  video.classList.toggle('pixelated', mode === 'integer')

  if (mode === 'stretch') {
    scaleText = 'Stretch'
    setVideoSize('100%', '100%', 'fill')
    return
  }

  // Squeeze the picture into a 4:3 box. Fixes retro consoles that come out stretched to 16:9.
  if (mode === 'aspect43') {
    const w = Math.floor(Math.min(winW, (winH * 4) / 3))
    scaleText = '4:3'
    setVideoSize(`${w}px`, `${Math.floor((w * 3) / 4)}px`, 'fill')
    return
  }

  if (mode === 'integer' && srcW && srcH) {
    // Work in physical pixels so each source pixel becomes an exact block on screen
    const dpr = window.devicePixelRatio || 1
    const k = Math.floor(Math.min((winW * dpr) / srcW, (winH * dpr) / srcH))
    if (k >= 1) {
      scaleText = `${k}x pixel perfect`
      setVideoSize(`${(srcW * k) / dpr}px`, `${(srcH * k) / dpr}px`, 'fill')
      return
    }
    scaleText = 'Fit (window smaller than signal)'
    setVideoSize('100%', '100%', 'contain')
    return
  }

  scaleText = 'Fit'
  setVideoSize('100%', '100%', 'contain')
}

window.addEventListener('resize', layoutVideo)
video.addEventListener('loadedmetadata', layoutVideo)
video.addEventListener('resize', layoutVideo)

// Stats and latency

const latencySamples = []
const frameTimes = []
let frameCallbackId = null

function onFrame(now, meta) {
  frameTimes.push(now)

  // captureTime is when this computer received the frame from the dongle
  if (typeof meta.captureTime === 'number') {
    const ms = meta.expectedDisplayTime - meta.captureTime
    if (ms > 0 && ms < 1000) {
      latencySamples.push(ms)
      if (latencySamples.length > 60) latencySamples.shift()
    }
  }

  frameCallbackId = video.requestVideoFrameCallback(onFrame)
}

function renderHud() {
  const now = performance.now()
  while (frameTimes.length && now - frameTimes[0] > 1000) frameTimes.shift()

  hudFps.textContent = stream ? `${frameTimes.length} fps` : '--'

  if (latencySamples.length) {
    const avg = latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length
    hudLatency.textContent = `${Math.round(avg)} ms`
    hudLatency.className = avg < 50 ? 'good' : avg < 90 ? 'ok' : 'bad'
  } else {
    hudLatency.textContent = 'n/a'
    hudLatency.className = ''
  }

  const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null
  hudDropped.textContent = quality && stream ? String(quality.droppedVideoFrames) : '--'

  hudAudio.textContent = audioCtx
    ? `${Math.round((audioCtx.baseLatency + (audioCtx.outputLatency || 0)) * 1000)} ms`
    : 'No audio'

  const track = stream?.getVideoTracks()[0]
  if (track) {
    const s = track.getSettings()
    hudSignal.textContent = `${s.width}x${s.height} at ${Math.round(s.frameRate)} fps`
  } else {
    hudSignal.textContent = '--'
  }

  hudScale.textContent = scaleText || '--'
}

function setStats(on) {
  statsOn = on
  hud.classList.toggle('hidden', !on)
  statsBtn.setAttribute('aria-pressed', String(on))
  localStorage.setItem('stats', on ? '1' : '0')

  if (!('requestVideoFrameCallback' in video)) return
  if (on && frameCallbackId === null) {
    frameCallbackId = video.requestVideoFrameCallback(onFrame)
  } else if (!on && frameCallbackId !== null) {
    video.cancelVideoFrameCallback(frameCallbackId)
    frameCallbackId = null
    frameTimes.length = 0
    latencySamples.length = 0
  }
  if (on) renderHud()
}

setInterval(() => {
  if (statsOn) renderHud()
}, 250)

// Picture in picture

async function togglePip() {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture()
    } else if (stream) {
      await video.requestPictureInPicture()
    }
  } catch (err) {
    console.warn('Picture in picture failed', err)
  }
}

video.addEventListener('enterpictureinpicture', () => pipBtn.setAttribute('aria-pressed', 'true'))
video.addEventListener('leavepictureinpicture', () => pipBtn.setAttribute('aria-pressed', 'false'))

// Controls

deviceSelect.onchange = () => start(deviceSelect.value)

resSelect.onchange = () => {
  localStorage.setItem('resolution', resSelect.value)
  if (deviceSelect.value) start(deviceSelect.value)
}

fpsSelect.onchange = () => {
  localStorage.setItem('framerate', fpsSelect.value)
  if (deviceSelect.value) start(deviceSelect.value)
}

scaleSelect.onchange = () => {
  localStorage.setItem('scaling', scaleSelect.value)
  layoutVideo()
}

volume.oninput = () => {
  if (gainNode) gainNode.gain.value = Number(volume.value)
  localStorage.setItem('volume', volume.value)
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen()
}

function cycleScaling() {
  const next = SCALE_MODES[(SCALE_MODES.indexOf(scaleSelect.value) + 1) % SCALE_MODES.length]
  scaleSelect.value = next
  scaleSelect.onchange()
}

pipBtn.onclick = togglePip
statsBtn.onclick = () => setStats(!statsOn)
fullscreenBtn.onclick = toggleFullscreen
video.ondblclick = toggleFullscreen

window.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault()
    toggleFullscreen()
    return
  }

  // Leave letter keys alone while a menu or slider has focus
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (['SELECT', 'INPUT'].includes(document.activeElement?.tagName)) return

  const key = e.key.toLowerCase()
  if (key === 'f') toggleFullscreen()
  else if (key === 'p') togglePip()
  else if (key === 'l') setStats(!statsOn)
  else if (key === 's') cycleScaling()
})

// Hide the controls and cursor after a few seconds without mouse movement
let idleTimer
function wake() {
  document.body.classList.remove('idle')
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500)
}
window.addEventListener('mousemove', wake)
wake()

// Reconnect when a USB device is plugged in or removed
let changeTimer
if (navigator.mediaDevices) {
  navigator.mediaDevices.ondevicechange = () => {
    if (!allowedToConnect) return
    clearTimeout(changeTimer)
    changeTimer = setTimeout(autoConnect, 500)
  }
}

// Restore saved settings and connect
function restore(select, key, fallback) {
  select.value = localStorage.getItem(key) || fallback
  if (!select.value) select.value = fallback
}
restore(resSelect, 'resolution', '1920x1080')
restore(fpsSelect, 'framerate', '60')
restore(scaleSelect, 'scaling', 'fit')
volume.value = localStorage.getItem('volume') || '1'

if (!document.pictureInPictureEnabled) pipBtn.hidden = true

setStats(localStorage.getItem('stats') === '1')
if (offerDownload) getAppLink.classList.remove('hidden')

// Lets the website work offline and be installed as an app
if (isWeb && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}

async function init() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showStatus(
      'This browser cannot open capture devices',
      'Use the latest Chrome or Edge, and make sure the page address starts with https.',
      { download: true }
    )
    return
  }

  if (isWeb && !(await cameraAlreadyAllowed())) {
    showWelcome()
    return
  }

  allowedToConnect = true
  autoConnect()
}

init()