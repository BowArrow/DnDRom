import { Search, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface AssetCatalogueItem {
  id: string;
  name: string;
  searchText?: string;
  preview: ReactNode;
  details: ReactNode;
  actions: ReactNode;
  active?: boolean;
  inCampaign?: boolean;
  status?: ReactNode;
}

interface AssetCatalogueDialogProps {
  ariaLabel: string;
  eyebrow: ReactNode;
  title: string;
  description: string;
  searchPlaceholder: string;
  items: AssetCatalogueItem[];
  empty: ReactNode;
  noResultsText?: string;
  onClose: () => void;
  tabs?: { id: string; label: string }[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
}

/** Shared searchable catalogue surface for characters, bases, dice, props, and future local assets. */
export function AssetCatalogueDialog({ ariaLabel, eyebrow, title, description, searchPlaceholder, items, empty, noResultsText = "Try a different name or description.", onClose, tabs, activeTab, onTabChange }: AssetCatalogueDialogProps) {
  const [search, setSearch] = useState("");
  const panel = useRef<HTMLElement>(null);
  const [size] = useState(() => { try { return JSON.parse(localStorage.getItem("dndrom.catalogueSize.v1") ?? "null") as { width: number; height: number } | null; } catch { return null; } });
  useEffect(() => {
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if (width > 0 && height > 0) localStorage.setItem("dndrom.catalogueSize.v1", JSON.stringify({ width: panel.current!.offsetWidth, height: panel.current!.offsetHeight })); });
    if (panel.current) observer.observe(panel.current);
    return () => observer.disconnect();
  }, []);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? items.filter((item) => `${item.name} ${item.searchText ?? ""}`.toLocaleLowerCase().includes(query)) : items;
  }, [items, search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={panel} className="map-generator-modal miniature-library-modal asset-catalogue-modal" role="dialog" aria-modal="true" aria-label={ariaLabel} style={size && Number.isFinite(size.width) && Number.isFinite(size.height) ? { width: size.width, height: size.height } : undefined}>
      <button className="modal-close" onClick={onClose} aria-label={`Close ${ariaLabel}`}><X size={18} /></button>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {tabs && <nav className="catalogue-tabs" role="tablist" aria-label="Catalogues">{tabs.map((tab, index) => <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} className={activeTab === tab.id ? "active" : ""} onClick={() => { setSearch(""); onTabChange?.(tab.id); }} onKeyDown={event => { const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0; if (step) { event.preventDefault(); const next = (index + step + tabs.length) % tabs.length; onTabChange?.(tabs[next].id); requestAnimationFrame(() => document.querySelectorAll<HTMLButtonElement>('.catalogue-tabs button')[next]?.focus()); } }}>{tab.label}</button>)}</nav>}
      {items.length > 0 && <label className="catalogue-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} autoFocus /></label>}
      {items.length === 0 ? empty : filtered.length === 0 ? <div className="miniature-library-empty catalogue-no-results"><Search size={28} /><strong>No matching assets</strong><small>{noResultsText}</small></div> : <div className="miniature-library-grid asset-catalogue-grid">{filtered.map((item) => <article key={item.id} className={`${item.active ? "active" : ""} ${item.inCampaign ? "in-campaign" : ""}`}>
        {item.preview}
        <div className="asset-catalogue-details"><strong title={item.name}>{item.name}</strong><small>{item.details}</small></div>
        <div className="asset-catalogue-actions">{item.actions}</div>
        {item.status}
      </article>)}</div>}
      <small className="catalogue-resize-hint">Drag the lower-right corner to resize</small>
    </section>
  </div>, document.body);
}
