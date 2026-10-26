FOCUSLENS: FULL UI REDESIGN AND IMPLEMENTATION
Act as a senior product designer, brand designer, and frontend engineer responsible for bringing FocusLens to a polished, production-quality standard.

Your job is to redesign and implement the entire existing application's UI, including its visual identity, typography, colors, components, layouts, and interaction states.

Do not merely provide suggestions, a design plan, or example code. Work directly in the existing project, implement the changes, run the application, inspect the actual rendered interface, and fix visual defects.

I am delegating the design decisions to you. Do not repeatedly stop to ask me which colors, fonts, layouts, or components I prefer. Follow the specification below and use your judgment for details that are not specified.

1. FIRST: USE THE AVAILABLE DESIGN TOOLS
Before editing the application, check which of these skills and tools are installed and available:

Anthropic Frontend Design: use for deliberate visual direction, layout composition, typography, and distinctive frontend design.

UI/UX Pro Max: use for design-system guidance, palette consistency, typography pairings, component recommendations, and accessibility.

Impeccable: use for improving the existing interface's hierarchy, spacing, typography, and visual polish.

Playwright MCP: use to inspect the actual running application, navigate screens, test interactions, and identify visual defects.

Vercel Web Design Guidelines: use to audit accessibility, semantic structure, responsive behavior, and interface consistency.

Unslop UI: if installed, use as a final audit for generic AI-generated design patterns.

Taste: if installed, use as an optional reference for distinctive visual direction.

Use each tool for its intended purpose. Establish one consistent design system instead of allowing different skills to generate conflicting designs.

If a skill is unavailable, continue using the specification and other available tools. Do not waste time repeatedly attempting to install unavailable tools.

2. INSPECT THE ENTIRE EXISTING PROJECT
This is not a generic web app. FocusLens is three separate surfaces sharing one backend, with hard architectural constraints that a redesign must not break:

**Surface A — study app** (`index.html` + `js/*.js`, no framework, no build step, no npm — plain ES modules, MediaPipe Tasks Vision 0.10.32 loaded by pinned CDN `<script>` tag per `AGENTS.md`'s hard constraints). Styled by `styles.css`. Served two ways: standalone on `:8000` via `server.py` (Phase 1, local-only, no account), and account-connected at `/study` via the Flask app in `backend/__init__.py` (Phase 2+). There is no router — `js/app.js` swaps visibility between view sections in a single page: **Start → Calibration → Setup → Live → Summary → History**, plus a collapsed `<details>` "Detector diagnostics" panel. `index.html` currently links `./styles.css?v=7.4` — bump that version query string whenever `styles.css` changes, or demo browsers will serve a stale cached copy.

**Surface B — account app** (`account.html` + `js/account.js` / `js/account-dashboard.js` / `js/account-settings.js`), styled by `account.css`, served at `/` and `/account.html` by the same Flask app. Real screens: sign in / sign up (email+password and Google), two-step onboarding (duration + engagement goal + phone policy, then 1–3 report-recipient emails), the account Dashboard (recent sessions, family links, report config, "Open study app," "Edit study and report settings," the macOS monitor pairing code and `FocusLens-monitor.zip` download), and the legacy-history import flow. This page's Content-Security-Policy (set in `backend/__init__.py`'s `security_headers`) allows styles only from `'self'` and `https://accounts.google.com/gsi/style` — no Google Fonts `<link>`, no other external stylesheet or font host will load here.

**Surface C — mobile companion** (`mobile/`, React Native + Expo SDK 58, **plain JavaScript, not TypeScript**, per `mobile/AGENTS.md`). Entry is `mobile/App.js`. After `AuthScreen.js` (email/password + the Expo-Go-safe browser-based Google flow in `GoogleSignIn.js`/`google-browser.js`), the app splits by role: **`StudentArea.js`** (Dashboard / History / session detail / Profile tabs) and **`ParentArea.js`** (Dashboard of per-linked-student weekly rollups / Link a student / Profile tabs — the most recently added screen). `NotificationSettings.js` is embedded inside each role's Profile tab, not a separate route. All shared visual tokens already live in one place: `mobile/src/ui.js` exports `Button`, `Card`, and a single `StyleSheet.create(styles)` object that every screen imports — this is the correct (and only sane) place to centralize a new palette/type system for this surface, not scattered literals in `StudentArea.js`/`ParentArea.js`/`AuthScreen.js`.

