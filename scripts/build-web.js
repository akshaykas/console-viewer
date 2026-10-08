// Builds the website into web-dist/ from the same files the desktop app uses
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const src = path.join(root, 'src')
const out = path.join(root, 'web-dist')
const pkg = require(path.join(root, 'package.json'))

const repoUrl = (pkg.repository?.url || pkg.repository || '')
  .replace(/^git\+/, '')
  .replace(/\.git$/, '')
if (!repoUrl.startsWith('https://github.com/') || repoUrl.includes('OWNER')) {
  console.warn('Set "repository" in package.json to your GitHub repo so the download link works.')
}
// Once PortPlay is live in the Microsoft Store, set this to true so Windows
// visitors go to the Store page instead of the GitHub installer
const USE_STORE = false
const STORE_URL = 'https://apps.microsoft.com/detail/9PD4BBB9JZXG'
const downloadUrl = USE_STORE
  ? STORE_URL
  : `${repoUrl}/releases/latest/download/PortPlaySetup.exe`

// Electron only files stay out of the website
const SKIP = new Set(['index.js', 'preload.js'])

fs.rmSync(out, { recursive: true, force: true })
fs.cpSync(src, out, {
  recursive: true,
  filter: (file) => !SKIP.has(path.basename(file)),
})

const fill = (file, replacements) => {
  const target = path.join(out, file)
  let text = fs.readFileSync(target, 'utf8')
  for (const [from, to] of replacements) text = text.replaceAll(from, to)
  fs.writeFileSync(target, text)
}

fill('index.html', [['__WINDOWS_DOWNLOAD_URL__', downloadUrl]])
fill('sw.js', [['__BUILD_VERSION__', `${pkg.version}-${Date.now()}`]])

// Tells GitHub Pages to serve files as they are
fs.writeFileSync(path.join(out, '.nojekyll'), '')

console.log(`Website built in web-dist/ with download link ${downloadUrl}`)
