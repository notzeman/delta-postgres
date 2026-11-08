import React, { useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { Save, Trash2 } from "lucide-react";
import { Button, ErrorBox, Modal } from "./ui";

export default function UnsavedChangesGuard({
  dirty,
  onSave,
  title = "Unsaved changes",
  description = "You have unsaved changes. Save them before leaving this page?",
}: {
  dirty: boolean;
  onSave: () => Promise<void>;
  title?: string;
  description?: string;
}) {
  const blocker = useBlocker(dirty);
  const navigate = useNavigate();
  const blockedTarget = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (blocker.state === "blocked") {
      blockedTarget.current =
        blocker.location.pathname + blocker.location.search + blocker.location.hash;
    }
  }, [blocker.state, blocker.location]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    if (blocker.state !== "blocked") {
      setError("");
      setSaving(false);
    }
  }, [blocker.state]);

  const open = blocker.state === "blocked";
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave();
      const target = blockedTarget.current;
      blocker.proceed?.();
      if (target) {
        // Some routers unblock automatically when the dirty flag clears.
        // If the blocked navigation did not happen, retry it after state settles.
        window.setTimeout(() => {
          const current =
            window.location.pathname + window.location.search + window.location.hash;
          if (current !== target) navigate(target);
        }, 80);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) blocker.reset?.();
      }}
      title={title}
      subtitle={description}
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-400">
          Choose <strong className="text-slate-200">Save changes</strong> to persist your edits,
          <strong className="text-slate-200"> Discard changes</strong> to leave without saving, or
          <strong className="text-slate-200"> Cancel</strong> to stay on this page.
        </p>
        {error ? <ErrorBox message={error} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => blocker.reset?.()}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => blocker.proceed?.()}
            disabled={saving}
          >
            <Trash2 className="h-4 w-4" /> Discard changes
          </Button>
          <Button type="button" variant="primary" onClick={save} loading={saving}>
            <Save className="h-4 w-4" /> Save changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
