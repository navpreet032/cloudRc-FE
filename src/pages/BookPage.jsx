import { useQuery, useMutation,useQueryClient } from '@tanstack/react-query';
import { carsApi, bookingsApi } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { useEffect } from 'react';



function CarStatusBadge({ status }) {
  const map = {
    IDLE: { cls: 'badge-idle', label: 'IDLE' },
    IN_USE: { cls: 'badge-in-use', label: 'IN USE' },
    OFFLINE: { cls: 'badge-offline', label: 'OFFLINE' },
  };
  const { cls, label } = map[status] || map.OFFLINE;
  return <span className={`badge ${cls}`}>{label}</span>;
}

function CarCard({ car, onBook, isBooking, disabled }) {
  const canBook = car.status !== 'OFFLINE';
  return (
    <div className={`car-card ${car.status.toLowerCase()}`}>
      <div className="car-card-header">
        <div>
          <div className="car-id mono">CAR #{car.id}</div>
          <div className="car-name">{car.name}</div>
        </div>
        <CarStatusBadge status={car.status} />
      </div>
      <div className="car-stats">
        <div className="stat">
          <span className="stat-label mono">BATTERY</span>
          <div className="battery-bar">
            <div className="battery-fill" style={{ width: `${car.batteryPct ?? 0}%`, background: (car.batteryPct ?? 0) < 20 ? 'var(--red)' : 'var(--green)' }} />
          </div>
          <span className="stat-val mono">{car.batteryPct ?? '—'}%</span>
        </div>
        <div className="stat">
          <span className="stat-label mono">STATUS</span>
          <span className="stat-val mono">{car.status}</span>
        </div>
        {car.lastSeen && (
          <div className="stat">
            <span className="stat-label mono">LAST SEEN</span>
            <span className="stat-val mono">{new Date(car.lastSeen).toLocaleTimeString()}</span>
          </div>
        )}
      </div>
      <button className="btn btn-primary btn-full" onClick={() => onBook(car.id)} disabled={!canBook || disabled || isBooking}>
        {isBooking ? <span className="spinner" /> : null}
        {car.status === 'IDLE' ? 'DRIVE NOW' : car.status === 'IN_USE' ? 'JOIN QUEUE' : 'UNAVAILABLE'}
      </button>
    </div>
  );
}

