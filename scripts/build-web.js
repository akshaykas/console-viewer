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
// Store pages for the desktop apps. The website picks the right one for each visitor.
const WINDOWS_STORE_URL = 'https://apps.microsoft.com/detail/9PD4BBB9JZXG'
// The Apple ID from App Store Connect, under App Information, General Information
const MAC_APP_ID = '6820696619'
const MAC_STORE_URL = `https://apps.apple.com/app/id${MAC_APP_ID}`

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

fill('index.html', [
  ['__WINDOWS_STORE_URL__', WINDOWS_STORE_URL],
  ['__MAC_STORE_URL__', MAC_STORE_URL],
])
fill('sw.js', [['__BUILD_VERSION__', `${pkg.version}-${Date.now()}`]])

// Tells GitHub Pages to serve files as they are
fs.writeFileSync(path.join(out, '.nojekyll'), '')

console.log(`Website built in web-dist/ with store links ${WINDOWS_STORE_URL} and ${MAC_STORE_URL}`)