import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Picker from "./Picker";
import { Button, cn } from "./ui";

export default function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 20, 50, 100],
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizes?: number[];
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pageSet = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const candidates = Array.from(pageSet)
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b);
  const items: Array<number | "…"> = [];
  for (let i = 0; i < candidates.length; i += 1) {
    if (i > 0 && candidates[i] - candidates[i - 1] > 1) items.push("…");
    items.push(candidates[i]);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-white/5 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span>
          Showing <span className="text-slate-300">{from}</span>–
          <span className="text-slate-300">{to}</span> of{" "}
          <span className="text-slate-300">{total}</span>
        </span>
        <span className="hidden text-slate-600 sm:inline">·</span>
        <span>Rows</span>
        <Picker
          value={String(pageSize)}
          onChange={(value) => onPageSizeChange(Number(value))}
          options={pageSizes.map((size) => ({
            value: String(size),
            label: String(size),
          }))}
          className="w-20"
          ariaLabel="Rows per page"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Button>
        {items.map((item, index) =>
          item === "…" ? (
            <span key={`ellipsis-${index}`} className="px-1 text-xs text-slate-600">
              …
            </span>
          ) : (
            <button
              key={item}
              onClick={() => onPageChange(item)}
              className={cn(
                "h-7 min-w-7 rounded-lg px-2 text-xs font-medium transition",
                item === page
                  ? "bg-accent-500/15 text-accent-300"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
              )}
              aria-current={item === page ? "page" : undefined}
            >
              {item}
            </button>
          ),
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