**A fourth, smaller surface** — `companion/` is a separate, minimal Home-Screen Web Push PWA (`companion/index.html`, `app.js`, `styles.css`, `sw.js`). It has no camera/microphone access and its own locked-down CSP (`default-src 'none'; script-src 'self'; style-src 'self'; ...`). Treat it as a fourth screen set to restyle, not skip.

Run and inspect what can actually be inspected without a physical camera or phone: `account.html`'s full auth/onboarding/dashboard flow, `/study`'s Start/Setup/Summary/History views and their layout at desktop and mobile widths, `companion/`'s screen, and a `npx expo export --platform ios` / Expo web build of `mobile/` for layout and console errors. Calibration and Live cannot be meaningfully inspected without a real webcam and real phone/push hardware — note this explicitly rather than claiming those screens were visually verified when only their markup/styles were.

Identify the existing features and integrations that must be preserved **by name**: `js/classifier.js`, `js/pose.js`, `js/calibration.js`, `js/camera.js`, `js/desk-camera.js` (Tier 4 dual-camera), `js/phone-tracker.js`/`js/phone-worker.js` (MediaPipe ObjectDetector), `js/session.js` (state machine + event/segment log), `js/history.js`/`js/history-view.js` (local history + trend chart), `js/pacing.js` (personalized pacing), `js/nudges.js`/`js/audio.js` (the two-stage, Web-Audio-synthesized 15s/45s cues — never external audio files), `js/insights.js` (Tier 5 pattern tip), `js/window-signal.js`/`js/window-fusion.js` (app-name monitoring fusion), `js/reports.js` (email reports), `js/parent-alerts.js` (the 10-minute parent check-in trigger), every `backend/*.py` Flask blueprint, and every `mobile/src/*.js` module. This is a redesign of the existing application, not a new application — do not rewrite any of the above to make styling easier, and do not change the underlying architecture (no adding a bundler to Surfaces A/B, no switching mobile off plain JS) without a demonstrable technical reason.

**82 Python tests, 103 root-level JS tests, and 27 mobile JS tests currently pass** (`node --test tests/*.test.mjs`, `.venv/bin/python -m unittest discover -s tests -p 'test_*.py'`, `cd mobile && npm test`). None of them render CSS, but several of the browser-based fixtures (`tests/session-browser.html`, `tests/summary-browser.html`, `tests/account-study-browser.html`) drive the real DOM by element id/class to simulate sessions. A redesign that only changes CSS custom properties, class-level styling, and copy text is safe; one that renames or restructures the ids/classes those fixtures query, or changes a component's exported prop names in `mobile/src/*.js`, will break them. Re-run all three suites after each pass and treat a failure as a redesign bug to fix, never a test to loosen.

3. ESTABLISH THE OFFICIAL FOCUSLENS BRAND
The visual identity is called Electric Pop 2.0.

Its personality is bold, modern, colorful, approachable, and technically credible. It should feel like a carefully designed software product for students, not a generic AI-generated dashboard, gaming interface, or surveillance application.

The interface is dark mode only for this redesign.

Do not create a light theme or spend time implementing theme switching.

**Note the real tension this creates, and proceed anyway — it's an explicit creative decision, not an oversight to flag back:** the current FocusLens palette (sage green `#28664e`, cream `#f1f6f2`/`#f3f5f2`) was deliberately chosen as low-saturation and calm, for a product literally about reducing visual distraction during study, for users who may have ADHD. Electric Pop 2.0 reverses that intentionally. Keep the one place this still matters — the **Live session screen** — as visually restrained as the brand allows (per Section 10's existing "avoid motion that distracts from the study experience" rule): save the boldest accent use for Dashboard, Summary, and the mobile Parent/Student screens, not the screen someone is actively trying to concentrate in front of.

