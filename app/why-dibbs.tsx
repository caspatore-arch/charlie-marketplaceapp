import React from 'react';
import { InfoPage } from '@/components/marketing/InfoPage';

export default function WhyDibbs() {
  return (
    <InfoPage
      current="why"
      title="Four reasons students use Dibbs."
      intro="Built so a sale takes a day, not a week of messages."
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
          title: 'Free, and you keep 100%',
          body: 'Dibbs has no fees or transaction costs. Sellers keep everything they ask for.',
        },
        {
          title: 'Safe and sure',
          body: 'Meetups are at public spots on campus, with other students who verified a campus email, at a time you both agreed to and get a reminder for. You can report or block anyone. A campus email shows someone controls it, not who they are, so use your own judgment.',
        },
      ]}
    />
  );
}
