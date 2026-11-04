"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/hooks/use-translations";
import { useAuth } from "@/contexts/auth-context";
import type {
  RepositoryItemResponse,
  RepositoryStatus,
} from "@/types/repository";
import { getRepositorySourceTypeLabelKey } from "@/lib/repository-source";
import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  GitBranch,
  Calendar,
  Bookmark,
  Bell,
  Code2,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildRepoBasePath } from "@/lib/repo-route";
import { addBookmark, removeBookmark, getBookmarkStatus } from "@/lib/bookmark-api";
import { addSubscription, removeSubscription, getSubscriptionStatus } from "@/lib/subscription-api";
import { toast } from "sonner";

const STATUS_CONFIG: Record<RepositoryStatus, {
  icon: typeof Clock;
  className: string;
  labelKey: string;
}> = {
  Pending: {
    icon: Clock,
    className: "text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 dark:text-yellow-400",
    labelKey: "pending",
  },
  Processing: {
    icon: Loader2,
    className: "text-sky-600 bg-sky-500/10 border border-sky-500/20 dark:text-sky-400",
    labelKey: "processing",
  },
  Completed: {
    icon: CheckCircle2,
    className: "text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 dark:text-emerald-400",
    labelKey: "completed",
  },
  Failed: {
    icon: XCircle,
    className: "text-red-600 bg-red-500/10 border border-red-500/20 dark:text-red-400",
    labelKey: "failed",
  },
};

function StatusBadge({ status }: { status: RepositoryStatus }) {
  const t = useTranslations();
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        config.className
      )}
    >
      <Icon
        className={cn(
          "h-3 w-3 shrink-0",
          status === "Processing" && "animate-spin"
        )}
      />
      {t(`home.repository.status.${config.labelKey}`)}
    </span>
  );
}

interface PublicRepositoryCardProps {
  repository: RepositoryItemResponse;
  variant?: "default" | "tree";
}

function getRepositoryLeafName(repository: RepositoryItemResponse) {
  const repoSegments = repository.repoName.split("/").filter(Boolean);

  return repoSegments.at(-1) || repository.repoName || repository.orgName;
}

export function PublicRepositoryCard({
  repository,
  variant = "default",
}: PublicRepositoryCardProps) {
  const t = useTranslations();
  const { user } = useAuth();
  const createdDate = new Date(repository.createdAt).toLocaleDateString();
  const wikiUrl = buildRepoBasePath(repository.orgName, repository.repoName);
  const isTreeVariant = variant === "tree";
  const repositoryName = isTreeVariant
    ? getRepositoryLeafName(repository)
    : `${repository.orgName}/${repository.repoName}`;

  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchStatus = async () => {
      try {
        const [bookmarkRes, subscribeRes] = await Promise.all([
          getBookmarkStatus(repository.id, user.id),
          getSubscriptionStatus(repository.id, user.id),
        ]);
        setIsBookmarked(bookmarkRes.isBookmarked);
        setIsSubscribed(subscribeRes.isSubscribed);
      } catch {
        // 静默处理错误
      }
    };

    fetchStatus();
  }, [user, repository.id]);

  const handleCopyIdentifier = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(`${repository.orgName}/${repository.repoName}`);
        setCopiedId(true);
        toast.success(`已复制仓库标识: ${repository.orgName}/${repository.repoName}`);
        setTimeout(() => setCopiedId(false), 1800);
      } catch {
        // Ignore clipboard errors
      }
    },
    [repository.orgName, repository.repoName]
  );

  const handleBookmark = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user || bookmarkLoading) return;

    setBookmarkLoading(true);
    try {
      if (isBookmarked) {
        await removeBookmark(repository.id, user.id);
        setIsBookmarked(false);
        toast.success(t("home.actions.bookmarkRemoved"));
      } else {
        await addBookmark({ userId: user.id, repositoryId: repository.id });
        setIsBookmarked(true);
        toast.success(t("home.actions.bookmarkSuccess"));
      }
    } catch {
      toast.error(t("home.actions.actionError"));
    } finally {
      setBookmarkLoading(false);
    }
  }, [user, repository.id, isBookmarked, bookmarkLoading, t]);

  const handleSubscribe = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user || subscribeLoading) return;

    setSubscribeLoading(true);
    try {
      if (isSubscribed) {
        await removeSubscription(repository.id, user.id);
        setIsSubscribed(false);
        toast.success(t("home.actions.subscribeRemoved"));
      } else {
        await addSubscription({ userId: user.id, repositoryId: repository.id });
        setIsSubscribed(true);
        toast.success(t("home.actions.subscribeSuccess"));
      }
    } catch {
      toast.error(t("home.actions.actionError"));
    } finally {
      setSubscribeLoading(false);
    }
  }, [user, repository.id, isSubscribed, subscribeLoading, t]);

  return (
    <Link href={wikiUrl} className="block h-full">
      <Card className="group h-full min-h-[164px] cursor-pointer overflow-hidden border-border/70 bg-card/70 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-500/35 hover:bg-card hover:shadow-[0_10px_30px_-18px_rgba(0,0,0,0.45)]">
        <CardContent className="flex h-full p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div
              className={cn(
                "grid min-w-0 gap-2.5",
                isTreeVariant
                  ? "grid-cols-1"
                  : "grid-cols-[minmax(0,1fr)_auto] items-start"
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
                  <GitBranch className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold tracking-tight group-hover:text-teal-600 dark:group-hover:text-teal-400">
                    {repositoryName}
                  </h3>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {repository.orgName}
                  </p>
                </div>
              </div>
              <div className={cn("flex items-center gap-1.5", isTreeVariant && "justify-start")}>
                <StatusBadge status={repository.statusName} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex max-w-[9rem] shrink-0 rounded-md border border-border/60 bg-secondary/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <span className="truncate">
                  {t(
                    `home.repository.${getRepositorySourceTypeLabelKey(
                      repository.sourceType,
                      repository.sourceTypeName
                    )}`
                  )}
                </span>
              </span>
              {repository.primaryLanguage && (
                <span className="inline-flex items-center gap-1 rounded-md border border-teal-500/20 bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-300">
                  <Code2 className="h-3 w-3" />
                  {repository.primaryLanguage}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/80">
                {repository.sourceLocation || repository.gitUrl}
              </span>
            </div>

            <div className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <div className="flex min-w-0 items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{createdDate}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={handleCopyIdentifier}
                  title="复制仓库标识 (用于 Agent / Open API 调用)"
                >
                  {copiedId ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
                {user && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-7 w-7",
                        isBookmarked && "text-yellow-500 hover:text-yellow-600"
                      )}
                      onClick={handleBookmark}
                      disabled={bookmarkLoading}
                      title={isBookmarked ? t("home.actions.bookmarked") : t("home.actions.bookmark")}
                    >
                      {bookmarkLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Bookmark className={cn("h-3.5 w-3.5", isBookmarked && "fill-current")} />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-7 w-7",
                        isSubscribed && "text-blue-500 hover:text-blue-600"
                      )}
                      onClick={handleSubscribe}
                      disabled={subscribeLoading}
                      title={isSubscribed ? t("home.actions.subscribed") : t("home.actions.subscribe")}
                    >
                      {subscribeLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Bell className={cn("h-3.5 w-3.5", isSubscribed && "fill-current")} />
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
