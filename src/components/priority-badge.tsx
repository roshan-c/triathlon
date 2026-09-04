import { Priority } from "@/lib/convex";

const classes: Record<Priority, string> = {
  low: "bg-[var(--ok-soft)] text-[var(--ok-text)]",
  medium: "bg-[var(--warn-soft)] text-[var(--warn-text)]",
  high: "bg-[var(--danger-soft)] text-[var(--danger-text)]"
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize ${classes[priority]}`}>
      {priority}
    </span>
  );
}