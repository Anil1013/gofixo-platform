# Gofixo Backend

Gofixo is a Ride (Bike/Auto/Car) + Home Services backend with customer/provider authentication, provider KYC, subscriptions, booking matching, ratings, earnings and realtime tracking support.

## Production deployment

The production process is pinned to `/home/ubuntu/gofixo-platform/server.js` through `ecosystem.config.cjs`. GitHub Actions deploys the `main` branch, restarts PM2, verifies the local API health endpoints, and then verifies the public API at `https://gofixo.mob13r.com/api/auth/health`. A deployment is considered failed when the public health endpoint is not HTTP 200.

The backend listens on port 4000 by default.

## Authentication

Customer:
- `POST /api/auth/customer/register`
- `POST /api/auth/customer/login`
- `POST /api/auth/customer/forgot-password`

Provider:
- `POST /api/providers/register`
- `POST /api/auth/provider/login`
- `POST /api/auth/provider/forgot-password`

Password rules: minimum 8 characters with at least one letter and one number.

Protected requests use:
`Authorization: Bearer <token>`

## Booking lifecycle

`requested -> accepted -> ongoing -> completed`

Customers can cancel before the booking starts. Providers accept or decline requests from the provider dashboard. The current implementation broadcasts an eligible request to providers within 10 km; the first eligible provider to atomically accept wins. A request that remains unclaimed for 60 seconds becomes `no_provider`.

For ride bookings, the customer app calculates the route and estimated fare before calling `POST /api/bookings`. The server validates the supplied distance and estimated fare bounds.

## Provider eligibility

A provider must have:
- approved KYC
- an active subscription
- an available/online status
- a recent GPS location
- no other accepted/ongoing booking

Location is considered fresh for 5 minutes.

## Booking start PIN

A 4-digit start PIN is created with the booking. The customer sees it; the provider must receive it from the customer in person.

`POST /api/bookings/:id/start`

Body:
`{ "pin": "1234" }`

A successful start clears the PIN and changes the booking to `ongoing`.

## Payment and earnings

`POST /api/bookings/:id/confirm-payment`

Completing an ongoing booking:
- marks the booking completed
- records the final fare
- records the provider earning
- updates the active subscription's earning total
- exhausts the plan at its earning cap
- controls whether the provider can go available again

## KYC documents

Provider documents are uploaded with:
`POST /api/providers/:id/documents`

The upload is multipart with `doc_type` and `file`.

Allowed file types: JPG, JPEG, PNG, WEBP and PDF. Maximum file size is 15 MB. Stored KYC files are not publicly exposed.

## Maps and routing

The Flutter mobile app uses:
- OpenStreetMap tiles
- Nominatim for address lookup/reverse geocoding
- OSRM public routing

These public services are intended for a low-cost MVP. High-volume production traffic should move to a hosted/self-managed provider later.

## Realtime

The backend provides:
`/api/realtime?token=<JWT>`

Authenticated customer/provider sockets can subscribe to a booking and receive provider-location events. The mobile app also has polling as a fallback.

## Database

Run `config/schema.sql` for a new database. Production startup also applies additive compatibility changes for fields/tables introduced after the initial schema.

## Mobile releases

Flutter mobile code lives in `mobile/`.

GitHub tag releases `v*` build a signed APK and publish:
- `gofixo-release.apk`
- `gofixo-version.json`

Release signing uses GitHub Actions secrets:
- `GOFIXO_KEYSTORE_B64`
- `GOFIXO_STORE_PASSWORD`
- `GOFIXO_KEY_PASSWORD`
- `GOFIXO_KEY_ALIAS`

Never commit `.env`, signing keys, VAPID private keys, or uploaded documents.
