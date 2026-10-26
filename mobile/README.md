# Native FocusLens companion

The user resumed the native React Native/Expo JavaScript companion after the free [Home Screen web companion](../companion/README.md) checkpoint. Both remain available. Camera detection stays on the laptop; neither companion accesses the camera or microphone.

This SDK 58 app uses the existing hosted email/password signup, login and identity routes. Its JWT is held in `expo-secure-store`, verified against `/auth/me` on restore, and erased on sign-out. Passwords are not saved. Students have a Dashboard, paginated History, private session details/timeline, linked-parent list and Profile. Missing imported data remains unknown. Parent rollups/linking await the ordered push checkpoint.

## Run on an iPhone

Install current Expo Go and sign in with the owner's Expo account. From this directory, run `npm ci` then `npx expo start --lan`. Scan the displayed QR using iPhone Camera while on the same Wi-Fi. Keep the Mac server running. No paid membership is needed just to run the JavaScript app in Expo Go.

The EAS project is `@pbrahmbhatt6/focuslens-companion`, ID `063625c9-aaee-4922-b8f9-88a895eab76c`. These are public project identifiers, not credentials. No APNs key, native provisioning profile or standalone build has been created.

Choose **Create account**, enter a name/email/password and select Student (or Parent). Use the same account on the hosted laptop app to see its sessions. A new student's empty dashboard is expected. Reload/reopen to check secure sign-in restoration, then verify sign-out removes access. On the laptop, new accounts still complete the existing study/report onboarding.

## Manual remote-notification checkpoint

1. Sign in on a real phone and open **Profile → Phone notifications** (the Parent placeholder also includes these controls).
2. Tap **Connect notifications**, approve the phone's notification prompt, then tap **Send test notification**. Confirm a banner arrives while FocusLens is open. A matching foreground receipt is also shown in the app when observed.
3. Wait at least one minute. Send another test and immediately return to the phone's Home Screen; confirm arrival in the background. Check phone Focus/notification settings if banners or sounds are suppressed.
4. **Check test status** distinguishes sending, Expo acceptance and APNs/FCM receipt. None proves delivery to the phone. Receipts are checked after 15 minutes. Test jobs disappear on server restart and expire after an hour; registrations remain in PostgreSQL.
5. Disconnect notifications and verify further tests are unavailable. Normal sign-out first disconnects. If offline cleanup fails, the app offers explicit sign-out anyway and warns that the generic registration may remain. It never retains an extra JWT for cleanup. A token registered to another account cannot silently be reassigned; reconnect the old account and disconnect first.

Registration calls account-JWT-protected `POST /push-tokens` with `{token, platform}` only. `DELETE /push-tokens` removes only that caller's token. Manual tests use `POST /push-tokens/test` with an owned registration ID; jobs are private. Five devices/account and one test/minute/account are allowed. Tokens are stored securely on the phone and are never printed, placed in URLs or returned in status responses. The server uses only fixed HTTPS Expo endpoints, no redirects, generic content and no automatic send retry. Invalidated tokens are removed on `DeviceNotRegistered` tickets/receipts.

Expo's current generic FAQ and iOS-specific SDK notes disagree about Expo Go push availability. This app attempts the real iOS registration path and reports a clear error if the runtime rejects it; Android Expo Go is explicitly unsupported. **Actual iPhone foreground/background delivery is still required before real study alerts are connected.** A standalone iPhone app requires Apple's native signing/push setup; the free Home Screen Web Push app remains available separately.

## Google and remaining order

Google is not connected in this Expo Go checkpoint. The native Google Sign-In library requires a development build, not Expo Go. Do not introduce an unsupported OAuth proxy or put FocusLens JWTs in redirect URLs to disguise that limitation. Per `PHASE3_MOBILE_APP_V2.md`, after real-device push confirmation come alert infrastructure, privacy-limited parent aggregates/UI, then additive mobile Google nonce transport and separate iOS/Android OAuth clients. Existing web Google cookie/nonces remain unchanged. Its real web login must be regression-tested when the mobile path is added.

## Verification

`npm test` runs 21 API/auth/progress/notification ownership and race tests. An SDK 58 iOS bundle exports successfully with `npx expo export --platform ios`. Hosted email signup/login/me/history were exercised with a clearly synthetic account; physical-device sign-in persistence and push delivery remain acceptance checks. Simulator/bundle checks do not establish them.

The SDK 58 development dependency tree reports five high-severity upstream Expo CLI findings (node-forge and Zod). No compatible patched tree was available; npm's suggested force fix downgrades Expo to SDK 44 and was not applied. These tools are not deployed with Flask. This is a development checkpoint, not a signed release or an App Store distribution.
