import { useState } from 'react';
import { AlertCircle, Check, Cloud, CloudOff, LoaderCircle, LogIn, LogOut, RefreshCw } from 'lucide-react';
import type { CloudSyncState } from '../sync/engine';

type Props = {
  state: CloudSyncState;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSync: () => void;
  onRestore: (conflictId: string, version: 'local' | 'cloud') => Promise<void>;
};

export function SyncControl({ state, onSignIn, onSignOut, onSync, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a sincronização.'); }
    finally { setBusy(false); }
  };
  const Icon = state.status === 'syncing' ? LoaderCircle : state.status === 'error' ? AlertCircle : state.status === 'synced' ? Cloud : CloudOff;
  const label = state.status === 'syncing' ? 'Sincronizando' : state.status === 'error' ? 'Erro de sincronização' : state.status === 'synced' ? 'Sincronizado' : 'Salvo localmente';

  return <div className="sync-control">
    <button type="button" className={`icon-button top-action sync-trigger sync-${state.status}`} aria-label={`Sincronização: ${label}`} title={`Sincronização: ${label}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Icon size={19} className={state.status === 'syncing' ? 'spin' : undefined} />
      {state.conflicts.length > 0 && <span className="sync-conflict-count" aria-label={`${state.conflicts.length} conflitos`}>{state.conflicts.length}</span>}
    </button>
    {open && <>
      <button type="button" className="outside-dismiss" aria-label="Fechar painel de sincronização" onClick={() => setOpen(false)} />
      <section className="sync-panel" aria-label="Sincronização de projetos">
        <div className="sync-panel-heading"><div><strong>{label}</strong><p>{state.message}</p></div><span className={`sync-dot sync-dot-${state.status}`} /></div>
        {state.uid ? <>
          <p className="sync-account">{state.email ?? 'Conta Google conectada'}</p>
          <div className="sync-panel-actions">
            <button type="button" className="button button-secondary" disabled={busy || state.status === 'syncing'} onClick={onSync}><RefreshCw size={16} />Sincronizar agora</button>
            <button type="button" className="sync-signout" disabled={busy} onClick={() => { void run(onSignOut); }}><LogOut size={16} />Sair da conta</button>
          </div>
        </> : <button type="button" className="button button-primary sync-signin" disabled={busy} onClick={() => { void run(onSignIn); }}>{busy ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}Entrar com Google</button>}
        {error && <p className="sync-inline-error" role="alert">{error}</p>}
        {state.status === 'error' && !error && <p className="sync-inline-error" role="alert">{state.message}</p>}
        {state.conflicts.length > 0 && <div className="sync-conflicts"><strong>Versões preservadas</strong>
          {state.conflicts.map((conflict) => <article className="sync-conflict" key={conflict.id}>
            <div><b>{conflict.projectName}</b><p>{conflict.reason}</p></div>
            <div className="sync-conflict-actions">
              <button type="button" onClick={() => { void run(() => onRestore(conflict.id, 'local')); }}>Recuperar cópia local</button>
              {conflict.cloudVersion && <button type="button" onClick={() => { void run(() => onRestore(conflict.id, 'cloud')); }}>Recuperar cópia da nuvem</button>}
            </div>
          </article>)}
        </div>}
        <div className="sync-local-note"><Check size={14} />Edições continuam salvas neste dispositivo.</div>
      </section>
    </>}
  </div>;
}
