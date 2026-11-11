"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Persona = {
  id: string;
  slug: string;
  name: string;
  role: "attendee" | "organiser";
  blurb: string;
};

type PersonaState = {
  /** "loading" until the first response; "error" if demo people could not be loaded. */
  status: "loading" | "ready" | "error";
  personas: Persona[];
  current: Persona | null;
  /** Resolves true when the switch was saved by the server. */
  switchTo: (profileId: string) => Promise<boolean>;
  reload: () => void;
};

const PersonaContext = createContext<PersonaState | null>(null);

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<PersonaState["status"]>("loading");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [current, setCurrent] = useState<Persona | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session")
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json() as Promise<{ personas: Persona[]; current: Persona | null }>;
      })
      .then((data) => {
        if (cancelled) return;
        setPersonas(data.personas);
        setCurrent(data.current);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const switchTo = useCallback(async (profileId: string) => {
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { current: Persona };
      setCurrent(data.current);
      return true;
    } catch {
      return false;
    }
  }, []);

  const reload = useCallback(() => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ status, personas, current, switchTo, reload }),
    [status, personas, current, switchTo, reload],
  );

  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaState {
  const value = useContext(PersonaContext);
  if (!value) throw new Error("usePersona must be used inside PersonaProvider.");
  return value;
}
