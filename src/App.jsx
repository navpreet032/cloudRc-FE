import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './pages/LoginPage';
import BookPage from './pages/BookPage';
import DrivePage from './pages/DrivePage';
import { useAuthStore } from './store/auth';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5000 } },
});

function AppInner() {
  const token = useAuthStore((s) => s.token);
  const [page, setPage] = useState(token ? 'book' : 'login');
  const [activeBooking, setActiveBooking] = useState(null);

  useEffect(() => {
    if (!token) { setPage('login'); setActiveBooking(null); }
  }, [token]);

  if (page === 'login' || !token) {
    return <LoginPage onLogin={() => setPage('book')} />;
  }

  if (page === 'drive' && activeBooking) {
  return (
    <DrivePage
      booking={activeBooking}
      onLeave={() => {
        setActiveBooking(null);
        setPage('book');
      }}
    />
  );
}

  return (
    <BookPage
      onBooked={(booking) => {
        if (booking.status === 'ACTIVE') {
          setActiveBooking(booking);
          setPage('drive');
        }
        // if QUEUED → stays on book page, banner shows queue position
      }}
    />
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}