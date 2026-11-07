# AutoTax Lite Android (V1.2.0)

Android WebView shell for https://tracuuhoadon.top/lite/ (same UI/functionality as Web Lite).

- Requires internet connection; this is not an offline invoice downloader.
- Uses the official AutoTax A + check brand mark adapted from docs/favicon.svg.
- HTTPS only; denies cleartext and does not ignore SSL errors.
- Does not request microphone/camera/location permissions.
- Builds a **debug-signed installable APK** for internal testing.
- Never use the debug-signed package as a Play Store release.
- The existing AutoTax Web login/payment/PDF behavior is handled by the Web site, not by a separate native service.

Build (Android SDK + JDK 17 required):
```bash
gradle --no-daemon -p android-lite :app:assembleDebug
```
Output: android-lite/app/build/outputs/apk/debug/app-debug.apk
