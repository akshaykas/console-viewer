// Bridge from preload.js. Missing when the page runs as the website.
const api = window.consoleViewer
const isWeb = !api
const isWindows =
  navigator.userAgentData?.platform === 'Windows' || /Windows/.test(navigator.userAgent)

const $ = (id) => document.getElementById(id)

const video = $('video')
const filterCanvas = $('filter-canvas')
const overlay = $('overlay')
const statusTitle = $('status-title')
const statusDetail = $('status-detail')
const statusSetup = $('status-setup')
const overlayActions = $('overlay-actions')
const connectBtn = $('connect')
const downloadLink = $('download')
const soundHint = $('sound-hint')
const noSignalEl = $('no-signal')
const flashEl = $('flash')
const controls = $('controls')
const profileSelect = $('profile')
const scaleSeg = $('scale-seg')
const filterSeg = $('filter-seg')
const muteBtn = $('mute')
const volume = $('volume')
const screenshotBtn = $('screenshot')
const recordBtn = $('record')
const replayBtn = $('replay')
const lowLatencyBtn = $('low-latency')
const statsBtn = $('stats')
const pipBtn = $('pip')
const fullscreenBtn = $('fullscreen')
const settingsBtn = $('settings-btn')
const settingsSheet = $('settings')
const deviceSelect = $('device')
const resSelect = $('resolution')
const fpsSelect = $('framerate')
const profileName = $('profile-name')
const audioDelay = $('audio-delay')
const audioDelayValue = $('audio-delay-value')
const micSelect = $('mic')
const micLevel = $('mic-level')
const replayToggle = $('replay-toggle')
const lowLatencyToggle = $('low-latency-toggle')
const controllerStatus = $('controller-status')
const recIndicator = $('rec-indicator')
const recTime = $('rec-time')
const tipEl = $('tip')
const toastsEl = $('toasts')
const landing = $('landing')
const demoVideo = $('demo-video')
const hud = $('hud')
const hudLatency = $('hud-latency')
const hudFps = $('hud-fps')
const hudDropped = $('hud-dropped')
const hudAudio = $('hud-audio')
const hudSignal = $('hud-signal')
const hudScale = $('hud-scale')
const hudMode = $('hud-mode')

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
const resolutionLabel = (value) => RESOLUTIONS.find(([v]) => v === value)?.[1] || value
const FRAME_RATES = [60, 50, 30]
const SCALE_MODES = ['fit', 'stretch', 'integer', 'aspect43']
const FILTER_ORDER = ['off', 'scanlines', 'crt']

for (const [value, label] of RESOLUTIONS) resSelect.add(new Option(label, value))
for (const fps of FRAME_RATES) fpsSelect.add(new Option(`${fps} fps`, String(fps)))