**Where these tokens actually need to live, concretely:**
- Web (Surfaces A, B, and the `companion/` PWA): `:root { ... }` custom properties in `styles.css`, `account.css`, and `companion/styles.css` respectively — each currently has a thin `:root` block already (`color-scheme`, base `font`, `color`, `background`) to extend, not replace wholesale.
- Mobile (Surface C): a new shared token object (colors, spacing, radii) added to `mobile/src/ui.js` alongside its existing `Button`/`Card`/`styles` exports — React Native has no CSS variables, so this JS object *is* the design-token layer, imported the same way every screen already imports `styles`.
- Every `theme_color`/`background_color` that currently hardcodes the old sage/cream palette must move together: `manifest.json` (`background_color: #f3f5f2`, `theme_color: #28664e`), `companion/manifest.webmanifest` (`background_color: #f1f6f2`, `theme_color: #28664e`), the `<meta name="theme-color">` tags in `index.html` and `account.html`, and `mobile/app.json`'s `"userInterfaceStyle": "light"` (must become `"dark"` for a dark-mode-only app, plus Android's `adaptiveIcon.backgroundColor: #E6F4FE` needs a dark-appropriate replacement).

Official color tokens
Use these exact colors as the starting point for a centralized design system.

Backgrounds and surfaces
Main application background: #242B40

Standard card and panel background: #373950

Raised surfaces, dropdowns, and popovers: #444660

Borders and dividers: #555773

The background should feel like a rich twilight blue-violet, not pure black, generic navy, or dull gray. Cards should have visible depth and separation.

Do not replace these approved foundation colors with near-black backgrounds.

Typography colors
Primary text: #F5F7FF

Secondary text: #C0C7DE

Muted text: #969FBC

Maintain clear text hierarchy. Use primary text for headings, important metrics, and essential information. Use secondary text for descriptions and supporting content. Reserve muted text for genuinely secondary metadata.

Do not make important information difficult to read simply to achieve a subtle aesthetic.

Brand accents
Electric cobalt: #3D7BFF

Signal cyan: #12CFE3

Impact coral: #FF6B6B

Pulse violet: #8D7CFF

Volt lime: #B7F542

Each accent must have a deliberate role.

Cobalt

Primary buttons and calls to action.

Selected navigation and tabs.

Links, selected controls, and active elements.

Important metrics and primary chart series.

Cyan

Live-session indicators.

Progress bars and live analytics.

Real-time data visualizations.

Secondary actions and active monitoring indicators.

Coral

Important insights and recommendations.

Secondary emphasis and selected highlights.

Warm visual accents that make the product feel approachable.

Violet

Secondary chart series.

Supporting analytics categories.

Selected pills, secondary data groupings, and occasional tinted surfaces.

Lime

Standout statistics.

Exceptional insights and small highlights.

Occasional high-contrast details.

Lime must remain relatively rare. It should attract attention when it appears.

Do not use all five colors randomly or give every component a different accent. Color should be distributed throughout the UI, but its meaning must remain consistent.

Suggested component treatments
Use these as starting values, adjusting individual components only when usability requires it:

Active navigation: cobalt-tinted surface with a clear active indicator. In FocusLens this is the account-app Dashboard's implicit single view (no tab bar yet) and, concretely, the mobile `Button` row pattern already used in `StudentArea.js` (`[['dashboard','Dashboard'],['history','History'],['profile','Profile']]`) and the newer `ParentArea.js` (`[['dashboard','Dashboard'],['link','Link a student'],['profile','Profile']]`) — the selected tab's `secondary={tab !== value}` Button is where the cobalt active-indicator belongs.

Selected filter pills: violet-tinted surface.

Live-session badges: cyan-tinted surface with a cyan indicator. Concretely: the study app's `.state-indicator`/`[data-state]` badge in `styles.css` and the "Live" stage of the Start→Calibration→Setup→Live→Summary→History flow.

