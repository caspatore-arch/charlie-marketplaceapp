/**
 * The FAQ, written once. Two things read this file and nothing else holds a
 * copy of the text:
 *   - app/faq.tsx renders it in the app (what people see after JavaScript runs);
 *   - scripts/prerender-public.ts writes it into dist/faq/index.html, including
 *     the FAQPage structured data (what crawlers and AI assistants read).
 * Keep this file plain TypeScript with no React Native imports so a Node script
 * can load it. Keep every answer true to what the app does (docs/PROJECT-DIRECTIVES.md):
 * no payment protection, no identity claims, no invented numbers.
 */
import { MINIMUM_AGE } from '../../constants/legal';

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_TITLE = 'Dibbs FAQ: common questions';
export const FAQ_HEADING = 'Questions about Dibbs';
export const FAQ_INTRO =
  'Short answers about how Dibbs works. If yours is not here, email hello@trydibbs.com.';
export const FAQ_DESCRIPTION =
  'Plain answers about Dibbs, the campus marketplace for University of Arizona students: how selling works, meetups, payment, safety, cost and account deletion.';

export const FAQ: FaqItem[] = [
  {
    question: 'What is Dibbs?',
    answer:
      'Dibbs is an independent marketplace where University of Arizona students in Tucson buy and sell used items such as furniture, textbooks and bikes. A seller lists an item with photos and an asking price, and a buyer makes an offer or books a time and a campus meetup spot to see it in person. Dibbs is not run by or affiliated with the University of Arizona.',
  },
  {
    question: 'Who can use Dibbs?',
    answer: `Dibbs is built for University of Arizona students and the Tucson campus community, and you must be ${MINIMUM_AGE} or older to create an account. You sign in with your email address. To sell, make offers, book meetups or post, you confirm an email address first.`,
  },
  {
    question: 'How do I sell my stuff at the University of Arizona?',
    answer:
      'Create an account, open the Sell tab, add photos, a title and a fixed asking price, and say when you can meet. Your listing appears in Browse for 24 hours, then moves to an Archive where it stays visible. Buyers can make an offer or propose a time and campus spot, and you accept or decline.',
  },
  {
    question: 'How do meetups work?',
    answer:
      'A meetup is a booked time at a public campus spot that both people agreed to. The buyer picks a slot from the times you offered, you meet in person, check the item together, and both confirm in Dibbs that the handoff happened. Dibbs sends reminders about the booked time.',
  },
  {
    question: 'How does payment work?',
    answer:
      'You pay in person, directly between students, in whatever way you both agree. Dibbs does not take, hold or process payment, and it does not protect buyers or sellers if a trade goes wrong. Check the item before you pay.',
  },
  {
    question: 'What does "campus email verified" mean?',
    answer:
      'It means the person confirmed they can receive email at a campus address. It does not confirm their identity, their name or that they are a current student, and Dibbs does not check government ID. Treat it as one small signal and use your own judgment.',
  },
  {
    question: 'How do I stay safe when meeting someone?',
    answer:
      'Meet at a public campus spot in daylight when you can, tell a friend where you are going, and bring a friend for larger items. Check the item before you pay, never pay before you meet, and leave if anything feels wrong. You can report or block anyone inside Dibbs.',
  },
  {
    question: 'How is Dibbs different from Facebook Marketplace?',
    answer:
      'Dibbs is made for one campus community and centers on a booked time and a public campus meetup spot, with listings that live in Browse for 24 hours. Facebook Marketplace and similar apps are open to anyone and are not limited to a campus. Dibbs is smaller and newer, so there are fewer listings than on those apps.',
  },
  {
    question: 'What is "Get a Dibbs offer"?',
    answer:
      'Get a Dibbs offer is a private request: you send photos and a short description of something you want to sell, and the Dibbs team reviews it by hand and may reply with an estimate. Any estimate is subject to inspection, you decide whether to accept, and replies are not guaranteed or timed. Your request is not posted publicly.',
  },
  {
    question: 'Does Dibbs cost anything?',
    answer:
      'No. Dibbs has no listing fees or transaction fees, and sellers keep the price they ask for. Because payment happens between students in person, Dibbs does not take a cut.',
  },
  {
    question: 'How do I report a problem?',
    answer:
      'Use the report option on a listing, message or profile in Dibbs, or email hello@trydibbs.com with what happened. You can also block someone from their profile so they cannot contact you.',
  },
  {
    question: 'How do I delete my account?',
    answer:
      'Open Settings while signed in and choose Close account, then type DELETE to confirm. Your profile is anonymized right away, and 30 days later Dibbs deletes your messages, listings and meetup records, as described in the Privacy Policy. An open accepted meetup has to be finished or cancelled first.',
  },
];