// Saved settings

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : JSON.parse(value)
  } catch {
    return fallback
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function legacy(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// Settings that belong to a profile. Everything else is shared.
const DEFAULT_PROFILE = {
  resolution: legacy('resolution') || '1920x1080',
  framerate: Number(legacy('framerate')) || 60,
  scaling: legacy('scaling') || 'fit',
  filter: 'off',
  audioDelay: 0,
}

let profiles = load('cv.profiles', null) || { Default: { ...DEFAULT_PROFILE } }
let activeProfile = load('cv.activeProfile', 'Default')
if (!profiles[activeProfile]) activeProfile = Object.keys(profiles)[0]
const deviceProfiles = load('cv.deviceProfiles', {})

const prefs = {
  volume: Number(legacy('volume')) || 1,
  muted: false,
  lowLatency: false,
  replay: false,
  stats: legacy('stats') === '1',
  micId: '',
  micLevel: 1,
  videoDevice: legacy('videoDevice') || '',
  ...load('cv.prefs', {}),
}
const savePrefs = () => save('cv.prefs', prefs)

const profile = () => profiles[activeProfile]

function setProfileValue(key, value) {
  profile()[key] = value
  save('cv.profiles', profiles)
}

// Live state

let stream = null
let currentDevice = null
let audioCtx = null
let gainNode = null
let delayNode = null
let recDest = null
let hasGameAudio = false
let micStream = null
let micGain = null
let recorder = null
let recTimer = null
let replay = null
let statsOn = false
let scaleText = ''
let allowedToConnect = !isWeb

const recType = pickRecordingType()
const filters = new FilterRenderer(video, filterCanvas)

// Running as an app installed from the browser, in its own window
const isInstalledWebApp =
  window.matchMedia?.('(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)')
    .matches || navigator.standalone === true

// The download link only makes sense in a browser tab, for Windows visitors
const offerDownload = isWeb && isWindows && !isInstalledWebApp

// Toasts

function toast(message, { action, duration = 3800 } = {}) {
  const el = document.createElement('div')
  el.className = 'toast'
  const text = document.createElement('span')
  text.textContent = message
  el.append(text)
  if (action) {
    const btn = document.createElement('button')
    btn.textContent = action.label
    btn.onclick = () => {
      action.run()
      dismiss()
    }
    el.append(btn)
  }
  toastsEl.append(el)
  while (toastsEl.children.length > 3) toastsEl.firstElementChild.remove()

  function dismiss() {
    el.classList.add('leaving')
    setTimeout(() => el.remove(), 250)
  }
  setTimeout(dismiss, action ? duration + 2500 : duration)
}

// Troubleshooting tips, each shown at most once per session

const dismissedTips = load('cv.dismissedTips', {})
const shownTips = new Set()

function showTip(id, title, text) {
  if (dismissedTips[id] || shownTips.has(id) || !tipEl.classList.contains('hidden')) return
  shownTips.add(id)
  $('tip-title').textContent = title
  $('tip-text').textContent = text
  tipEl.classList.remove('hidden')
  tipEl.dataset.id = id
}

$('tip-ok').onclick = () => tipEl.classList.add('hidden')
$('tip-never').onclick = () => {
  dismissedTips[tipEl.dataset.id] = true
  save('cv.dismissedTips', dismissedTips)
  tipEl.classList.add('hidden')
}

// Status screen

const setupTemplate = $('setup-template')

function showStatus(
  title,
  detail = '',
  { connect = false, download = false, installer = false, setup = false } = {}
) {
  statusTitle.textContent = title
  statusDetail.textContent = detail
  statusSetup.replaceChildren(...(setup ? [setupTemplate.content.cloneNode(true)] : []))
  const showDownload = download && offerDownload
  const showInstaller = installer && offerDownload
  connectBtn.classList.toggle('hidden', !connect)
  downloadLink.classList.toggle('hidden', !showDownload)
  $('download-installer').classList.toggle('hidden', !showInstaller)
  overlayActions.classList.toggle('hidden', !connect && !showDownload && !showInstaller)
  overlay.classList.remove('hidden')
}

function hideStatus() {
  overlay.classList.add('hidden')
}

// Website front page

function showLanding({ back = false } = {}) {
  $('landing-back').classList.toggle('hidden', !back)
  $('landing-connect').classList.toggle('hidden', back)
  landing.classList.remove('hidden')
  landing.scrollTop = 0
  if (!demoVideo.src) demoVideo.src = demoVideo.dataset.src
  closeSettings()
}

function hideLanding() {
  landing.classList.add('hidden')
}

// Devices

async function getDevices() {
  let devices = await navigator.mediaDevices.enumerateDevices()

  // Browsers hide device names and IDs until access is granted. Ask for the
  // microphone too, since the dongle's game audio arrives as a microphone.
  const hidden = devices.some(
    (d) => (d.kind === 'videoinput' || d.kind === 'audioinput') && !d.label
  )
  if (hidden) {
    let temp = null
    try {
      temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch {
      // No microphone allowed or present, so carry on with video only
      try {
        temp = await navigator.mediaDevices.getUserMedia({ video: true })
      } catch {}
    }
    if (temp) {
      temp.getTracks().forEach((t) => t.stop())
      devices = await navigator.mediaDevices.enumerateDevices()
    }
  }

  return {
    videos: devices.filter((d) => d.kind === 'videoinput'),
    audios: devices.filter((d) => d.kind === 'audioinput'),
  }
}

// The dongle's audio input shares a groupId with its video input
function findDongleAudio(vid, audios) {
  return (
    audios.find(
      (a) =>
        a.groupId === vid.groupId && a.deviceId !== 'default' && a.deviceId !== 'communications'
    ) || audios.find((a) => looksLikeCapture(a.label))
  )
}

async function refreshDevices() {
  const { videos } = await getDevices()

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
    videos.find((v) => v.deviceId === prefs.videoDevice) ||
    videos.find((v) => looksLikeCapture(v.label)) ||
    null

  if (pick) deviceSelect.value = pick.deviceId
  return pick
}

function fillMicList(audios, dongleAudio) {
  micSelect.innerHTML = ''
  micSelect.add(new Option('Off', ''))
  for (const a of audios) {
    if (a.deviceId === 'communications' || a.deviceId === dongleAudio?.deviceId) continue
    if (dongleAudio && a.groupId === dongleAudio.groupId && a.deviceId === 'default') continue
    micSelect.add(new Option(a.label || 'Microphone', a.deviceId))
  }
  micSelect.value = prefs.micId
  if (micSelect.value !== prefs.micId) micSelect.value = ''
  $('mic-level-row').classList.toggle('hidden', !micSelect.value)
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

  // A dongle that can't reach 50 fps is often sitting in a USB 2 port
  if (profile().framerate >= 50 && Number.isFinite(maxFps) && maxFps < 49) {
    showTip(
      'slow-dongle',
      `Your dongle tops out at ${Math.round(maxFps)} fps`,
      'HDMI dongles often slow down in a USB 2 port. Try a USB 3 port, usually blue or marked SS. If it is already in one, the dongle may be a USB 2 model.'
    )
  }
}

async function start(deviceId) {
  stop()
  showStatus('Connecting')

  const { videos, audios } = await getDevices()
  const vid = videos.find((v) => v.deviceId === deviceId)

  if (!vid) {
    showStatus('Capture device not found', 'Plug in your HDMI dongle and it will connect automatically.', {
      setup: true,
      download: true,
    })
    return
  }

  // Each dongle brings back the profile it was last used with
  const mapped = vid.label && deviceProfiles[vid.label]
  if (mapped && profiles[mapped] && mapped !== activeProfile) {
    activeProfile = mapped
    save('cv.activeProfile', activeProfile)
    applyProfileToUi()
    toast(`Loaded your ${mapped} profile`)
  }

  const p = profile()
  const [width, height] = p.resolution.split('x').map(Number)
  const frameRate = p.framerate
  const aud = findDongleAudio(vid, audios)
  fillMicList(audios, aud)

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
  const startIndex = Math.max(0, RESOLUTIONS.findIndex(([value]) => value === p.resolution))
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
          : isWeb
            ? 'Click the icon to the left of the address bar, allow the camera and microphone, then reload the page.'
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

  currentDevice = vid
  prefs.videoDevice = deviceId
  savePrefs()
  if (vid.label) {
    deviceProfiles[vid.label] = activeProfile
    save('cv.deviceProfiles', deviceProfiles)
  }

  // Show the resolution that is actually running
  resSelect.value = usedResolution || p.resolution
  fpsSelect.value = String(p.framerate)
  if (usedResolution && usedResolution !== p.resolution) {
    toast(
      `Running at ${resolutionLabel(usedResolution)}, since your dongle doesn't offer ${p.framerate} fps at ${resolutionLabel(p.resolution)}`,
      { duration: 6000 }
    )
  }

  video.srcObject = new MediaStream(stream.getVideoTracks())
  setupAudio()

  const track = stream.getVideoTracks()[0]
  track.onended = () => {
    stop()
    showStatus('Capture device disconnected', 'Plug it back in to reconnect.', { setup: true })
  }

  applyCapabilities(track)
  hideStatus()
  layoutVideo()
  startFrameLoop()
  startMonitor()
  startReplay()
}

function stop() {
  if (recorder) finishRecording()
  stopReplay()
  stopFrameLoop()
  stopMonitor()
  stopMic()
  setNoSignal(false)
  soundHint.classList.add('hidden')
  if (stream) stream.getTracks().forEach((t) => t.stop())
  if (audioCtx) audioCtx.close()
  stream = null
  currentDevice = null
  audioCtx = null
  gainNode = null
  delayNode = null
  recDest = null
  hasGameAudio = false
  video.srcObject = null
}

async function autoConnect() {
  if (stream && stream.active) return
  const pick = await refreshDevices()
  if (pick) {
    start(pick.deviceId)
  } else {
    showStatus(
      'No capture device found',
      'Plug in your HDMI to USB dongle, or choose a device in settings.',
      { setup: true, download: true }
    )
  }
}

async function cameraAlreadyAllowed() {
  try {
    const status = await navigator.permissions.query({ name: 'camera' })
    return status.state === 'granted'
  } catch {
    return false
  }
}

function connectFromWeb() {
  hideLanding()
  allowedToConnect = true
  autoConnect()
}

connectBtn.onclick = connectFromWeb
$('landing-connect').onclick = connectFromWeb
$('landing-back').onclick = hideLanding
$('about-btn').onclick = () => showLanding({ back: true })

// Audio
// Game audio: dongle, sync delay, volume, speakers. Recordings tap in after
// the sync delay so volume and mute never affect them. A microphone only
// goes into recordings, never to the speakers.

function setupAudio() {
  audioCtx = new AudioContext({ latencyHint: 'interactive' })
  recDest = audioCtx.createMediaStreamDestination()

  const tracks = stream.getAudioTracks()
  hasGameAudio = tracks.length > 0
  if (hasGameAudio) {
    delayNode = audioCtx.createDelay(1)
    delayNode.delayTime.value = profile().audioDelay / 1000
    gainNode = audioCtx.createGain()
    audioCtx.createMediaStreamSource(new MediaStream(tracks)).connect(delayNode)
    delayNode.connect(gainNode).connect(audioCtx.destination)
    delayNode.connect(recDest)
  }
  applyVolume()
  watchAudioState(audioCtx)
  setupMic()
}

function applyVolume() {
  if (gainNode) gainNode.gain.value = prefs.muted ? 0 : prefs.volume
  volume.value = String(prefs.volume)
  muteBtn.setAttribute('aria-pressed', String(prefs.muted))
  muteBtn.querySelector('use').setAttribute('href', prefs.muted ? '#i-muted' : '#i-volume')
  muteBtn.dataset.tip = prefs.muted ? 'Unmute (M)' : 'Mute (M)'
}

function toggleMute() {
  prefs.muted = !prefs.muted
  savePrefs()
  applyVolume()
}

async function setupMic() {
  stopMic()
  if (!prefs.micId || !audioCtx) return
  const ctx = audioCtx
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: prefs.micId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    // The capture may have restarted while we waited
    if (ctx !== audioCtx) {
      s.getTracks().forEach((t) => t.stop())
      return
    }
    micStream = s
    micGain = ctx.createGain()
    micGain.gain.value = prefs.micLevel
    ctx.createMediaStreamSource(micStream).connect(micGain).connect(recDest)
  } catch {
    toast("Couldn't open that microphone")
  }
}

function stopMic() {
  if (micStream) micStream.getTracks().forEach((t) => t.stop())
  micStream = null
  micGain = null
}

// Browsers keep audio paused until the visitor clicks or presses a key on the page.
// Show a prompt until then, and resume on the first interaction.

function watchAudioState(ctx) {
  let wasRunning = ctx.state === 'running'
  const update = () => {
    if (ctx !== audioCtx) return
    soundHint.classList.toggle('hidden', !(hasGameAudio && ctx.state === 'suspended'))
    // Instant replay started before audio was allowed, so restart it with sound
    if (ctx.state === 'running' && !wasRunning && replay) restartReplay()
    wasRunning = ctx.state === 'running'
  }
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

// Scaling and filters

function setSeg(seg, value) {
  for (const b of seg.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.value === value))
  }
}

function sizeFor(mode, winW, winH, srcW, srcH) {
  if (mode === 'stretch') return { w: winW, h: winH, text: 'Stretch' }

  // Squeeze the picture into a 4:3 box. Fixes retro consoles that come out stretched to 16:9.
  if (mode === 'aspect43') {
    const w = Math.floor(Math.min(winW, (winH * 4) / 3))
    return { w, h: Math.floor((w * 3) / 4), text: '4:3' }
  }

  if (mode === 'integer') {
    // Work in physical pixels so each source pixel becomes an exact block on screen
    const dpr = window.devicePixelRatio || 1
    const k = Math.floor(Math.min((winW * dpr) / srcW, (winH * dpr) / srcH))
    if (k >= 1) return { w: (srcW * k) / dpr, h: (srcH * k) / dpr, text: `${k}x pixel perfect` }
  }

  const scale = Math.min(winW / srcW, winH / srcH)
  const text = mode === 'integer' ? 'Fit (window smaller than signal)' : 'Fit'
  return { w: srcW * scale, h: srcH * scale, text }
}

function layoutVideo() {
  const mode = profile().scaling
  const srcW = video.videoWidth
  const srcH = video.videoHeight
  const pixelated = mode === 'integer'

  video.classList.toggle('pixelated', pixelated)
  filterCanvas.classList.toggle('pixelated', pixelated)
  filters.setSmooth(!pixelated)

  if (!srcW || !srcH) {
    scaleText = ''
    video.style.width = '100%'
    video.style.height = '100%'
    video.style.objectFit = 'contain'
    return
  }

  const { w, h, text } = sizeFor(mode, window.innerWidth, window.innerHeight, srcW, srcH)
  scaleText = text
  video.style.width = `${w}px`
  video.style.height = `${h}px`
  video.style.objectFit = 'fill'
  if (filters.active) filters.resize(w, h)
}

window.addEventListener('resize', layoutVideo)
video.addEventListener('loadedmetadata', layoutVideo)
video.addEventListener('resize', layoutVideo)

function setScaling(mode) {
  setProfileValue('scaling', mode)
  setSeg(scaleSeg, mode)
  layoutVideo()
}

function cycleScaling() {
  const i = SCALE_MODES.indexOf(profile().scaling)
  setScaling(SCALE_MODES[(i + 1) % SCALE_MODES.length])
  toast(`Scaling: ${scaleText || profile().scaling}`, { duration: 1500 })
}

function applyFilter() {
  const name = prefs.lowLatency ? 'off' : profile().filter
  filters.setFilter(name)
  setSeg(filterSeg, profile().filter)
  filterSeg.classList.toggle('dimmed', prefs.lowLatency)
  layoutVideo()
}

function setFilter(name) {
  if (name !== 'off' && !filters.supported) {
    toast("Filters need WebGL, which isn't available on this computer")
    return
  }
  setProfileValue('filter', name)
  if (prefs.lowLatency && name !== 'off') {
    setLowLatency(false)
    toast('Low latency mode is off so the filter can run')
  }
  applyFilter()
}

function cycleFilter() {
  const i = FILTER_ORDER.indexOf(profile().filter)
  const next = FILTER_ORDER[(i + 1) % FILTER_ORDER.length]
  setFilter(next)
  toast(`Filter: ${FILTERS[next].label === 'Off' ? 'Clean' : FILTERS[next].label}`, { duration: 1500 })
}

scaleSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]')
  if (b) setScaling(b.dataset.value)
})

filterSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]')
  if (b) setFilter(b.dataset.value)
})

// Low latency mode

function setLowLatency(on, { announce = false } = {}) {
  prefs.lowLatency = on
  savePrefs()
  lowLatencyBtn.setAttribute('aria-pressed', String(on))
  lowLatencyToggle.checked = on
  applyFilter()
  if (on) stopReplay()
  else startReplay()
  if (announce) {
    toast(
      on
        ? 'Low latency mode on. Filters and instant replay are paused.'
        : 'Low latency mode off'
    )
  }
}

lowLatencyBtn.onclick = () => setLowLatency(!prefs.lowLatency, { announce: true })
lowLatencyToggle.onchange = () => setLowLatency(lowLatencyToggle.checked, { announce: true })

// Frames, delay and stats

const latencySamples = []
const frameTimes = []
let frameCallbackId = null

function onFrame(now, meta) {
  frameTimes.push(now)
  while (frameTimes.length && now - frameTimes[0] > 1000) frameTimes.shift()

  // captureTime is when this computer received the frame from the dongle.
  // A filter draws the frame again, which usually costs one more screen refresh.
  if (typeof meta.captureTime === 'number') {
    const ms = meta.expectedDisplayTime - meta.captureTime + (filters.active ? 1000 / 60 : 0)
    if (ms > 0 && ms < 1000) {
      latencySamples.push(ms)
      if (latencySamples.length > 60) latencySamples.shift()
    }
  }

  frameCallbackId = video.requestVideoFrameCallback(onFrame)
}

