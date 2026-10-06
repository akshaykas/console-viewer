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

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Console Viewer',
    executableName: 'console-viewer',
    appBundleId: 'com.kaseebhotla.consoleviewer',
    appCategoryType: 'public.app-category.games',
    // Forge picks icon.icns on macOS and icon.ico on Windows
    icon: asset('icon'),
    extendInfo: {
      NSCameraUsageDescription:
        'Console Viewer shows the video from your HDMI capture dongle, which your Mac treats as a camera.',
      NSMicrophoneUsageDescription:
        'Console Viewer plays your game audio, which comes in through the capture dongle as a microphone.',
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
        name: 'console_viewer',
        // A fixed file name lets the website always link to the latest installer
        setupExe: 'ConsoleViewerSetup.exe',
        setupIcon: asset('icon.ico'),
        windowsSign,
      },
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        icon: asset('icon.icns'),
        format: 'ULFO',
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
