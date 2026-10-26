# Mobile companion scope

The user's Phase 3 request authorizes React Native and Expo in this directory. Use JavaScript, not TypeScript. The root plain-web/no-bundler constraint continues to apply to the existing web application.

Read `../PHASE3_MOBILE_APP_V2.md`. Follow its order: reachability, real email/password auth, read-only student screens, push registration and actual test delivery before real-distraction wiring, parent aggregates, then additive mobile Google auth. Mocks/simulators do not establish two-device physical push delivery.

Use expo-secure-store for native JWTs. Never put credentials in AsyncStorage, logs, URLs, committed files or public configuration. Clear private in-memory data on account changes. Do not access cameras, microphones, screen contents or browser tabs. Keep the existing web Google cookie path and regression tests intact.
