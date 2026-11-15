# brick

A do-it-yourself version of the "tap a physical thing to block your phone"
gadgets. The physical thing is a blank NFC tag (about a dollar). Tap a phone on
it and the distracting apps on that phone stop opening; they stay that way
until the same tag is tapped again.

One tag serves any number of phones. Nothing is written to it: each phone just
remembers the tag's factory serial number.

| Phone | How it blocks | Where |
|---|---|---|
| Android | A small app (this directory). An accessibility service covers blocked apps with a lock screen. | [`android/`](android/) |
| iPhone | No app. Three Shortcuts automations, built by hand on the phone. | [`IPHONE.md`](IPHONE.md) |

The iPhone side is a recipe rather than an app because Apple only lets apps use
NFC and the Screen Time blocking API on the paid developer program.

## What you need

- NFC tags: **NTAG213 or NTAG215**, as stickers, cards or key fobs. Get a
  pack so there is a spare. If it will be stuck to metal (a fridge), buy
  "on-metal" tags; ordinary ones do not read through metal.
- Android phone with NFC, Android 8 or newer.
- iPhone XS/XR or newer, iOS 17 or newer.

Leave the tag blank. If a link is written to it, both phones will offer to open
that link on every tap.

## Android

### Get the app

Every push that touches `android/` builds an APK in GitHub Actions:
repository → **Actions** → **brick-android** → latest run → **Artifacts** →
`brick-apk`. It downloads as a zip holding `app-debug.apk`.

Or build it yourself (needs the Android SDK, which Android Studio installs):

```bash
cd brick/android
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest    # the tests
```

`./gradlew testDebugUnitTest -Pbrick.snapshots=/some/dir` also saves a PNG of
each screen.

### Install and set up

1. Get `app-debug.apk` onto the phone and open it. Android asks to allow
   installs from the app you opened it with (Files, Chrome); allow it. Play
   Protect may say it does not recognise the developer; choose to install
   anyway.
2. Open **Brick**. It shows one "next step" at a time:
   1. Turn on NFC if it is off.
   2. Hold the back of the phone against the tag. It becomes the brick.
   3. Choose the apps to block.
   4. Turn on Brick under Accessibility. On Android 13 and newer the switch is
      greyed out at first ("Restricted setting"). Open Settings → Apps →
      Brick, tap the ⋮ menu top right, choose **Allow restricted settings**,
      then go back and switch it on.
3. Settings → Apps → Brick → Battery → **Unrestricted**. Some phones (Samsung,
   Xiaomi, OnePlus) otherwise stop the service after a while, which silently
   unblocks everything.

### Use

- Tap the tag: bricked. Opening a blocked app shows the lock screen instead.
- Tap the tag again, from the lock screen, the Brick app or the home screen:
  unbricked.
- **Emergency unlock** unbricks without the tag. There are 5. They can only be
  refilled while unbricked, so running out means going back to the tag.
- **Strict mode** also blocks the Settings app and the uninstall dialog while
  bricked, which are the easy ways to switch Brick off.
- The app list, strict mode and the paired tag can only be changed while
  unbricked.

### If you are locked out

Tag lost, emergency unlocks spent, strict mode on: hold the power button, then
press and hold **Power off** to restart in safe mode. Third-party apps do not
run there, so Brick can be uninstalled from Settings. Restart normally
afterwards.

### Limits

- This is a commitment device between consenting adults, not parental control.
  Safe mode always gets around it, and without strict mode so does switching
  the service off in Settings.
- Notifications from blocked apps still arrive. Pair it with Do Not Disturb if
  that matters.
- A blocked app already playing in picture-in-picture keeps playing.
- The app is also offered when any other NFC card is held to the phone on the
  home screen; it just says "That isn't your brick."

### How it is built

Kotlin, platform views only, no runtime dependencies.

| File | Role |
|---|---|
| `BrickController.kt` | The rules: pairing, toggling, what to block, emergency unlocks. No Android imports. |
| `Brick.kt` | Storage (SharedPreferences) and the NFC reader. |
| `BlockerService.kt` | Accessibility service. Hears which app came to the front; cannot read the screen. |
| `MainActivity.kt` | Status, setup steps, settings. |
| `BlockActivity.kt` | The lock screen shown over a blocked app. |
| `AppPickerActivity.kt` | Choosing which apps to block. |

`app/debug.keystore` is checked in on purpose so that builds from CI and from
any laptop are signed alike and install over each other. It is a throwaway
debug key with the standard `android` password; do not reuse it for anything
you publish.
