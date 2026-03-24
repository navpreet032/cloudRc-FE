import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../lib/api';
import { useAuthStore } from '../store/auth';

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login');
  const setAuth = useAuthStore((s) => s.setAuth);

  const loginMut = useMutation({
    mutationFn: () => authApi.login(email, password),
    onSuccess: (data) => {
      const payload = JSON.parse(atob(data.token.split('.')[1]));
      setAuth(data.token, { email: payload.sub, role: payload.role });
      onLogin();
    },
  });

  const registerMut = useMutation({
    mutationFn: () => authApi.register(email, password),
    onSuccess: () => loginMut.mutate(),
  });

  const isLoading = loginMut.isPending || registerMut.isPending;
  const error = (mode === 'login' ? loginMut.error : registerMut.error)?.message;

  function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) return;
    if (mode === 'login') loginMut.mutate();
    else registerMut.mutate();
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <div className="brand-inner fade-up">
          <div className="brand-badge mono">SYSTEM v1.0</div>
          <h1 className="brand-title">CLOUD<span>RC</span></h1>
          <p className="brand-sub">Remote vehicle control platform.<br />Queue. Drive. Command.</p>
          <div className="brand-specs">
            {[
              ['PROTOCOL', 'STOMP / WS'],
              ['VEHICLE', 'HyperGo H12P'],
              ['SESSION', '30 MIN'],
              ['LATENCY', '&lt;50ms'],
            ].map(([k, v]) => (
              <div key={k} className="spec-row">
                <span className="spec-key mono">{k}</span>
                <span className="spec-val mono" dangerouslySetInnerHTML={{ __html: v }} />
              </div>
            ))}
          </div>
        </div>
        <div className="brand-decor" aria-hidden>
          <div className="decor-ring ring-1" />
          <div className="decor-ring ring-2" />
          <div className="decor-ring ring-3" />
          <div className="decor-cross" />
        </div>
      </div>

      <div className="login-form-panel">
        <div className="login-form-wrap fade-up" style={{ animationDelay: '0.1s' }}>
          <div className="form-tabs">
            {['login', 'register'].map((t) => (
              <button key={t} type="button" className={`form-tab mono ${mode === t ? 'active' : ''}`} onClick={() => setMode(t)}>
                {t === 'login' ? 'SIGN IN' : 'REGISTER'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="input-group">
              <label className="input-label">EMAIL</label>
              <input className="input-field" type="email" placeholder="pilot@cloudrc.io" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            <div className="input-group">
              <label className="input-label">PASSWORD</label>
              <input className="input-field" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="btn btn-primary btn-full" disabled={isLoading || !email || !password}>
              {isLoading ? <span className="spinner" /> : null}
              {mode === 'login' ? 'AUTHENTICATE' : 'CREATE ACCOUNT'}
            </button>
          </form>

          <div className="login-footer mono">
            <span className="pulse-dot" />&nbsp;SYSTEM ONLINE — READY
          </div>
        </div>
      </div>

      <style>{`
        .login-page { min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; }
        @media (max-width: 768px) { .login-page { grid-template-columns: 1fr; } .login-brand { display: none; } }

        .login-brand { background: var(--bg-1); border-right: 1px solid var(--border); position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; padding: 60px 48px; }
        .brand-inner { position: relative; z-index: 2; }
        .brand-badge { font-size: 0.65rem; letter-spacing: 0.2em; color: var(--amber); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
        .brand-badge::before { content: ''; display: inline-block; width: 20px; height: 1px; background: var(--amber); }
        .brand-title { font-family: var(--display); font-size: 6rem; font-weight: 900; letter-spacing: -0.02em; line-height: 0.9; color: var(--text-primary); margin-bottom: 20px; }
        .brand-title span { color: var(--amber); }
        .brand-sub { font-family: var(--body); font-size: 1rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 40px; font-weight: 300; }
        .brand-specs { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border); padding-top: 24px; }
        .spec-row { display: flex; justify-content: space-between; align-items: center; gap: 40px; }
        .spec-key { font-size: 0.65rem; letter-spacing: 0.12em; color: var(--text-muted); }
        .spec-val { font-size: 0.75rem; color: var(--amber); }

        .brand-decor { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
        .decor-ring { position: absolute; border-radius: 50%; border: 1px solid var(--border); }
        .ring-1 { width: 300px; height: 300px; right: -80px; bottom: -60px; }
        .ring-2 { width: 480px; height: 480px; right: -160px; bottom: -140px; }
        .ring-3 { width: 660px; height: 660px; right: -240px; bottom: -220px; border-style: dashed; opacity: 0.4; }
        .decor-cross { position: absolute; top: 40px; right: 40px; width: 20px; height: 20px; }
        .decor-cross::before, .decor-cross::after { content: ''; position: absolute; background: var(--amber); opacity: 0.4; }
        .decor-cross::before { width: 1px; height: 100%; left: 50%; }
        .decor-cross::after { width: 100%; height: 1px; top: 50%; }

        .login-form-panel { display: flex; align-items: center; justify-content: center; padding: 40px 24px; }
        .login-form-wrap { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 24px; }

        .form-tabs { display: flex; border-bottom: 1px solid var(--border); }
        .form-tab { font-size: 0.7rem; letter-spacing: 0.15em; padding: 10px 18px; background: transparent; border: none; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all var(--transition); }
        .form-tab.active { color: var(--amber); border-bottom-color: var(--amber); }
        .form-tab:hover:not(.active) { color: var(--text-secondary); }

        .login-form { display: flex; flex-direction: column; gap: 16px; }
        .login-footer { font-size: 0.65rem; letter-spacing: 0.1em; color: var(--text-muted); display: flex; align-items: center; gap: 6px; padding-top: 8px; }
      `}</style>
    </div>
  );
}