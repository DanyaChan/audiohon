import { useState } from 'react';
import { useUI } from '../../ui/ui';
import { Modal } from '../Modal';

interface ConfirmDialogProps {
  title: string;
  message: string;
  action: string;
  onConfirm: () => unknown;
  onClose: () => void;
}

export function ConfirmDialog({ title, message, action, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const ui = useUI();
  return (
    <Modal
      title={title}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } catch (error) {
                console.error(error);
                ui.toast('Не получилось: попробуйте ещё раз', 'error');
              } finally {
                onClose();
              }
            }}
          >
            {action}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
