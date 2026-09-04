import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

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
}

/** Shared searchable catalogue surface for characters, bases, dice, props, and future local assets. */
export function AssetCatalogueDialog({ ariaLabel, eyebrow, title, description, searchPlaceholder, items, empty, noResultsText = "Try a different name or description.", onClose }: AssetCatalogueDialogProps) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? items.filter((item) => `${item.name} ${item.searchText ?? ""}`.toLocaleLowerCase().includes(query)) : items;
  }, [items, search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="map-generator-modal miniature-library-modal asset-catalogue-modal" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <button className="modal-close" onClick={onClose} aria-label={`Close ${ariaLabel}`}><X size={18} /></button>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {items.length > 0 && <label className="catalogue-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} autoFocus /></label>}
      {items.length === 0 ? empty : filtered.length === 0 ? <div className="miniature-library-empty catalogue-no-results"><Search size={28} /><strong>No matching assets</strong><small>{noResultsText}</small></div> : <div className="miniature-library-grid asset-catalogue-grid">{filtered.map((item) => <article key={item.id} className={`${item.active ? "active" : ""} ${item.inCampaign ? "in-campaign" : ""}`}>
        {item.preview}
        <div className="asset-catalogue-details"><strong title={item.name}>{item.name}</strong><small>{item.details}</small></div>
        <div className="asset-catalogue-actions">{item.actions}</div>
        {item.status}
      </article>)}</div>}
    </section>
  </div>;
}