export default function BookPage({ onBooked }) {
    useEffect(() => {
  qc.invalidateQueries({ queryKey: ['my-booking'] });
  qc.invalidateQueries({ queryKey: ['cars'] });
}, []);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const carsQ = useQuery({ queryKey: ['cars'], queryFn: carsApi.list, refetchInterval: 10_000 });
const myBookingQ = useQuery({
  queryKey: ['my-booking'],
  queryFn: bookingsApi.getMy,
  retry: false,
  refetchInterval: 5000, // poll every 5s
   placeholderData: null,
});
  const bookMut = useMutation({
    mutationFn: bookingsApi.create,
    onSuccess: (booking) => {
      qc.invalidateQueries({ queryKey: ['cars'] });
      qc.invalidateQueries({ queryKey: ['my-booking'] });
      onBooked(booking);
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id) => bookingsApi.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cars'] });
      qc.invalidateQueries({ queryKey: ['my-booking'] });
    },
  });

  const existingBooking = myBookingQ.isError ? null : myBookingQ.data;
  const hasActiveBooking = existingBooking?.status === 'ACTIVE';
  const hasQueuedBooking = existingBooking?.status === 'QUEUED';

  return (
    <div className="book-page">
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="brand-sm">CLOUD<span style={{ color: 'var(--amber)' }}>RC</span></span>
          <span className="top-bar-sep">|</span>
          <span className="mono top-bar-label">VEHICLE SELECT</span>
        </div>
        <div className="top-bar-right">
          <span className="mono top-bar-user">{user?.email}</span>
          <button className="btn btn-ghost" onClick={clearAuth}>SIGN OUT</button>
        </div>
      </header>

      <main className="book-main fade-up">
        {existingBooking && (
          <div className={`booking-banner ${existingBooking.status.toLowerCase()}`}>
            <div className="banner-left">
              <span className={`pulse-dot ${hasActiveBooking ? '' : 'amber'}`} />
              <div>
                <div className="banner-title mono">
                  {hasActiveBooking ? 'ACTIVE SESSION' : `QUEUE POSITION #${existingBooking.queuePosition}`}
                </div>
                <div className="banner-sub">
                  {hasActiveBooking
                    ? `Car #${existingBooking.car?.id} — Session ends ${new Date(existingBooking.endTime).toLocaleTimeString()}`
                    : `Car #${existingBooking.car?.id} — Waiting for car to become available`}
                </div>
              </div>
            </div>
            <div className="banner-actions">
              {hasActiveBooking && (
                <button className="btn btn-primary" onClick={() => onBooked(existingBooking)}>GO TO DRIVE →</button>
              )}
              <button className="btn btn-danger" onClick={() => cancelMut.mutate(existingBooking.id)} disabled={cancelMut.isPending}>
                {cancelMut.isPending ? <span className="spinner" /> : 'CANCEL'}
              </button>
            </div>
          </div>
        )}

        <div className="section-header">
          <h2 className="section-title">AVAILABLE VEHICLES</h2>
          <div className="section-meta mono">
            {carsQ.isFetching
              ? <><span className="spinner" style={{ width: 10, height: 10 }} />&nbsp;SYNCING</>
              : <><span className="pulse-dot" />&nbsp;LIVE</>}
          </div>
        </div>

        {carsQ.isLoading && <div className="loading-state"><span className="spinner" style={{ width: 24, height: 24 }} /><span className="mono">SCANNING FOR VEHICLES...</span></div>}
        {carsQ.error && <p className="error-text">Failed to load vehicles: {carsQ.error.message}</p>}
        {bookMut.error && <p className="error-text">{bookMut.error.message}</p>}

        <div className="cars-grid">
          {(carsQ.data || []).map((car) => (
            <CarCard
              key={car.id}
              car={car}
              onBook={(carId) => bookMut.mutate(carId)}
              isBooking={bookMut.isPending && bookMut.variables === car.id}
              disabled={hasActiveBooking || hasQueuedBooking || bookMut.isPending}
            />
          ))}
        </div>

        {carsQ.data?.length === 0 && (
          <div className="empty-state mono">NO VEHICLES REGISTERED — WAITING FOR ESP32 CONNECTION</div>
        )}
      </main>

      <style>{`
        .book-page { min-height: 100vh; display: flex; flex-direction: column; }
        .top-bar { display: flex; align-items: center; justify-content: space-between; padding: 14px 32px; background: var(--bg-1); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; }
        .top-bar-left, .top-bar-right { display: flex; align-items: center; gap: 14px; }
        .brand-sm { font-family: var(--display); font-weight: 900; font-size: 1.3rem; letter-spacing: 0.03em; }
        .top-bar-sep { color: var(--border-bright); }
        .top-bar-label { font-size: 0.7rem; letter-spacing: 0.15em; color: var(--text-muted); }
        .top-bar-user { font-size: 0.75rem; color: var(--text-secondary); }

        .book-main { flex: 1; padding: 32px; max-width: 1100px; width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }

        .booking-banner { background: var(--bg-2); border: 1px solid var(--border); border-left: 3px solid var(--green); padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-radius: var(--radius); }
        .booking-banner.queued { border-left-color: var(--amber); }
        .banner-left { display: flex; align-items: center; gap: 12px; }
        .banner-title { font-size: 0.75rem; letter-spacing: 0.12em; color: var(--text-primary); }
        .banner-sub { font-size: 0.7rem; color: var(--text-muted); margin-top: 3px; }
        .banner-actions { display: flex; gap: 8px; }

        .section-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .section-title { font-family: var(--display); font-size: 1.5rem; font-weight: 700; letter-spacing: 0.05em; }
        .section-meta { font-size: 0.65rem; color: var(--text-muted); display: flex; align-items: center; gap: 5px; }

        .cars-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }

        .car-card { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; display: flex; flex-direction: column; gap: 16px; transition: border-color var(--transition); }
        .car-card.idle { border-top: 2px solid var(--green); }
        .car-card.in_use { border-top: 2px solid var(--amber); }
        .car-card.offline { border-top: 2px solid var(--text-muted); opacity: 0.6; }
        .car-card:hover { border-color: var(--border-bright); }
        .car-card-header { display: flex; align-items: flex-start; justify-content: space-between; }
        .car-id { font-size: 0.65rem; letter-spacing: 0.15em; color: var(--text-muted); margin-bottom: 3px; }
        .car-name { font-family: var(--display); font-size: 1.2rem; font-weight: 700; letter-spacing: 0.05em; }

        .car-stats { display: flex; flex-direction: column; gap: 10px; }
        .stat { display: flex; align-items: center; gap: 8px; }
        .stat-label { font-size: 0.6rem; letter-spacing: 0.12em; color: var(--text-muted); min-width: 70px; }
        .stat-val { font-size: 0.75rem; color: var(--text-secondary); margin-left: auto; }
        .battery-bar { flex: 1; height: 4px; background: var(--bg-3); border-radius: 2px; overflow: hidden; }
        .battery-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; }

        .loading-state { display: flex; align-items: center; gap: 12px; padding: 40px 0; font-family: var(--mono); font-size: 0.75rem; color: var(--text-muted); letter-spacing: 0.1em; }
        .empty-state { padding: 60px 0; text-align: center; font-size: 0.7rem; letter-spacing: 0.15em; color: var(--text-muted); }
      `}</style>
    </div>
  );
}