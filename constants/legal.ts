/**
 * Single source of truth for the Terms of Service and Privacy Policy shown
 * in app/legal/terms.tsx and app/legal/privacy.tsx, plus the age-eligibility
 * constant used by the sign-up gate in app/auth/verify.tsx.
 *
 * The founder supplied the operator facts on 2026-10-26; the November 16, 2026
 * revision brought the text in line with "Get a Dibbs offer", added community
 * rules and corrected the Privacy Policy against the code. The text is written
 * by a non-lawyer and has NOT been reviewed by a lawyer yet (docs/LEGAL-TODO.md).
 * Keep it honest about what the app does. The 30-day retention promise is
 * enforced by backend/retention.ts; change both together. Dibbs offer requests
 * are NOT covered by that job (see PRIVACY_SECTIONS, section 6).
 *
 * This file must stay free of React / React Native imports: scripts import it.
 */

/**
 * Minimum age to create an account, as a self-declared checkbox (not age
 * verification — see the sign-up screen copy).
 *
 * This number has real legal consequences and is the founder's decision,
 * not an engineering one:
 *  - Under 13 in the US triggers COPPA (strict parental-consent rules).
 *  - Under 16 triggers "GDPR-K" style rules in parts of the EU/EEA even for
 *    a US-only prototype if any user could be in scope.
 *  - App Store / Play Store age ratings and required disclosures change
 *    based on this number and on marketplace/contact features like this
 *    app's chat and in-person meetups.
 * 18 is used as a conservative placeholder because this app arranges
 * in-person meetups between strangers. Do not lower it without legal advice.
 */
export const MINIMUM_AGE = 18;

export const LEGAL_ENTITY_NAME = 'Charles Aspatore';
export const OPERATOR_CONTACT_EMAIL = 'hello@trydibbs.com';
export const GOVERNING_JURISDICTION = 'the State of Arizona, USA';
export const DATA_RETENTION_PERIOD =
  'Your profile is anonymized as soon as you close your account. 30 days later we delete the messages you sent, your listings and their photos from the App, your offers and meetup and sale records, and your Community posts. We keep the anonymized "Deleted user" placeholder, safety reports and anything that was reported, so moderators can still act on them. Private "Get a Dibbs offer" requests and their photos and video are not part of this 30-day cleanup: they are kept until you ask us to delete them.';
export const ANALYTICS_THIRD_PARTIES =
  'No analytics, advertising or tracking services, and no advertising or analytics cookies. The App runs on service providers that store or process data only to operate it: Render (app server), Neon (database), Netlify (website), Cloudflare (photo and video storage and web domain), Resend (sign-in and meetup emails), Expo (push notification delivery) and OpenStreetMap Nominatim (looking up a meetup address a user types in). If the photo autofill feature is switched on, the photos you choose are also sent to Anthropic to draft a listing.';
export const DATA_DELETION_CONTACT =
  'email hello@trydibbs.com from the email address on your account. The operator, Charles Aspatore, handles these requests within 30 days.';

export const LAST_UPDATED = 'November 16, 2026';

export const DRAFT_BANNER =
  'Written in plain language by the founder. These terms have not yet been reviewed by a lawyer.';

export interface LegalSection {
  heading: string;
  body: string[];
}

export const TERMS_TITLE = 'Terms of Service';

/** Short plain-English summary shown above the full text. Not a substitute for it. */
export const TERMS_SUMMARY: string[] = [
  'Dibbs is a campus marketplace. For most listings you meet another student in person and Dibbs is not part of the trade. If you use "Get a Dibbs offer", Dibbs itself may buy your item.',
  'No payments happen in the app. You pay or get paid in person or outside the app. A verified campus email is not an ID check.',
  'Some things may not be listed (weapons, alcohol, drugs and more), and harassment and scams are not allowed. See the Community rules.',
  'Community posts stay up until their author deletes them. Report or block anyone who makes you uncomfortable.',
];

export const RULES_TITLE = 'Community rules';

export const RULES_INTRO =
  'Dibbs is for students buying and selling things from each other on campus. These rules keep it useful and safe. They are part of the Terms of Service.';

