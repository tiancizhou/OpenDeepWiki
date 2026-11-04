"use client";

import * as React from "react";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Globe, Lock, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateRepositoryVisibility } from "@/lib/repository-api";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { useTranslations } from "@/hooks/use-translations";

export interface VisibilityToggleProps {
  repositoryId: string;
  isPublic: boolean;
  hasPassword: boolean;
  onVisibilityChange: (newIsPublic: boolean) => void;
  disabled?: boolean;
}

export function VisibilityToggle({
  repositoryId,
  isPublic,
  onVisibilityChange,
  disabled = false,
}: VisibilityToggleProps) {
  const t = useTranslations();
  const [isLoading, setIsLoading] = React.useState(false);
  const [currentIsPublic, setCurrentIsPublic] = React.useState(isPublic);
  const [employeeNosInput, setEmployeeNosInput] = React.useState("");
  const [isSavingWhitelist, setIsSavingWhitelist] = React.useState(false);

  React.useEffect(() => {
    setCurrentIsPublic(isPublic);
  }, [isPublic]);

  const isDisabled = disabled || isLoading;

  const handleToggle = async (checked: boolean) => {
    const newIsPublic = checked;
    setIsLoading(true);

    try {
      const response = await updateRepositoryVisibility({
        repositoryId,
        isPublic: newIsPublic,
      });

      if (response.success) {
        setCurrentIsPublic(response.isPublic);
        onVisibilityChange(response.isPublic);
        toast.success(
          response.isPublic
            ? t("home.private.visibility.setPublicSuccess")
            : t("home.private.visibility.setPrivateSuccess")
        );
      } else {
        toast.error(response.errorMessage || t("home.private.visibility.updateError"));
      }
    } catch (error) {
      console.error("Failed to update visibility:", error);
      toast.error(t("home.private.visibility.updateError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveEmployeeWhitelist = async () => {
    setIsSavingWhitelist(true);
    try {
      const list = employeeNosInput
        .split(/[,;，；\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      await api.put(`/api/v1/repositories/${repositoryId}/allowed-employees`, {
        employeeNos: list,
      });
      toast.success(
        list.length > 0
          ? `已设置飞书工号白名单（${list.join(", ")}）`
          : "已清空工号白名单限制"
      );
    } catch (err) {
      console.error("Failed to save employee whitelist:", err);
      toast.error("保存飞书工号白名单失败");
    } finally {
      setIsSavingWhitelist(false);
    }
  };

  return (
    <div className={cn("flex items-center gap-2", isDisabled && "opacity-50")}>
      <div className="flex items-center gap-1.5">
        {isLoading ? (
          <Spinner className="h-4 w-4" />
        ) : currentIsPublic ? (
          <Globe className="h-4 w-4 text-emerald-500" />
        ) : (
          <Lock className="h-4 w-4 text-amber-500" />
        )}
        <Switch
          checked={currentIsPublic}
          onCheckedChange={handleToggle}
          disabled={isDisabled}
          aria-label={currentIsPublic ? "全员公开" : "受限访问"}
        />
        <span className="text-xs text-muted-foreground">
          {currentIsPublic ? "全员可见" : "私有受限"}
        </span>
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
            title="配置 ZtWork 飞书工号访问白名单"
          >
            <Users className="h-3.5 w-3.5" />
            工号授权
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3 space-y-2.5" align="end">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-foreground">
              ZtWork 飞书工号访问白名单
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              填写允许访问此项目的飞书员工工号（多个用逗号分隔，例如 <code>64308, 64309</code>）。留空则按公开/部门权限判断。
            </p>
          </div>
          <Input
            value={employeeNosInput}
            onChange={(e) => setEmployeeNosInput(e.target.value)}
            placeholder="例如: 64308, 64309"
            className="h-8 text-xs font-mono"
          />
          <Button
            type="button"
            size="sm"
            className="w-full h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
            onClick={handleSaveEmployeeWhitelist}
            disabled={isSavingWhitelist}
          >
            {isSavingWhitelist ? "保存中..." : "保存工号权限"}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
