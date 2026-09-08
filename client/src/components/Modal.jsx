/* ===================================================================
   Modal — single overlay + content, driven by App-level state
   (mirrors the original's #modalOverlay / #modalRoot / openModal/closeModal).
   `content` is arbitrary JSX supplied by the caller.
=================================================================== */
export default function Modal({ open, onClose, children }) {
  return (
    <div
      id="modalOverlay"
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => { if (e.target.id === 'modalOverlay') onClose(); }}
    >
      <div id="modalRoot" className="modal">
        {open ? children : null}
      </div>
    </div>
  );
}
