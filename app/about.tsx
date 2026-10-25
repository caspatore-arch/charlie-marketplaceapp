import React from 'react';
import { InfoPage } from '@/components/marketing/InfoPage';

export default function About() {
  return (
    <InfoPage
      current="about"
      numbered
      title="Good stuff. Another semester."
      intro="Dibbs is an independent marketplace starting with the University of Arizona campus community. Buy and sell used goods nearby, with a clear plan for meeting up."
      sections={[
        {
          title: 'List it for 24 hours',
          body: 'Add a photo, a price, and when you can meet. Your listing stays up for a day. If it does not sell, the market has spoken: repost it at a lower price.',
        },
        {
          title: 'A buyer books a time and spot',
          body: 'No back-and-forth and no haggling. A buyer who likes the price picks a 15-minute slot at a public campus meetup spot from the times you offered.',
        },
        {
          title: 'Meet, check it, hand it over',
          body: 'Meet in public on campus. Check the item together, pay the seller directly however you agree, and confirm the handoff in Dibbs. Dibbs never holds your money.',
        },
      ]}
    />
  );
}
