const BASE_URL = import.meta.env.VITE_BASE_WS_URL


function getToken() {
  return localStorage.getItem('cloudrc_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.message || body.error || msg;
    } catch {}
    throw new Error(msg);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const authApi = {
  login: (email, password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email, password) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
};

export const carsApi = {
  list: () => request('/api/cars/getAll'),
  get: (carId) => request(`/api/cars/${carId}`),
};

export const bookingsApi = {
  create: (carId) =>
    request('/api/bookings', { method: 'POST', body: JSON.stringify({ carId }) }),
 getMy: () =>
  request('/api/bookings/my').catch((e) => {
    if (e.message.includes('404') || e.message.includes('HTTP 404')) return null;
    throw e;
  }),
  cancel: (bookingId) =>
    request(`/api/bookings/${bookingId}`, { method: 'DELETE' }),
};