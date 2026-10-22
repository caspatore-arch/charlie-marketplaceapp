import React from 'react';
import { InfoPage } from '@/components/marketing/InfoPage';
export default function WhyDibbs() {
  return <InfoPage title="A marketplace that fits between classes." intro="Dibbs is built around a campus handoff: the item, the price, the place, and the time. Here’s why that can make buying and selling easier." sections={[
    { title: 'A nearby community', body: 'Instead of searching across an entire city, start with your campus feed. Campus email verification is required to post or trade. It confirms control of an email address, not someone’s identity or trustworthiness.' },
    { title: 'A plan before the handoff', body: 'If you’ve spent a message thread asking “When are you free?”, you know the friction. Dibbs puts seller availability and campus meetup spots on the listing so buyers can book an exact time.' },
    { title: 'Secondhand prices, room to negotiate', body: 'Sellers set their asking price, and buyers can make offers. Compare similar items, ask about wear, and inspect before paying. Used goods can cost less than new ones; prices and savings vary by item.' },
    { title: 'A fresh feed', body: 'Posts expire after a day, helping reduce old listings in your search. Broader marketplaces may offer more inventory or shipping options; Dibbs focuses on nearby, in-person exchanges.' },
    { title: 'Know what you’re agreeing to', body: 'Dibbs doesn’t process your payment or provide escrow or buyer protection. Choose a public meetup spot, check the item, and agree on payment directly. Never treat an upvote as a safety guarantee.' },
  ]} />;
}
