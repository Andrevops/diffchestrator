import type { ReactNode } from "react";

interface Props {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Badge content rendered next to the title inside the toggle button. */
  children?: ReactNode;
  /** Header actions (rendered outside the toggle button). */
  actions?: ReactNode;
}

/** Collapsible dashboard section header — a real button with aria-expanded. */
export default function SectionHeader({ title, collapsed, onToggle, children, actions }: Props) {
  return (
    <div className="dashboard-section-header">
      <button
        type="button"
        className="section-toggle"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span> {title} {children}
      </button>
      {actions && <span className="header-actions">{actions}</span>}
    </div>
  );
}
