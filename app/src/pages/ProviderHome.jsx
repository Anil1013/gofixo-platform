import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../api';
import MapView from '../components/MapView';
import { getRoute } from '../utils/geo';
import { startBuzzer, stopBuzzer } from '../utils/buzzer';

const TYPE_ICON = { bike: '🏍', auto: '🛺', car: '🚗', general_worker: '🧹', skilled_worker: '🔧' };
const OFFER_SECONDS = 60;

export default function ProviderHome() {
  const [profile, setProfile] = useState(null);
  const [activeBooking, setActiveBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [fareAmount, setFareAmount] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [pickupRoute, setPickupRoute] = useState(null);

  const buzzingRef = useRef(false);
  const buzzedBookingRef = useRef(null);
  const pushSetupRef = useRef(false);
  const autoOnlineAttemptRef = useRef(false);

  async function loadAll() {
    try {
      const [me, bookings] = await Promise.all([
        apiGet('/providers/me', true),
        apiGet('/bookings/mine/provider', true),
      ]);
      setProfile(me);
      const active = bookings.find((b) => ['requested', 'accepted', 'ongoing'].includes(b.status));
      setActiveBooking(active || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 2000);
    const providerTypeLabel = profile.type === 'general_worker' ? 'Home Services' : profile.type === 'skilled_worker' ? 'Skilled Expert' : (profile.type || 'bike').replaceAll('_', ' ');
  const ratingValue = profile.avg_rating ? Number(profile.avg_rating).toFixed(1) : '—';

  return (
    <div className="screen provider-home-screen">
      <header className="partner-app-header">
        <div className="partner-logo"><span className="partner-logo-pin" /><strong>Gofi<span>xo</span></strong></div>
        <button
          type="button"
          className={profile.is_available ? 'partner-online-toggle online' : 'partner-online-toggle'}
          onClick={toggleAvailability}
          disabled={busy || profile.kyc_status !== 'approved'}
        >
          <span>{profile.is_available ? 'Online' : 'Offline'}</span><i />
        </button>
      </header>

      <section className="partner-profile-card">
        <div className="partner-avatar">
          <img src={profile.type === 'bike' ? '/illustrations/bike.svg' : profile.type === 'auto' ? '/illustrations/auto.svg' : profile.type === 'car' ? '/illustrations/car.svg' : '/illustrations/worker.svg'} alt="" />
          <b />
        </div>
        <div className="partner-profile-copy">
          <h1>{profile.name}</h1>
          <div className="partner-rating"><span>★</span> {ratingValue} <small>({Number(profile.today_rides || 0)} rides today)</small></div>
          <p>{providerTypeLabel} · {profile.generated_id}</p>
        </div>
        <span className="partner-profile-arrow">›</span>
      </section>

      <div className="partner-stat-row">
        <div><span className="stat-icon blue">▣</span><strong>{Number(profile.today_rides || 0)}</strong><small>Today Rides</small></div>
        <div><span className="stat-icon green">▰</span><strong>₹{Number(profile.total_earned_this_cycle || 0).toLocaleString('en-IN')}</strong><small>Earnings</small></div>
        <div><span className="stat-icon orange">★</span><strong>{ratingValue}</strong><small>Rating</small></div>
      </div>

      {error && <p className="auth-error">{error}</p>}

      <section className="keep-going-card">
        <div className="keep-going-icon">🏆</div>
        <div><strong>Keep Going!</strong><p>You are doing great today. Stay online and earn more.</p></div>
        <span>›</span>
      </section>

      {activeBooking && activeBooking.status === 'requested' ? (
        <section className="reference-request-card">
          <div className="reference-section-head">
            <h2>Incoming Bookings</h2><button type="button">See all →</button>
          </div>
          <div className="reference-ride-card">
            <div className="reference-ride-top">
              <div className="ride-type-icon">🏍️</div>
              <div><strong>New Ride Request</strong><small>{secondsLeft !== null ? `${secondsLeft}s left` : 'Just now'}</small></div>
            </div>
            <div className="reference-route-line">
              <div><span className="pickup-dot" /><strong>{activeBooking.pickup_location}</strong></div>
              <div><span className="drop-dot" /><strong>{activeBooking.drop_or_service_address || 'Destination'}</strong></div>
            </div>
            <div className="reference-fare-row">
              <strong>₹{Number(activeBooking.fare_amount || 0).toLocaleString('en-IN')}</strong>
              <small>{activeBooking.route_distance_km ? Number(activeBooking.route_distance_km).toFixed(1) + ' km' : 'Nearby'}</small>
            </div>
            <div className="reference-request-actions">
              <button className="reject-reference" onClick={declineBooking} disabled={busy}>Reject</button>
              <button className="accept-reference" onClick={acceptBooking} disabled={busy}>Accept</button>
            </div>
          </div>
          <div className="reference-map-card">
            <MapView markers={jobMarker} height={190} />
          </div>
          <div className="reference-online-footer"><span /><div><strong>You are Online</strong><small>Getting ride requests nearby</small></div><button type="button" onClick={toggleAvailability}>Go Offline</button></div>
        </section>
      ) : (
        <section className="reference-request-card">
          <div className="reference-section-head">
            <h2>Incoming Bookings</h2><button type="button">See all →</button>
          </div>
          <div className="waiting-request">
            <div className="ride-type-icon">🏍️</div>
            <div><strong>Waiting for your next ride</strong><small>Stay online and nearby requests will appear here.</small></div>
          </div>
          {profile.is_available && profile.current_lat && profile.current_lng && (
            <div className="reference-map-card idle-map">
              <MapView markers={[{ lat: Number(profile.current_lat), lng: Number(profile.current_lng), emoji: '🏍', color: '#ff7a00' }]} height={160} />
            </div>
          )}
        </section>
      )}

      {!activeBooking && (
        <section className="provider-benefits reference-benefits">
          <span className="section-kicker">GOFIXO PARTNER</span>
          <h2>Keep Growing!</h2>
          <p className="partner-motivation">Stay online, accept nearby jobs and build your earnings every day.</p>
          <div className="benefit-grid">
            <div><span>🏆</span><strong>Nearby jobs</strong><small>Smart matching</small></div>
            <div><span>💰</span><strong>Clear earnings</strong><small>Know your fare</small></div>
            <div><span>🛡️</span><strong>Built for trust</strong><small>Verified customers</small></div>
          </div>
        </section>
      )}
    </div>
  );

}