/** What may not be listed, sold or offered through Dibbs. Shown in Terms section 5 and on the Community rules screen. */
export const PROHIBITED_ITEMS: string[] = [
  'Weapons, ammunition and explosives, including fireworks.',
  'Alcohol.',
  'Tobacco, vapes and e-cigarettes.',
  'Illegal drugs, drug paraphernalia, and prescription or controlled medicine.',
  'Stolen goods, and counterfeit or fake items (for example fake designer goods or fake IDs).',
  'Recalled items.',
  'Hazardous materials, such as chemicals, fuel and anything flammable or toxic.',
  'Live animals.',
  'Adult or sexually explicit content.',
  'Tickets, accounts, logins, codes or passes whose resale is restricted by the issuer or the seller\'s terms.',
  'Anything that is illegal to sell in Arizona.',
  'Services that break university rules, such as writing coursework or taking exams for someone else.',
];

/** Conduct rules for listings, messages, Community posts and comments. */
export const CONDUCT_RULES: string[] = [
  'No harassment, bullying, threats or intimidation.',
  'No hate speech or content that attacks people for who they are.',
  'No scams: do not take money for things you will not hand over, do not misdescribe an item, and do not ask someone to pay or send anything unusual.',
  'No spam, repeated posts, or off-topic advertising and solicitation.',
  'Post only items you own or are allowed to sell, and only photos you have the right to use.',
  'Do not share another person\'s private information.',
  'Do not pretend to be someone else, including Dibbs.',
];

/** Practical meetup tips. Not a guarantee of safety. */
export const MEETUP_SAFETY: string[] = [
  'Meet in a public, well-lit place on campus, in daytime when you can.',
  'Bring a friend, or tell someone where you are going and when you expect to be back.',
  'Look the item over and check that it works before you pay. Do not pay for something you have not seen.',
  'Do not share more personal information than you need to. You do not need to give out your address, class schedule or other private details.',
  'If something feels wrong, leave. It is fine to cancel or walk away.',
  'In an emergency, call 911. For something that is not an emergency, contact campus police.',
];

