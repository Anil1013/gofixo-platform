const pool = require('../config/db');


// Return every eligible provider within the customer's 3 km pickup radius.
async function findNearbyProviders(providerType, lat, lng, excludeIds = [], radiusKm = 3) {
  const result = await pool.query(
    `SELECT id,
            ( 6371 * acos(
                LEAST(1, GREATEST(-1,
                  cos(radians($1)) * cos(radians(current_lat)) *
                  cos(radians(current_lng) - radians($2)) +
                  sin(radians($1)) * sin(radians(current_lat))
                ))
              )
            ) AS distance_km
     FROM service_providers
     WHERE type = $3
       AND is_available = true
       AND kyc_status = 'approved'
       AND current_lat IS NOT NULL AND current_lng IS NOT NULL
       AND location_updated_at > NOW() - INTERVAL '5 minutes'
       AND EXISTS (
         SELECT 1 FROM provider_subscriptions ps
         WHERE ps.provider_id = service_providers.id
           AND ps.status = 'active'
           AND ps.expiry_date > NOW()
       )
       AND NOT (id = ANY($4::int[]))
       AND (6371 * acos(
         LEAST(1, GREATEST(-1,
           cos(radians($1)) * cos(radians(current_lat)) *
           cos(radians(current_lng) - radians($2)) +
           sin(radians($1)) * sin(radians(current_lat))
         ))
       )) <= $5
     ORDER BY distance_km ASC, id ASC`,
    [lat, lng, providerType, excludeIds, radiusKm]
  );
  return result.rows;
}

// Nearest available, KYC-approved provider of the requested type (Haversine distance in km),
// skipping anyone who already declined / missed this booking.
async function findNearestProvider(providerType, lat, lng, excludeIds = []) {
  const result = await pool.query(
    `SELECT id,
            ( 6371 * acos(
                LEAST(1, GREATEST(-1,
                  cos(radians($1)) * cos(radians(current_lat)) *
                  cos(radians(current_lng) - radians($2)) +
                  sin(radians($1)) * sin(radians(current_lat))
                ))
              )
            ) AS distance_km
     FROM service_providers
     WHERE type = $3
       AND is_available = true
       AND kyc_status = 'approved'
       AND current_lat IS NOT NULL AND current_lng IS NOT NULL
       AND location_updated_at > NOW() - INTERVAL '5 minutes'
       AND EXISTS (
         SELECT 1 FROM provider_subscriptions ps
         WHERE ps.provider_id = service_providers.id
           AND ps.status = 'active'
           AND ps.expiry_date > NOW()
       )
       AND NOT (id = ANY($4::int[]))
     ORDER BY distance_km ASC
     LIMIT 1`,
    [lat, lng, providerType, excludeIds]
  );
  return result.rows[0] || null;
}

// Atomically claim the nearest available provider on the supplied transaction.
// FOR UPDATE SKIP LOCKED prevents two simultaneous bookings from selecting the same provider.
async function claimNearestProvider(client, providerType, lat, lng, excludeIds = []) {
  const result = await client.query(
    `WITH candidate AS (
       SELECT id
       FROM service_providers
       WHERE type = $3
         AND is_available = true
         AND kyc_status = 'approved'
         AND current_lat IS NOT NULL AND current_lng IS NOT NULL
         AND location_updated_at > NOW() - INTERVAL '5 minutes'
         AND EXISTS (
           SELECT 1 FROM provider_subscriptions ps
           WHERE ps.provider_id = service_providers.id
             AND ps.status = 'active'
             AND ps.expiry_date > NOW()
         )
         AND NOT (id = ANY($4::int[]))
       ORDER BY
         ( 6371 * acos(
             LEAST(1, GREATEST(-1,
               cos(radians($1)) * cos(radians(current_lat)) *
               cos(radians(current_lng) - radians($2)) +
               sin(radians($1)) * sin(radians(current_lat))
             ))
           )
         ) ASC,
         id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE service_providers sp
     SET is_available = false
     FROM candidate
     WHERE sp.id = candidate.id
     RETURNING sp.id`,
    [lat, lng, providerType, excludeIds]
  );
  return result.rows[0] || null;
}

// Offers the booking to the next nearest provider (skipping those who already declined/timed out).
// The offered provider is marked busy while the offer is open. If nobody is left, the booking becomes 'no_provider'.
async function offerToNextProvider(booking) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Claim the next provider and update the booking in one transaction.
    // This closes the race where two offer/timeout workers could target the same provider.
    const next = await claimNearestProvider(
      client,
      booking.provider_type,
      booking.pickup_lat,
      booking.pickup_lng,
      booking.declined_providers || []
    );

    if (!next) {
      await client.query(
        `UPDATE bookings
         SET status = 'no_provider', provider_id = NULL, offered_at = NULL
         WHERE id = $1 AND status = 'requested'`,
        [booking.id]
      );
      await client.query('COMMIT');
      return null;
    }

    const updated = await client.query(
      `UPDATE bookings
       SET provider_id = $1, status = 'requested', offered_at = NOW()
       WHERE id = $2 AND status = 'requested'
       RETURNING id`,
      [next.id, booking.id]
    );

    if (updated.rows.length === 0) {
      // The booking was accepted/cancelled concurrently; rollback releases the provider.
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('COMMIT');
    return next.id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// A provider declined (or let the offer time out): record them, free/offline them, and offer to the next nearest.
//  - explicit decline  -> provider stays on duty (available again)
//  - timeout           -> provider is put offline (they didn't respond, so they must tap "Go available" again)
async function handleDeclineOrTimeout(bookingId, timedOut = false) {
  const res = await pool.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  const booking = res.rows[0];
  if (!booking || booking.status !== 'requested' || !booking.provider_id) return;

  // Atomic claim: only proceeds if the booking is still waiting on THIS provider
  // (so a simultaneous "Accept" and a timeout can't both win).
  const claim = await pool.query(
    `UPDATE bookings
     SET declined_providers = array_append(COALESCE(declined_providers, '{}'), provider_id)
     WHERE id = $1 AND status = 'requested' AND provider_id = $2
     RETURNING *`,
    [bookingId, booking.provider_id]
  );
  if (claim.rows.length === 0) return;

  if (timedOut) {
    await pool.query('UPDATE service_providers SET is_available = false WHERE id = $1', [booking.provider_id]);
  } else {
    // A declined provider can return to the queue only when their subscription is
    // still valid and they still have a usable location.
    const eligibility = await pool.query(
      `SELECT 1
       FROM service_providers sp
       WHERE sp.id = $1
         AND sp.kyc_status = 'approved'
         AND sp.current_lat IS NOT NULL
         AND sp.current_lng IS NOT NULL
         AND sp.location_updated_at > NOW() - INTERVAL '5 minutes'
         AND EXISTS (
           SELECT 1 FROM provider_subscriptions ps
           WHERE ps.provider_id = sp.id
             AND ps.status = 'active'
             AND ps.expiry_date > NOW()
         )`,
      [booking.provider_id]
    );
    await pool.query(
      'UPDATE service_providers SET is_available = $1 WHERE id = $2',
      [eligibility.rows.length > 0, booking.provider_id]
    );
  }
  await offerToNextProvider(claim.rows[0]);
}

module.exports = { findNearestProvider, findNearbyProviders, claimNearestProvider, offerToNextProvider, handleDeclineOrTimeout };