function startFrameLoop() {
  if (frameCallbackId !== null || !('requestVideoFrameCallback' in video)) return
  frameCallbackId = video.requestVideoFrameCallback(onFrame)
}

function stopFrameLoop() {
  if (frameCallbackId !== null) video.cancelVideoFrameCallback(frameCallbackId)
  frameCallbackId = null
  frameTimes.length = 0
  latencySamples.length = 0
}

function currentFps() {
  const now = performance.now()
  return frameTimes.filter((t) => now - t <= 1000).length
}

function renderHud() {
  hudFps.textContent = stream ? `${currentFps()} fps` : '--'

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

  hudAudio.textContent =
    audioCtx && hasGameAudio
      ? `${Math.round((audioCtx.baseLatency + (audioCtx.outputLatency || 0)) * 1000 + profile().audioDelay)} ms`
      : 'No audio'

  const track = stream?.getVideoTracks()[0]
  if (track) {
    const s = track.getSettings()
    hudSignal.textContent = `${s.width}x${s.height} at ${Math.round(s.frameRate)} fps`
  } else {
    hudSignal.textContent = '--'
  }

  hudScale.textContent = scaleText || '--'

  const mode = [prefs.lowLatency ? 'Low latency' : 'Normal']
  if (filters.active) mode.push(`${FILTERS[filters.filter].label} filter`)
  if (replay) mode.push('replay on')
  hudMode.textContent = mode.join(', ')
}

