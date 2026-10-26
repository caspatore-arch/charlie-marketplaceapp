/**
 * Single source of truth for the Terms of Service and Privacy Policy shown
 * in app/legal/terms.tsx and app/legal/privacy.tsx, plus the age-eligibility
 * constant used by the sign-up gate in app/auth/verify.tsx.
 *
 * IMPORTANT — read this before editing:
 * This is placeholder legal scaffolding written by a non-lawyer founder for
 * a local prototype. It is honest about what the app currently does (see
 * docs/HANDOFF.md §3, "Simulated or unfinished") and it is NOT reviewed by
 * a lawyer. Every `[FOUNDER TO CONFIRM: ...]` marker below is a fact the
 * founder must supply or a decision only the founder can make. Do not ship
 * this to real students without: (1) filling in every marker, and (2) a
 * lawyer reviewing the result. See docs/LEGAL-TODO.md for the checklist.
 */

/**
 * Minimum age to create an account, as a self-declared checkbox (not age
 * verification — see the sign-up screen copy).
 *
 * [FOUNDER TO CONFIRM] — this number has real legal consequences and is the
 * founder's decision, not an engineering one:
 *  - Under 13 in the US triggers COPPA (strict parental-consent rules).
 *  - Under 16 triggers "GDPR-K" style rules in parts of the EU/EEA even for
 *    a US-only prototype if any user could be in scope.
 *  - App Store / Play Store age ratings and required disclosures change
 *    based on this number and on marketplace/contact features like this
 *    app's chat and in-person meetups.
 * 18 is used as a conservative placeholder because this app arranges
 * in-person meetups between strangers. Do not lower it without legal advice.
 */
export const MINIMUM_AGE = 18; // [FOUNDER TO CONFIRM]

export const LEGAL_ENTITY_NAME = '[FOUNDER TO CONFIRM: legal entity name, e.g. "Dibbs, Inc." or the founder\'s own name if unincorporated]';
export const OPERATOR_CONTACT_EMAIL = '[FOUNDER TO CONFIRM: operator contact email, e.g. support@example.com]';
export const GOVERNING_JURISDICTION = '[FOUNDER TO CONFIRM: governing law / jurisdiction, e.g. "the State of Arizona, USA"]';
export const DATA_RETENTION_PERIOD = '[FOUNDER TO CONFIRM: how long account, message, and transaction data is kept after account closure]';
export const ANALYTICS_THIRD_PARTIES = '[FOUNDER TO CONFIRM: any analytics, crash-reporting, or other third-party services used — none are wired up in this prototype yet]';
export const DATA_DELETION_CONTACT = '[FOUNDER TO CONFIRM: how a user requests full data deletion — an email address or form, and who handles it]';

export const LAST_UPDATED = '[FOUNDER TO CONFIRM: date this document was last actually reviewed]';

export const DRAFT_BANNER =
  'DRAFT — placeholder legal text. This has not been reviewed by a lawyer and must not be used for a real launch with real students until every [FOUNDER TO CONFIRM] item below is resolved and a lawyer has reviewed the final text.';

export interface LegalSection {
  heading: string;
  body: string[];
}

export const TERMS_TITLE = 'Terms of Service';

/** Short plain-English summary shown above the full text. Not a substitute for it. */
export const TERMS_SUMMARY: string[] = [
  'Dibbs is a prototype campus marketplace. You meet other students in person; Dibbs is not part of the trade.',
  'No payments happen in the app. Phone verified and campus email verified are not ID checks.',
  'Community posts stay up until their author deletes them. Report or block anyone who makes you uncomfortable.',
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: '1. What this is',
    body: [
      `These Terms of Service ("Terms") govern use of this campus marketplace app (the "App"), operated by ${LEGAL_ENTITY_NAME}. This is a working prototype, not a finished commercial product. By creating an account you agree to these Terms.`,
      'This document is a placeholder draft written for a prototype. It is not legal advice and has not been reviewed by a lawyer.',
    ],
  },
  {
    heading: '2. Eligibility',
    body: [
      `You must be at least ${MINIMUM_AGE} years old to create an account. Age is self-declared at sign-up — the App does not verify your age or identity.`,
      'You verify a phone number when you sign up, and you must verify a campus email address to buy, sell, or post. Phone verified means you can receive a text at that number. Campus email verified means you can receive mail at that address. Neither is an identity check, and neither confirms you are a student, faculty, or staff member.',
    ],
  },
  {
    heading: '3. What is real, and what is simulated',
    body: [
      'This section must always match docs/HANDOFF.md §3 exactly, in plain language:',
      'No payments happen in the App. Payments are switched off: no payment processor is active, the App charges no fees, and it does not hold, transmit, or protect funds. A listing price is what the buyer and seller agree to settle between themselves in person.',
      'Sign-in codes are emailed to you. Text-message (SMS) sign-in is not active yet, so codes are never texted.',
      'The App does not verify your identity, run background checks, or vet other users beyond confirming an email address and, to buy, sell or post, a campus email address. Email verification is not identity verification.',
      'The App does not resolve disputes between users. If a trade goes wrong, the operator can review reports but cannot guarantee a refund, replacement, or any particular outcome, because no money or goods pass through the operator at all.',
      'Meetup spots and listings marked "Demo" are sample data for testing and have not been verified for accuracy, hours, or permission to use as a meetup location.',
    ],
  },
  {
    heading: '4. Meetups are between users',
    body: [
      `${LEGAL_ENTITY_NAME} is not a party to any transaction, trade, or meetup arranged through the App. Users are solely responsible for the items they list, the accuracy of their listings, and their own safety and conduct when meeting other users in person.`,
      'Use good judgment: meet in public, well-lit areas, tell someone where you are going, and trust your instincts. The App does not provide safety guarantees, escorts, or monitoring of in-person meetups.',
      'If something urgent or unsafe happens, contact campus police or 911 first. Reporting a listing or a user inside the App sends it to an operator for review — this is not a substitute for emergency services and not law enforcement.',
    ],
  },
  {
    heading: '5. Your content',
    body: [
      'You are responsible for what you post — listing text, photos, messages, Community posts, and comments. Do not post anything illegal, fraudulent, or that you do not have the right to post.',
      'Listings are live in Browse for 24 hours. An unsold listing then moves to the Archive, where it stays visible and a buyer can still propose a time and place for the seller to accept or decline; the seller can relist or remove it at any time. Community posts stay up until their author or a moderator removes them.',
      'The operator can remove listings or content, and suspend or close accounts, at its discretion — including through the moderation tools described in docs/HANDOFF.md.',
    ],
  },
  {
    heading: '6. Account closure',
    body: [
      'You can close your account from Settings. Closing your account removes your active listings, cancels pending meetup requests, and signs you out everywhere. This is anonymization, not full erasure: your message history and completed transactions are kept so the other people involved can still see what happened, for the retention period described in the Privacy Policy.',
    ],
  },
  {
    heading: '7. No warranties, limitation of liability',
    body: [
      `[FOUNDER TO CONFIRM: standard "as-is" disclaimer and liability limitation language — this needs a lawyer's wording, not a placeholder generated by an AI assistant. Do not launch without replacing this paragraph.]`,
    ],
  },
  {
    heading: '8. Governing law',
    body: [`These Terms are governed by the laws of ${GOVERNING_JURISDICTION}.`],
  },
  {
    heading: '9. Changes to these Terms',
    body: [
      'These Terms may change as the App changes. Material changes will be reflected by updating the date below.',
      `Last updated: ${LAST_UPDATED}`,
    ],
  },
  {
    heading: '10. Contact',
    body: [`Questions about these Terms: ${OPERATOR_CONTACT_EMAIL}`],
  },
];

