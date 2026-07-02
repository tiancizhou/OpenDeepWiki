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
import { Loader2, Settings, User } from "lucide-react";
import { isAssistantOnlyUser } from "@/lib/role-access";

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
  const assistantOnly = isAssistantOnlyUser(user);

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
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground hidden md:inline-block">
          {currentWeekday}
        </span>

        {searchBox && (
          <HeaderSearchBox
            value={searchBox.value}
            onChange={searchBox.onChange}
            visible={searchBox.visible}
          />
        )}

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
                <Avatar className="h-9 w-9">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
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
              {!assistantOnly && (
                <>
                  <DropdownMenuItem onClick={() => router.push("/profile")}>
                    <User className="mr-2 h-4 w-4" />
                    {t("common.profile.title")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/settings")}>
                    <Settings className="mr-2 h-4 w-4" />
                    {t("common.settings.title")}
                  </DropdownMenuItem>
                </>
              )}
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleAdminPanel}>
                    <Settings className="mr-2 h-4 w-4" />
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
          <Button size="sm" onClick={handleLogin}>
            {t("common.login")}
          </Button>
        )}
      </div>
    </header>
  );
}