function setStats(on) {
  statsOn = on
  hud.classList.toggle('hidden', !on)
  statsBtn.setAttribute('aria-pressed', String(on))
  prefs.stats = on
  savePrefs()
  if (on) renderHud()
}

setInterval(() => {
  if (statsOn) renderHud()
}, 250)

// Watches the signal and offers help when something looks wrong

const probe = document.createElement('canvas')
probe.width = 64
probe.height = 36
// Scaling down happens on the graphics card, so only a tiny image is read back
const probeCtx = probe.getContext('2d')
let monitorTimer = null
let darkSeconds = 0
let slowSeconds = 0
let droppedHistory = []

function isPictureBlack() {
  if (video.readyState < 2 || !video.videoWidth) return true
  try {
    probeCtx.drawImage(video, 0, 0, probe.width, probe.height)
    const data = probeCtx.getImageData(0, 0, probe.width, probe.height).data
    let brightest = 0
    for (let i = 0; i < data.length; i += 4) {
      brightest = Math.max(brightest, (data[i] + data[i + 1] + data[i + 2]) / 3)
    }
    return brightest < 24
  } catch {
    return false
  }
}

function setNoSignal(on) {
  noSignalEl.classList.toggle('hidden', !on)
}

function checkSignal() {
  if (!stream) return
  const fps = currentFps()
  const noPicture = fps === 0 || isPictureBlack()

  darkSeconds = noPicture ? darkSeconds + 1 : 0
  setNoSignal(darkSeconds >= 4)
  if (noPicture) return

  // Frame rate well under what the dongle says it is sending
  const target = stream.getVideoTracks()[0]?.getSettings().frameRate || 0
  slowSeconds = target >= 25 && fps < target * 0.75 ? slowSeconds + 1 : 0
  if (slowSeconds >= 8) {
    showTip(
      'low-fps',
      `Running at ${fps} fps instead of ${Math.round(target)}`,
      "Try a USB 3 port, set your console's video output to 1080p, or pick a lower resolution in settings. Closing other apps that use the camera can help too."
    )
  }

  // More than 30 dropped frames in 10 seconds
  const quality = video.getVideoPlaybackQuality?.()
  if (quality) {
    droppedHistory.push(quality.droppedVideoFrames)
    if (droppedHistory.length > 10) droppedHistory.shift()
    if (droppedHistory.length === 10 && droppedHistory[9] - droppedHistory[0] > 30) {
      showTip(
        'dropped',
        'Frames are being dropped',
        'Your computer is falling behind drawing the picture. Turn off retro filters and instant replay, or try low latency mode with G.'
      )
    }
  }
}

function startMonitor() {
  stopMonitor()
  monitorTimer = setInterval(checkSignal, 1000)
}

function stopMonitor() {
  clearInterval(monitorTimer)
  monitorTimer = null
  darkSeconds = 0
  slowSeconds = 0
  droppedHistory = []
}

// Screenshots, recording and instant replay

function stamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