Insight cards: subtle coral-tinted backgrounds with coral highlights. Concretely: the `.pattern-tip` block in `styles.css` (driven by `js/insights.js`) and the mobile Parent Dashboard's per-student rollup `Card` in `ParentArea.js`.

Analytics cards: lavender surfaces with colored chart series. Concretely: `#history-chart` and its `.chart-grid`/`.chart-line`/`.chart-dot` classes in `styles.css`, and `mobile/src/progress.js`'s timeline rendering consumed by `StudentArea.js`'s `SessionDetail`.

Primary buttons: cobalt with accessible text.

Secondary buttons: cyan with dark text when the contrast is sufficient.

Progress indicators: cyan or cobalt, depending on their purpose. Concretely: the `.session-countdown` and `.countdown` elements in `styles.css`.

Selected chart points: use the relevant series color, not an arbitrary accent.

Use restrained gradients for specific brand moments. Do not apply gradients to every card, button, or background.

4. REDESIGN THE LOGO AND WORDMARK
The logo must feel like a genuine, professionally designed software brand.

**There is no prior FocusLens logo to reuse.** Every icon asset in the repo today is an explicitly-labeled placeholder (`TIER7_MAC_PACKAGING.md`: "a simple placeholder icon is fine, this isn't being judged on logo design") — `icon-192.png` and `icon-512.png` at the project root. Do not search for a better-quality original; design the mark from scratch per the direction below, then regenerate it into **every one of these exact files**, which are the complete, real set of places an icon is referenced from:
- `icon-192.png`, `icon-512.png` (root) — read by `manifest.json`, `companion/manifest.webmanifest`, `index.html`'s `<link rel="icon">`/`<link rel="apple-touch-icon">`, `account.html`'s `<link rel="icon" href="/assets/icon-192.png">`, and `backend/__init__.py`'s `account_assets`/`public_asset` static-file allowlists (adding a differently-named file requires adding it to those allowlists or it will 404).
- `mobile/assets/icon.png`, `mobile/assets/favicon.png`, `mobile/assets/splash-icon.png`, `mobile/assets/android-icon-foreground.png`, `mobile/assets/android-icon-background.png`, `mobile/assets/android-icon-monochrome.png` — referenced from `mobile/app.json`'s `expo.icon`, `expo.web.favicon`, and `expo.android.adaptiveIcon`.

Approved direction
A clean, geometric lens or focus-frame symbol.

A bold, recognizable silhouette that remains legible at small sizes.

A smooth, continuous gradient flowing from cobalt blue through violet into coral.

The word Focus in soft white.

The word Lens in the same smooth cobalt-to-violet-to-coral gradient.

A clean, bold wordmark with carefully balanced proportions.

The gradient should transition smoothly. Avoid abrupt color changes between letters.

Logo style restrictions
Do not use:

Glossy 3D effects.

Metallic or glass effects.

Bevels and embossed lettering.

Heavy outer glows.

Excessive shadows.

Overly complex camera illustrations.

Decorative AI-generated visual effects.

The logo should be flat, bold, geometric, and classy.

Build the wordmark as an inline SVG (or a small set of static SVG/PNG exports at the sizes above) — the web surfaces have no build tool to run an icon-generation pipeline, so whatever is produced must be hand-exported to those exact raster sizes, not generated at request time.

Create consistent variants for:

Full logo with wordmark.

Compact icon for navigation and small spaces — this is the icon-only mark that becomes `icon-192.png`/`mobile/assets/icon.png`.

Favicon or application icon — `icon-192.png` already serves this role on web; `mobile/assets/favicon.png` on mobile web.

Ensure that the icon works independently of the wordmark.

5. ESTABLISH A CONSISTENT TYPOGRAPHY SYSTEM
Use the following pairing throughout the application:

Primary brand font: Manrope

Wordmark: ExtraBold 800 where supported by the selected font file.

Main page headings: Bold 700.

Section headings: SemiBold 600 or Bold 700.

