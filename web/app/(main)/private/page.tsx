"use client";

import { useState, useCallback } from "react";
import { AppLayout } from "@/components/app-layout";
import { useTranslations } from "@/hooks/use-translations";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { RepositorySubmitForm } from "@/components/repo/repository-submit-form";
import { RepositoryList } from "@/components/repo/repository-list";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";

export default function PrivatePage() {
  const t = useTranslations();
  const { user } = useAuth();
  const [activeItem, setActiveItem] = useState(t("sidebar.private"));
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleSubmitSuccess = useCallback(() => {
    setIsFormOpen(false);
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  // Use a placeholder user ID if not authenticated
  const ownerUserId = user?.id ?? "anonymous";

  return (
    <AppLayout activeItem={activeItem} onItemClick={setActiveItem}>
      <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">{t("sidebar.private")}</h1>
            <p className="text-muted-foreground">
              {t("common.privateRepos.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => setIsFormOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("home.addPrivateRepo")}
            </Button>
            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
              <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <RepositorySubmitForm
                  onSuccess={handleSubmitSuccess}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <RepositoryList ownerId={ownerUserId} refreshTrigger={refreshTrigger} />
      </div>
    </AppLayout>
  );
}
