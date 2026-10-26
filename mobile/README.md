# Native companion prototype

This Expo SDK 57 JavaScript starter was created first, with email/password auth, `expo-secure-store`, and read-only student screens. During the checkpoint the user chose the free iPhone Home Screen web app with Web Push. The actively shipped companion is now [`../companion/`](../companion/README.md). Pure API/auth/progress modules here are also served through a strict allowlist to that web app.

`npm install` then `npm start` runs this native prototype. `npm test` checks the shared authentication and progress logic. The iOS JavaScript bundle exports successfully. Hosted email signup/login/me/history were tested with a synthetic account; **native physical-device login, native secure-store persistence, Google sign-in and push delivery are not claimed verified**. No EAS project or native push credentials were created.

Expo Go is for limited development testing. A standalone iPhone app and native push setup need their own signing/push credentials; the free Web Push path avoids those native requirements.

The generated SDK 57 development dependency tree currently reports five high-severity audit findings through Expo CLI's node-forge and Zod dependencies. No compatible upstream patch was available when checked; the suggested force fix would downgrade Expo to SDK 44 and was not applied. These native tools are not used to build or serve the plain web companion. Do not present this prototype as release-ready or expose its development server publicly. Review supported upstream updates before resuming native distribution.
