"use client";

import { useRef, useState, type ReactNode } from "react";

export function HeaderNavigation({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  return <div className="header-navigation" data-open={open} onKeyDown={(event) => {
    if (event.key === "Escape" && open) {
      setOpen(false);
      toggle.current?.focus();
    }
  }}>
    <button ref={toggle} type="button" className="nav-toggle button-secondary" aria-expanded={open} aria-controls="main-navigation" aria-label={open ? "Close navigation" : "Open navigation"} onClick={() => setOpen(!open)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {open ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
      </svg>
    </button>
    <nav id="main-navigation" aria-label="Main navigation" onClick={(event) => {
      if ((event.target as HTMLElement).closest("a")) setOpen(false);
    }}>{children}</nav>
  </div>;
}
