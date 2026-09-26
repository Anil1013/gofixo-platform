# Gofixo App (Customer + Provider, one app)

Mobile-friendly web app (PWA-style) — works in any phone browser, can be added to the home screen. Covers both roles in a single app:

- **Customer**: register/login (phone + password), book a Ride (bike/car) or Pronto (home service), see the 4-digit start PIN, track status, rate after completion, view history.
- **Provider**: register/login, view KYC/plan/pending-amount status, subscribe to a plan, upload KYC documents, go available/offline, share live location, receive a booking and enter the customer's PIN to start it, confirm payment + rate the customer, view history.

The role is chosen on the login/signup screen ("I need a service" vs "I'm a driver / worker").

## Setup

```
npm install
npm run dev      # local dev server
npm run build    # production build -> dist/
```

`src/api.js` points at `https://gofixo.mob13r.com/api` — the live backend.

## Deploy

Deployed the same way as `admin/` — via AWS Amplify (monorepo appRoot: `app`), auto-builds on push to `main`.

## Structure

- `src/api.js` — fetch helpers, session storage (token/user/role in localStorage)
- `src/pages/Auth.jsx` — login/register/reset, with the customer/provider role switch
- `src/pages/Home.jsx`, `Active.jsx`, `History.jsx` — customer flow
- `src/pages/ProviderHome.jsx`, `ProviderPlans.jsx`, `ProviderDocuments.jsx`, `ProviderHistory.jsx` — provider flow
- `src/App.jsx` — role-based navigation shell