// Desktop app: straight to Pictures or Videos. Website: a normal download.
async function saveCapture(kind, blob, ext) {
  if (api?.saveCapture) {
    try {
      return { file: await api.saveCapture(kind, ext, await blob.arrayBuffer()) }
    } catch (err) {
      toast(`Couldn't save: ${err.message}`)
      return null
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `console-viewer-${kind}-${stamp()}.${ext}`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { downloaded: true }
}

function savedToast(result, message, folder) {
  if (result.file) {
    toast(`${message} to ${folder}`, {
      action: { label: 'Show in folder', run: () => api.revealFile(result.file) },
    })
  } else {
    toast(`${message} to your Downloads`)
  }
}

function needsStream() {
  if (stream && video.videoWidth) return true
  toast('Connect your console first')
  return false
}

async function takeScreenshot() {
  if (!needsStream()) return
  flashEl.classList.remove('go')
  void flashEl.offsetWidth
  flashEl.classList.add('go')

  const blob = await captureFrame(video)
  let copied = false
  try {
    if (api?.copyImage) {
      copied = await api.copyImage(await blob.arrayBuffer())
    } else if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      copied = true
    }
  } catch {}

  const result = await saveCapture('screenshot', blob, 'png')
  if (result) savedToast(result, copied ? 'Screenshot copied and saved' : 'Screenshot saved', 'Pictures')
}

// Video for recordings: the clean picture plus game audio and any microphone.
// Audio only joins once the browser has allowed sound to play.
function recordingStream() {
  const tracks = [...stream.getVideoTracks()]
  if (audioCtx?.state === 'running' && recDest) tracks.push(...recDest.stream.getAudioTracks())
  return new MediaStream(tracks)
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function toggleRecording() {
  if (recorder) {
    finishRecording()
    return
  }
  if (!needsStream()) return
  if (!recType) {
    toast("This browser can't record video")
    return
  }
  try {
    recorder = new Recorder(recordingStream(), recType, recordingBitrate(stream.getVideoTracks()[0], false))
    recorder.start()
  } catch (err) {
    recorder = null
    toast(`Couldn't start recording: ${err.message}`)
    return
  }
  recordBtn.setAttribute('aria-pressed', 'true')
  recordBtn.dataset.tip = 'Stop recording (R)'
  recIndicator.classList.remove('hidden')
  recTime.textContent = '0:00'
  recTimer = setInterval(() => {
    if (recorder) recTime.textContent = formatTime(recorder.elapsed)
  }, 500)
}

async function finishRecording() {
  const r = recorder
  recorder = null
  clearInterval(recTimer)
  recordBtn.setAttribute('aria-pressed', 'false')
  recordBtn.dataset.tip = 'Record (R)'
  recIndicator.classList.add('hidden')

  const blob = await r.stop()
  if (!blob.size) return
  const result = await saveCapture('video', blob, recordingExt(recType))
  if (result) savedToast(result, 'Recording saved', 'Videos')
}

function startReplay() {
  updateReplayButton()
  if (replay || !stream || !recType || !prefs.replay || prefs.lowLatency) return
  try {
    replay = new ReplayBuffer(
      recordingStream(),
      recType,
      recordingBitrate(stream.getVideoTracks()[0], true)
    )
    replay.start()
  } catch (err) {
    replay = null
    console.warn('Instant replay could not start', err)
  }
  updateReplayButton()
}

function stopReplay() {
  if (replay) replay.stop()
  replay = null
  updateReplayButton()
}

function restartReplay() {
  stopReplay()
  startReplay()
}

function updateReplayButton() {
  replayBtn.classList.toggle('armed', Boolean(replay))
  replayBtn.dataset.tip = prefs.replay
    ? 'Save the last 30 seconds (V)'
    : 'Turn on instant replay (V)'
}

function setReplay(on) {
  prefs.replay = on
  savePrefs()
  replayToggle.checked = on
  if (on) startReplay()
  else stopReplay()
}

async function saveReplay() {
  if (!needsStream()) return
  if (!recType) {
    toast("This browser can't record video")
    return
  }
  if (prefs.lowLatency) {
    toast('Instant replay is paused in low latency mode. Press G to turn it off.')
    return
  }
  if (!prefs.replay || !replay) {
    setReplay(true)
    toast('Instant replay is on. From now on, press V to save the last 30 seconds.', { duration: 5000 })
    return
  }
  const seconds = Math.round(replay.available)
  if (seconds < 3) {
    toast('Instant replay is still filling up')
    return
  }
  const blob = await replay.save()
  if (!blob || !blob.size) {
    toast("Couldn't save the replay")
    return
  }
  const result = await saveCapture('video', blob, recordingExt(recType))
  if (result) savedToast(result, `Saved the last ${seconds} seconds`, 'Videos')
}

screenshotBtn.onclick = takeScreenshot
recordBtn.onclick = toggleRecording
replayBtn.onclick = saveReplay
replayToggle.onchange = () => setReplay(replayToggle.checked)

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

// Full screen

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    // A controller press doesn't count as a click, so browsers may refuse
    document.documentElement.requestFullscreen().catch(() => toast('Press F to go full screen'))
  }
}

// Settings panel

function openSettings() {
  settingsSheet.classList.add('open')
  settingsSheet.setAttribute('aria-hidden', 'false')
  settingsBtn.setAttribute('aria-expanded', 'true')
  wake()
}

function closeSettings() {
  settingsSheet.classList.remove('open')
  settingsSheet.setAttribute('aria-hidden', 'true')
  settingsBtn.setAttribute('aria-expanded', 'false')
}

const settingsOpen = () => settingsSheet.classList.contains('open')

settingsBtn.onclick = () => (settingsOpen() ? closeSettings() : openSettings())
$('settings-close').onclick = closeSettings

deviceSelect.onchange = () => start(deviceSelect.value)

