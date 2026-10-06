# Signing Console Viewer

Builds are unsigned unless these environment variables are set, so `npm run make` keeps working on your own machine either way.

## macOS (signing and notarization)

You need a Mac and a paid Apple Developer Program membership.

1. In Xcode or on developer.apple.com, create a **Developer ID Application** certificate and install it in your keychain.
2. Find its exact name with `security find-identity -v -p codesigning`.
3. Create an app-specific password at account.apple.com under Sign-In and Security.
4. Find your Team ID on the Membership page of developer.apple.com.

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
npm run make
```

Notarization uploads the app to Apple and usually takes a few minutes. To confirm it worked:

```bash
spctl -a -vv "out/Console Viewer-darwin-arm64/Console Viewer.app"
```

It should say `accepted` and `source=Notarized Developer ID`.

## Windows

The config signs with a `.pfx` certificate file:

```powershell
$env:WINDOWS_CERTIFICATE_FILE = "C:\path\to\cert.pfx"
$env:WINDOWS_CERTIFICATE_PASSWORD = "your-password"
npm run make
```

Things to know before buying anything:

* Most certificate authorities now ship code signing keys on a hardware token or cloud HSM, so a plain `.pfx` file may not be an option. If you go that route, use the custom hook option in `@electron/windows-sign` instead of `certificateFile`.
* Microsoft's Azure Trusted Signing service is usually the cheapest path for individuals. Check current pricing and eligibility first.
* A certificate removes the "unknown publisher" warning, but SmartScreen still builds reputation over downloads, so early users may see a prompt for a while.
* Publishing through the Microsoft Store avoids all of this, since Microsoft signs the package for you.

## Before release

* Change `appBundleId` in `forge.config.js` if you want a different reverse domain. It can't easily change after people install the app.
* Build each platform on that platform. The DMG and notarization only work on macOS.
