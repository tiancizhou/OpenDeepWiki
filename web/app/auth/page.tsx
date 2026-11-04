"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, Sparkles, Zap, ArrowLeft, Loader2, Cpu, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { setToken } from "@/lib/auth-api";
import { useTranslations } from "@/hooks/use-translations";

type AuthMode = "login" | "register";

const defaultSeedAdmin = {
  account: "admin",
  password: "Admin@123",
};

function FeishuLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.6 6.2C3.6 5.09543 4.49543 4.2 5.6 4.2H11.8C15.5555 4.2 18.6 7.24446 18.6 11V11.4H9.2C6.10721 11.4 3.6 8.89279 3.6 5.8V6.2Z"
        fill="#00D6B9"
      />
      <path
        d="M8.4 11.4H20.4V13C20.4 16.9765 17.1765 20.2 13.2 20.2H5.6C4.49543 20.2 3.6 19.3046 3.6 18.2V16.2C3.6 13.549 5.74903 11.4 8.4 11.4Z"
        fill="#3370FF"
      />
    </svg>
  );
}

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl");
  const feishuToken = searchParams.get("feishu_token");
  const { login, register, refreshUser } = useAuth();
  const t = useTranslations();
  const [mode, setMode] = useState<AuthMode>("login");
  const [isLoading, setIsLoading] = useState(false);
  const [isFeishuRedirecting, setIsFeishuRedirecting] = useState(false);
  const [error, setError] = useState("");

  // Login form (username / account + password)
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");

  // Register form
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const redirectAfterAuth = () => {
    if (returnUrl) {
      router.push(decodeURIComponent(returnUrl));
    } else {
      router.push("/");
    }
  };

  // 处理飞书 OAuth 登录回调带回的 JWT 令牌
  useEffect(() => {
    if (!feishuToken) return;
    let active = true;
    const finishFeishuLogin = async () => {
      setIsLoading(true);
      try {
        setToken(feishuToken);
        await refreshUser();
        if (active) {
          if (returnUrl) {
            router.replace(decodeURIComponent(returnUrl));
          } else {
            router.replace("/");
          }
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "飞书登录状态同步失败");
          setIsLoading(false);
        }
      }
    };
    void finishFeishuLogin();
    return () => {
      active = false;
    };
  }, [feishuToken, refreshUser, returnUrl, router]);

  const handleFeishuLogin = () => {
    setIsFeishuRedirecting(true);
    const targetReturn = returnUrl ? encodeURIComponent(returnUrl) : encodeURIComponent("/");
    window.location.href = `/api/ztwork/auth/feishu/login?returnUrl=${targetReturn}`;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login({ email: account.trim(), password });
      redirectAfterAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errors.loginFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("auth.errors.passwordMismatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("auth.errors.passwordTooShort"));
      return;
    }

    setIsLoading(true);

    try {
      const cleanName = name.trim();
      const autoEmail = cleanName.includes("@") ? cleanName : `${cleanName}@internal.local`;
      await register({ name: cleanName, email: autoEmail, password, confirmPassword });
      redirectAfterAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errors.registerFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError("");
  };

  return (
    <div className="flex min-h-screen">
      {/* Left Side - Enterprise Brand Section */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary/10 via-primary/5 to-background relative overflow-hidden border-r border-border/60">
        <div className="absolute inset-0 bg-grid-white/5 [mask-image:radial-gradient(white,transparent_85%)]" />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("authUi.backToHome")}
            </Link>
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
                <Sparkles className="h-4 w-4" />
                {t("authUi.aiPowered")}
              </div>
              <h1 className="text-4xl font-bold tracking-tight">{t("authUi.title")}</h1>
              <p className="text-lg text-muted-foreground max-w-md">
                {t("authUi.subtitle")}
              </p>
            </div>

            <div className="space-y-6 max-w-md">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{t("authUi.features.smartDocs")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t("authUi.features.smartDocsDesc")}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{t("authUi.features.fastSearch")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t("authUi.features.fastSearchDesc")}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{t("authUi.features.githubIntegration")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t("authUi.features.githubIntegrationDesc")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            {t("authUi.copyright")}
          </div>
        </div>
      </div>

      {/* Right Side - Feishu SSO + Username/Password Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile Header */}
          <div className="lg:hidden text-center space-y-2">
            <h1 className="text-2xl font-bold">{t("authUi.title")}</h1>
            <p className="text-muted-foreground">{t("authUi.mobileSubtitle")}</p>
          </div>

          <div className="space-y-6 rounded-xl border border-border/60 bg-card/50 p-6 sm:p-8 shadow-sm">
            <div className="space-y-2 text-center lg:text-left">
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-primary mb-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                企业研发内部认证
              </div>
              <h2 className="text-2xl font-bold tracking-tight">
                {mode === "login" ? t("authUi.welcome") : t("authUi.createAccount")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {mode === "login"
                  ? "支持飞书企业账号一键登录，或使用研发本地账号密码登录"
                  : t("authUi.registerDesc")}
              </p>
            </div>

            {error && (
              <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950/50 border border-red-500/20 rounded-md">
                {error}
              </div>
            )}

            {/* 飞书一键登录入口 */}
            <div className="space-y-4">
              <Button
                type="button"
                variant="outline"
                className="w-full h-11 gap-2.5 border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 text-foreground font-medium"
                onClick={handleFeishuLogin}
                disabled={isLoading || isFeishuRedirecting}
              >
                {isFeishuRedirecting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                ) : (
                  <FeishuLogo className="h-5 w-5 shrink-0" />
                )}
                使用飞书企业账号登录（ZtWork 统一身份）
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/60" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2.5 text-muted-foreground">
                    或使用账号密码登录
                  </span>
                </div>
              </div>
            </div>

            {mode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="account" className="text-sm font-medium">
                    {t("authUi.email")}
                  </label>
                  <Input
                    id="account"
                    type="text"
                    autoComplete="username"
                    placeholder={defaultSeedAdmin.account}
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    required
                    disabled={isLoading || isFeishuRedirecting}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="text-sm font-medium">
                      {t("authUi.password")}
                    </label>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder={defaultSeedAdmin.password}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading || isFeishuRedirecting}
                    className="h-11"
                  />
                </div>
                <Button type="submit" className="w-full h-11" disabled={isLoading || isFeishuRedirecting}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("authUi.signingIn")}
                    </>
                  ) : (
                    t("authUi.signIn")
                  )}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="name" className="text-sm font-medium">
                    {t("authUi.username")}
                  </label>
                  <Input
                    id="name"
                    type="text"
                    autoComplete="username"
                    placeholder={t("authUi.usernamePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    disabled={isLoading}
                    className="h-11"
                    minLength={2}
                    maxLength={50}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="reg-password" className="text-sm font-medium">
                    {t("authUi.password")}
                  </label>
                  <Input
                    id="reg-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={t("authUi.passwordHint")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    className="h-11"
                    minLength={6}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="confirm-password" className="text-sm font-medium">
                    {t("authUi.confirmPassword")}
                  </label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={t("authUi.confirmPasswordPlaceholder")}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    className="h-11"
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full h-11" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("authUi.signingUp")}
                    </>
                  ) : (
                    t("authUi.signUp")
                  )}
                </Button>
              </form>
            )}

            <div className="text-center text-sm text-muted-foreground pt-2 border-t border-border/50">
              {mode === "login" ? t("authUi.noAccount") : t("authUi.hasAccount")}{" "}
              <Button
                variant="link"
                className="p-0 h-auto font-normal text-primary"
                onClick={switchMode}
              >
                {mode === "login" ? t("authUi.signUpNow") : t("authUi.signInNow")}
              </Button>
            </div>

            <div className="lg:hidden text-center">
              <Button variant="ghost" onClick={() => router.push("/")} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                {t("authUi.backToHome")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
