import { createContext, useCallback, useContext, useState } from 'react';
import Modal from './Modal.jsx';

/* ===================================================================
   ModalProvider — one global overlay driven by whatever JSX is passed
   to modal.open(content). Mirrors the original's single #modalOverlay
   + openModal(html)/closeModal() pair.
=================================================================== */
const ModalCtx = createContext(null);

export function ModalProvider({ children }) {
  const [content, setContent] = useState(null);
  const [open, setOpen] = useState(false);

  const openModal = useCallback((jsx) => {
    setContent(jsx);
    setOpen(true);
  }, []);
  const closeModal = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <ModalCtx.Provider value={{ open: openModal, close: closeModal }}>
      {children}
      <Modal open={open} onClose={closeModal}>{content}</Modal>
    </ModalCtx.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalCtx);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}
