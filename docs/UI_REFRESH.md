# Frontend refresh

Implemented on 14 November 2026, continuing the saved `46dad36` checkpoint.
Published demo: https://code-kaybee.github.io/Intent-Guard/

## Completed

- Yellow `#f3ca20` and black `#000000` branding, with neutral dark and light surfaces. Light-mode text uses a darker gold for readable contrast; primary buttons retain the brand yellow.
- Self-hosted DM Sans and Space Grotesk variable fonts, with their SIL Open Font Licenses in `assets/fonts/`. No external font requests are needed.
- Light, Dark, and System appearance settings. The saved preference applies before first paint; System follows operating-system changes. Restricted browser storage does not interrupt the console.
- A desktop sidebar that collapses to an accessible icon rail and remembers the setting.
- A mobile navigation drawer with a backdrop, Escape dismissal, focus containment, focus return, and dismissal on navigation. Background content is inert while the drawer is open.
- A reproducible, captioned demo recording through `npm run record:demo`; see [submission materials](SUBMISSION.md).

Taste's `design-taste-frontend` skill was installed from `Leonxlnx/taste-skill` using the skill-installer helper. Its typography, contrast, interaction, and accessibility guidance informed this bounded refresh of the existing attack console. The application keeps its working console layout and verified NEAR evidence.

## Verification

```sh
npm run build:web
npm test
npm run test:web
npm run build:contract
npm run test:integration
```

Browser checks cover appearance persistence and System changes, prepaint appearance without the console module, restricted storage, the desktop rail, mobile drawer keyboard behavior, existing receipt workflows, and layouts from 320 to 1920 pixels. The existing GitHub Pages workflow validates and publishes pushes to `main`.
