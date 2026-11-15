# vibes

A home for several unrelated projects. Each one lives in its own top-level
directory with its own dependencies, tests and README — nothing is shared
across them, so they can be built, run and broken independently.

| Project | What it is |
|---|---|
| [`nashville-rentals/`](nashville-rentals/) | Monitors Nashville homes for rent and ranks them against a personal fit profile (neighborhood, commute to two workplaces, room to host, walkability). Python + SQLite. |
| [`brick/`](brick/) | A DIY phone "brick": tap a blank NFC tag to block distracting apps until you tap it again. Android app (Kotlin) plus a Shortcuts recipe for iPhone. |

## Adding a project

Give it a directory, a README that says what it does and how to run it, and
its own dependency manifest. Keep the repo root free of project-specific
files so the next one starts just as cleanly.
