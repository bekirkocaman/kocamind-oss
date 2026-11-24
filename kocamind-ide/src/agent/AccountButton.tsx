import { useCallback, useEffect, useState } from 'react';
import { IconLoading, IconProfile, IconSignIn, IconSignOut } from '../components/icons.tsx';
import { getAuthApi } from './agentApi.ts';

type AuthStatus =
  | { kind: 'loading' }
  | { kind: 'loggedOut' }
  | { kind: 'loggedIn'; email: string; persisted: boolean };

const AUTH_SYNC_EVENT = 'km:auth-changed';

export function AccountButton() {
  const auth = getAuthApi();
  const [status, setStatus] = useState<AuthStatus>(() =>
    auth ? { kind: 'loading' } : { kind: 'loggedOut' }
  );
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    if (!auth) return;
    try {
      const res = await auth.state();
      if ('error' in res) {
        setStatus({ kind: 'loggedOut' });
        setError(res.error);
      } else if (res.loggedIn) {
        setStatus({
          kind: 'loggedIn',
          email: res.email || 'Hesap bağlı',
          persisted: res.persisted,
        });
      } else {
        setStatus({ kind: 'loggedOut' });
      }
    } catch {
      setStatus({ kind: 'loggedOut' });
    }
  }, [auth]);

  useEffect(() => {
    void refreshState();
    const onSync = () => {
      void refreshState();
    };
    window.addEventListener(AUTH_SYNC_EVENT, onSync);
    return () => window.removeEventListener(AUTH_SYNC_EVENT, onSync);
  }, [refreshState]);

  if (!auth) {
    return (
      <div className="ag-agent-auth">
        <div className="ag-agent-auth-row">
          <span className="ag-agent-auth-badge" aria-hidden="true">
            <IconProfile size={12} />
          </span>
          <span className="ag-agent-auth-email">Masaüstü oturumu kapalı</span>
        </div>
      </div>
    );
  }

  const handleLogin = async () => {
    if (loggingIn) return;
    setLoggingIn(true);
    setError(null);
    try {
      const res = await auth.login();
      if ('error' in res) {
        setError(res.error);
      } else {
        await refreshState();
        window.dispatchEvent(new CustomEvent(AUTH_SYNC_EVENT));
      }
    } catch (err) {
      setError((err as Error)?.message || 'Giriş yapılamadı.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    setError(null);
    try {
      const res = await auth.logout();
      if ('error' in res) {
        setError(res.error);
      } else {
        setStatus({ kind: 'loggedOut' });
        window.dispatchEvent(new CustomEvent(AUTH_SYNC_EVENT));
      }
    } catch (err) {
      setError((err as Error)?.message || 'Çıkış yapılamadı.');
    }
  };

  const initial =
    status.kind === 'loggedIn' && status.email
      ? status.email.trim().charAt(0).toUpperCase()
      : null;

  return (
    <div className="ag-agent-auth">
      {status.kind === 'loggedIn' ? (
        <div className="ag-agent-auth-row">
          <span className="ag-agent-auth-badge" aria-hidden="true">
            {initial || <IconProfile size={12} />}
          </span>
          <span className="ag-agent-auth-email" title={status.email}>
            {status.email}
          </span>
          <button
            type="button"
            className="ag-agent-btn-reset"
            onClick={() => void handleLogout()}
            title="Hesaptan çıkış yap"
            aria-label="Hesaptan çıkış yap"
          >
            <IconSignOut size={12} />
            <span>Çıkış</span>
          </button>
        </div>
      ) : (
        <div className="ag-agent-auth-row">
          <span className="ag-agent-auth-badge muted" aria-hidden="true">
            <IconProfile size={12} />
          </span>
          <span className="ag-agent-auth-email">Oturum açılmadı</span>
          <button
            type="button"
            className="ag-agent-btn-reset primary-subtle"
            onClick={() => void handleLogin()}
            disabled={loggingIn || status.kind === 'loading'}
            aria-label="Hesaba giriş yap"
          >
            {loggingIn ? <IconLoading size={12} className="km-spin" /> : <IconSignIn size={12} />}
            <span>{loggingIn ? 'Bekleniyor…' : 'Giriş yap'}</span>
          </button>
        </div>
      )}

      {status.kind === 'loggedIn' && !status.persisted && (
        <div className="ag-agent-auth-note">
          Oturum bu bilgisayarda saklanamadı; uygulamayı kapatınca tekrar giriş gerekecek.
        </div>
      )}

      {error && <div className="ag-agent-auth-error" role="alert">{error}</div>}
    </div>
  );
}
