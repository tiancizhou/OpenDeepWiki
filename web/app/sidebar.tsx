"use client";

import {
    Compass,
    ThumbsUp,
    GitFork,
    Star,
    Bookmark,
    Building2,
    AppWindow,
    MessagesSquare,
    Zap,
} from "lucide-react";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/animate-ui/components/radix/sidebar";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/hooks/use-translations";
import { useAuth } from "@/contexts/auth-context";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { isAssistantOnlyUser } from "@/lib/role-access";

const itemKeys = [
    { key: "explore", url: "/", icon: Compass, requireAuth: false },
    { key: "recommend", url: "/recommend", icon: ThumbsUp, requireAuth: false },
    { key: "private", url: "/private", icon: GitFork, requireAuth: true },
    { key: "subscribe", url: "/subscribe", icon: Star, requireAuth: true },
    { key: "bookmarks", url: "/bookmarks", icon: Bookmark, requireAuth: true },
    { key: "organizations", url: "/organizations", icon: Building2, requireAuth: false },
    { key: "chatApps", url: "/chat-apps", icon: MessagesSquare, requireAuth: true },
    { key: "apps", url: "/apps", icon: AppWindow, requireAuth: true },
    { key: "mcp", url: "/mcp", icon: Zap, requireAuth: false },
];

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
    const { user, isAuthenticated } = useAuth();
    const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

    useEffect(() => {
        api.get<{ success: boolean; data: VersionInfo }>("/api/system/version", { skipAuth: true })
            .then((res) => {
                if (res.success) {
                    setVersionInfo(res.data);
                }
            })
            .catch(() => {
                // 忽略版本获取失败
            });
    }, []);

    // 处理版本号，去掉 commit hash（+号后面的部分）
    const displayVersion = versionInfo?.version?.split('+')[0] || '';
    const isPreview = displayVersion.toLowerCase().includes('preview');

    const visibleItemKeys = isAssistantOnlyUser(user)
        ? itemKeys.filter(item => item.key === "chatApps")
        : itemKeys;

    const items = visibleItemKeys.map(item => ({
        title: t(`sidebar.${item.key}`),
        url: item.url,
        icon: item.icon,
        requireAuth: item.requireAuth,
    }));

    const handleItemClick = (item: typeof items[0]) => {
        if (item.requireAuth && !isAuthenticated) {
            router.push("/auth");
            return;
        }
        onItemClick?.(item.title);
    };

    return (
        <Sidebar collapsible="icon" {...props}>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>
                        <Image
                            src="/favicon.png"
                            alt="OpenDeepWiki"
                            width={24}
                            height={24}
                            className="shrink-0 rounded"
                        />
                        <span className="ml-2">OpenDeepWiki</span>
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {items.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton
                                        asChild
                                        tooltip={item.title}
                                        isActive={activeItem === item.title}
                                        onClick={(e) => {
                                            if (item.requireAuth && !isAuthenticated) {
                                                e.preventDefault();
                                                handleItemClick(item);
                                            } else {
                                                onItemClick?.(item.title);
                                            }
                                        }}
                                    >
                                        <Link href={item.requireAuth && !isAuthenticated ? "#" : item.url}>
                                            <item.icon />
                                            <span>{item.title}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                {displayVersion && (
                    <div className="px-3 py-2 border-t">
                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                            {isPreview ? (
                                <Badge className="text-[10px] px-2 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/30">
                                    v{displayVersion}
                                </Badge>
                            ) : (
                                <span>v{displayVersion}</span>
                            )}
                        </div>
                    </div>
                )}
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