resSelect.onchange = () => {
  setProfileValue('resolution', resSelect.value)
  if (currentDevice) start(currentDevice.deviceId)
}

fpsSelect.onchange = () => {
  setProfileValue('framerate', Number(fpsSelect.value))
  if (currentDevice) start(currentDevice.deviceId)
}

audioDelay.oninput = () => {
  const ms = Number(audioDelay.value)
  setProfileValue('audioDelay', ms)
  audioDelayValue.textContent = `${ms} ms`
  if (delayNode) delayNode.delayTime.value = ms / 1000
}

volume.oninput = () => {
  prefs.volume = Number(volume.value)
  if (prefs.muted && prefs.volume > 0) prefs.muted = false
  savePrefs()
  applyVolume()
}

muteBtn.onclick = toggleMute

micSelect.onchange = () => {
  prefs.micId = micSelect.value
  savePrefs()
  $('mic-level-row').classList.toggle('hidden', !micSelect.value)
  setupMic()
}

micLevel.oninput = () => {
  prefs.micLevel = Number(micLevel.value)
  savePrefs()
  if (micGain) micGain.gain.value = prefs.micLevel
}

// Profiles

function renderProfiles() {
  profileSelect.innerHTML = ''
  for (const name of Object.keys(profiles)) profileSelect.add(new Option(name, name))
  profileSelect.value = activeProfile
  $('profile-delete').disabled = Object.keys(profiles).length <= 1
}

function applyProfileToUi() {
  const p = profile()
  renderProfiles()
  resSelect.value = p.resolution
  fpsSelect.value = String(p.framerate)
  setSeg(scaleSeg, p.scaling)
  audioDelay.value = String(p.audioDelay)
  audioDelayValue.textContent = `${p.audioDelay} ms`
  if (delayNode) delayNode.delayTime.value = p.audioDelay / 1000
  applyFilter()
}

function switchProfile(name) {
  if (!profiles[name] || name === activeProfile) return
  const before = { ...profile() }
  activeProfile = name
  save('cv.activeProfile', activeProfile)
  if (currentDevice?.label) {
    deviceProfiles[currentDevice.label] = name
    save('cv.deviceProfiles', deviceProfiles)
  }
  applyProfileToUi()
  const p = profile()
  if (currentDevice && (before.resolution !== p.resolution || before.framerate !== p.framerate)) {
    start(currentDevice.deviceId)
  }
}

profileSelect.onchange = () => switchProfile(profileSelect.value)

$('profile-save').onclick = () => {
  const name = profileName.value.trim()
  if (!name) {
    toast('Give the profile a name first')
    profileName.focus()
    return
  }
  if (profiles[name]) {
    toast('A profile with that name already exists')
    return
  }
  profiles[name] = { ...profile() }
  save('cv.profiles', profiles)
  profileName.value = ''
  switchProfile(name)
  toast(`Saved your ${name} profile`)
}

profileName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('profile-save').click()
})

$('profile-delete').onclick = () => {
  const names = Object.keys(profiles)
  if (names.length <= 1) return
  const gone = activeProfile
  const next = names.find((n) => n !== gone)
  switchProfile(next)
  delete profiles[gone]
  for (const [label, name] of Object.entries(deviceProfiles)) {
    if (name === gone) delete deviceProfiles[label]
  }
  save('cv.profiles', profiles)
  save('cv.deviceProfiles', deviceProfiles)
  renderProfiles()
  toast(`Deleted the ${gone} profile`)
}

// Controller connected to this computer. Hold Select and press a button.

const PAD_SELECT = 8
const PAD_ACTIONS = {
  0: takeScreenshot,
  1: toggleRecording,
  2: saveReplay,
  3: toggleFullscreen,
  4: cycleScaling,
  5: cycleFilter,
  9: () => setStats(!statsOn),
}
const padPrevious = {}
let padLoop = null

function pollPads() {
  let any = false
  for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!pad) continue
    any = true
    const pressed = pad.buttons.map((b) => b.pressed)
    const before = padPrevious[pad.index] || []
    if (pressed[PAD_SELECT]) {
      for (const [index, action] of Object.entries(PAD_ACTIONS)) {
        if (pressed[index] && !before[index]) {
          wake()
          action()
        }
      }
    }
    padPrevious[pad.index] = pressed
  }
  padLoop = any ? requestAnimationFrame(pollPads) : null
}

function describePads() {
  const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean)
  controllerStatus.textContent = pads.length
    ? `Connected: ${pads.map((p) => p.id.replace(/\s*\(.*\)\s*$/, '')).join(', ')}`
    : 'Plug a controller into this computer and press any button.'
}

window.addEventListener('gamepadconnected', () => {
  describePads()
  toast('Controller connected. Hold Select and press A for a screenshot.', { duration: 5000 })
  if (!padLoop) padLoop = requestAnimationFrame(pollPads)
})

window.addEventListener('gamepaddisconnected', describePads)

// Keyboard

const KEY_ACTIONS = {
  f: toggleFullscreen,
  p: togglePip,
  l: () => setStats(!statsOn),
  s: cycleScaling,
  e: cycleFilter,
  c: takeScreenshot,
  r: toggleRecording,
  v: saveReplay,
  m: toggleMute,
  g: () => setLowLatency(!prefs.lowLatency, { announce: true }),
  o: () => (settingsOpen() ? closeSettings() : openSettings()),
}

