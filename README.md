# Dibbs

iPhone‑first marketplace for college students to buy and sell small secondhand items nearby, with fast same‑day campus meetups. Prototype — demo data, simulated payments, simulated email delivery.

**Start here:** [Project directives and work queue](docs/PROJECT-DIRECTIVES.md) — current direction, ordered tasks, deployment status and owner approval rules.

**GitHub:** [caspatore-arch/charlie-marketplaceapp](https://github.com/caspatore-arch/charlie-marketplaceapp).

[Historical handoff](docs/HANDOFF.md) contains run instructions and past verification; consult the directives before following older launch steps.

```bash
npm install && npm run db:seed && npm run env:lan
npm run backend      # terminal 1
npm start            # terminal 2 → scan QR in Expo Go
npm run test:e2e     # scripted acceptance test
```

Docs: [Architecture](docs/ARCHITECTURE.md) · [API + data contract](docs/CONTRACT.md) · [Design system](docs/DESIGN.md) · [Brief](docs/BRIEF.md)
