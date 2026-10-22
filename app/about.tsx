import React from 'react';
import { InfoPage } from '@/components/marketing/InfoPage';
export default function About() {
  return <InfoPage title="Good stuff. Another semester." intro="Dibbs is an independent marketplace starting with the University of Arizona campus community. Buy and sell used goods nearby, with a clear plan for meeting up." sections={[
    { title: 'Turn unused stuff into money', body: 'The jacket you never wear. The textbook you finished. The lamp that won’t fit next semester. Post photos, describe the condition, set an asking price, and choose when and where you can meet.' },
    { title: 'Find what you need for less', body: 'Shop secondhand clothes, shoes, books, tech, and dorm essentials. Compare prices and condition, ask questions, or make an offer. A good deal starts with knowing what you’re buying.' },
    { title: 'From a listing to a real handoff', body: 'Buyers book a 30-minute slot from the seller’s available times and campus spots. Use messages to settle details, inspect the item in person, arrange payment directly, and confirm the handoff in Dibbs.' },
    { title: 'Keep it moving around campus', body: 'Listings and Community posts expire after 24 hours. Share a listing link with friends, post what you’re looking for in Community, and upvote useful posts. Confirmed meetups remain available after a listing expires.' },
  ]} />;
}
