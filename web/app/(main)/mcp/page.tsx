"use client";

import { useCallback, useEffect, useState } from "react";
import { AppLayout } from "@/components/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Globe,
  KeyRound,
  Copy,
  Check,
  Loader2,
  Zap,
  Shield,
  Code2,
  Terminal,
  Plus,
  Trash2,
  GitBranch,
  Bot,
  BookOpen,
  Webhook,
} from "lucide-react";
import { useTranslations } from "@/hooks/use-translations";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface McpProviderPublic {
  id: string;
  name: string;
  description?: string;
  serverUrl: string;
  transportType: string;
  requiresApiKey: boolean;
  apiKeyObtainUrl?: string;
  iconUrl?: string;
  maxRequestsPerDay: number;
  allowedTools?: string;
}

interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  userId: string;
  userEmail?: string;
  scope: string;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
}

interface ApiKeyCreateResult {
  id: string;
  name: string;
  keyPrefix: string;
  scope: string;
  expiresAt?: string | null;
  plainTextKey: string;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-500" />
          {label && <span className="text-emerald-500">已复制</span>}
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          {label && <span>{label}</span>}
        </>
      )}
    </button>
  );
}

function CodeBlock({
  code,
  language = "json",
  title,
}: {
  code: string;
  language?: string;
  title?: string;
}) {
  return (
    <div className="relative rounded-xl bg-muted/50 border border-border/70 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-muted/30">
        <span className="text-xs text-muted-foreground font-mono">
          {title || language}
        </span>
        <CopyButton text={code} label="复制代码" />
      </div>
      <pre className="p-4 text-xs sm:text-sm overflow-x-auto font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const OPEN_API_ENDPOINTS = [
  {
    category: "知识检索与文档读取 (Scope: open:read)",
    items: [
      {
        method: "GET",
        path: "/api/v1/open/capabilities",
        summary: "服务发现与凭据自检",
        desc: "返回知识库统计、可用 AI 模型、当前 API Key 权限范围及全部开放端点清单。",
      },
      {
        method: "GET",
        path: "/api/v1/open/repositories?keyword=&org=&language=&status=",
        summary: "分页查询代码仓库列表",
        desc: "获取已纳管仓库、分支列表、多语言文档状态及专属 MCP 接入地址。",
      },
      {
        method: "GET",
        path: "/api/v1/open/repositories/{id}/catalog?branch=main&language=zh",
        summary: "获取仓库 Wiki 目录树",
        desc: "返回指定仓库与分支的层级化章节目录结构。",
      },
      {
        method: "GET",
        path: "/api/v1/open/repositories/{id}/docs?path=overview&all=false",
        summary: "读取文档 Markdown 或全量导出",
        desc: "按路径读取单篇 Wiki 正文及关联源码文件；传 all=true 可一次性拉取全库文档供外部 Agent 向量化索引。",
      },
      {
        method: "POST",
        path: "/api/v1/open/search",
        summary: "跨仓库 / 单仓库全文检索",
        desc: "传入 { query, repositoryId, owner, repo, maxResults }，返回匹配文档片段与行号。",
      },
      {
        method: "GET",
        path: "/api/v1/open/repositories/{id}/mindmap",
        summary: "获取架构思维导图与 SKILL 定义",
        desc: "返回项目的模块架构思维导图以及可供 Agent 直接挂载的 SKILL.md。",
      },
      {
        method: "GET",
        path: "/api/v1/open/repositories/{id}/graph",
        summary: "获取 Graphify 代码知识图谱",
        desc: "返回 Graphify 静态与语义分析生成的节点/边图谱 JSON 与架构报告。",
      },
    ],
  },
  {
    category: "AI 智能问答与 Agent 协同 (Scope: open:chat)",
    items: [
      {
        method: "POST",
        path: "/api/v1/open/ask",
        summary: "Agent 知识库同步问答接口",
        desc: "传入 { query, repositoryId, owner, repo, branch, modelId }，自动结合知识库检索与本地 Git 代码工具生成回答与引用来源。",
      },
      {
        method: "POST",
        path: "/api/v1/chat/stream",
        summary: "SSE 流式对话接口",
        desc: "支持多轮上下文、思维链状态与工具调用事件的 Server-Sent Events 流式输出。",
      },
    ],
  },
  {
    category: "仓库生命周期与自动化管控 (Scope: open:write)",
    items: [
      {
        method: "POST",
        path: "/api/v1/open/repositories",
        summary: "API 自动接入内部 GitLab / Git 仓库",
        desc: "传入 { gitUrl, branchName, languageCode, authAccount, authPassword } 自动创建仓库并加入后台构建队列。",
      },
      {
        method: "GET",
        path: "/api/v1/open/repositories/{id}/status",
        summary: "查询文档生成进度与实时日志",
        desc: "返回仓库与分支构建状态、增量同步记录及最近 20 条 AI 处理日志。",
      },
      {
        method: "POST",
        path: "/api/v1/open/repositories/{id}/sync",
        summary: "触发增量更新或全量重构",
        desc: "传入 { branchName, mode: 'incremental' | 'full' } 立即触发同步。",
      },
    ],
  },
];

export default function McpPage() {
  const t = useTranslations();
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const [providers, setProviders] = useState<McpProviderPublic[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScope, setNewKeyScope] = useState("open:read,open:chat,open:write,mcp:read");
  const [newKeyExpireDays, setNewKeyExpireDays] = useState("365");
  const [creatingKey, setCreatingKey] = useState(false);
  const [createdKeyResult, setCreatedKeyResult] = useState<ApiKeyCreateResult | null>(null);

  const origin =
    typeof window === "undefined" ? "http://localhost:5265" : window.location.origin;

  function buildServerUrl(serverUrl: string) {
    const endpoint = serverUrl || "/api/mcp";
    if (/^https?:\/\//.test(endpoint)) {
      return endpoint;
    }
    return `${origin}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
  }

  useEffect(() => {
    api
      .get<{ success: boolean; data: McpProviderPublic[] }>("/api/mcp-providers", {
        skipAuth: true,
      })
      .then((res) => {
        if (res.success) setProviders(res.data);
      })
      .catch(() => {})
      .finally(() => setLoadingProviders(false));
  }, []);

  const loadApiKeys = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoadingKeys(true);
    try {
      const list = await api.get<ApiKeyItem[]>("/api/auth/api-keys");
      if (Array.isArray(list)) {
        setApiKeys(list);
      }
    } catch {
      // Ignore unauthorized or network error
    } finally {
      setLoadingKeys(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadApiKeys();
  }, [loadApiKeys]);

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) {
      toast.error("请输入 API Key 名称（例如：公司 Agents 平台生产密钥）");
      return;
    }

    setCreatingKey(true);
    try {
      const expiresInDays = Number.parseInt(newKeyExpireDays, 10);
      const res = await api.post<ApiKeyCreateResult>("/api/auth/api-keys", {
        name: newKeyName.trim(),
        scope: newKeyScope,
        expiresInDays: Number.isNaN(expiresInDays) || expiresInDays <= 0 ? null : expiresInDays,
      });
      setCreatedKeyResult(res);
      setNewKeyName("");
      toast.success("API Key 创建成功，请立即复制保存！");
      await loadApiKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建 API Key 失败");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeApiKey = async (id: string) => {
    try {
      await api.delete(`/api/auth/api-keys/${id}`);
      toast.success("API Key 已吊销");
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
    } catch {
      toast.error("吊销 API Key 失败");
    }
  };

  const curlSearchExample = `curl -X POST "${origin}/api/v1/open/search" \\
  -H "X-API-Key: dwk_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "认证中间件与权限校验流程",
    "maxResults": 5,
    "includeContent": false
  }'`;

  const pythonAgentExample = `import requests

BASE_URL = "${origin}/api/v1/open"
HEADERS = {
    "X-API-Key": "dwk_YOUR_API_KEY",
    "Content-Type": "application/json"
}

# 1. 调用知识库智能问答接口 (供自研 Agent 平台作为 Tool 调用)
resp = requests.post(
    f"{BASE_URL}/ask",
    headers=HEADERS,
    json={
        "query": "系统是如何解析 Git 仓库并生成目录树的？",
        "owner": "hmkj",
        "repo": "Zt Wiki",
        "branch": "main",
        "maxSources": 5
    },
    timeout=60
)
result = resp.json()["data"]
print("AI Answer:", result["answer"])
print("Citations:", [c["path"] for c in result["citations"]])`;

  const defaultMcpConfig = JSON.stringify(
    {
      mcpServers: {
        "opendeepwiki-enterprise": {
          url: `${origin}/api/mcp`,
          headers: {
            Authorization: "Bearer dwk_YOUR_API_KEY",
          },
        },
      },
    },
    null,
    2
  );

  return (
    <AppLayout activeItem={t("sidebar.mcp")}>
      <div className="mx-auto w-full max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Hero Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-teal-500/[0.08] via-background to-sky-500/[0.05] p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3 max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-700 dark:text-teal-300">
                <Terminal className="h-3.5 w-3.5" />
                OPEN PLATFORM & AGENT INTEGRATION HUB
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                开放平台与智能体接入中心
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                将公司内部代码知识库无缝对接至自研 Agents 平台、研发流水线与 IDE 智能助手。
                支持标准 RESTful Open API、Model Context Protocol (MCP) 以及 GitLab Webhook 实时增量同步。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="rounded-xl border border-border/70 bg-background/80 px-4 py-3 text-xs space-y-1">
                <div className="text-muted-foreground">Open API 基础端点</div>
                <div className="flex items-center gap-2 font-mono font-semibold text-foreground">
                  <span>{origin}/api/v1/open</span>
                  <CopyButton text={`${origin}/api/v1/open`} />
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/80 px-4 py-3 text-xs space-y-1">
                <div className="text-muted-foreground">全局 MCP 端点</div>
                <div className="flex items-center gap-2 font-mono font-semibold text-foreground">
                  <span>{origin}/api/mcp</span>
                  <CopyButton text={`${origin}/api/mcp`} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3 Core Capability Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-border/70 bg-card/60">
            <CardHeader className="pb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                  <Bot className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">自研 Agents 平台原生对接</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                提供全套 <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/api/v1/open/*</code> 接口，
                支持外部 Agent 跨库检索文档、读取架构图谱、调用 RAG 问答以及批量拉取语料。
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/60">
            <CardHeader className="pb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Shield className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">统一 API Key 与细粒度 Scope</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                支持通过 <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">X-API-Key: dwk_xxx</code> 或{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">Bearer dwk_xxx</code> 鉴权，
                按读取、问答、写入与 MCP 精细化控制权限。
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/60">
            <CardHeader className="pb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <Webhook className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">GitLab Webhook 自动增量演进</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                内网 GitLab 代码推送后可自动回调{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/api/v1/open/webhooks/git</code>，
                自动识别变更提交并增量更新对应章节文档。
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Main Interactive Tabs */}
        <Tabs defaultValue="open-api" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto p-1 gap-1">
            <TabsTrigger value="open-api" className="gap-2 py-2 text-xs sm:text-sm">
              <BookOpen className="h-4 w-4" />
              Open REST API 文档
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="gap-2 py-2 text-xs sm:text-sm">
              <KeyRound className="h-4 w-4" />
              API Key 密钥管理
            </TabsTrigger>
            <TabsTrigger value="mcp" className="gap-2 py-2 text-xs sm:text-sm">
              <Zap className="h-4 w-4" />
              MCP 协议接入
            </TabsTrigger>
            <TabsTrigger value="webhook" className="gap-2 py-2 text-xs sm:text-sm">
              <GitBranch className="h-4 w-4" />
              GitLab Webhook 同步
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Open REST API Reference & SDK Examples */}
          <TabsContent value="open-api" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <CodeBlock
                title="Python · 自研 Agents 平台调用知识库问答示例"
                language="python"
                code={pythonAgentExample}
              />
              <CodeBlock
                title="cURL · 跨库全文检索代码知识片段"
                language="bash"
                code={curlSearchExample}
              />
            </div>

            <div className="space-y-6">
              {OPEN_API_ENDPOINTS.map((group) => (
                <Card key={group.category} className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{group.category}</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-y divide-border/60">
                    {group.items.map((ep) => (
                      <div
                        key={ep.path}
                        className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={ep.method === "GET" ? "secondary" : "default"}
                              className={
                                ep.method === "GET"
                                  ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 font-mono text-[11px]"
                                  : "bg-teal-600 text-white font-mono text-[11px]"
                              }
                            >
                              {ep.method}
                            </Badge>
                            <code className="font-mono text-xs sm:text-sm font-semibold break-all">
                              {ep.path}
                            </code>
                            <CopyButton text={`${origin}${ep.path.split("?")[0]}`} />
                          </div>
                          <p className="text-xs text-muted-foreground">{ep.desc}</p>
                        </div>
                        <Badge variant="outline" className="shrink-0 self-start sm:self-center text-xs">
                          {ep.summary}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* TAB 2: API Key Management */}
          <TabsContent value="api-keys" className="space-y-6">
            {!isAuthenticated ? (
              <Card className="border-border/70">
                <CardContent className="flex flex-col items-center justify-center py-14 text-center space-y-4">
                  <KeyRound className="h-10 w-10 text-teal-600 dark:text-teal-400" />
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold">请先登录以管理您的开放平台 API Key</h3>
                    <p className="text-sm text-muted-foreground">
                      登录后可生成 <code className="font-mono">dwk_</code> 前缀的访问密钥，用于对接自研 Agents 平台、MCP 客户端与 CI/CD。
                    </p>
                  </div>
                  <Button
                    className="bg-teal-600 text-white hover:bg-teal-500"
                    onClick={() => router.push("/auth")}
                  >
                    前往登录
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="border-border/70">
                  <CardHeader>
                    <CardTitle className="text-base">创建开放平台 API Key</CardTitle>
                    <CardDescription>
                      生成的密钥支持通过请求头 <code className="font-mono">X-API-Key: dwk_xxx</code> 或{" "}
                      <code className="font-mono">Authorization: Bearer dwk_xxx</code> 调用所有开放接口与 MCP 服务。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleCreateApiKey} className="grid gap-4 sm:grid-cols-4 items-end">
                      <div className="space-y-1.5 sm:col-span-1">
                        <label className="text-xs font-medium">密钥名称 / 对接系统</label>
                        <Input
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                          placeholder="例如：公司 Agents 平台生产环境"
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className="text-xs font-medium">权限范围 (Scopes)</label>
                        <select
                          value={newKeyScope}
                          onChange={(e) => setNewKeyScope(e.target.value)}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <option value="open:read,open:chat,open:write,mcp:read">
                            全功能接入 (open:read, open:chat, open:write, mcp:read)
                          </option>
                          <option value="open:read,open:chat,mcp:read">
                            知识读取与 AI 问答 (open:read, open:chat, mcp:read)
                          </option>
                          <option value="open:read,mcp:read">
                            仅只读检索与 MCP (open:read, mcp:read)
                          </option>
                        </select>
                      </div>
                      <div className="flex items-end gap-2 sm:col-span-1">
                        <div className="space-y-1.5 flex-1">
                          <label className="text-xs font-medium">有效期(天)</label>
                          <Input
                            type="number"
                            value={newKeyExpireDays}
                            onChange={(e) => setNewKeyExpireDays(e.target.value)}
                            placeholder="365"
                            className="h-9 text-sm"
                          />
                        </div>
                        <Button
                          type="submit"
                          disabled={creatingKey}
                          className="h-9 bg-teal-600 text-white hover:bg-teal-500"
                        >
                          {creatingKey ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Plus className="mr-1.5 h-4 w-4" />
                              生成密钥
                            </>
                          )}
                        </Button>
                      </div>
                    </form>

                    {createdKeyResult && (
                      <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            密钥已生成（仅显示一次，请立即复制保存）：
                          </span>
                          <CopyButton text={createdKeyResult.plainTextKey} label="复制完整密钥" />
                        </div>
                        <code className="block rounded bg-background/90 px-3 py-2 font-mono text-xs sm:text-sm font-semibold break-all">
                          {createdKeyResult.plainTextKey}
                        </code>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/70">
                  <CardHeader>
                    <CardTitle className="text-base">我的 API Keys</CardTitle>
                    <CardDescription>管理当前账号下已签发的开放平台访问凭证</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loadingKeys ? (
                      <div className="flex items-center justify-center py-10">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : apiKeys.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        暂未创建 API Key，请在上方表单中生成。
                      </p>
                    ) : (
                      <div className="divide-y divide-border/60">
                        {apiKeys.map((item) => (
                          <div
                            key={item.id}
                            className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{item.name}</span>
                                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                                  dwk_{item.keyPrefix}...
                                </code>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>Scope: {item.scope}</span>
                                <span>·</span>
                                <span>创建于: {new Date(item.createdAt).toLocaleDateString()}</span>
                                {item.lastUsedAt && (
                                  <>
                                    <span>·</span>
                                    <span>最近调用: {new Date(item.lastUsedAt).toLocaleString()}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive self-start sm:self-center"
                              onClick={() => handleRevokeApiKey(item.id)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              吊销
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* TAB 3: MCP Protocol Integration */}
          <TabsContent value="mcp" className="space-y-6">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="text-base">内置知识库 MCP Server 接入配置</CardTitle>
                <CardDescription>
                  支持全局跨仓库检索（<code className="font-mono">/api/mcp</code>）或单仓库隔离接入（
                  <code className="font-mono">/api/mcp/&#123;owner&#125;/&#123;repo&#125;</code>）。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CodeBlock
                  title="Claude Code / Cursor / 自研 Agent MCP 客户端配置 (.cursor/mcp.json)"
                  language="json"
                  code={defaultMcpConfig}
                />
              </CardContent>
            </Card>

            {loadingProviders ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              providers.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-base font-semibold">{t("common.mcp.availableProviders")}</h3>
                  {providers.map((provider) => {
                    const serverUrl = buildServerUrl(provider.serverUrl);
                    return (
                      <Card key={provider.id} className="border-border/70">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                                <Globe className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div>
                                <CardTitle className="text-base">{provider.name}</CardTitle>
                                {provider.description && (
                                  <CardDescription>{provider.description}</CardDescription>
                                )}
                              </div>
                            </div>
                            <Badge variant="secondary">{provider.transportType}</Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs font-mono">
                            <span>{serverUrl}</span>
                            <CopyButton text={serverUrl} label="复制地址" />
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )
            )}
          </TabsContent>

          {/* TAB 4: GitLab / Git Webhook Automation */}
          <TabsContent value="webhook" className="space-y-6">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="text-base">GitLab / Git 仓库 Push 自动增量同步</CardTitle>
                <CardDescription>
                  在内部 GitLab 仓库或群组的 Settings → Webhooks 中配置以下回调地址，当有代码合并或推送时，知识库将自动触发对应分支的增量更新。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-border/70 bg-muted/30 p-4 space-y-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Webhook URL</span>
                    <div className="flex items-center gap-2 font-mono text-xs sm:text-sm font-semibold">
                      <span>{origin}/api/v1/open/webhooks/git</span>
                      <CopyButton text={`${origin}/api/v1/open/webhooks/git`} label="复制" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Secret Token (推荐)
                    </span>
                    <span className="text-xs text-muted-foreground">
                      可填写任意已创建的 <code className="font-mono">dwk_xxx</code> API Key 或服务端配置的{" "}
                      <code className="font-mono">WEBHOOK_SECRET</code>
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Trigger Events</span>
                    <Badge variant="outline">Push events</Badge>
                  </div>
                </div>

                <CodeBlock
                  title="模拟发送 GitLab Push Webhook 测试请求"
                  language="bash"
                  code={`curl -X POST "${origin}/api/v1/open/webhooks/git" \\
  -H "X-API-Key: dwk_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "ref": "refs/heads/main",
    "project": {
      "path_with_namespace": "hmkj/Zt Wiki",
      "git_http_url": "https://gitlab.company.com/hmkj/Zt Wiki.git"
    }
  }'`}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
