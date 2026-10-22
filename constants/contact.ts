/**
 * Where people email a short product video (PostPublishModal, "Email your video").
 *
 * hello@trydibbs.com is the Cloudflare-routed founder inbox recorded as verified
 * in docs/PROJECT-DIRECTIVES.md. NO dedicated video inbox has been established,
 * so the owner must confirm this address. Override it at build time with
 * EXPO_PUBLIC_VIDEO_EMAIL (baked into the bundle like every EXPO_PUBLIC_* value).
 */
export const VIDEO_SUBMISSION_EMAIL = process.env.EXPO_PUBLIC_VIDEO_EMAIL?.trim() || 'hello@trydibbs.com';
