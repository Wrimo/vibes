# Brick on iPhone

There is no app to install. Three automations in Apple's **Shortcuts** app do
the job. Setting them up takes about 15 minutes, once.

Needs an iPhone XS/XR or newer on iOS 17 or newer.

These steps were written from how Shortcuts works on iOS 17 and 18 and have not
been run on a phone as part of this project. Action names shift slightly
between iOS versions; if one is not found, search Shortcuts for the nearest
match (noted in brackets where it is likely).

## How it works

- The phone is "bricked" while a file called `brick.txt` exists in the
  Shortcuts folder.
- Tapping the tag creates the file if it is missing and deletes it if it is
  there.
- Whenever one of your chosen apps is opened, an automation checks for the file
  and, if it finds it, sends you back to the Home Screen.
- A Focus called **Brick** is switched on and off alongside, to silence
  notifications and show that you are bricked.

The file, not the Focus, is what counts. Turning the Focus off in Control
Center does not unblock anything.

## 1. Make the Focus

Settings → Focus → **+** → Custom → name it `Brick`. Under **Apps**, choose
"Silence Notifications From" and pick the same apps you are about to block.
Leave People alone so calls and messages still come through.

## 2. Automation: tapping the tag

Shortcuts → **Automation** tab → **+** → **NFC**.

1. Tap **Scan** and hold the top edge of the iPhone to the tag. Name it
   `Brick`.
2. Choose **Run Immediately** and turn **Notify When Run** off. Next.
3. Choose **New Blank Automation** and add these actions in order:

| # | Action | Settings |
|---|---|---|
| 1 | **Get File from Folder** | Folder: `Shortcuts`. File Path: `brick.txt`. Tap the arrow and turn **Error If Not Found** off. |
| 2 | **If** | Input: `File`. Condition: **has any value**. |
| 3 | **Delete Files** (inside If) | File: the `File` from step 1. Turn **Delete Immediately** on. |
| 4 | **Set Focus** (inside If) | Turn `Brick` **Off**. |
| 5 | **Otherwise** | Already there; the next three actions go under it. |
| 6 | **Text** | Type `bricked`. |
| 7 | **Save File** | File: the `Text`. Turn **Ask Where to Save** off. Folder: `Shortcuts`. Subpath: `brick.txt`. Turn **Overwrite If File Exists** on. |
| 8 | **Set Focus** | Turn `Brick` **On** until **Turned Off**. |
| 9 | **End If** | Already there. |

The order inside each half matters: delete the file *before* turning the Focus
off, and save it *before* turning the Focus on.

Tap the tag twice now. The first time iOS asks whether the automation may
delete a file; choose **Always Allow**.

## 3. Automation: opening a blocked app

Automation → **+** → **App**.

1. Tap **Choose** and tick every app to block. Keep **Is Opened** ticked.
2. **Run Immediately**, **Notify When Run** off. Next.
3. **New Blank Automation**, with these actions:

| # | Action | Settings |
|---|---|---|
| 1 | **Get File from Folder** | Same as before: `Shortcuts`, `brick.txt`, **Error If Not Found** off. |
| 2 | **If** | `File` **has any value**. |
| 3 | **Go to Home Screen** (inside If) | Nothing to set. |
| 4 | **End If** | |

## 4. Automation: keeping the Focus on

This stops the Focus being switched off by hand while bricked.

Automation → **+** → **Focus** → `Brick` → **When Turning Off** → **Run
Immediately**, **Notify When Run** off. Next. **New Blank Automation**:

| # | Action | Settings |
|---|---|---|
| 1 | **Get File from Folder** | Same as before. |
| 2 | **If** | `File` **has any value**. |
| 3 | **Set Focus** (inside If) | Turn `Brick` **On** until **Turned Off**. |
| 4 | **End If** | |

## Try it

1. Unlock the phone and hold its top edge to the tag. The Brick Focus comes on.
2. Open a blocked app. It appears for a moment and you are returned to the
   Home Screen.
3. Tap the tag again. The Focus goes off and the app opens normally.

The phone has to be unlocked with the screen on for a tag tap to register.

## Making it stricter

As built, the way to cheat is to open Shortcuts and switch an automation off.
To close that, edit the automation from step 3 and add **Shortcuts** to its app
list. From then on Shortcuts itself is blocked while bricked.

Leave the **Files** app unblocked. It is the emergency exit.

## Emergency exit

There is no counter on iPhone. If the tag is lost or you are away from it:
Files → Browse → iCloud Drive (or On My iPhone) → **Shortcuts** → delete
`brick.txt`. Everything unblocks at once, and the Focus can then be switched
off from Control Center.

## Limits

- Blocked apps flash on screen for a moment before the phone returns Home.
- Spotlight, widgets and notifications can still show content from blocked
  apps; only opening the app is stopped.
- This is weaker than the Android app. It relies on friction rather than a
  real lock, because the real lock (Apple's Screen Time API) needs a paid
  developer account.
