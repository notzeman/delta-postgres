import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button, ErrorBox, Modal } from "./ui";

export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loading = false,
  confirmDisabled = false,
  error,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  /** Keep the confirm button disabled (e.g. until a confirmation is typed). */
  confirmDisabled?: boolean;
  error?: string;
  children?: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!loading) onClose();
      }}
      title={title}
      subtitle={description}
    >
      <div className="space-y-4">
        {children ? (
          <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-slate-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div>{children}</div>
          </div>
        ) : null}
        {error ? <ErrorBox message={error} /> : null}
        <div className="flex justify-end gap-2 border-t border-white/5 pt-4">
          <Button type="button" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={onConfirm}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
