import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  ChevronDown,
  ChevronLeft,
  Eye,
  ListOrdered,
  RefreshCw,
  Trash2,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

import { ActionMenu } from "@/components/calm/ActionMenu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NOT_CREATED_YET } from "@/lib/collections/copy";
import { COLLECTION_KIND_LABEL, type CollectionKind } from "@/lib/collections/types";

const KIND_ICON: Record<CollectionKind, LucideIcon> = {
  manual: ListOrdered,
  smart: WandSparkles,
  synced: RefreshCw,
};

export interface OpenTarget {
  label: string;
  href: string;
}

function Tag({ icon, children, tone }: { icon?: ReactNode; children: ReactNode; tone?: "shared" }) {
  return (
    <span
      className={
        tone === "shared"
          ? "inline-flex items-center gap-1.5 rounded-md bg-sky-500/15 px-2 py-0.5 text-[12px] font-semibold text-sky-300"
          : "bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-semibold"
      }
    >
      {icon}
      {children}
    </span>
  );
}

/** Open ▾: one library opens at once, several offer a menu. */
function OpenButton({ targets }: { targets: readonly OpenTarget[] }) {
  if (targets.length === 1) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link to={targets[0]!.href}>
          <Eye aria-hidden />
          Open
        </Link>
      </Button>
    );
  }
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Eye aria-hidden />
          Open
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {targets.map((target) => (
          <DropdownMenuItem key={target.href} asChild>
            <Link to={target.href}>{target.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The editor's header: back link, cover, type tag, name (two lines at most),
 * meta line, and once the collection exists Open ▾ and ⋯ (Delete…).
 */
export function EditorHeader({
  back,
  kind,
  name,
  created,
  shared,
  posterUrl,
  meta,
  open,
  onDelete,
}: {
  back: { label: string; href: string };
  kind: CollectionKind;
  name: string;
  created: boolean;
  shared?: boolean;
  posterUrl?: string;
  meta?: ReactNode;
  open: readonly OpenTarget[];
  onDelete?: () => void;
}) {
  const KindIcon = KIND_ICON[kind];
  return (
    <div className="grid gap-4">
      <Link
        to={back.href}
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-[14px]"
      >
        <ChevronLeft aria-hidden className="size-4" />
        {back.label}
      </Link>
      <header className="grid grid-cols-[64px_minmax(0,1fr)] items-end gap-x-5 gap-y-3 sm:grid-cols-[64px_minmax(0,1fr)_auto]">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt=""
            className="bg-muted aspect-[2/3] w-16 self-start rounded-[10px] object-cover"
          />
        ) : (
          <span aria-hidden className="bg-muted aspect-[2/3] w-16 self-start rounded-[10px]" />
        )}
        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Tag icon={<KindIcon aria-hidden className="size-3.5" />}>
              {COLLECTION_KIND_LABEL[kind]}
            </Tag>
            {shared ? (
              <Tag tone="shared" icon={<Users aria-hidden className="size-3.5" />}>
                Shared
              </Tag>
            ) : null}
            {!created ? <Tag>{NOT_CREATED_YET}</Tag> : null}
          </div>
          <h1 className="line-clamp-2 text-[26px] leading-[1.15] font-bold tracking-[-0.02em] break-words sm:text-[32px]">
            {name || "New collection"}
          </h1>
          {meta}
        </div>
        {created ? (
          <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
            {open.length > 0 ? <OpenButton targets={open} /> : null}
            {onDelete ? (
              <ActionMenu
                label="More actions"
                items={[
                  {
                    key: "delete",
                    label: "Delete…",
                    icon: Trash2,
                    destructive: true,
                    onSelect: onDelete,
                  },
                ]}
              />
            ) : null}
          </div>
        ) : null}
      </header>
    </div>
  );
}
