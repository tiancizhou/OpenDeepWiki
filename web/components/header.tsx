"use client";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/animate-ui/components/radix/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { HeaderSearchBox } from "@/components/header-search-box";
import { useTranslations } from "@/hooks/use-translations";
import { useAuth } from "@/contexts/auth-context";
import { KeyRound, Loader2, Settings, Shield, Terminal, User } from "lucide-react";

interface HeaderSearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
}

interface HeaderProps {
  title: string;
  currentWeekday: string;
  searchBox?: HeaderSearchBoxProps;
}

export function Header({ title, currentWeekday, searchBox }: HeaderProps) {
  const router = useRouter();
  const t = useTranslations();
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  const isAdmin = user?.roles?.includes("Admin") ?? false;

  const handleLogin = () => {
    router.push("/auth");
  };

  const handleLogout = () => {
    logout();
    router.refresh();
  };

  const handleAdminPanel = () => {
    router.push("/admin");
  };

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-background/85 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="flex min-w-0 items-center gap-2.5">
        <SidebarTrigger className="-ml-1 rounded-lg" />
        <Separator orientation="vertical" className="mr-1 hidden h-4 sm:block" />
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
          <span className="hidden items-center gap-1 rounded-full border border-teal-500/25 bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-700 md:inline-flex dark:text-teal-300">
            <span className="size-1.5 rounded-full bg-teal-500" />
            知识库引擎在线
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {searchBox && (
          <HeaderSearchBox
            value={searchBox.value}
            onChange={searchBox.onChange}
            visible={searchBox.visible}
          />
        )}

        <Button
          variant="outline"
          size="sm"
          className="hidden h-8 gap-1.5 rounded-lg border-border/80 bg-background/70 text-xs font-medium sm:inline-flex"
          onClick={() => router.push("/mcp")}
        >
          <Terminal className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
          <span>Open API / Agent</span>
        </Button>

        <span className="hidden text-xs text-muted-foreground lg:inline-block">
          {currentWeekday}
        </span>

        <div className="flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
        </div>

        {isLoading ? (
          <Button variant="ghost" size="sm" disabled>
            <Loader2 className="h-4 w-4 animate-spin" />
          </Button>
        ) : isAuthenticated && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                <Avatar className="h-9 w-9 ring-1 ring-border">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="bg-teal-500/15 font-semibold text-teal-700 dark:text-teal-300">
                    {user.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user.name}</p>
                  {user.email && (
                    <p className="text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/profile")}>
                <User className="mr-2 h-4 w-4" />
                {t("common.profile.title")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/mcp")}>
                <KeyRound className="mr-2 h-4 w-4" />
                API Key 与开放平台
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Settings className="mr-2 h-4 w-4" />
                {t("common.settings.title")}
              </DropdownMenuItem>
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleAdminPanel}>
                    <Shield className="mr-2 h-4 w-4 text-teal-600 dark:text-teal-400" />
                    {t("common.adminPanel") || "Admin Panel"}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                {t("common.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="sm" className="h-8 rounded-lg bg-teal-600 px-3 text-white hover:bg-teal-500" onClick={handleLogin}>
            {t("common.login")}
          </Button>
        )}
      </div>
    </header>
  );
}
