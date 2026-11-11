'use strict';

function resolveServiceCatalogBooking(catalogItem, requestedProviderType) {
  if (!catalogItem || catalogItem.is_active !== true) {
    return { error: 'This service is currently unavailable. Please refresh the service list.' };
  }
  if (catalogItem.provider_type !== requestedProviderType) {
    return { error: 'The selected service requires a different partner type. Please refresh and try again.' };
  }
  const baseFare = Number(catalogItem.base_fare);
  if (!Number.isFinite(baseFare) || baseFare <= 0 || baseFare > 100000) {
    return { error: 'The service price is temporarily unavailable. Please try again later.' };
  }
  return { baseFare };
}

module.exports = { resolveServiceCatalogBooking };
