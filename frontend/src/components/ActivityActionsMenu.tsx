"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";

export function ActivityActionsMenu({ activityId, title }: { activityId: number; title: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.deleteActivity(activityId),
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["activity", activityId] });
    },
  });
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  function remove() {
    if (confirm(`Delete "${title}"? This cannot be undone.`)) del.mutate();
  }
  return <div ref={ref} className="actions-menu">
    <button className="actions-trigger" type="button" aria-label={`Actions for ${title}`} onClick={() => setOpen((v) => !v)}>⋮</button>
    {open && <div className="actions-popover"><button className="btn actions-item actions-danger" type="button" disabled={del.isPending} onClick={remove}>{del.isPending ? "Deleting…" : "Delete activity"}</button></div>}
  </div>;
}
