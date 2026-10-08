const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { FusesPlugin } = require('@electron-forge/plugin-fuses')
const { FuseV1Options, FuseVersion } = require('@electron/fuses')

// Signing is driven by environment variables, so local builds still work unsigned.
// See SIGNING.md for where each value comes from.
const env = process.env
const asset = (file) => path.resolve(__dirname, 'assets', file)

const osxSign = env.APPLE_SIGNING_IDENTITY
  ? {
      identity: env.APPLE_SIGNING_IDENTITY,
      optionsForFile: () => ({
        hardenedRuntime: true,
        entitlements: asset('entitlements.mac.plist'),
      }),
    }
  : undefined

const osxNotarize =
  osxSign && env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID
    ? {
        appleId: env.APPLE_ID,
        appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: env.APPLE_TEAM_ID,
      }
    : undefined

const windowsSign = env.WINDOWS_CERTIFICATE_FILE
  ? {
      certificateFile: env.WINDOWS_CERTIFICATE_FILE,
      certificatePassword: env.WINDOWS_CERTIFICATE_PASSWORD,
    }
  : undefined

// Microsoft Store package (.msix). Built only by `npm run make:store`, which
// sets PORTPLAY_STORE. Needs Windows and the Windows SDK.
const pkg = require('./package.json')

// Store versions have four parts and the last one must be 0
const storeVersion = `${pkg.version.split('-')[0]}.0`

function storeManifest() {
  const xml = fs
    .readFileSync(asset('AppxManifest.xml'), 'utf8')
    .replaceAll('{{Version}}', storeVersion)
  const file = path.join(os.tmpdir(), `portplay-AppxManifest-${storeVersion}.xml`)
  fs.writeFileSync(file, xml)
  return file
}

// Uses the newest Windows SDK installed, wherever it is
function newestWindowsKit() {
  const root = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'
  try {
    const versions = fs
      .readdirSync(root)
      .filter((v) => /^10\.0\.\d+\.\d+$/.test(v))
      .filter((v) => fs.existsSync(path.join(root, v, 'x64', 'makeappx.exe')))
      .sort((a, b) => {
        const x = a.split('.').map(Number)
        const y = b.split('.').map(Number)
        return x.reduce((d, n, i) => d || n - y[i], 0)
      })
    return versions.length ? path.join(root, versions.at(-1), 'x64') : undefined
  } catch {
    return undefined
  }
}

const storeMakers = env.PORTPLAY_STORE
  ? [
      {
        name: '@electron-forge/maker-msix',
        platforms: ['win32'],
        config: {
          appManifest: storeManifest(),
          packageAssets: asset('msix'),
          windowsKitPath: newestWindowsKit(),
          // Without this the temporary file would be named after app\portplay.exe,
          // pointing into a folder that doesn't exist
          packageName: 'PortPlay.msix',
          // The Store signs the package itself after certification
          sign: false,
          outputFileName: `PortPlay-${storeVersion}-x64`,
        },
      },
    ]
  : []

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'PortPlay',
    executableName: 'portplay',
    appBundleId: 'com.kaseebhotla.portplay',
    appCategoryType: 'public.app-category.games',
    // Forge picks icon.icns on macOS and icon.ico on Windows
    icon: asset('icon'),
    // Lets the website open the installed app with portplay:// links
    protocols: [{ name: 'PortPlay', schemes: ['portplay'] }],
    extendInfo: {
      NSCameraUsageDescription:
        'PortPlay shows the video from your HDMI capture dongle, which your Mac treats as a camera.',
      NSMicrophoneUsageDescription:
        'PortPlay plays your game audio, which comes in through the capture dongle as a microphone.',
    },
    osxSign,
    osxNotarize,
    windowsSign,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'portplay',
        // A fixed file name lets the website always link to the latest installer
        setupExe: 'PortPlaySetup.exe',
        setupIcon: asset('icon.ico'),
        windowsSign,
      },
    },
    {
      // Keep the zip too, since Electron's auto updater on macOS uses it
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: asset('icon.png'),
          categories: ['Game', 'AudioVideo'],
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          icon: asset('icon.png'),
        },
      },
    },
    ...storeMakers,
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses turn Electron features on or off at package time, before signing
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
}