export const PRIVACY_TITLE = 'Privacy Policy';

/** Short plain-English summary shown above the full text. Not a substitute for it. */
export const PRIVACY_SUMMARY: string[] = [
  'We keep your phone number and verification status, your campus email, your profile, and what you post (listings, messages, Community posts, comments and votes).',
  'Instagram and a contact phone number are shown to others only if you turn sharing on.',
  'We do not collect payment details or government ID. We do not sell your information.',
];


export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: '1. What this is',
    body: [
      `This Privacy Policy explains what information ${LEGAL_ENTITY_NAME} collects through this App and what happens to it. This is a placeholder draft written for a prototype — it is not legal advice and has not been reviewed by a lawyer.`,
    ],
  },
  {
    heading: '2. What we collect',
    body: [
      'Account information: your phone number and whether it is verified, your campus email address and whether it is verified, your display name, and an optional bio and profile photo.',
      'Optional contact sharing: if you add an Instagram handle or a contact phone number to your profile, we store it. It is shown to other students only if you turn sharing on, and you can turn it off at any time.',
      'Content you create: listings (title, description, price, photos, availability), messages you send other users, meetup requests, and reports you file.',
      'Community activity: Community posts (which stay up until deleted), comments and votes on them, and comments on listings.',
      'Notifications: if you allow notifications, a device notification token so we can send you alerts, and your notification and text-message preferences.',
      'Automatically: basic technical data needed to run the App (e.g. request logs on the backend server).',
      `Analytics and third-party services: ${ANALYTICS_THIRD_PARTIES}`,
    ],
  },
  {
    heading: '3. What we do not collect',
    body: [
      'No payment or financial information — payments are switched off and the App has no active payment flow (see the Terms of Service, section 3).',
      'No government ID or identity document — phone and campus email verification only confirm that you can receive a text or mail there, not who you are.',
      'No precise real-time location tracking. Meetup spots are chosen from a fixed list, not derived from device location.',
    ],
  },
  {
    heading: '4. How your information is used',
    body: [
      'To operate the App: showing your listings to other users, delivering messages, and coordinating meetups you agree to.',
      'To keep the App safe: reviewing reports, and moderating listings and accounts.',
      'To email you sign-in codes and meetup confirmations: these are sent through our email provider, Resend, which receives your email address and the message only to deliver it.',
    ],
  },
  {
    heading: '5. Who can see your information',
    body: [
      'Other users see your display name, bio, profile photo, active listings, Community posts, comments and votes, and campus-email-verified badge (not your actual email address or sign-in phone number) when you interact with them. Your Instagram handle and contact phone number are shown only if you turn sharing on.',
      'Messages are visible to you and the person you are messaging.',
      'The operator can see reports, account details, and content for moderation purposes.',
      `We do not sell your information. [FOUNDER TO CONFIRM: confirm this is accurate once any third-party analytics or services are added — see item 2 above.]`,
    ],
  },
  {
    heading: '6. Data retention and deletion',
    body: [
      `Retention period: ${DATA_RETENTION_PERIOD}`,
      'Closing your account (Settings → Close account) anonymizes your profile immediately and cancels pending requests, but keeps message history and completed-transaction records tied to a "Deleted user" placeholder, so the other people involved can still see what happened.',
      `To request full deletion of your data beyond what account closure removes: ${DATA_DELETION_CONTACT}`,
    ],
  },
  {
    heading: '7. Children\'s privacy',
    body: [
      `This App is not directed at children and requires self-declared age of at least ${MINIMUM_AGE} at sign-up (see the Terms of Service, section 2). [FOUNDER TO CONFIRM: if the minimum age above is ever lowered, this section and the app's App Store age rating must be revisited together — they cannot move independently.]`,
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
