# Native FocusLens companion

The user resumed the native React Native/Expo JavaScript companion after the free [Home Screen web companion](../companion/README.md) checkpoint. Both remain available. Camera detection stays on the laptop; neither companion accesses the camera or microphone.

This SDK 58 app uses the existing hosted email/password signup, login and identity routes. Its JWT is held in `expo-secure-store`, verified against `/auth/me` on restore, and erased on sign-out. Passwords are not saved. Students have a Dashboard, paginated History, private session details/timeline, linked-parent list and Profile. Missing imported data remains unknown. Parent rollups/linking await the ordered push checkpoint.

## Run on an iPhone

Install current Expo Go and sign in with the owner's Expo account. From this directory, run `npm ci` then `npx expo start --lan`. Scan the displayed QR using iPhone Camera while on the same Wi-Fi. Keep the Mac server running. No paid membership is needed just to run the JavaScript app in Expo Go.

The EAS project is `@pbrahmbhatt6/focuslens-companion`, ID `063625c9-aaee-4922-b8f9-88a895eab76c`. These are public project identifiers, not credentials. No APNs key, native provisioning profile or standalone build has been created.

Choose Student (or Parent), then **Continue with Google**, or choose **Create account** for email/password signup. Use the same account on the hosted laptop app to see its sessions. A new student's empty dashboard is expected. Reload/reopen to check secure sign-in restoration, then verify sign-out removes access. On the laptop, new accounts still complete the existing study/report onboarding.

## Manual remote-notification checkpoint

1. Sign in on a real phone and open **Profile → Phone notifications** (the Parent placeholder also includes these controls).
2. Tap **Connect notifications**, approve the phone's notification prompt, then tap **Send test notification**. Confirm a banner arrives while FocusLens is open. A matching foreground receipt is also shown in the app when observed.
3. Wait at least one minute. Send another test and immediately return to the phone's Home Screen; confirm arrival in the background. Check phone Focus/notification settings if banners or sounds are suppressed.
4. **Check test status** distinguishes sending, Expo acceptance and APNs/FCM receipt. None proves delivery to the phone. Receipts are checked after 15 minutes. Test jobs disappear on server restart and expire after an hour; registrations remain in PostgreSQL.
5. Disconnect notifications and verify further tests are unavailable. Normal sign-out first disconnects. If offline cleanup fails, the app offers explicit sign-out anyway and warns that the generic registration may remain. It never retains an extra JWT for cleanup. A token registered to another account cannot silently be reassigned; reconnect the old account and disconnect first.

Registration calls account-JWT-protected `POST /push-tokens` with `{token, platform}` only. `DELETE /push-tokens` removes only that caller's token. Manual tests use `POST /push-tokens/test` with an owned registration ID; jobs are private. Five devices/account and one test/minute/account are allowed. Tokens are stored securely on the phone and are never printed, placed in URLs or returned in status responses. The server uses only fixed HTTPS Expo endpoints, no redirects, generic content and no automatic send retry. Invalidated tokens are removed on `DeviceNotRegistered` tickets/receipts.

Expo's current generic FAQ and iOS-specific SDK notes disagree about Expo Go push availability. This app attempts the real iOS registration path and reports a clear error if the runtime rejects it; Android Expo Go is explicitly unsupported. **Actual iPhone foreground/background delivery is still required before real study alerts are connected.** A standalone iPhone app requires Apple's native signing/push setup; the free Home Screen Web Push app remains available separately.

## Google sign-in in Expo Go — approved browser flow

The user prioritized Google before the push checkpoint and chose **Keep Expo Go—add secure browser Google login**. This replaces the original Section 2 native SDK transport for this testing app. It uses the same existing web OAuth client/origins; no new native client ID or paid library is needed for this path. A signed native Google SDK app remains a separate future distribution choice.

Tap **Continue with Google**. Compare the six-digit code shown in the app and browser, then select your Google account. After verification, tap **Done** in the iPhone browser (or return to Expo Go and tap **Check Google sign-in**). The app displays the verified email, name and stored role. Tap **Continue as …** only if it is your account. Cancellation and choosing another account require a fresh flow. Existing email/password accounts still require their FocusLens password before Google can be linked; it is entered only into the FocusLens HTTPS page and is never stored.

The phone generates a 256-bit private verifier with Expo Crypto and sends only its S256 challenge to `POST /auth/google/companion/start`. The browser URL contains only a random public flow ID, never a verifier, password, Google ID token, app JWT or email. The browser has its own signed HttpOnly/SameSite nonce cookie; the same signature/audience/issuer/expiry/verified-email checks as web run before account resolution. Google credentials remain in page memory only. A ready browser response contains no app JWT. Proof-authenticated JSON POSTs check/finish/cancel the flow, and the app explicitly confirms the displayed identity before the atomic one-use exchange issues access. It verifies `/auth/me` before saving the app JWT in SecureStore. The private verifier is memory-only; restarting the app requires a new sign-in flow.

Flows expire after ten minutes, are bounded/rate-limited, and are lost on a backend restart. There is no polling loop, custom app redirect, third-party OAuth proxy, additional Google API access or browser credential storage. Provider errors are not logged. The browser page disables camera/microphone/geolocation and uses no-store, origin-only cross-origin referrers (required for GIS origin checks), and the existing restrictive Google CSP. Both Google pages use a fresh response nonce for GIS's injected button stylesheet; inline scripts and unrelated inline styles remain blocked. Role is chosen only for a new account; existing users keep their database role.

The original `/auth/google/config` + `/auth/google` web cookie path remains separate. Regression tests exercise real RSA verification and account linking for both transports, including mixed browser cookies and one-use exchanges. **Real phone browser return and Google consent/login still require user verification.** The browser test environment loaded Google's actual button but did not complete an authenticated Google callback; do not describe that as a successful real sign-in. Check the existing web login with the same real Google account as well.

After the Google check, resume the foreground/background push checkpoint. Actual study alerts and parent rollups/UI still wait for it.

## Verification

`npm test` runs 27 API/auth/progress/Google/notification ownership and race tests. An SDK 58 iOS bundle exports successfully with `npx expo export --platform ios`. Hosted email signup/login/me/history and native notification registration/removal were exercised with a clearly synthetic account, without sending a notification. Physical-device sign-in persistence and push delivery remain acceptance checks. Simulator/bundle checks do not establish them.

The SDK 58 development dependency tree reports five high-severity upstream Expo CLI findings (node-forge and Zod). No compatible patched tree was available; npm's suggested force fix downgrades Expo to SDK 44 and was not applied. These tools are not deployed with Flask. This is a development checkpoint, not a signed release or an App Store distribution.