window.addEventListener('keydown', (e) => {
  wake()
  if (e.key === 'F11') {
    e.preventDefault()
    toggleFullscreen()
    return
  }
  if (e.key === 'Escape' && settingsOpen()) {
    closeSettings()
    return
  }

  // Leave letter keys alone while typing, using a menu, or reading the front page
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
  const el = document.activeElement
  if (el?.tagName === 'SELECT' || (el?.tagName === 'INPUT' && el.type === 'text')) return
  if (!landing.classList.contains('hidden')) return

  const action = KEY_ACTIONS[e.key.toLowerCase()]
  if (action) {
    e.preventDefault()
    action()
  }
})

pipBtn.onclick = togglePip
statsBtn.onclick = () => setStats(!statsOn)
fullscreenBtn.onclick = toggleFullscreen
$('stage').ondblclick = toggleFullscreen

// Hide the controls and cursor after a few seconds without mouse movement,
// unless settings are open or the pointer is on the controls
let idleTimer
let pointerOnControls = false

function wake() {
  document.body.classList.remove('idle')
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (!settingsOpen() && !pointerOnControls) document.body.classList.add('idle')
    else wake()
  }, 2500)
}

window.addEventListener('mousemove', wake)
controls.addEventListener('pointerenter', () => (pointerOnControls = true))
controls.addEventListener('pointerleave', () => (pointerOnControls = false))
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

// Windows app button
// Websites can't see what's installed, and guessing from focus breaks when
// Windows shows its own "find an app" popup. So the first click downloads the
// installer, and after that the button opens the app.

const APP_LINK = 'console-viewer://open'
const appState = { downloaded: false, pwaInstalled: false, ...load('cv.windowsApp', {}) }
const installerLink = $('download-installer')

function updateAppLinks() {
  const known = appState.downloaded || appState.pwaInstalled
  for (const link of document.querySelectorAll('.js-get-app')) {
    link.classList.toggle('known', known)
    const label = link.querySelector('.app-label')
    if (label) label.textContent = appState.downloaded ? label.dataset.known : label.dataset.new
  }
  $('get-app').dataset.tip = appState.downloaded ? 'Open the desktop app' : 'Download the desktop app'
}

function markDownloaded() {
  appState.downloaded = true
  save('cv.windowsApp', appState)
  updateAppLinks()
  toast('Downloading the Windows app. Once it is installed, this button opens it.', { duration: 7000 })
}

function downloadInstaller(url) {
  markDownloaded()
  window.location.href = url
}

function openWindowsApp() {
  // Free the dongle first, since usually only one program can use it at a time
  stop()
  hideLanding()
  closeSettings()
  window.location.href = APP_LINK
  showStatus(
    'Opening the Windows app',
    "The capture device was released so the app can use it. If Windows asks you to find an app instead, the app isn't installed yet.",
    { connect: true, installer: true }
  )
}

function onAppLinkClick(event) {
  event.preventDefault()
  if (appState.downloaded) openWindowsApp()
  else downloadInstaller(event.currentTarget.href)
}

for (const link of document.querySelectorAll('.js-get-app')) {
  link.addEventListener('click', onAppLinkClick)
  if (offerDownload && link !== downloadLink) link.classList.remove('hidden')
}

// A plain link, so the browser starts the download itself
installerLink.addEventListener('click', markDownloaded)

// Installing the website as an app from the browser counts too
window.addEventListener('appinstalled', () => {
  appState.pwaInstalled = true
  save('cv.windowsApp', appState)
  updateAppLinks()
})

if (isInstalledWebApp && !appState.pwaInstalled) {
  appState.pwaInstalled = true
  save('cv.windowsApp', appState)
}
updateAppLinks()

// Front page demo: a real clip at media/demo.mp4 replaces the drawing
demoVideo.addEventListener('loadeddata', () => {
  demoVideo.classList.remove('hidden')
  $('demo-fallback').classList.add('hidden')
})

// Start up

document.body.classList.add(isWeb ? 'is-web' : 'is-app')
$('landing-setup').append(setupTemplate.content.cloneNode(true))
$('save-location').textContent = api
  ? 'Screenshots go to Pictures and recordings go to Videos, each in a Console Viewer folder.'
  : 'Screenshots and recordings go to your Downloads folder.'

if (!document.pictureInPictureEnabled) pipBtn.classList.add('hidden')
if (!recType) {
  recordBtn.disabled = true
  replayBtn.disabled = true
}

micLevel.value = String(prefs.micLevel)
replayToggle.checked = prefs.replay
lowLatencyToggle.checked = prefs.lowLatency
lowLatencyBtn.setAttribute('aria-pressed', String(prefs.lowLatency))
applyProfileToUi()
applyVolume()
updateReplayButton()
setStats(prefs.stats)
describePads()

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
    if (isWeb) showLanding()
    return
  }

  if (isWeb && !(await cameraAlreadyAllowed())) {
    showStatus('Connect your capture device', '', { connect: true, setup: true, download: true })
    showLanding()
    return
  }

  allowedToConnect = true
  autoConnect()
}

init()