/** How reporting and blocking work today. No response time is promised. */
export const HOW_TO_REPORT: string[] = [
  'You can report a listing, a Community post, or a user (from their profile or a conversation) inside the App. Pick a reason and add details if you want.',
  'You can block a user in the App. Blocking a user stops messages between the two of you and ends any follow.',
  'A person reviews each report. We may remove a listing or post, or restrict an account. We do not promise how fast.',
  'Reports are not a way to reach emergency services. In an emergency call 911.',
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: '1. What this is',
    body: [
      `These Terms of Service ("Terms") govern use of this campus marketplace app (the "App"), operated by ${LEGAL_ENTITY_NAME}. This is a young product and is still changing. The operator is an individual, not a company. By creating an account you agree to these Terms and to the Community rules in section 5.`,
      'The App is not run by, endorsed by, or affiliated with any university.',
    ],
  },
  {
    heading: '2. Eligibility',
    body: [
      `You must be at least ${MINIMUM_AGE} years old to create an account. Age is self-declared at sign-up. The App does not verify your age or identity.`,
      'You sign in with an email address that you confirm with a code, and that confirmed email lets you buy, sell, or post. A "Campus email verified" badge means you also confirmed a campus email address. Either one only means you can receive mail at that address. It is not an identity check, and it does not confirm you are a student, faculty, or staff member.',
    ],
  },
  {
    heading: '3. What the App does and does not do',
    body: [
      'No payments happen in the App. There is no payment processor, and the App does not hold, transmit, or protect funds. A listing price is what the buyer and seller agree to settle between themselves in person. Dibbs is not an escrow service and offers no payment protection.',
      'The App does not charge fees to buy or sell between students. If you sell to Dibbs through "Get a Dibbs offer" (section 4), Dibbs itself pays you, outside the App.',
      'Sign-in codes are emailed to you. Text-message (SMS) sign-in is not active, so codes are never texted.',
      'The App does not verify your identity, run background checks, or vet other users beyond confirming an email address (optionally a campus email address). Email verification is not identity verification.',
      'The App does not resolve disputes between users. If a trade between students goes wrong, the operator can review reports but cannot guarantee a refund, replacement, or any particular outcome, because the operator is not part of the trade.',
      'Meetup spots and listings marked "Demo" are sample data for testing and have not been verified for accuracy, hours, or permission to use as a meetup location.',
    ],
  },
  {
    heading: '4. Get a Dibbs offer',
    body: [
      '"Get a Dibbs offer" lets you ask Dibbs itself to buy an item from you. In this case the operator is the buyer, so it is a trade with Dibbs and not only with another student.',
      'Your request is private. It is visible only to you and to Dibbs staff. It does not appear in Browse, the Archive, profiles, Community or search. The photos and video you send with it are also private to you and Dibbs staff.',
      'Dibbs staff review each request by hand. Offers are made by people, not by automatic pricing.',
      'Any estimate we send is not a commitment to buy. It depends on inspection. An estimate lapses if you do not answer it within 48 hours, and staff may send a new one.',
      'The final offer is made only after staff inspect the item in person at a campus meetup. Either side may decline at any point, including after inspection. You are never required to accept.',
      'By sending a request you state that you own the item, that you are allowed to sell it, and that it is not on the prohibited list in section 5.',
      'Payment is arranged outside the App. The App does not pay anyone and does not move money. Marking a handoff as complete in the App does not mean payment was sent or received. Agree how and when you will be paid before you hand the item over.',
      'Dibbs does not promise to buy any item, to reply by a certain time, or to pay any particular amount.',
    ],
  },
  {
    heading: '5. Acceptable use and prohibited items',
    body: [
      'You may not list, sell, offer to Dibbs, or ask for any of the following:',
      ...PROHIBITED_ITEMS.map((item) => `• ${item}`),
      'Conduct rules for listings, messages, Community posts and comments:',
      ...CONDUCT_RULES.map((rule) => `• ${rule}`),
      'We can remove listings, posts and other content, and restrict or close accounts, if they break these rules or we think they put someone at risk. We may do this without notice.',
      'Anyone can report a listing, a Community post or a user inside the App, and block a user. A person reviews reports. We do not promise a response time.',
    ],
  },
  {
    heading: '6. Meetups are between users',
    body: [
      `${LEGAL_ENTITY_NAME} is not a party to a trade, or a meetup, arranged between students through the App. Users are solely responsible for the items they list, the accuracy of their listings, and their own safety and conduct when meeting other users in person. (A meetup with Dibbs for a Dibbs offer is covered in section 4.)`,
      'The App does not provide safety guarantees, escorts, or monitoring of in-person meetups.',
      'If something urgent or unsafe happens, call 911 or contact campus police first. Reporting inside the App sends it to a person for review. It is not a substitute for emergency services and it is not law enforcement.',
    ],
  },
  {
    heading: '7. Meetup safety',
    body: [
      'These tips lower risk. They do not remove it.',
      ...MEETUP_SAFETY.map((tip) => `• ${tip}`),
    ],
  },
  {
    heading: '8. Your content',
    body: [
      'You are responsible for what you post: listing text, photos, messages, Community posts, and comments. Do not post anything illegal, fraudulent, or that you do not have the right to post.',
      'Listings are live in Browse for 24 hours. An unsold listing then moves to the Archive, where it stays visible and a buyer can still propose a time and place for the seller to accept or decline. The seller can relist or remove it at any time. Community posts stay up until their author or a moderator removes them.',
      'You keep ownership of what you post. By posting it you let the operator store and show it in the App so the App can work.',
    ],
  },
  {
    heading: '9. Removal and copyright complaints',
    body: [
      'The operator can remove listings or content, and suspend or close accounts, at its discretion.',
      `If you believe something in the App infringes your copyright, email ${OPERATOR_CONTACT_EMAIL} with: your name and contact details; a description of the work you say was copied; where to find the content in the App (a link or the listing or post title); a statement that you believe in good faith the use is not allowed; and a statement that your information is accurate and that you own the work or may act for the owner. We will review it and may remove the content. We have not registered a designated agent under the US Digital Millennium Copyright Act.`,
    ],
  },
  {
    heading: '10. Account closure',
    body: [
      'You can close your account from Settings. Closing your account removes your active listings, cancels pending meetup requests, ends any open Dibbs offer requests, and signs you out everywhere. Your profile is anonymized right away. 30 days later, the messages you sent, your listings, and your offer and meetup records are deleted, as described in the Privacy Policy. Private Dibbs offer requests are handled differently, as described there.',
      'Closing is refused while a meetup is accepted or a Dibbs offer is mid-handoff. Finish or cancel it first.',
    ],
  },
  {
    heading: '11. No warranties, limitation of liability',
    body: [
      'The App is provided "as is" and "as available", without warranties of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, and non-infringement. The operator does not promise the App will be uninterrupted, error-free, or secure.',
      `To the fullest extent permitted by law, ${LEGAL_ENTITY_NAME} is not liable for any indirect, incidental, special, or consequential damages, or for any loss or harm arising from items, trades, meetups, or conduct between users. The operator's total liability for any claim relating to the App is limited to $50.`,
    ],
  },
  {
    heading: '12. Governing law',
    body: [`These Terms are governed by the laws of ${GOVERNING_JURISDICTION}.`],
  },
  {
    heading: '13. Changes to these Terms',
    body: [
      'These Terms may change as the App changes. Material changes will be reflected by updating the date below.',
      `Last updated: ${LAST_UPDATED}`,
    ],
  },
  {
    heading: '14. Contact',
    body: [`Questions about these Terms, or to report a problem: ${OPERATOR_CONTACT_EMAIL}`],
  },
];

