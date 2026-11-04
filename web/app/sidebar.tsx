"use client";

import {
  Compass,
  GitFork,
  Star,
  Bookmark,
  Building2,
  AppWindow,
  Terminal,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/animate-ui/components/radix/sidebar";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "@/hooks/use-translations";
import { useAuth } from "@/contexts/auth-context";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type NavItemDef = {
  key: string;
  url: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  requireAuth?: boolean;
  badge?: string;
};

type NavGroupDef = {
  labelKey: string;
  items: NavItemDef[];
};

const navGroups: NavGroupDef[] = [
  {
    labelKey: "groupDiscover",
    items: [
      { key: "explore", url: "/", icon: Compass },
      { key: "organizations", url: "/organizations", icon: Building2 },
    ],
  },
  {
    labelKey: "groupWorkspace",
    items: [
      { key: "private", url: "/private", icon: GitFork, requireAuth: true },
      { key: "bookmarks", url: "/bookmarks", icon: Bookmark, requireAuth: true },
      { key: "subscribe", url: "/subscribe", icon: Star, requireAuth: true },
    ],
  },
  {
    labelKey: "groupTools",
    items: [
      { key: "mcp", url: "/mcp", icon: Terminal, badge: "API" },
      { key: "apps", url: "/apps", icon: AppWindow, requireAuth: true },
    ],
  },
];

function isPathActive(pathname: string, url: string) {
  if (url === "/") return pathname === "/";
  return pathname === url || pathname.startsWith(`${url}/`);
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activeItem?: string;
  onItemClick?: (title: string) => void;
}

interface VersionInfo {
  version: string;
  assemblyVersion: string;
  productName: string;
}

export function AppSidebar({ activeItem, onItemClick, ...props }: AppSidebarProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    api
      .get<{ success: boolean; data: VersionInfo }>("/api/system/version", {
        skipAuth: true,
      })
      .then((res) => {
        if (res.success) {
          setVersionInfo(res.data);
        }
      })
      .catch(() => {
        // 忽略版本获取失败
      });
  }, []);

  const displayVersion = versionInfo?.version?.split("+")[0] || "";

  const handleItemClick = (item: { title: string; url: string; requireAuth?: boolean }) => {
    if (item.requireAuth && !isAuthenticated) {
      router.push("/auth");
      return;
    }
    onItemClick?.(item.title);
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="gap-0 border-b border-sidebar-border/70 px-3 py-3.5">
        <Link
          href="/"
          className="group/brand flex items-center gap-2.5 rounded-lg px-1 py-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-teal-500/20 via-emerald-500/10 to-cyan-500/20 ring-1 ring-teal-500/30 transition-transform duration-200 group-hover/brand:scale-[1.03]">
            <Image
              src="/favicon.png"
              alt="Enterprise Knowledge Hub"
              width={20}
              height={20}
              className="rounded-sm"
            />
          </span>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[14px] font-semibold tracking-tight text-sidebar-foreground">
                Zt Wiki
              </span>
              <span className="inline-flex shrink-0 items-center rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-teal-600 uppercase dark:text-teal-400">
                Enterprise
              </span>
            </span>
            <span className="block truncate text-[11px] text-sidebar-foreground/55">
              {t("sidebar.brandTagline")}
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2 py-3">
        {navGroups.map((group, groupIndex) => (
          <SidebarGroup key={group.labelKey} className={cn("p-0", groupIndex > 0 && "mt-4")}>
            <SidebarGroupLabel className="mb-1 h-7 px-2.5 text-[11px] font-semibold tracking-[0.08em] text-sidebar-foreground/45 uppercase">
              {t(`sidebar.${group.labelKey}`)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) => {
                  const title = t(`sidebar.${item.key}`);
                  const active =
                    isPathActive(pathname, item.url) || activeItem === title;
                  const Icon = item.icon;

                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        asChild
                        tooltip={title}
                        isActive={active}
                        className={cn(
                          "relative h-9 rounded-lg px-2.5 text-[13px] font-medium text-sidebar-foreground/75 transition-[color,background-color,transform] duration-200",
                          "hover:text-sidebar-foreground",
                          "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--sidebar-border)_80%,transparent)]",
                          "group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0!"
                        )}
                        onClick={(e) => {
                          if (item.requireAuth && !isAuthenticated) {
                            e.preventDefault();
                            handleItemClick({
                              title,
                              url: item.url,
                              requireAuth: item.requireAuth,
                            });
                          } else {
                            onItemClick?.(title);
                          }
                        }}
                      >
                        <Link
                          href={
                            item.requireAuth && !isAuthenticated ? "#" : item.url
                          }
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span
                              className={cn(
                                "absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-teal-500 opacity-0 transition-opacity duration-200",
                                active && "opacity-100",
                                "group-data-[collapsible=icon]:hidden"
                              )}
                            />
                            <Icon
                              className={cn(
                                "size-[18px]! shrink-0 transition-colors",
                                active
                                  ? "text-teal-500"
                                  : "text-sidebar-foreground/55"
                              )}
                              strokeWidth={active ? 2.25 : 1.85}
                            />
                            <span className="truncate">{title}</span>
                          </span>
                          {item.badge && (
                            <span className="rounded bg-teal-500/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-teal-600 group-data-[collapsible=icon]:hidden dark:text-teal-400">
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="gap-2 border-t border-sidebar-border/70 p-3">
        <Link
          href="/mcp"
          className="group/hub flex items-center gap-2.5 rounded-xl border border-teal-500/20 bg-gradient-to-r from-teal-500/[0.08] via-emerald-500/[0.04] to-transparent p-2.5 transition-colors hover:border-teal-500/40 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1.5"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-400">
            <Sparkles className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-xs font-semibold text-sidebar-foreground">
              Agent & Open API
            </span>
            <span className="block truncate text-[11px] text-sidebar-foreground/55">
              REST v1 · MCP · Webhook
            </span>
          </span>
        </Link>

        <SidebarSeparator className="mx-0" />
        <div className="flex items-center justify-between px-1 text-[11px] text-sidebar-foreground/45 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="inline-flex items-center gap-1.5 group-data-[collapsible=icon]:hidden">
            <ShieldCheck className="size-3.5 text-emerald-500" />
            <span>内网知识引擎就绪</span>
          </span>
          {displayVersion && (
            <Badge
              variant="outline"
              className="border-sidebar-border/70 px-1.5 py-0 font-mono text-[10px] text-sidebar-foreground/55"
            >
              v{displayVersion}
            </Badge>
          )}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
