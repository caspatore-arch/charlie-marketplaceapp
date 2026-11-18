import React from 'react';
import { InfoPage } from '@/components/marketing/InfoPage';

export default function WhyDibbs() {
  return (
    <InfoPage
      current="why"
      title="A marketplace that fits between classes."
      intro="Dibbs is built around a campus handoff: the item, the price, the place, and the time. Here’s why that can make buying and selling easier."
      sections={[
        {
          title: 'Quick, with no haggling',
          body: 'The price is the price. Buyers decide if it is right and agree to a time and place, so there is no negotiating and no lowball spam.',
        },
        {
          title: 'Sell the same day',
          body: 'Need cash for a trip or a night out? Sell the thing you have not touched in months today. Listings run for 24 hours, and if one does not sell, repost it lower.',
        },
        {
          title: 'Free to list, no fees',
          body: 'Dibbs charges no fees. When you sell to another student, you keep the full price you both agreed on. If you sell to Dibbs instead, you get the offer you accepted.',
        },
        {
          title: 'On campus, in person',
          body: 'Meetups are at spots on campus, at a time you both agreed to and get a reminder for. Members sign in with an email address they confirmed with a code. That shows they can receive mail there, not who they are, so use your own judgment. You can report or block anyone.',
        },
      ]}
    />
  );
}
