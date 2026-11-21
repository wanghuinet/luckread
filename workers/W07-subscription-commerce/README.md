# W07 — Subscription / Commerce / Payment / Advertising

Canonical Worker identity: **W07**
Canonical responsibility: **Subscription / Commerce / Payment / Advertising**
Primary Tasks: **T16, T17, T18**
Primary D1 authority: **D1-04**; scoped D1-01 entitlement transition only under explicit Contract authority.

Canonical repository path: `workers/W07-subscription-commerce`.

Boundary:
- Subscription, commerce, payment, and advertising business workflows belong to W07.
- Financial facts remain authoritative in D1-04.
- Subscription/access state remains authoritative in D1-01.
- W10 may execute asynchronous work under W07/Task authority; it does not become a second owner.

No business implementation is admitted by directory naming alone.