export const PRIVACY_TITLE = 'Privacy Policy';

/** Short plain-English summary shown above the full text. Not a substitute for it. */
export const PRIVACY_SUMMARY: string[] = [
  'We keep your email address, whether your campus email is verified, your profile, and what you post (listings, messages, Community posts, comments and votes).',
  'Instagram and a contact phone number are shown to others only if you turn sharing on.',
  'We do not collect payment details or government ID. We do not sell your information. We use no analytics or advertising trackers.',
  'Photos and video you send with a "Get a Dibbs offer" request are private to you and Dibbs staff, and are kept until you ask us to delete them.',
  '30 days after you close your account, we delete your messages, listings and meetup records.',
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: '1. What this is',
    body: [
      `This Privacy Policy explains what information ${LEGAL_ENTITY_NAME} collects through this App and what happens to it. It has not yet been reviewed by a lawyer.`,
    ],
  },
  {
    heading: '2. What we collect',
    body: [
      'Account information: your email address, whether a campus email address is verified, your display name, and an optional bio and profile photo. If you add a phone number, we store it and whether it is verified.',
      'Optional contact sharing: if you add an Instagram handle or a contact phone number to your profile, we store it. It is shown to other students only if you turn sharing on, and you can turn it off at any time.',
      'Content you create: listings (title, description, price, photos, availability), messages you send other users, meetup requests (including a meetup address if you type one in), and reports you file.',
      'Get a Dibbs offer: if you send a request, we store the item details you enter, the photos and any video you attach, and the conversation and decisions that follow (estimates, questions, meetup times, final offers). Dibbs staff can see all of this. No one else can. The files are kept apart from public listing photos, with our storage provider, and are shown only to you and to staff through links that expire after about an hour.',
      'Community activity: Community posts (which stay up until deleted), comments and votes on them, and comments on listings.',
      'Notifications: if you allow notifications, a device notification token and the kind of device, so we can send you alerts, plus your notification and text-message preferences. Alerts are delivered through Expo\'s push service, which receives the token and the alert text.',
      'Meetup addresses: spots for most meetups come from a list of campus places. For a listing meetup, a buyer can also type an address within about 2 miles of campus. We send the address text to OpenStreetMap Nominatim to find its location, and we keep the address, its location, and a saved copy of the lookup so we do not repeat it.',
      'Photo autofill: if the "fill in from photos" feature is switched on and you use it, the photos you choose are sent to Anthropic, which drafts the listing text. We do not send them for any other reason.',
      'Automatically: our server and hosting providers see your IP address and basic request details when you use the App, as with any website. Error messages are written to server logs. We use your IP address, or your sign-in, to keep a short-lived rate-limit count in the server\'s memory so one source cannot flood the service. It is not saved to the database and is cleared when the server restarts. We do not store IP addresses or device identifiers on user accounts.',
      'Visit counter: when the App opens, it sends one request that adds 1 to a daily count for web, iOS or Android. That count is all we store. It holds no IP address, account or device identifier, and it cannot be linked to you.',
      'On your device: we keep your sign-in token in your device\'s secure storage, or in your browser\'s local storage on the web, so you stay signed in. A few preferences and "seen this guide" flags are also kept in local storage. The member App sets no cookies and uses no analytics or advertising cookies. (The staff admin page, which is not for members, uses a sign-in cookie.)',
      `Analytics and third-party services: ${ANALYTICS_THIRD_PARTIES}`,
    ],
  },
  {
    heading: '3. What we do not collect',
    body: [
      'No payment or financial information. No payments happen in the App (see the Terms of Service, section 3). If Dibbs buys something from you, payment is arranged outside the App and we do not collect your bank or card details in it.',
      'No government ID or identity document. Phone and campus email verification only confirm that you can receive a text or mail there, not who you are.',
      'No precise real-time location tracking. Meetup spots come from a list of campus places or from an address you type in. They are never taken from your device\'s location.',
    ],
  },
  {
    heading: '4. How your information is used',
    body: [
      'To operate the App: showing your listings to other users, delivering messages, coordinating meetups you agree to, and reviewing and answering Dibbs offer requests.',
      'To keep the App safe: reviewing reports, and moderating listings and accounts.',
      'To email you sign-in codes, meetup confirmations and updates on a Dibbs offer request: these are sent through our email provider, Resend, which receives your email address and the message only to deliver it.',
    ],
  },
  {
    heading: '5. Who can see your information',
    body: [
      'Other users see your display name, bio, profile photo, active listings, Community posts, comments and votes, and campus-email-verified badge (not your actual email address or sign-in phone number) when you interact with them. Your Instagram handle and contact phone number are shown only if you turn sharing on.',
      'Messages are visible to you and the person you are messaging.',
      'The operator and Dibbs staff can see reports, account details, and content for moderation purposes. Dibbs offer requests and their photos and video are visible only to you and to Dibbs staff.',
      'The service providers named in section 2 handle data only to run the App.',
      'We do not sell your information.',
    ],
  },
  {
    heading: '6. Data retention and deletion',
    body: [
      `Retention period: ${DATA_RETENTION_PERIOD}`,
      'Closing your account (Settings, then Close account) does the following right away: your name, email, photo, bio, phone number and contact details are removed from your profile and replaced with "Deleted user"; your active listings are taken down; pending meetup requests are cancelled; open Dibbs offer requests are withdrawn; saved items, follows, blocks and sign-in sessions are deleted; and your Community posts stop being shown. This is closing and anonymizing the account. It is not an immediate erasure of everything.',
      'After 30 days, a cleanup job deletes the messages you sent, your listings and their photos, your offers and meetup and sale records, and your Community posts. It keeps the anonymized "Deleted user" placeholder, and keeps reports and the listings or posts they are about, so moderators can still act on them. Until then, other people involved can still see past messages and meetups, shown as "Deleted user". Comments you left on listings or posts stay up under "Deleted user" unless you ask us to remove them.',
      'Dibbs offer requests are not covered by that 30-day job. We keep them, including their photos and video, until you ask us to delete them. We do not currently set an automatic deletion date for them. Open requests are withdrawn when you close your account, but the stored request and its files stay private to staff until deleted on request.',
      `To request full deletion of your data beyond what account closure removes, including a Dibbs offer request and its media: ${DATA_DELETION_CONTACT}`,
    ],
  },
  {
    heading: '7. Children\'s privacy',
    body: [
      `This App is not directed at children and requires self-declared age of at least ${MINIMUM_AGE} at sign-up (see the Terms of Service, section 2).`,
    ],
  },
  {
    heading: '8. Changes to this policy',
    body: [
      'This policy may change as the App changes. Material changes will be reflected by updating the date below.',
      `Last updated: ${LAST_UPDATED}`,
    ],
  },
  {
    heading: '9. Contact',
    body: [`Questions about this policy, or to request your data: ${OPERATOR_CONTACT_EMAIL}`],
  },
];
