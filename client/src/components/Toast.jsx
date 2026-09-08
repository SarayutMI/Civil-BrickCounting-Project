import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Icon from '../icons/Icon.jsx';

/* ===================================================================
   Toast system — small custom queue, matching the original's
   auto-dismiss (2.8s) + fade-out (.3s) behavior. No toast library.
=================================================================== */
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]); // { id, message, type, fading }
  const nextId = useRef(1);

  const toast = useCallback((message, type = 'info') => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, message, type, fading: false }]);
    setTimeout(() => {
      setToasts((list) => list.map((t) => (t.id === id ? { ...t, fading: true } : t)));
      setTimeout(() => {
        setToasts((list) => list.filter((t) => t.id !== id));
      }, 300);
    }, 2800);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div id="toastContainer" className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} style={{ opacity: t.fading ? 0 : 1, transition: 'opacity .3s ease' }}>
            <Icon name={t.type === 'success' ? 'check' : 'bell'} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
