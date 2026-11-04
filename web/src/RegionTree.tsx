import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { DetailedAnnotationStructure } from "./detailedAnnotations";

type RegionTreeProps = {
  onHover: (structure: DetailedAnnotationStructure | null) => void;
  onSelect: (structure: DetailedAnnotationStructure) => void;
  displayedIds: ReadonlySet<number>;
  onToggleDisplayed: (structure: DetailedAnnotationStructure) => void;
  search: string;
  selectedId: number | null;
  structures: DetailedAnnotationStructure[];
};

function RegionTreeComponent({
  onHover,
  onSelect,
  displayedIds,
  onToggleDisplayed,
  search,
  selectedId,
  structures,
}: RegionTreeProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const { childrenByParent, roots, structureById } = useMemo(() => {
    const byId = new Map(structures.map((structure) => [structure.id, structure]));
    const children = new Map<number | null, DetailedAnnotationStructure[]>();
    for (const structure of structures) {
      const parentId = structure.parentId !== null && byId.has(structure.parentId)
        ? structure.parentId
        : null;
      const siblings = children.get(parentId) ?? [];
      siblings.push(structure);
      children.set(parentId, siblings);
    }
    for (const siblings of children.values()) {
      siblings.sort((left, right) => left.name.localeCompare(right.name, "fr"));
    }
    return {
      childrenByParent: children,
      roots: children.get(null) ?? [],
      structureById: byId,
    };
  }, [structures]);

  useEffect(() => {
    setExpanded((current) => {
      if (current.size > 0) return current;
      return new Set(
        structures
          .filter((structure) => structure.path.length <= 4)
          .map((structure) => structure.id),
      );
    });
  }, [structures]);

  useEffect(() => {
    if (selectedId === null) return;
    const selected = structureById.get(selectedId);
    if (!selected) return;
    setExpanded((current) => {
      const missingAncestor = selected.path.some((id) => !current.has(id));
      return missingAncestor ? new Set([...current, ...selected.path]) : current;
    });
  }, [selectedId, structureById]);

  useEffect(() => {
    if (selectedId === null) return;
    const frame = requestAnimationFrame(() => {
      selectedRowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, selectedId]);

  const normalizedSearch = search.trim().toLocaleLowerCase("fr");
  const searchVisibleIds = useMemo(() => {
    if (!normalizedSearch) return null;
    const visible = new Set<number>();
    for (const structure of structures) {
      const haystack = `${structure.name} ${structure.acronym} ${structure.id}`
        .toLocaleLowerCase("fr");
      if (!haystack.includes(normalizedSearch)) continue;
      for (const id of structure.path) {
        if (structureById.has(id)) visible.add(id);
      }
    }
    return visible;
  }, [normalizedSearch, structureById, structures]);

  const rows: Array<{ depth: number; structure: DetailedAnnotationStructure }> = [];
  const append = (structure: DetailedAnnotationStructure, depth: number) => {
    if (searchVisibleIds && !searchVisibleIds.has(structure.id)) return;
    rows.push({ depth, structure });
    const isOpen = searchVisibleIds !== null || expanded.has(structure.id);
    if (!isOpen) return;
    for (const child of childrenByParent.get(structure.id) ?? []) {
      append(child, depth + 1);
    }
  };
  for (const root of roots) {
    if (root.id === 997) {
      for (const child of childrenByParent.get(root.id) ?? []) append(child, 0);
    } else {
      append(root, 0);
    }
  }

  if (rows.length === 0) {
    return <p className="region-search-empty">Aucune annotation trouvée</p>;
  }

  return (
    <div className="region-tree-shell">
      <div className="region-tree" role="tree">
      {rows.map(({ depth, structure }) => {
        const children = childrenByParent.get(structure.id) ?? [];
        const isExpanded = searchVisibleIds !== null || expanded.has(structure.id);
        return (
          <div
            className={`region-tree-row${selectedId === structure.id ? " is-selected" : ""}`}
            key={structure.id}
            ref={selectedId === structure.id ? selectedRowRef : undefined}
            onPointerEnter={() => onHover(structure)}
            onPointerLeave={() => onHover(null)}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={children.length > 0 ? isExpanded : undefined}
            style={{ "--tree-depth": depth } as CSSProperties}
          >
            {children.length > 0 ? (
              <button
                type="button"
                className="region-tree-toggle"
                aria-label={`${isExpanded ? "Réduire" : "Développer"} ${structure.name}`}
                onClick={() => {
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(structure.id)) next.delete(structure.id);
                    else next.add(structure.id);
                    return next;
                  });
                }}
              >
                {isExpanded ? "▾" : "▸"}
              </button>
            ) : (
              <span className="region-tree-toggle-spacer" />
            )}
            <input
              type="checkbox"
              checked={displayedIds.has(structure.id)}
              aria-label={`Afficher ${structure.name} dans la vue 3D`}
              title="Afficher ou masquer cette région dans la vue 3D"
              onChange={() => onToggleDisplayed(structure)}
            />
            <span
              className="color-swatch"
              style={{ backgroundColor: structure.color }}
              aria-hidden="true"
            />
            <button
              type="button"
              className="region-tree-select"
              title={`Sélectionner ${structure.name}`}
              onClick={() => onSelect(structure)}
            >
              <span>
                <strong>
                  {structure.acronym}
                  {children.length > 0 && <em>{children.length}</em>}
                </strong>
                <small>{structure.name}</small>
              </span>
              <span className="region-number">{structure.id}</span>
            </button>
          </div>
        );
      })}
      </div>
    </div>
  );
}

export default memo(RegionTreeComponent);
