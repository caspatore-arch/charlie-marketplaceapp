# Dibbs

iPhone‑first marketplace for college students to buy and sell small secondhand items nearby, with fast same‑day campus meetups. Demo data is labeled; payments and SMS are simulated.

**Start here:** [Project directives and work queue](docs/PROJECT-DIRECTIVES.md) — current direction, ordered tasks, deployment status and owner approval rules.

**GitHub:** [caspatore-arch/charlie-marketplaceapp](https://github.com/caspatore-arch/charlie-marketplaceapp).

**Production:** website https://trydibbs.com (Netlify), API https://api.trydibbs.com (Render), database on Neon, sign-in email via Resend. Payments and SMS are simulated. How each piece is hosted, redeployed and checked: [Backend operations](docs/DEPLOY.md) and [Website operations](docs/DEPLOY-WEB.md). What is simulated or unfinished: [Handoff](docs/HANDOFF.md) section 3.

```bash
npm install && npm run db:seed && npm run env:lan
npm run backend      # terminal 1
npm start            # terminal 2 → scan QR in Expo Go
npm run test:e2e     # scripted acceptance test
```

Docs: [Architecture](docs/ARCHITECTURE.md) · [API + data contract](docs/CONTRACT.md) · [Design system](docs/DESIGN.md) · [Brief](docs/BRIEF.md) · [Overhaul checklist](docs/OVERHAUL.md)
