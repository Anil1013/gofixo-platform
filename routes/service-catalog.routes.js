'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAdmin } = require('../middleware/admin');
const { requireAuth } = require('../middleware/auth');
const { calculateServicePrice } = require('../services/service-pricing');
const { HOME_SERVICE_CATALOG, getServiceBaseFare, isValidServiceCategoryKey } = require('../services/catalog');

const router = express.Router();

function publicItem(row) {
  return {
    key: row.category_key,
    label: row.label,
    description: row.description,
    imageUrl: row.image_url,
    providerType: row.provider_type,
    baseFare: Number(row.base_fare),
    metadata: row.metadata || {},
    pricingRule: row.metadata?.pricingRule || null,
  };
}

// Public read endpoint shared by customer and partner apps. Fall back to the
// bundled catalog during a rolling deployment before migration 016 is applied.
router.get('/services', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT category_key, label, description, image_url, provider_type, base_fare, metadata
         FROM service_catalog
        WHERE is_active = true
        ORDER BY sort_order ASC, label ASC`
    );
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    // An empty result is meaningful: the admin has intentionally disabled all
    // services. Only fall back when the table is not deployed yet (42P01 below).
    return res.json(result.rows.map(publicItem));
  } catch (err) {
    if (err.code === '42P01') {
      return res.json(HOME_SERVICE_CATALOG.map((item) => ({
        ...item, description: '', baseFare: getServiceBaseFare(item.key), metadata: {},
      })));
    }
    return next(err);
  }
});


// Customer price preview. The same server-side rule is re-applied at booking time.
router.post('/:key/quote', requireAuth(['customer']), async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim().toLowerCase();
    if (!isValidServiceCategoryKey(key)) return res.status(400).json({ error: 'Unknown service category' });
    const result = await pool.query(
      `SELECT label, base_fare, is_active, metadata FROM service_catalog WHERE category_key = $1`,
      [key]
    );
    const row = result.rows[0];
    if (!row || row.is_active !== true) return res.status(409).json({ error: 'This service is not available for new bookings' });
    const configuredRule = row.metadata?.pricingRule;
    const rule = configuredRule || { pricingMode: 'fixed', unitPrice: Number(row.base_fare), unitLabel: 'service' };
    const quote = calculateServicePrice(rule, req.body?.selection || {});
    return res.json({ categoryKey: key, serviceName: row.label, currency: 'INR', ...quote });
  } catch (err) {
    if (err instanceof TypeError || err instanceof RangeError) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
});

// Admin catalog management. Price here is the displayed legacy/base fare only;
// booking quote/pricing activation remains a separate reviewed release.
router.get('/admin/services', requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, category_key, label, description, image_url, provider_type,
              base_fare, is_active, sort_order, metadata, created_at, updated_at
         FROM service_catalog ORDER BY sort_order, label`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// "Delete" is a reversible archive: preserve historical bookings, provider
// skills and settlement references while immediately hiding the service.
router.delete('/admin/services/:key', requireAdmin, async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim().toLowerCase();
    if (!isValidServiceCategoryKey(key)) {
      return res.status(400).json({ error: 'Unknown service category' });
    }
    const result = await pool.query(
      `UPDATE service_catalog
          SET is_active = false, updated_at = NOW()
        WHERE category_key = $1
        RETURNING category_key, label, is_active`,
      [key]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Service not found' });
    return res.json({ service: result.rows[0], archived: true });
  } catch (err) { return next(err); }
});

router.put('/admin/services/:key', requireAdmin, async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim().toLowerCase();
    if (!isValidServiceCategoryKey(key)) {
      return res.status(400).json({ error: 'Unknown service category' });
    }
    const body = req.body || {};
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() : '';
    const providerType = body.provider_type;
    const baseFare = Number(body.base_fare);
    const sortOrder = Number(body.sort_order ?? 100);
    const isActive = body.is_active;
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata : {};
    if (metadata.pricingRule !== undefined) {
      try {
        const rule = metadata.pricingRule;
        const sampleQuantity = rule?.minimumQuantity === undefined ? 1 : Number(rule.minimumQuantity);
        calculateServicePrice(rule, { quantity: sampleQuantity, variantKey: Array.isArray(rule?.variants) ? rule.variants[0]?.key : undefined });
      } catch (pricingError) {
        if (pricingError instanceof TypeError || pricingError instanceof RangeError) {
          return res.status(400).json({ error: `Invalid pricing rule: ${pricingError.message}` });
        }
        throw pricingError;
      }
    }
    if (!label || label.length > 120) return res.status(400).json({ error: 'A service label of 1–120 characters is required' });
    if (description.length > 4000 || imageUrl.length > 2048) return res.status(400).json({ error: 'Description or image URL is too long' });
    if (!['general_worker', 'skilled_worker'].includes(providerType)) return res.status(400).json({ error: 'Invalid provider type' });
    if (!Number.isFinite(baseFare) || baseFare < 0 || baseFare > 100000) return res.status(400).json({ error: 'Base fare must be between 0 and 100000' });
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) return res.status(400).json({ error: 'Invalid sort order' });
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'is_active must be true or false' });
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) return res.status(400).json({ error: 'Image URL must use HTTPS' });

    const result = await pool.query(
      `INSERT INTO service_catalog
         (category_key, label, description, image_url, provider_type, base_fare, is_active, sort_order, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (category_key) DO UPDATE SET
         label=EXCLUDED.label, description=EXCLUDED.description, image_url=EXCLUDED.image_url,
         provider_type=EXCLUDED.provider_type, base_fare=EXCLUDED.base_fare,
         is_active=EXCLUDED.is_active, sort_order=EXCLUDED.sort_order,
         metadata=EXCLUDED.metadata, updated_at=NOW()
       RETURNING *`,
      [key, label, description, imageUrl, providerType, baseFare, isActive, sortOrder, JSON.stringify(metadata)]
    );
    res.json({ service: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
