"use client";

import { Profiler, type ReactNode } from "react";

type Commit = { id: string; phase: string; actual: number };

declare global {
  interface Window {
    __profile?: boolean;
    __reactCommits?: Commit[];
    __printed?: boolean;
  }
}

/** Records React commit time when a measurement script sets window.__profile. */
export function Profile({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler
      id={id}
      onRender={(profileId, phase, actualDuration) => {
        if (typeof window === "undefined" || !window.__profile) return;
        const commits = window.__reactCommits ?? [];
        commits.push({ id: profileId, phase, actual: actualDuration });
        window.__reactCommits = commits;
      }}
    >
      {children}
    </Profiler>
  );
}
