// Screenshots, recordings and instant replay

// MP4 plays everywhere and uploads anywhere, so prefer it when the browser can make it
const RECORDING_TYPES = [
  'video/mp4;codecs=avc1.640034,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

function pickRecordingType() {
  if (typeof MediaRecorder === 'undefined') return null
  return RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || null
}

const recordingExt = (type) => (type.startsWith('video/mp4') ? 'mp4' : 'webm')

// Bitrate that keeps 1080p60 sharp without huge files
function recordingBitrate(videoTrack, forReplay) {
  const s = videoTrack.getSettings()
  const pixelsPerSecond = (s.width || 1920) * (s.height || 1080) * (s.frameRate || 60)
  const bits = pixelsPerSecond * (forReplay ? 0.05 : 0.08)
  return Math.round(Math.min(Math.max(bits, 2_500_000), 16_000_000))
}

// Grabs the current frame at full resolution as a PNG
function captureFrame(video) {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d').drawImage(video, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No frame'))), 'image/png')
  )
}

// A simple start and stop recording
class Recorder {
  constructor(stream, type, bitrate) {
    this.chunks = []
    this.type = type
    this.startedAt = 0
    this.rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate })
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data)
    }
  }

  start() {
    this.startedAt = performance.now()
    this.rec.start(1000)
  }

  get elapsed() {
    return this.rec.state === 'recording' ? performance.now() - this.startedAt : 0
  }

  stop() {
    return new Promise((resolve) => {
      if (this.rec.state === 'inactive') {
        resolve(new Blob(this.chunks, { type: this.type }))
        return
      }
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: this.type }))
      this.rec.stop()
    })
  }

  // Stops without keeping anything
  discard() {
    this.rec.ondataavailable = null
    this.chunks = []
    if (this.rec.state !== 'inactive') this.rec.stop()
  }
}

// Instant replay. A video file can't be trimmed from the front without
// re-encoding it, so two recorders run half a cycle apart. When you save,
// the one that has been running longer always holds at least the last
// 30 seconds, and at most the last 60.
class ReplayBuffer {
  constructor(stream, type, bitrate, minSeconds = 30) {
    this.stream = stream
    this.type = type
    this.bitrate = bitrate
    this.cycleMs = minSeconds * 2 * 1000
    this.slots = [{}, {}]
    this.running = false
  }

  start() {
    if (this.running) return
    this.running = true
    this.restart(this.slots[0])
    this.slots[1].timer = setTimeout(() => this.restart(this.slots[1]), this.cycleMs / 2)
  }

  restart(slot, firstCycleMs = this.cycleMs) {
    clearTimeout(slot.timer)
    if (slot.recorder) slot.recorder.discard()
    slot.recorder = null
    if (!this.running) return
    slot.recorder = new Recorder(this.stream, this.type, this.bitrate)
    slot.recorder.start()
    slot.timer = setTimeout(() => this.restart(slot), firstCycleMs)
  }

  // Seconds of footage a save would contain right now
  get available() {
    return Math.max(0, ...this.slots.map((s) => (s.recorder ? s.recorder.elapsed : 0))) / 1000
  }

  async save() {
    const slot = this.slots
      .filter((s) => s.recorder)
      .sort((a, b) => b.recorder.elapsed - a.recorder.elapsed)[0]
    if (!slot) return null

    clearTimeout(slot.timer)
    const recorder = slot.recorder
    slot.recorder = null
    const blob = await recorder.stop()
    if (!this.running) return blob

    // Start this slot fresh, then line its restarts up half a cycle away from
    // the other slot's, so the two never restart close together
    const other = this.slots.find((s) => s !== slot)
    if (other.recorder) {
      let firstCycle = (this.cycleMs * 1.5 - other.recorder.elapsed) % this.cycleMs
      if (firstCycle < 1000) firstCycle += this.cycleMs
      this.restart(slot, firstCycle)
    } else {
      this.restart(slot)
      clearTimeout(other.timer)
      other.timer = setTimeout(() => this.restart(other), this.cycleMs / 2)
    }
    return blob
  }

  stop() {
    this.running = false
    for (const slot of this.slots) {
      clearTimeout(slot.timer)
      if (slot.recorder) slot.recorder.discard()
      slot.recorder = null
    }
  }
}