Important dashboard metrics: Bold 700.

Interface font: Inter

Body text: Regular 400.

Buttons: Medium 500 or SemiBold 600.

Navigation: Medium 500.

Labels and metadata: Medium 500 where appropriate.

**Concrete loading path per surface — do not reach for a Google Fonts `<link>` anywhere; it will be blocked.** Every CSP in this project (`backend/__init__.py`'s `security_headers`, and `companion/`'s own fully-locked policy) restricts `style-src`/`font-src` to `'self'` plus, on the account/Google pages only, `https://accounts.google.com/gsi/*`. Self-host the actual Manrope and Inter font files instead: add them as static files served from the same place `js/*.js` is already served (`backend/__init__.py`'s `study_asset`/`account_assets` handlers and `server.py`'s Phase-1 equivalent, both of which currently allow-list files by exact name — a new `/fonts/` path needs its own explicit route and allow-list, the same pattern those handlers already use for `.js` files), and declare them with local `@font-face` rules in `styles.css`/`account.css`/`companion/styles.css`. For mobile (Surface C), there is no CSS — add `expo-font` (not currently a `mobile/package.json` dependency) and load the two families with `useFont`/`Font.loadAsync` from bundled `.ttf` assets under `mobile/assets/`.

Use genuine font files or reliable font loading. Verify that the chosen weights actually load. Do not simulate every weight by applying arbitrary CSS properties to a single font file.

Use a deliberate type scale with clear differences between page titles, section headings, metric values, body text, and metadata.

Avoid:

Inconsistent heading sizes.

Random font changes between screens.

Excessively bold body text.

Oversized headings that waste dashboard space.

Tiny labels that are difficult to read.

Excessively loose or cramped letter spacing.

Keep the logo typography distinct from ordinary interface typography.

6. MAKE THE INTERFACE VISIBLY VIBRANT
This requirement is critical.

A dark interface containing mostly muted cards, white text, and one blue button is not the desired outcome.

The UI must have a substantial, deliberate presence of accent colors across the actual application.

Use color in:

Navigation and selected tabs — concretely, the mobile tab-switcher `Button` rows in `StudentArea.js`/`ParentArea.js`.

Icons and icon containers.

Status badges and pills — concretely, `[data-state="engaged|distracted|drowsy|away|paused|unclassified"]` in `styles.css`.

Charts and analytics — `#history-chart` (web) and `mobile/src/progress.js`'s timeline (mobile).

Focus-session progress indicators — `.session-countdown`, `.countdown`.

Session timelines — `.timeline` and `.legend` in `styles.css`; the `View`-based timeline bars in `StudentArea.js`'s `SessionDetail`.

Metric cards — `.summary-stats`, `.recovery-stat` in `styles.css`; the mobile `Dashboard`/`StudentSummary` `Card`s.

