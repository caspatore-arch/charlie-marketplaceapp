/**
 * Crawlable copy for the public pages that are NOT the FAQ or the legal pages.
 * scripts/prerender-public.ts writes this into dist/<page>/index.html so that
 * search engines and AI assistants read real text before JavaScript runs.
 *
 * The same words are on screen in the app (app/about.tsx, app/why-dibbs.tsx).
 * Those files belong to the app, so when you change one, change the matching
 * entry here (docs/SEO.md, "Adding a public page"). Keep every line true:
 * Dibbs is independent of the University of Arizona, payment is arranged
 * between students and not protected by Dibbs, and "campus email verified"
 * only means an address was confirmed.
 */

export interface PageSection {
  heading: string;
  body: string;
}

export interface SimplePage {
  title: string;
  description: string;
  ogDescription: string;
  h1: string;
  intro: string;
  sections: PageSection[];
}

export const ABOUT: SimplePage = {
  title: 'How Dibbs works | University of Arizona campus marketplace',
  description:
    'How Dibbs works: list an item for 24 hours, a buyer makes an offer or books a time and public campus meetup spot, you meet, check it and hand it off.',
  ogDescription: 'List it for 24 hours, a student books a time and a campus spot, you meet and hand it off.',
  h1: 'Good stuff. Another semester.',
  intro:
    'Dibbs is an independent marketplace starting with the University of Arizona campus community. Buy and sell used goods nearby, with a clear plan for meeting up.',
  sections: [
    {
      heading: 'List it for 24 hours',
      body: 'Add a photo, a price, and when you can meet. Your listing stays up for a day. If it does not sell, repost it at a lower price.',
    },
    {
      heading: 'A buyer books a time and spot',
      body: 'A buyer who likes the price picks a 15-minute slot at a public campus meetup spot from the times you offered, or makes an offer.',
    },
    {
      heading: 'Meet, check it, hand it over',
      body: 'Meet in public on campus. Check the item together, pay the seller directly however you agree, and confirm the handoff in Dibbs. Dibbs never holds your money and does not protect payments.',
    },
  ],
};

export const WHY: SimplePage = {
  title: 'Why Dibbs | A campus marketplace for UArizona students',
  description:
    'Why use Dibbs: fixed prices, listings that run 24 hours, no fees, and meetups at public campus spots with students who confirmed an email address.',
  ogDescription: 'A marketplace that fits between classes: fixed prices, no fees, handed off in person on campus.',
  h1: 'A marketplace that fits between classes.',
  intro:
    'Dibbs is built around a campus handoff: the item, the price, the place, and the time. Here is why that can make buying and selling easier.',
  sections: [
    {
      heading: 'Quick, with no haggling',
      body: 'The price is the price. Buyers decide if it is right and agree to a time and place.',
    },
    {
      heading: 'Sell the same day',
      body: 'Listings run for 24 hours in Browse, and if one does not sell, you can repost it lower.',
    },
    {
      heading: 'Free to list, no fees',
      body: 'Dibbs charges no fees. When you sell to another student, you keep the full price you both agreed on. If you sell to Dibbs instead, you get the offer you accepted.',
    },
    {
      heading: 'On campus, in person',
      body: 'Meetups are at spots on campus, at a time you both agreed to, with a reminder. Members sign in with an email address they confirmed with a code. That shows they can receive mail there, not who they are, so use your own judgment. You can report or block anyone. Dibbs does not handle or protect payments.',
    },
  ],
};
