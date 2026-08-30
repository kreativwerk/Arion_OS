"use client";

import { useCallback, useEffect, useState } from "react";

/** Kleiner Daten-Hook für die generische CRUD-API. */
export function useTable<T extends { id: number }>(table: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const request = useCallback(async (input: string, init?: RequestInit): Promise<boolean> => {
    try {
      const res = await fetch(input, init);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Server-Fehler ${res.status}`);
        return false;
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/data/${table}`, { cache: "no-store" });
      if (res.ok) {
        setRows(await res.json());
        setError("");
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Server-Fehler ${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [table]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = async (data: Partial<T>) => {
    if (await request(`/api/data/${table}`, { method: "POST", body: JSON.stringify(data) })) await reload();
  };
  const update = async (id: number, data: Partial<T>) => {
    if (await request(`/api/data/${table}`, { method: "PATCH", body: JSON.stringify({ id, ...data }) })) await reload();
  };
  const remove = async (id: number) => {
    if (await request(`/api/data/${table}?id=${id}`, { method: "DELETE" })) await reload();
  };

  return { rows, loading, error, reload, create, update, remove };
}

export function todayIso(): string {
  // Lokales Datum des Geräts (nicht UTC) – sonst kippt "heute" nach Mitternacht.
  return new Date().toLocaleDateString("sv-SE");
}

export function fmtDate(s?: string | null): string {
  if (!s) return "–";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
