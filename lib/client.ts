"use client";

import { useCallback, useEffect, useState } from "react";

/** Kleiner Daten-Hook für die generische CRUD-API. */
export function useTable<T extends { id: number }>(table: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/data/${table}`, { cache: "no-store" });
    if (res.ok) setRows(await res.json());
    setLoading(false);
  }, [table]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = async (data: Partial<T>) => {
    await fetch(`/api/data/${table}`, { method: "POST", body: JSON.stringify(data) });
    await reload();
  };
  const update = async (id: number, data: Partial<T>) => {
    await fetch(`/api/data/${table}`, { method: "PATCH", body: JSON.stringify({ id, ...data }) });
    await reload();
  };
  const remove = async (id: number) => {
    await fetch(`/api/data/${table}?id=${id}`, { method: "DELETE" });
    await reload();
  };

  return { rows, loading, reload, create, update, remove };
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fmtDate(s?: string | null): string {
  if (!s) return "–";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
