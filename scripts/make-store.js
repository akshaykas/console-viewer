// Builds the Microsoft Store package (.msix) into out/make/msix/x64.
// Windows only, and needs the Windows SDK installed. GitHub's Windows
// build machines already have it, so the release workflow builds this too.
const { spawnSync } = require('node:child_process')
const path = require('node:path')

if (process.platform !== 'win32') {
  console.error('The Store package can only be built on Windows.')
  process.exit(1)
}

const cli = path.join(__dirname, '..', 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js')
const result = spawnSync(process.execPath, [cli, 'make', '--targets', '@electron-forge/maker-msix'], {
  stdio: 'inherit',
  env: { ...process.env, PORTPLAY_STORE: '1' },
})
process.exit(result.status ?? 1)