Insight and recommendation cards — `.pattern-tip` (web, from `js/insights.js`); the Parent Dashboard rollup card (mobile, from `ParentArea.js`'s `StudentSummary`).

Interactive buttons.

Selected states and focus outlines — every surface already has an explicit `:focus-visible` outline rule (`styles.css`, `account.css`); keep a visible, high-contrast focus ring in the new palette, don't drop it for aesthetics.

Empty states and meaningful illustrations — concretely, `ParentArea.js`'s "No student linked yet" card, and `StudentArea.js`'s "Your first session is still ahead" / "No sessions yet" copy.

Relevant hover and pressed states.

Use tinted backgrounds and colored details to add depth without making entire screens overwhelmingly bright.

Vary the composition. Some sections can be dense with information, while others should give important metrics room to stand out.

Do not make every card the same color, size, layout, and radius.

Do not force everything into a repetitive grid of identical rounded rectangles.

Do not use color as decoration without a purpose.

The goal is high accent density with a consistent visual hierarchy.

7. REDESIGN EVERY EXISTING SCREEN
Inspect and improve every existing screen, not just the landing page. FocusLens has no generic "dashboard" or client-side router — redesign these real screens, in these real files:

Study app (`index.html` / `js/app.js` / `styles.css`) — six views in one page, no routing
- **Start:** Phone-free vs. Studying-with-phone choice, Begin button, History entry point.
- **Calibration:** three timed prompts (screen 5s, notes 5s, side-glance 3s) with a live valid-frame percentage.
- **Setup:** duration (15/25/45/custom), engagement-goal slider, optional personalized-pacing suggestion line (`js/pacing.js`), optional desk-camera (Camera B) picker, optional app-monitor allow-list.
- **Live:** time remaining, confirmed state badge, engagement percentage, pause/resume/stop controls, the two-stage audio+banner nudge. Make the current state and the timer the loudest things on screen; keep everything else quiet, per Section 3's note on this specific screen.
- **Summary:** recovery speed first, then engagement-vs-goal, distraction count, longest distraction, the `js/insights.js` pattern tip, and the segmented `.timeline`. Give recovery speed the most prominent single number on the page — it's the project's defining, differentiating metric.
- **History:** chronological saved-summary table plus the recovery-trend `#history-chart`, available without activating the camera.
- Preserve the existing camera, classifier, calibration, state-machine, event-logging, scoring, and audio behavior exactly — this redesign only ever touches `styles.css` and the static markup/copy in `index.html`, never `js/classifier.js`, `js/pose.js`, `js/session.js`, `js/audio.js`, or the detector pipeline files.

Account app (`account.html` / `js/account*.js` / `account.css`)
- Sign in / sign up (email+password, Google), the two-step onboarding form, the Dashboard (recent sessions, family links, report config, study-app/settings links, monitor pairing + `FocusLens-monitor.zip` download), and legacy-history import. Apply the same typography, spacing, buttons, forms, and surfaces as the study app — these two stylesheets should read as one brand, not two.
- Give validation errors (`#account-error`, `#settings-error`), loading states, and successful actions (e.g. "Student linked.") one consistent visual treatment across both files.

Mobile companion (`mobile/App.js` / `mobile/src/*.js`)
- **StudentArea.js:** Dashboard (recent-session summary + pacing suggestion), History (paginated list, "Load older sessions"), session detail (engagement, recovery, timeline), Profile (account info, linked parents, Companion settings, `NotificationSettings`).
- **ParentArea.js:** Dashboard (per-linked-student weekly rollup — sessions this week, average engagement, average recovery, trend vs. last week), Link a student (email form), Profile (reuses the same `Profile` component as the student side).
- Both roles share one token source, `mobile/src/ui.js` — redesign there once, every screen inherits it.

`companion/` Home Screen Web Push PWA
- Its one screen (connect/test/disconnect notifications) should read as the same brand as the native mobile app, not a separate product.

Navigation and shared components
- There is no cross-page navigation chrome to unify beyond: the study app's Start/Setup/Live/Summary/History view-swap (a progress indicator across these five would help, since there currently is none), the account app's Dashboard-centric single-page layout, and the mobile app's tab-`Button` row pattern already shared by `StudentArea.js`/`ParentArea.js`. Standardize button heights, input styles, border radii, and spacing across `styles.css`, `account.css`, `companion/styles.css`, and `mobile/src/ui.js`'s `styles` object — these four places are the entire component system; there are no other stylesheets.
- There are no modals, dropdown menus, or tooltips in the current markup to restyle — don't invent any. The closest existing "popover-like" surfaces are the native `<select>` elements (duration/engagement) and the `<details>`/`<summary>` diagnostics/history panels.

If a screen does not exist, do not invent new product functionality just to fill a design section.

8. USE A CONSISTENT ICON SYSTEM
Use a single coherent icon family, preferably Lucide if compatible with the existing stack.

**Compatibility check, concretely:** the study and account apps (Surfaces A/B) have no npm/bundler — `npm install lucide` is not an option there. Use either hand-copied inline SVG markup from Lucide's icon set (no JS dependency, consistent with the existing no-build-tool constraint) or a single self-hosted static SVG sprite file added to the same static-asset allowlist discussed in Section 5. The mobile app (Surface C) does have npm, so `lucide-react-native` is a legitimate real dependency to add there.

Keep stroke weights consistent.

Align icons optically with their labels.

Use appropriate icon sizes for navigation, buttons, cards, and status indicators.

Avoid mixing filled, outlined, emoji, and unrelated icon styles without a clear reason.

Give important icons intentional accent colors.

Do not use an icon where a readable label is necessary.

9. CREATE AND USE DESIGN TOKENS
Implement the design system centrally using the project's existing styling approach — which differs by surface, and both already exist:

- Web (Surfaces A/B) and `companion/`: CSS custom properties. Each of `styles.css`, `account.css`, and `companion/styles.css` already has a `:root { ... }` block (currently just `color-scheme`, base font, `color`, `background`) — extend each with the full backgrounds/surfaces/text/accent/status/spacing/radius/shadow/transition/focus-outline token set, rather than adding a fourth, separate tokens file.
- Mobile (Surface C): `mobile/src/ui.js`'s existing `StyleSheet.create(styles)` object plus its `Button`/`Card` components — extend that one object/file, imported by every screen exactly as it already is, rather than duplicating hex values inside `StudentArea.js`, `ParentArea.js`, `AuthScreen.js`, or `NotificationSettings.js`.

Do not scatter unrelated hard-coded color values across dozens of components.

Do not perform an unnecessary framework migration or introduce a large UI library merely for convenience.

Use shared components where doing so improves consistency and maintainability.

10. ACCESSIBILITY AND STATUS COLORS
Keep the brand palette separate from the classifier's semantic status colors.

Use this starting status system:

Engaged: #28D17C

Distracted: #FFB020

Drowsy: #B18CFF

Away: #A0A8BC

Technical error: #FF4D5D

Use appropriate tinted backgrounds for these states.

A distraction warning is not a technical error. Do not treat every lapse as a failure or use aggressive red alerts for ordinary distraction.

**Status meaning must remain consistent across cards, charts, timelines, and notifications — concretely, that means updating these two places together, since they currently duplicate the same four colors independently:** the `[data-state="engaged|distracted|drowsy|away|paused|unclassified"]` CSS rules in `styles.css` (web timeline, live badge, legend), and the `STATE_COLORS`/`STATE_LABELS` objects exported from `mobile/src/progress.js` (consumed by `StudentArea.js`'s session-detail timeline). Leaving one updated and the other on the old sage/amber/blue/gray set will make the web and mobile timelines disagree about what each color means.

Also:

Check text contrast against the actual background.

Make keyboard focus visible — every surface already defines an explicit `:focus-visible` rule; preserve one in the new palette rather than removing it.

Preserve semantic HTML and accessible labels — note that `AuthScreen.js`, `NotificationSettings.js`, and others already set real `accessibilityLabel`/`accessibilityRole` props throughout; keep them on any restructured element.

Ensure interactive controls have usable hit areas.

Do not rely on color alone to convey status.

Avoid motion that distracts from the study experience — this applies most to the Live screen specifically (see Section 3).

Do not claim WCAG compliance without checking the relevant combinations and interactions.

11. IMPLEMENT IN CONTROLLED PASSES
Complete the work in this order:

Pass 1: Foundation

Establish design tokens in `styles.css`, `account.css`, `companion/styles.css`, and `mobile/src/ui.js`.

Load the correct fonts (self-hosted, per Section 5 — not a Google Fonts `<link>`).

Refine the logo and shared icon treatments, and regenerate every icon file listed in Section 4.

Standardize the main layout, spacing, and surfaces.

Pass 2: Main product screens

Redesign the study app's Setup, Live, and Summary views.

Redesign the account app's Dashboard.

Redesign the mobile Student and Parent Dashboards.

Pass 3: Remaining interface

Redesign Start, Calibration, and History on the study app; sign-in/sign-up, onboarding, and the import flow on the account app; mobile History, session detail, Profile/notifications, and Link-a-student; and the `companion/` PWA screen.

Ensure the four shared token sources (`styles.css`, `account.css`, `companion/styles.css`, `mobile/src/ui.js`) stay consistent with each other.

Pass 4: Visual polish

Refine spacing and alignment.

Fix typography inconsistencies.

Improve chart styling (`#history-chart`, `mobile/src/progress.js`'s timeline) and color distribution.

Add thoughtful hover, active, loading, empty, and error states — reusing the real copy already in the codebase (e.g. `StudentArea.js`'s "Your first session is still ahead," `ParentArea.js`'s "No student linked yet") rather than inventing new empty-state language.

Remove unnecessary decoration and generic design patterns.

Pass 5: Verification

Run `node --test tests/*.test.mjs`, `.venv/bin/python -m unittest discover -s tests -p 'test_*.py'`, and `cd mobile && npm test` — all 212 existing checks must still pass unmodified.

Use Playwright (already available in this environment) to load `account.html` and the non-camera parts of `/study`, and `npx expo export --platform ios` to confirm the mobile bundle still builds, with the new styles applied.

Test desktop and mobile-width layouts (both web stylesheets already have a `@media` breakpoint to extend, not replace).

Navigate through the actual application as far as it goes without a physical camera, phone, or push-capable device.

Check for clipping, overflow, broken alignment, unreadable text, inconsistent components, and missing assets (every icon/font path from Sections 4–5 actually resolving under the real static-file allowlists, not 404ing).

State plainly which parts (camera calibration/live accuracy, real push-notification appearance on a phone) could not be visually verified this way, rather than claiming full verification.

Fix the defects discovered during inspection.

Do not stop after the first successful build. Review the rendered interface and repeat the correction cycle until the major visual defects are resolved.

12. NON-NEGOTIABLE RULES
Do not stop after presenting a plan.

Do not return only CSS snippets or recommendations.

Do not create static mockups in place of the real interface.

Do not remove functioning features.

Do not replace real data with invented dashboard metrics.

Do not claim a feature works unless you have tested it.

Do not add unnecessary routes or features.

Do not change the approved brand palette without a compelling technical reason.

Do not make the entire UI monochrome.

Do not make every component neon.

Do not make the logo glossy or overly complex.

Do not ask me to make routine design decisions.

Do not claim the application is fully verified if you have not inspected it.

**Do not add a bundler, framework, or npm dependency to the study or account apps (Surfaces A/B) to make the redesign easier — "plain HTML/CSS/JS, no build tool" is a hard constraint in `AGENTS.md`, not a stylistic default.** Any new static asset (font files, icon SVGs) must be added to the exact allowlists in `backend/__init__.py` (`study_asset`, `account_assets`, `public_asset`) and `server.py`'s Phase-1 equivalent, or it will 404 once deployed — adding the file alone is not enough.

**Do not weaken any Content-Security-Policy in `backend/__init__.py` or `companion/`'s handlers to make an external font/icon host load — self-host the asset instead (Sections 5 and 8).**

Prioritize a coherent brand, a vibrant and readable dark interface, and professional execution.

13. FINAL REPORT
When the implementation and verification are complete, report:

Which screens were redesigned (by the real names in Section 7 — Start/Calibration/Setup/Live/Summary/History, the account Dashboard, Student/Parent mobile screens, the companion PWA).

Which fonts, logo assets, and design tokens were implemented, and in which of the four token sources (`styles.css`, `account.css`, `companion/styles.css`, `mobile/src/ui.js`).

Which plugins and skills were actually used.

Which browser/Playwright checks and which of the three automated test suites (root Python, root JS, mobile JS) were run, and whether all 212 checks still passed.

Any CSP or static-asset-allowlist changes made, and exactly which files/routes they touch.

Any remaining visual or functional problems.

Any features that could not be verified (explicitly: real-camera calibration/live accuracy, and real push-notification appearance, since neither is reachable from this environment).

Start by inspecting the existing project, then proceed through implementation and browser verification. Complete as much of the redesign as possible without sacrificing the working application.
