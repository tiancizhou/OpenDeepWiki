using System.Diagnostics;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using OpenDeepWiki.Agents;
using OpenDeepWiki.Agents.Tools;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Entities;
using OpenDeepWiki.Models;
using OpenDeepWiki.Services.AI;
using OpenDeepWiki.Services.Auth;
using OpenDeepWiki.Services.Repositories;
using OpenDeepWiki.Services.Wiki;

namespace OpenDeepWiki.Endpoints;

/// <summary>
/// 企业级开放平台 API 端点（/api/v1/open/*）
/// 供公司自研 Agents 平台、CI/CD 流水线、IDE 插件及第三方内部系统调用知识库核心能力。
/// 支持通过 X-API-Key: dwk_xxx、Authorization: Bearer dwk_xxx 或标准 JWT 令牌认证。
/// </summary>
public static class OpenPlatformEndpoints
{
    public static IEndpointRouteBuilder MapOpenPlatformEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/open")
            .WithTags("Open Platform API (Agents & External Systems)");

        // 1. 平台能力发现与健康自检（允许带 Key 或匿名查看能力目录，带 Key 时返回当前凭据详情）
        group.MapGet("/capabilities", GetCapabilitiesAsync)
            .WithName("GetOpenPlatformCapabilities")
            .WithSummary("获取开放平台能力清单与当前认证凭据状态");

        // 2. 知识库检索与读取（需要 open:read 权限）
        group.MapGet("/groups", ListRepositoryGroupsAsync)
            .WithName("OpenListRepositoryGroups")
            .WithSummary("查询所有业务系统/仓库组及其包含的前后端子仓库列表");

        group.MapGet("/repositories", ListRepositoriesAsync)
            .WithName("OpenListRepositories")
            .WithSummary("分页查询知识库中的代码仓库列表及分支/语言元数据");

        group.MapGet("/repositories/{id}", GetRepositoryByIdAsync)
            .WithName("OpenGetRepositoryById")
            .WithSummary("按仓库 ID 获取仓库详情、分支列表、多语言状态与图谱状态");

        group.MapGet("/repos/{owner}/{repo}", GetRepositoryByOwnerRepoAsync)
            .WithName("OpenGetRepositoryByOwnerRepo")
            .WithSummary("按组织与仓库名称获取仓库详情");

        group.MapGet("/repositories/{id}/catalog", GetRepositoryCatalogAsync)
            .WithName("OpenGetRepositoryCatalog")
            .WithSummary("获取指定仓库分支的 Wiki 目录树结构");

        group.MapGet("/repositories/{id}/docs", GetRepositoryDocsAsync)
            .WithName("OpenGetRepositoryDocs")
            .WithSummary("读取指定路径的 Wiki 文档正文，或批量导出全量文档供外部 RAG 索引");

        group.MapGet("/repositories/{id}/mindmap", GetRepositoryMindMapAsync)
            .WithName("OpenGetRepositoryMindMap")
            .WithSummary("获取指定仓库的项目架构思维导图与 SKILL 描述");

        group.MapGet("/repositories/{id}/graph", GetRepositoryGraphAsync)
            .WithName("OpenGetRepositoryGraph")
            .WithSummary("获取指定仓库的 Graphify 代码知识图谱与架构分析报告");

        group.MapPost("/search", SearchKnowledgeBaseAsync)
            .WithName("OpenSearchKnowledgeBase")
            .WithSummary("跨仓库或单仓库全文检索 Wiki 知识库，返回匹配片段与行号");

        // 3. AI 智能问答与 Agent 协同接口（需要 open:chat 权限）
        group.MapPost("/ask", AskKnowledgeBaseAsync)
            .WithName("OpenAskKnowledgeBase")
            .WithSummary("面向外部 Agent 平台的知识库智能问答接口（支持自动检索文档与代码工具调用）");

        // 4. 仓库生命周期管控接口（需要 open:write 权限）
        group.MapPost("/groups", SubmitRepositoryGroupAsync)
            .WithName("OpenSubmitRepositoryGroup")
            .WithSummary("一次性接入业务系统/仓库组的多个前后端代码仓库并自动触发 Wiki 生成");

        group.MapPost("/repositories", SubmitRepositoryAsync)
            .WithName("OpenSubmitRepository")
            .WithSummary("通过 API 接入 GitLab / Git 仓库并自动触发 Wiki 生成");

        group.MapGet("/repositories/{id}/status", GetRepositoryBuildStatusAsync)
            .WithName("OpenGetRepositoryBuildStatus")
            .WithSummary("查询仓库文档构建进度、分支任务状态与实时处理日志");

        group.MapPost("/repositories/{id}/sync", TriggerRepositorySyncAsync)
            .WithName("OpenTriggerRepositorySync")
            .WithSummary("触发仓库增量同步或全量重新生成");

        // 5. GitLab / GitHub Webhook 自动增量同步接入端点
        group.MapPost("/webhooks/git", HandleGitWebhookAsync)
            .WithName("OpenHandleGitWebhook")
            .WithSummary("接收 GitLab / GitHub Push Webhook 并自动触发对应分支的增量文档更新")
            .AllowAnonymous();

        return app;
    }

    private static IResult? EnforceScope(HttpContext httpContext, string requiredScope)
    {
        if (httpContext.User.Identity?.IsAuthenticated != true)
        {
            return Results.Json(new
            {
                success = false,
                errorCode = "UNAUTHORIZED",
                message = "未提供有效的认证凭据。请在请求头中携带 X-API-Key: dwk_xxx 或 Authorization: Bearer dwk_xxx",
                timestamp = DateTime.UtcNow
            }, statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!httpContext.User.HasApiKeyScope(requiredScope))
        {
            return Results.Json(new
            {
                success = false,
                errorCode = "INSUFFICIENT_SCOPE",
                message = $"当前 API Key 缺少所需权限 Scope: '{requiredScope}'",
                timestamp = DateTime.UtcNow
            }, statusCode: StatusCodes.Status403Forbidden);
        }

        return null;
    }

    private static async Task<IResult> GetCapabilitiesAsync(
        HttpContext httpContext,
        [FromServices] IContext context,
        CancellationToken cancellationToken)
    {
        var isAuthenticated = httpContext.User.Identity?.IsAuthenticated == true;
        var authType = httpContext.User.FindFirstValue("auth_type") ?? (isAuthenticated ? "jwt" : "anonymous");
        var scopes = httpContext.User.FindAll("scope").Select(c => c.Value).ToArray();

        var completedRepoCount = await context.Repositories
            .AsNoTracking()
            .CountAsync(r => !r.IsDeleted && r.Status == RepositoryStatus.Completed, cancellationToken);

        var activeModels = await context.ModelConfigs
            .AsNoTracking()
            .Where(m => m.IsActive && !m.IsDeleted)
            .OrderByDescending(m => m.IsDefault)
            .Select(m => new { m.Id, m.Name, m.Provider, m.ModelId, m.IsDefault })
            .ToListAsync(cancellationToken);

        return Results.Ok(new
        {
            success = true,
            data = new
            {
                platform = "OpenDeepWiki Enterprise Knowledge Hub",
                apiVersion = "v1",
                authenticated = isAuthenticated,
                authType,
                userId = httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier),
                userName = httpContext.User.FindFirstValue(ClaimTypes.Name),
                apiKeyName = httpContext.User.FindFirstValue("api_key_name"),
                scopes = scopes.Length > 0 ? scopes : (isAuthenticated ? new[] { "open:read", "open:chat", "open:write", "mcp:read" } : Array.Empty<string>()),
                statistics = new
                {
                    completedRepositories = completedRepoCount,
                    activeModels = activeModels.Count
                },
                models = activeModels,
                protocols = new
                {
                    openRestBaseUrl = "/api/v1/open",
                    mcpGlobalEndpoint = "/api/mcp",
                    mcpRepoScopedEndpointTemplate = "/api/mcp/{owner}/{repo}",
                    chatStreamEndpoint = "/api/v1/chat/stream",
                    gitWebhookEndpoint = "/api/v1/open/webhooks/git"
                },
                endpoints = new object[]
                {
                    new { method = "GET", path = "/api/v1/open/groups", scope = "open:read", description = "查询业务系统/仓库组列表及其下属前后端子仓库" },
                    new { method = "POST", path = "/api/v1/open/groups", scope = "open:write", description = "批量接入同一业务系统下的前端、后端等多个代码仓库" },
                    new { method = "GET", path = "/api/v1/open/repositories", scope = "open:read", description = "分页查询代码仓库列表及分支/语言元数据" },
                    new { method = "GET", path = "/api/v1/open/repositories/{id}", scope = "open:read", description = "获取仓库详情、分支与构建状态" },
                    new { method = "GET", path = "/api/v1/open/repos/{owner}/{repo}", scope = "open:read", description = "按组织名与仓库名获取详情" },
                    new { method = "GET", path = "/api/v1/open/repositories/{id}/catalog", scope = "open:read", description = "获取仓库 Wiki 目录树" },
                    new { method = "GET", path = "/api/v1/open/repositories/{id}/docs", scope = "open:read", description = "读取单篇或批量导出全部 Wiki Markdown 文档" },
                    new { method = "GET", path = "/api/v1/open/repositories/{id}/mindmap", scope = "open:read", description = "获取架构思维导图与 SKILL 定义" },
                    new { method = "GET", path = "/api/v1/open/repositories/{id}/graph", scope = "open:read", description = "获取 Graphify 代码知识图谱与分析报告" },
                    new { method = "POST", path = "/api/v1/open/search", scope = "open:read", description = "支持按业务系统组(group)、多仓库或单库全文检索知识片段" },
                    new { method = "POST", path = "/api/v1/open/ask", scope = "open:chat", description = "支持按业务系统组(group)跨前后端仓库联合 RAG + 工具协同问答" },
                    new { method = "POST", path = "/api/v1/open/repositories", scope = "open:write", description = "自动提交 GitLab/Git 仓库并触发文档生成" },
                    new { method = "GET", path = "/api/v1/open/repositories/{id}/status", scope = "open:read", description = "查询仓库生成进度与处理日志" },
                    new { method = "POST", path = "/api/v1/open/repositories/{id}/sync", scope = "open:write", description = "触发增量同步或全量重新生成" },
                    new { method = "POST", path = "/api/v1/open/webhooks/git", scope = "webhook", description = "接收 GitLab/GitHub Push 事件自动触发增量更新" }
                }
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> ListRepositoryGroupsAsync(
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromQuery] string? keyword = null,
        CancellationToken cancellationToken = default)
    {
        var authError = EnforceScope(httpContext, "open:read");
        if (authError != null) return authError;

        var query = context.Repositories.AsNoTracking().Where(r => !r.IsDeleted);
        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var kw = keyword.Trim().ToLowerInvariant();
            query = query.Where(r =>
                r.OrgName.ToLower().Contains(kw) ||
                r.RepoName.ToLower().Contains(kw) ||
                (r.Description != null && r.Description.ToLower().Contains(kw)));
        }

        var repos = await query
            .OrderByDescending(r => r.UpdatedAt ?? r.CreatedAt)
            .ToListAsync(cancellationToken);

        var groups = repos
            .GroupBy(r => r.OrgName, StringComparer.OrdinalIgnoreCase)
            .Select(g => new
            {
                groupName = g.Key,
                totalRepositories = g.Count(),
                completedCount = g.Count(r => r.Status == RepositoryStatus.Completed),
                processingCount = g.Count(r => r.Status == RepositoryStatus.Processing || r.Status == RepositoryStatus.Pending),
                failedCount = g.Count(r => r.Status == RepositoryStatus.Failed),
                updatedAt = g.Max(r => r.UpdatedAt ?? r.CreatedAt),
                repositories = g.Select(r => new
                {
                    id = r.Id,
                    orgName = r.OrgName,
                    repoName = r.RepoName,
                    fullName = $"{r.OrgName}/{r.RepoName}",
                    description = r.Description,
                    gitUrl = r.SourceLocation,
                    primaryLanguage = r.PrimaryLanguage,
                    status = r.Status.ToString(),
                    isPublic = r.IsPublic,
                    updatedAt = r.UpdatedAt ?? r.CreatedAt
                }).ToList()
            })
            .OrderByDescending(g => g.totalRepositories)
            .ThenByDescending(g => g.updatedAt)
            .ToList();

        return Results.Ok(new
        {
            success = true,
            data = new
            {
                totalGroups = groups.Count,
                totalRepositories = repos.Count,
                groups
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> SubmitRepositoryGroupAsync(
        [FromBody] OpenRepositoryGroupSubmitRequest request,
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromServices] IUserContext userContext,
        CancellationToken cancellationToken)
    {
        var authError = EnforceScope(httpContext, "open:write");
        if (authError != null) return authError;

        if (string.IsNullOrWhiteSpace(request.GroupName))
        {
            return Results.BadRequest(new
            {
                success = false,
                errorCode = "GROUP_NAME_REQUIRED",
                message = "业务系统/仓库组名称 groupName 不能为空",
                timestamp = DateTime.UtcNow
            });
        }

        if (request.Repositories == null || request.Repositories.Count == 0)
        {
            return Results.BadRequest(new
            {
                success = false,
                errorCode = "REPOSITORIES_REQUIRED",
                message = "至少需要提供一个子仓库配置",
                timestamp = DateTime.UtcNow
            });
        }

        var groupName = request.GroupName.Trim();
        var languageCode = string.IsNullOrWhiteSpace(request.LanguageCode) ? "zh" : request.LanguageCode.Trim();
        var currentUserId = userContext.UserId ?? "system";
        var createdItems = new List<object>();

        foreach (var item in request.Repositories)
        {
            if (string.IsNullOrWhiteSpace(item.GitUrl)) continue;
            var gitUrl = item.GitUrl.Trim();
            var (_, parsedRepo) = TryParseOrgAndRepo(gitUrl);
            var repoName = !string.IsNullOrWhiteSpace(item.RepoName) ? item.RepoName.Trim() : (parsedRepo ?? "repo");
            var branchName = string.IsNullOrWhiteSpace(item.BranchName) ? "main" : item.BranchName.Trim();
            var rolePrefix = !string.IsNullOrWhiteSpace(item.Role) ? $"[{item.Role.Trim()}] " : string.Empty;
            var desc = !string.IsNullOrWhiteSpace(item.Description)
                ? $"{rolePrefix}{item.Description.Trim()}"
                : (!string.IsNullOrWhiteSpace(rolePrefix) ? $"{rolePrefix}{groupName} - {repoName}" : request.Description);

            var existingRepo = await context.Repositories
                .FirstOrDefaultAsync(r =>
                    !r.IsDeleted &&
                    ((r.OrgName == groupName && r.RepoName == repoName) || r.GitUrl == gitUrl),
                    cancellationToken);

            if (existingRepo != null)
            {
                createdItems.Add(new
                {
                    repositoryId = existingRepo.Id,
                    orgName = existingRepo.OrgName,
                    repoName = existingRepo.RepoName,
                    role = item.Role,
                    status = existingRepo.Status.ToString(),
                    alreadyExists = true
                });
                continue;
            }

            var repository = new Repository
            {
                Id = Guid.NewGuid().ToString(),
                OwnerUserId = currentUserId,
                GitUrl = gitUrl,
                OrgName = groupName,
                RepoName = repoName,
                Description = desc,
                AuthAccount = !string.IsNullOrWhiteSpace(item.AuthAccount) ? item.AuthAccount : request.AuthAccount,
                AuthPassword = !string.IsNullOrWhiteSpace(item.AuthPassword) ? item.AuthPassword : request.AuthPassword,
                IsPublic = request.IsPublic ?? true,
                GenerateSkill = request.GenerateSkill ?? true,
                Status = RepositoryStatus.Pending
            };

            var branch = new RepositoryBranch
            {
                Id = Guid.NewGuid().ToString(),
                RepositoryId = repository.Id,
                BranchName = branchName
            };

            var language = new BranchLanguage
            {
                Id = Guid.NewGuid().ToString(),
                RepositoryBranchId = branch.Id,
                LanguageCode = languageCode,
                UpdateSummary = string.Empty,
                IsDefault = true
            };

            context.Repositories.Add(repository);
            context.RepositoryBranches.Add(branch);
            context.BranchLanguages.Add(language);

            createdItems.Add(new
            {
                repositoryId = repository.Id,
                branchId = branch.Id,
                orgName = repository.OrgName,
                repoName = repository.RepoName,
                role = item.Role,
                branchName = branch.BranchName,
                status = repository.Status.ToString(),
                alreadyExists = false
            });
        }

        await context.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/v1/open/groups?keyword={Uri.EscapeDataString(groupName)}", new
        {
            success = true,
            data = new
            {
                groupName,
                totalSubmitted = createdItems.Count,
                repositories = createdItems
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> ListRepositoriesAsync(
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromQuery] string? keyword = null,
        [FromQuery] string? org = null,
        [FromQuery] string? language = null,
        [FromQuery] RepositoryStatus? status = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        var authError = EnforceScope(httpContext, "open:read");
        if (authError != null) return authError;

        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var query = context.Repositories.AsNoTracking().Where(r => !r.IsDeleted);

        if (!string.IsNullOrWhiteSpace(org))
        {
            var normalizedOrg = org.Trim().ToLowerInvariant();
            query = query.Where(r => r.OrgName.ToLower() == normalizedOrg);
        }

        if (!string.IsNullOrWhiteSpace(language))
        {
            query = query.Where(r => r.PrimaryLanguage == language);
        }

        if (status.HasValue)
        {
            query = query.Where(r => r.Status == status.Value);
        }

        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var kw = keyword.Trim().ToLowerInvariant();
            query = query.Where(r =>
                r.OrgName.ToLower().Contains(kw) ||
                r.RepoName.ToLower().Contains(kw) ||
                (r.Description != null && r.Description.ToLower().Contains(kw)));
        }

        var total = await query.CountAsync(cancellationToken);
        var repos = await query
            .OrderByDescending(r => r.UpdatedAt ?? r.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var repoIds = repos.Select(r => r.Id).ToArray();
        var branches = await context.RepositoryBranches
            .AsNoTracking()
            .Where(b => repoIds.Contains(b.RepositoryId) && !b.IsDeleted)
            .ToListAsync(cancellationToken);

        var branchIds = branches.Select(b => b.Id).ToArray();
        var branchLanguages = await context.BranchLanguages
            .AsNoTracking()
            .Where(bl => branchIds.Contains(bl.RepositoryBranchId) && !bl.IsDeleted)
            .ToListAsync(cancellationToken);

        var items = repos.Select(r =>
        {
            var repoBranches = branches.Where(b => b.RepositoryId == r.Id).ToList();
            var repoBranchIds = repoBranches.Select(b => b.Id).ToHashSet();
            var repoLangs = branchLanguages
                .Where(bl => repoBranchIds.Contains(bl.RepositoryBranchId))
                .Select(bl => bl.LanguageCode)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            return new
            {
                id = r.Id,
                orgName = r.OrgName,
                repoName = r.RepoName,
                fullName = $"{r.OrgName}/{r.RepoName}",
                description = r.Description,
                sourceType = r.SourceType.ToString(),
                gitUrl = r.SourceLocation,
                primaryLanguage = r.PrimaryLanguage,
                status = r.Status.ToString(),
                isPublic = r.IsPublic,
                branches = repoBranches.Select(b => new
                {
                    id = b.Id,
                    name = b.BranchName,
                    lastCommitId = b.LastCommitId,
                    lastProcessedAt = b.LastProcessedAt
                }),
                languages = repoLangs,
                mcpEndpoint = $"/api/mcp/{Uri.EscapeDataString(r.OrgName)}/{Uri.EscapeDataString(r.RepoName)}",
                createdAt = r.CreatedAt,
                updatedAt = r.UpdatedAt
            };
        });

        return Results.Ok(new
        {
            success = true,
            data = new
            {
                total,
                page,
                pageSize,
                items
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> GetRepositoryByIdAsync(
        string id,
        HttpContext httpContext,
        [FromServices] IContext context,
        CancellationToken cancellationToken)
    {
        var authError = EnforceScope(httpContext, "open:read");
        if (authError != null) return authError;

        var repository = await context.Repositories
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id && !r.IsDeleted, cancellationToken);

        if (repository == null)
        {
            return Results.NotFound(new
            {
                success = false,
                errorCode = "REPOSITORY_NOT_FOUND",
                message = $"未找到 ID 为 '{id}' 的仓库",
                timestamp = DateTime.UtcNow
            });
        }

        return await BuildRepositoryDetailResultAsync(repository, context, cancellationToken);
    }

    private static async Task<IResult> GetRepositoryByOwnerRepoAsync(
        string owner,
        string repo,
        HttpContext httpContext,
        [FromServices] IContext context,
        CancellationToken cancellationToken)
    {
        var authError = EnforceScope(httpContext, "open:read");
        if (authError != null) return authError;

        var decodedOwner = Uri.UnescapeDataString(owner);
        var decodedRepo = Uri.UnescapeDataString(repo);

        var repository = await context.Repositories
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.OrgName == decodedOwner && r.RepoName == decodedRepo && !r.IsDeleted, cancellationToken);

        if (repository == null)
        {
            return Results.NotFound(new
            {
                success = false,
                errorCode = "REPOSITORY_NOT_FOUND",
                message = $"未找到仓库 '{decodedOwner}/{decodedRepo}'",
                timestamp = DateTime.UtcNow
            });
        }

        return await BuildRepositoryDetailResultAsync(repository, context, cancellationToken);
    }

    private static async Task<IResult> BuildRepositoryDetailResultAsync(
        Repository repository,
        IContext context,
        CancellationToken cancellationToken)
    {
        var branches = await context.RepositoryBranches
            .AsNoTracking()
            .Where(b => b.RepositoryId == repository.Id && !b.IsDeleted)
            .OrderBy(b => b.CreatedAt)
            .ToListAsync(cancellationToken);

        var branchIds = branches.Select(b => b.Id).ToArray();
        var languages = await context.BranchLanguages
            .AsNoTracking()
            .Where(bl => branchIds.Contains(bl.RepositoryBranchId) && !bl.IsDeleted)
            .ToListAsync(cancellationToken);

        var languageIds = languages.Select(l => l.Id).ToArray();
        var docCounts = await context.DocCatalogs
            .AsNoTracking()
            .Where(c => languageIds.Contains(c.BranchLanguageId) && !c.IsDeleted && !string.IsNullOrEmpty(c.DocFileId))
            .GroupBy(c => c.BranchLanguageId)
            .Select(g => new { BranchLanguageId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.BranchLanguageId, x => x.Count, cancellationToken);

        var graphArtifacts = await context.GraphifyArtifacts
            .AsNoTracking()
            .Where(g => g.RepositoryId == repository.Id && !g.IsDeleted)
            .ToListAsync(cancellationToken);

        return Results.Ok(new
        {
            success = true,
            data = new
            {
                id = repository.Id,
                orgName = repository.OrgName,
                repoName = repository.RepoName,
                fullName = $"{repository.OrgName}/{repository.RepoName}",
                description = repository.Description,
                sourceType = repository.SourceType.ToString(),
                gitUrl = repository.SourceLocation,
                primaryLanguage = repository.PrimaryLanguage,
                status = repository.Status.ToString(),
                isPublic = repository.IsPublic,
                generateSkill = repository.GenerateSkill,
                createdAt = repository.CreatedAt,
                updatedAt = repository.UpdatedAt,
                lastUpdateCheckAt = repository.LastUpdateCheckAt,
                mcpEndpoint = $"/api/mcp/{Uri.EscapeDataString(repository.OrgName)}/{Uri.EscapeDataString(repository.RepoName)}",
                branches = branches.Select(b =>
                {
                    var bLangs = languages.Where(l => l.RepositoryBranchId == b.Id).ToList();
                    var graph = graphArtifacts
                        .Where(g => g.RepositoryBranchId == b.Id)
                        .OrderByDescending(g => g.CreatedAt)
                        .FirstOrDefault();

                    return new
                    {
                        id = b.Id,
                        branchName = b.BranchName,
                        lastCommitId = b.LastCommitId,
                        lastProcessedAt = b.LastProcessedAt,
                        generationStatus = b.GenerationStatus?.ToString(),
                        graphifyStatus = graph?.Status.ToString(),
                        languages = bLangs.Select(l => new
                        {
                            id = l.Id,
                            languageCode = l.LanguageCode,
                            isDefault = l.IsDefault,
                            mindMapStatus = l.MindMapStatus.ToString(),
                            hasSkillMarkdown = !string.IsNullOrWhiteSpace(l.SkillMarkdown),
                            documentCount = docCounts.GetValueOrDefault(l.Id, 0),
                            updateSummary = l.UpdateSummary
                        })
                    };
                })
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> GetRepositoryCatalogAsync(
        string id,
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromQuery] string? branch = null,
        [FromQuery] string? language = null,
        CancellationToken cancellationToken = default)
    {
        var authError = EnforceScope(httpContext, "open:read");
        if (authError != null) return authError;

        var resolved = await ResolveBranchAndLanguageAsync(context, id, branch, language, cancellationToken);
        if (resolved.ErrorResult != null) return resolved.ErrorResult;

        var catalogs = await context.DocCatalogs
            .AsNoTracking()
            .Where(c => c.BranchLanguageId == resolved.BranchLanguage!.Id && !c.IsDeleted)
            .OrderBy(c => c.Order)
            .ToListAsync(cancellationToken);

        var lookup = catalogs.ToLookup(c => c.ParentId);
        List<WikiCatalogItemResponse> BuildTree(string? parentId)
        {
            return lookup[parentId]
                .OrderBy(c => c.Order)
                .Select(c =>
                {
                    var children = BuildTree(c.Id);
                    return new WikiCatalogItemResponse
                    {
                        Title = c.Title,
                        Path = c.Path,
                        Order = c.Order,
                        HasContent = children.Count == 0 && !string.IsNullOrEmpty(c.DocFileId),
                        Children = children
                    };
                })
                .ToList();
        }

        var tree = BuildTree(null);
        return Results.Ok(new
        {
            success = true,
            data = new
            {
                repositoryId = resolved.Repository!.Id,
                fullName = $"{resolved.Repository.OrgName}/{resolved.Repository.RepoName}",
                branch = resolved.Branch!.BranchName,
                language = resolved.BranchLanguage!.LanguageCode,
                totalNodes = catalogs.Count,
                items = tree
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> GetRepositoryDocsAsync(
        string id,
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromQuery] string? path = null,
        [FromQuery] string? branch = null,
        [FromQuery] string? language = null,
        [FromQuery] bool all = false,
        CancellationToken cancellationToken = default)
    {
        var authError = EnforceScope(httpContext, "open:read");
        if (authError != null) return authError;

        var resolved = await ResolveBranchAndLanguageAsync(context, id, branch, language, cancellationToken);
        if (resolved.ErrorResult != null) return resolved.ErrorResult;

        if (!string.IsNullOrWhiteSpace(path) && !all)
        {
            var normalizedPath = path.Trim().Trim('/');
            var catalog = await context.DocCatalogs
                .AsNoTracking()
                .FirstOrDefaultAsync(c =>
                    c.BranchLanguageId == resolved.BranchLanguage!.Id &&
                    c.Path == normalizedPath &&
                    !c.IsDeleted,
                    cancellationToken);

            if (catalog == null || string.IsNullOrEmpty(catalog.DocFileId))
            {
                return Results.NotFound(new
                {
                    success = false,
                    errorCode = "DOCUMENT_NOT_FOUND",
                    message = $"未找到路径为 '{normalizedPath}' 的文档",
                    timestamp = DateTime.UtcNow
                });
            }

            var docFile = await context.DocFiles
                .AsNoTracking()
                .FirstOrDefaultAsync(d => d.Id == catalog.DocFileId && !d.IsDeleted, cancellationToken);

            if (docFile == null)
            {
                return Results.NotFound(new
                {
                    success = false,
                    errorCode = "DOCUMENT_CONTENT_MISSING",
                    message = $"文档 '{normalizedPath}' 的正文不存在",
                    timestamp = DateTime.UtcNow
                });
            }

            return Results.Ok(new
            {
                success = true,
                data = new
                {
                    repositoryId = resolved.Repository!.Id,
                    fullName = $"{resolved.Repository.OrgName}/{resolved.Repository.RepoName}",
                    branch = resolved.Branch!.BranchName,
                    language = resolved.BranchLanguage!.LanguageCode,
                    title = catalog.Title,
                    path = catalog.Path,
                    content = docFile.Content,
                    sourceFiles = ParseSourceFiles(docFile.SourceFiles),
                    updatedAt = docFile.UpdatedAt ?? docFile.CreatedAt
                },
                timestamp = DateTime.UtcNow
            });
        }

        // Batch export all documents in this branch/language (for external Agent RAG indexing)
        var allDocs = await context.DocCatalogs
            .AsNoTracking()
            .Where(c => c.BranchLanguageId == resolved.BranchLanguage!.Id && !c.IsDeleted && !string.IsNullOrEmpty(c.DocFileId))
            .OrderBy(c => c.Order)
            .Join(
                context.DocFiles.AsNoTracking().Where(d => !d.IsDeleted),
                c => c.DocFileId,
                d => d.Id,
                (c, d) => new
                {
                    title = c.Title,
                    path = c.Path,
                    order = c.Order,
                    content = d.Content,
                    sourceFiles = d.SourceFiles,
                    updatedAt = d.UpdatedAt ?? d.CreatedAt
                })
            .ToListAsync(cancellationToken);

        return Results.Ok(new
        {
            success = true,
            data = new
            {
                repositoryId = resolved.Repository!.Id,
                fullName = $"{resolved.Repository.OrgName}/{resolved.Repository.RepoName}",
                branch = resolved.Branch!.BranchName,
                language = resolved.BranchLanguage!.LanguageCode,
                documentCount = allDocs.Count,
                documents = allDocs.Select(d => new
                {
                    d.title,
                    d.path,
                    d.order,
                    d.content,
                    sourceFiles = ParseSourceFiles(d.sourceFiles),
                    d.updatedAt
                })
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> GetRepositoryMindMapAsync(
        string id,
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromQuery] string? branch = null,
        [FromQuery] string? language = null,
        CancellationToken cancellationToken = default)
    {
        var authError = EnforceScope(httpContext, "open:read");
        if (authError != null) return authError;

        var resolved = await ResolveBranchAndLanguageAsync(context, id, branch, language, cancellationToken);
        if (resolved.ErrorResult != null) return resolved.ErrorResult;

        return Results.Ok(new
        {
            success = true,
            data = new
            {
                repositoryId = resolved.Repository!.Id,
                fullName = $"{resolved.Repository.OrgName}/{resolved.Repository.RepoName}",
                branch = resolved.Branch!.BranchName,
                language = resolved.BranchLanguage!.LanguageCode,
                mindMapStatus = resolved.BranchLanguage.MindMapStatus.ToString(),
                mindMapContent = resolved.BranchLanguage.MindMapContent,
                skillMarkdown = resolved.BranchLanguage.SkillMarkdown,
                skillGeneratedAt = resolved.BranchLanguage.SkillGeneratedAt
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> GetRepositoryGraphAsync(
        string id,
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromQuery] string? branch = null,
        CancellationToken cancellationToken = default)
    {
        var authError = EnforceScope(httpContext, "open:read");
        if (authError != null) return authError;

        var resolved = await ResolveBranchAndLanguageAsync(context, id, branch, null, cancellationToken);
        if (resolved.ErrorResult != null) return resolved.ErrorResult;

        var artifact = await context.GraphifyArtifacts
            .AsNoTracking()
            .Where(a => a.RepositoryId == resolved.Repository!.Id &&
                        a.RepositoryBranchId == resolved.Branch!.Id &&
                        !a.IsDeleted)
            .OrderByDescending(a => a.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (artifact == null)
        {
            return Results.Ok(new
            {
                success = true,
                data = new
                {
                    repositoryId = resolved.Repository!.Id,
                    fullName = $"{resolved.Repository.OrgName}/{resolved.Repository.RepoName}",
                    branch = resolved.Branch!.BranchName,
                    status = "NotGenerated",
                    graph = (object?)null,
                    report = (string?)null
                },
                timestamp = DateTime.UtcNow
            });
        }

        JsonElement? graphElement = null;
        if (!string.IsNullOrWhiteSpace(artifact.GraphJsonPath) && File.Exists(artifact.GraphJsonPath))
        {
            try
            {
                var rawGraph = await File.ReadAllTextAsync(artifact.GraphJsonPath, cancellationToken);
                using var doc = JsonDocument.Parse(rawGraph);
                graphElement = doc.RootElement.Clone();
            }
            catch
            {
                // Ignore corrupt graph file
            }
        }

        string? reportText = null;
        if (!string.IsNullOrWhiteSpace(artifact.ReportPath) && File.Exists(artifact.ReportPath))
        {
            try
            {
                reportText = await File.ReadAllTextAsync(artifact.ReportPath, cancellationToken);
            }
            catch
            {
                // Ignore unreadable report file
            }
        }

        return Results.Ok(new
        {
            success = true,
            data = new
            {
                repositoryId = resolved.Repository!.Id,
                fullName = $"{resolved.Repository.OrgName}/{resolved.Repository.RepoName}",
                branch = resolved.Branch!.BranchName,
                status = artifact.Status.ToString(),
                commitId = artifact.CommitId,
                completedAt = artifact.CompletedAt,
                graph = graphElement,
                report = reportText
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> SearchKnowledgeBaseAsync(
        [FromBody] OpenKnowledgeSearchRequest request,
        HttpContext httpContext,
        [FromServices] IContext context,
        CancellationToken cancellationToken)
    {
        var authError = EnforceScope(httpContext, "open:read");
        if (authError != null) return authError;

        if (string.IsNullOrWhiteSpace(request.Query))
        {
            return Results.BadRequest(new
            {
                success = false,
                errorCode = "INVALID_QUERY",
                message = "检索关键词 query 不能为空",
                timestamp = DateTime.UtcNow
            });
        }

        var queryText = request.Query.Trim();
        var maxResults = Math.Clamp(request.MaxResults ?? 10, 1, 50);
        var escapedQuery = queryText.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
        var pattern = $"%{escapedQuery}%";

        var repoQuery = context.Repositories.AsNoTracking().Where(r => !r.IsDeleted);
        if (!string.IsNullOrWhiteSpace(request.RepositoryId))
        {
            repoQuery = repoQuery.Where(r => r.Id == request.RepositoryId);
        }
        else if (request.RepositoryIds is { Length: > 0 })
        {
            var idSet = request.RepositoryIds.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).ToArray();
            repoQuery = repoQuery.Where(r => idSet.Contains(r.Id));
        }
        else if (!string.IsNullOrWhiteSpace(request.Group))
        {
            var grp = request.Group.Trim().ToLowerInvariant();
            repoQuery = repoQuery.Where(r => r.OrgName.ToLower() == grp);
        }
        else if (!string.IsNullOrWhiteSpace(request.Owner) && !string.IsNullOrWhiteSpace(request.Repo))
        {
            repoQuery = repoQuery.Where(r => r.OrgName == request.Owner && r.RepoName == request.Repo);
        }
        else if (!string.IsNullOrWhiteSpace(request.Owner))
        {
            var grp = request.Owner.Trim().ToLowerInvariant();
            repoQuery = repoQuery.Where(r => r.OrgName.ToLower() == grp);
        }

        var matchingDocs = await (
            from r in repoQuery
            join b in context.RepositoryBranches.AsNoTracking().Where(x => !x.IsDeleted)
                on r.Id equals b.RepositoryId
            join bl in context.BranchLanguages.AsNoTracking().Where(x => !x.IsDeleted)
                on b.Id equals bl.RepositoryBranchId
            join c in context.DocCatalogs.AsNoTracking().Where(x => !x.IsDeleted && !string.IsNullOrEmpty(x.DocFileId))
                on bl.Id equals c.BranchLanguageId
            join d in context.DocFiles.AsNoTracking().Where(x => !x.IsDeleted)
                on c.DocFileId equals d.Id
            where (string.IsNullOrEmpty(request.Branch) || b.BranchName == request.Branch)
               && (string.IsNullOrEmpty(request.Language) || bl.LanguageCode == request.Language)
               && (EF.Functions.Like(c.Title, pattern) || EF.Functions.Like(c.Path, pattern) || EF.Functions.Like(d.Content, pattern))
            select new
            {
                RepositoryId = r.Id,
                r.OrgName,
                r.RepoName,
                b.BranchName,
                bl.LanguageCode,
                c.Title,
                c.Path,
                d.Content
            })
            .Take(maxResults)
            .ToListAsync(cancellationToken);

        var hits = matchingDocs.Select(doc =>
        {
            var (matchLine, snippet) = ExtractSnippet(doc.Content, queryText);
            return new
            {
                repositoryId = doc.RepositoryId,
                owner = doc.OrgName,
                repo = doc.RepoName,
                fullName = $"{doc.OrgName}/{doc.RepoName}",
                branch = doc.BranchName,
                language = doc.LanguageCode,
                title = doc.Title,
                path = doc.Path,
                matchLine,
                snippet,
                content = request.IncludeContent == true ? doc.Content : null
            };
        }).ToList();

        return Results.Ok(new
        {
            success = true,
            data = new
            {
                query = queryText,
                totalHits = hits.Count,
                results = hits
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> AskKnowledgeBaseAsync(
        [FromBody] OpenAskRequest request,
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromServices] AgentFactory agentFactory,
        [FromServices] IAiProviderResolver aiProviderResolver,
        [FromServices] IOptions<RepositoryAnalyzerOptions> repoOptions,
        CancellationToken cancellationToken)
    {
        var authError = EnforceScope(httpContext, "open:chat");
        if (authError != null) return authError;

        if (string.IsNullOrWhiteSpace(request.Query))
        {
            return Results.BadRequest(new
            {
                success = false,
                errorCode = "INVALID_QUERY",
                message = "提问内容 query 不能为空",
                timestamp = DateTime.UtcNow
            });
        }

        var stopwatch = Stopwatch.StartNew();
        var queryText = request.Query.Trim();
        var maxSources = Math.Clamp(request.MaxSources ?? 5, 1, 15);

        Repository? targetRepo = null;
        var targetGroupRepos = new List<Repository>();
        if (!string.IsNullOrWhiteSpace(request.RepositoryId))
        {
            targetRepo = await context.Repositories
                .AsNoTracking()
                .FirstOrDefaultAsync(r => r.Id == request.RepositoryId && !r.IsDeleted, cancellationToken);
            if (targetRepo != null) targetGroupRepos.Add(targetRepo);
        }
        else if (request.RepositoryIds is { Length: > 0 })
        {
            var idSet = request.RepositoryIds.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).ToArray();
            targetGroupRepos = await context.Repositories
                .AsNoTracking()
                .Where(r => idSet.Contains(r.Id) && !r.IsDeleted)
                .ToListAsync(cancellationToken);
            if (targetGroupRepos.Count == 1) targetRepo = targetGroupRepos[0];
        }
        else if (!string.IsNullOrWhiteSpace(request.Group))
        {
            var grp = request.Group.Trim().ToLowerInvariant();
            targetGroupRepos = await context.Repositories
                .AsNoTracking()
                .Where(r => r.OrgName.ToLower() == grp && !r.IsDeleted)
                .ToListAsync(cancellationToken);
            if (targetGroupRepos.Count == 1) targetRepo = targetGroupRepos[0];
        }
        else if (!string.IsNullOrWhiteSpace(request.Owner) && !string.IsNullOrWhiteSpace(request.Repo))
        {
            targetRepo = await context.Repositories
                .AsNoTracking()
                .FirstOrDefaultAsync(r => r.OrgName == request.Owner && r.RepoName == request.Repo && !r.IsDeleted, cancellationToken);
            if (targetRepo != null) targetGroupRepos.Add(targetRepo);
        }
        else if (!string.IsNullOrWhiteSpace(request.Owner))
        {
            var grp = request.Owner.Trim().ToLowerInvariant();
            targetGroupRepos = await context.Repositories
                .AsNoTracking()
                .Where(r => r.OrgName.ToLower() == grp && !r.IsDeleted)
                .ToListAsync(cancellationToken);
            if (targetGroupRepos.Count == 1) targetRepo = targetGroupRepos[0];
        }

        var targetRepoIds = targetGroupRepos.Select(r => r.Id).ToArray();
        var hasScopeFilter = targetRepoIds.Length > 0;

        var escapedQuery = queryText.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
        var pattern = $"%{escapedQuery}%";

        var baseQuery =
            from r in context.Repositories.AsNoTracking().Where(x => !x.IsDeleted)
            join b in context.RepositoryBranches.AsNoTracking().Where(x => !x.IsDeleted)
                on r.Id equals b.RepositoryId
            join bl in context.BranchLanguages.AsNoTracking().Where(x => !x.IsDeleted)
                on b.Id equals bl.RepositoryBranchId
            join c in context.DocCatalogs.AsNoTracking().Where(x => !x.IsDeleted && !string.IsNullOrEmpty(x.DocFileId))
                on bl.Id equals c.BranchLanguageId
            join d in context.DocFiles.AsNoTracking().Where(x => !x.IsDeleted)
                on c.DocFileId equals d.Id
            where (!hasScopeFilter || targetRepoIds.Contains(r.Id))
               && (string.IsNullOrEmpty(request.Branch) || b.BranchName == request.Branch)
               && (string.IsNullOrEmpty(request.Language) || bl.LanguageCode == request.Language)
            select new
            {
                RepositoryId = r.Id,
                r.OrgName,
                r.RepoName,
                b.BranchName,
                bl.LanguageCode,
                c.Title,
                c.Path,
                c.Order,
                d.Content
            };

        var matchedDocs = await baseQuery
            .Where(x => EF.Functions.Like(x.Title, pattern) || EF.Functions.Like(x.Content, pattern))
            .Take(maxSources)
            .ToListAsync(cancellationToken);

        // Fallback: if keyword didn't directly match via LIKE, load top overview docs from each target repository in the group
        if (matchedDocs.Count == 0 && hasScopeFilter)
        {
            matchedDocs = await baseQuery
                .OrderBy(x => x.Order)
                .Take(Math.Min(Math.Max(3, targetRepoIds.Length * 2), maxSources))
                .ToListAsync(cancellationToken);
        }

        var citations = matchedDocs.Select(doc =>
        {
            var (matchLine, snippet) = ExtractSnippet(doc.Content, queryText);
            return new
            {
                repositoryId = doc.RepositoryId,
                fullName = $"{doc.OrgName}/{doc.RepoName}",
                branch = doc.BranchName,
                language = doc.LanguageCode,
                title = doc.Title,
                path = doc.Path,
                matchLine,
                snippet
            };
        }).ToList();

        // Resolve active AI ModelConfig
        ModelConfig? modelConfig = null;
        if (!string.IsNullOrWhiteSpace(request.ModelId))
        {
            modelConfig = await context.ModelConfigs
                .AsNoTracking()
                .FirstOrDefaultAsync(m => (m.Id == request.ModelId || m.ModelId == request.ModelId) && m.IsActive && !m.IsDeleted, cancellationToken);
        }

        modelConfig ??= await context.ModelConfigs
            .AsNoTracking()
            .Where(m => m.IsActive && !m.IsDeleted)
            .OrderByDescending(m => m.IsDefault)
            .ThenByDescending(m => m.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (modelConfig == null)
        {
            stopwatch.Stop();
            return Results.Ok(new
            {
                success = true,
                data = new
                {
                    query = queryText,
                    answer = matchedDocs.Count > 0
                        ? $"系统暂未配置活动的 AI 对话模型，已为您检索到 {matchedDocs.Count} 篇相关知识库文档：\n\n" +
                          string.Join("\n\n", citations.Select(c => $"### {c.title} (`{c.path}`)\n{c.snippet}"))
                        : "系统暂未配置活动的 AI 对话模型，且未找到匹配的文档。",
                    model = (string?)null,
                    repository = targetRepo != null ? $"{targetRepo.OrgName}/{targetRepo.RepoName}" : null,
                    citations,
                    durationMs = stopwatch.ElapsedMilliseconds
                },
                timestamp = DateTime.UtcNow
            });
        }

        try
        {
            var resolvedModel = await aiProviderResolver.ResolveModelConfigAsync(modelConfig, cancellationToken);
            var requestOptions = resolvedModel.ToRequestOptions();

            var tools = new List<AITool>();
            if (targetRepo != null)
            {
                var branchName = request.Branch ?? matchedDocs.FirstOrDefault()?.BranchName ?? "main";
                var repoPath = RepositoryWorkspacePath.Resolve(repoOptions.Value, targetRepo.OrgName, targetRepo.RepoName, branchName);
                if (Directory.Exists(repoPath))
                {
                    try
                    {
                        var gitTool = new GitTool(repoPath);
                        tools.AddRange(gitTool.GetTools());
                    }
                    catch
                    {
                        // Ignore GitTool initialization errors
                    }
                }
            }

            using var aiScope = AiExecutionScope.Begin(new AiExecutionContext
            {
                BusinessTag = "open_api_ask",
                Description = "开放平台 Agent 知识库问答",
                Repository = targetRepo != null ? $"{targetRepo.OrgName}/{targetRepo.RepoName}" : "global",
                ModelId = resolvedModel.ModelId
            });

            var agentOptions = new ChatClientAgentOptions
            {
                ChatOptions = new ChatOptions
                {
                    MaxOutputTokens = 8000,
                    ToolMode = ChatToolMode.Auto
                }
            };

            var (agent, _) = agentFactory.CreateChatClientWithTools(
                resolvedModel.ModelId,
                tools.Count == 0 ? Array.Empty<AITool>() : tools.ToArray(),
                agentOptions,
                requestOptions);

            var promptBuilder = new StringBuilder();
            if (targetGroupRepos.Count > 1)
            {
                promptBuilder.AppendLine($"Target System Group: {request.Group ?? targetGroupRepos[0].OrgName}");
                promptBuilder.AppendLine("Sub-Repositories in this System Group:");
                foreach (var subRepo in targetGroupRepos)
                {
                    promptBuilder.AppendLine($"- {subRepo.OrgName}/{subRepo.RepoName} ({subRepo.Description ?? subRepo.PrimaryLanguage ?? "Sub-Repo"})");
                }
            }
            else if (targetRepo != null)
            {
                promptBuilder.AppendLine($"Target Repository: {targetRepo.OrgName}/{targetRepo.RepoName}");
            }
            promptBuilder.AppendLine($"Question: {queryText}");
            promptBuilder.AppendLine();
            promptBuilder.AppendLine("=== KNOWLEDGE BASE CONTEXT ===");
            foreach (var doc in matchedDocs)
            {
                var truncatedContent = doc.Content.Length > 3000 ? doc.Content[..3000] + "\n...[truncated]" : doc.Content;
                promptBuilder.AppendLine($"### Document: {doc.Title} (Repo: {doc.OrgName}/{doc.RepoName}, Path: {doc.Path})");
                promptBuilder.AppendLine(truncatedContent);
                promptBuilder.AppendLine();
            }

            var systemPrompt = string.IsNullOrWhiteSpace(request.SystemPrompt)
                ? "你是企业研发代码知识库的智能技术专家。请基于提供的知识库文档上下文与代码工具，准确、清晰、结构化地回答问题，并在回答中引用相关的文档路径或代码文件。"
                : request.SystemPrompt!;

            var messages = new List<ChatMessage>
            {
                new(ChatRole.System, systemPrompt),
                new(ChatRole.User, promptBuilder.ToString())
            };

            var session = await agent.CreateSessionAsync(cancellationToken);
            var answerBuilder = new StringBuilder();
            await foreach (var update in agent.RunStreamingAsync(messages, session, cancellationToken: cancellationToken))
            {
                if (!string.IsNullOrEmpty(update.Text))
                {
                    answerBuilder.Append(update.Text);
                }
            }

            stopwatch.Stop();
            return Results.Ok(new
            {
                success = true,
                data = new
                {
                    query = queryText,
                    answer = answerBuilder.ToString().Trim(),
                    model = resolvedModel.ModelId,
                    repository = targetRepo != null ? $"{targetRepo.OrgName}/{targetRepo.RepoName}" : null,
                    citations,
                    durationMs = stopwatch.ElapsedMilliseconds
                },
                timestamp = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            return Results.Ok(new
            {
                success = true,
                data = new
                {
                    query = queryText,
                    answer = matchedDocs.Count > 0
                        ? $"AI 模型调用发生异常（{ex.Message}），已为您返回检索到的知识库文档片段：\n\n" +
                          string.Join("\n\n", citations.Select(c => $"### {c.title} (`{c.path}`)\n{c.snippet}"))
                        : $"AI 模型调用发生异常：{ex.Message}",
                    model = modelConfig.ModelId,
                    repository = targetRepo != null ? $"{targetRepo.OrgName}/{targetRepo.RepoName}" : null,
                    citations,
                    durationMs = stopwatch.ElapsedMilliseconds
                },
                timestamp = DateTime.UtcNow
            });
        }
    }

    private static async Task<IResult> SubmitRepositoryAsync(
        [FromBody] OpenRepositorySubmitRequest request,
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromServices] IUserContext userContext,
        CancellationToken cancellationToken)
    {
        var authError = EnforceScope(httpContext, "open:write");
        if (authError != null) return authError;

        if (string.IsNullOrWhiteSpace(request.GitUrl))
        {
            return Results.BadRequest(new
            {
                success = false,
                errorCode = "GIT_URL_REQUIRED",
                message = "gitUrl 不能为空",
                timestamp = DateTime.UtcNow
            });
        }

        var gitUrl = request.GitUrl.Trim();
        var (parsedOrg, parsedRepo) = TryParseOrgAndRepo(gitUrl);
        var orgName = !string.IsNullOrWhiteSpace(request.OrgName) ? request.OrgName.Trim() : parsedOrg;
        var repoName = !string.IsNullOrWhiteSpace(request.RepoName) ? request.RepoName.Trim() : parsedRepo;

        if (string.IsNullOrWhiteSpace(orgName) || string.IsNullOrWhiteSpace(repoName))
        {
            return Results.BadRequest(new
            {
                success = false,
                errorCode = "INVALID_REPO_IDENTITY",
                message = "无法从 gitUrl 自动解析 orgName 与 repoName，请显式传入",
                timestamp = DateTime.UtcNow
            });
        }

        var branchName = string.IsNullOrWhiteSpace(request.BranchName) ? "main" : request.BranchName.Trim();
        var languageCode = string.IsNullOrWhiteSpace(request.LanguageCode) ? "zh" : request.LanguageCode.Trim();
        var currentUserId = userContext.UserId ?? "system";

        var existingRepo = await context.Repositories
            .FirstOrDefaultAsync(r =>
                !r.IsDeleted &&
                ((r.OrgName == orgName && r.RepoName == repoName) || r.GitUrl == gitUrl),
                cancellationToken);

        if (existingRepo != null)
        {
            var existingBranch = await context.RepositoryBranches
                .FirstOrDefaultAsync(b => b.RepositoryId == existingRepo.Id && b.BranchName == branchName && !b.IsDeleted, cancellationToken);

            if (existingBranch != null)
            {
                return Results.Ok(new
                {
                    success = true,
                    data = new
                    {
                        repositoryId = existingRepo.Id,
                        branchId = existingBranch.Id,
                        orgName = existingRepo.OrgName,
                        repoName = existingRepo.RepoName,
                        branchName = existingBranch.BranchName,
                        status = existingRepo.Status.ToString(),
                        alreadyExists = true,
                        message = "该仓库与分支已在知识库中"
                    },
                    timestamp = DateTime.UtcNow
                });
            }

            var newBranch = new RepositoryBranch
            {
                Id = Guid.NewGuid().ToString(),
                RepositoryId = existingRepo.Id,
                BranchName = branchName
            };
            var newLang = new BranchLanguage
            {
                Id = Guid.NewGuid().ToString(),
                RepositoryBranchId = newBranch.Id,
                LanguageCode = languageCode,
                UpdateSummary = string.Empty,
                IsDefault = true
            };

            context.RepositoryBranches.Add(newBranch);
            context.BranchLanguages.Add(newLang);
            await context.SaveChangesAsync(cancellationToken);

            return Results.Created($"/api/v1/open/repositories/{existingRepo.Id}", new
            {
                success = true,
                data = new
                {
                    repositoryId = existingRepo.Id,
                    branchId = newBranch.Id,
                    orgName = existingRepo.OrgName,
                    repoName = existingRepo.RepoName,
                    branchName = newBranch.BranchName,
                    status = existingRepo.Status.ToString(),
                    alreadyExists = false,
                    message = "已为现有仓库新增分支并加入构建队列"
                },
                timestamp = DateTime.UtcNow
            });
        }

        var repository = new Repository
        {
            Id = Guid.NewGuid().ToString(),
            OwnerUserId = currentUserId,
            GitUrl = gitUrl,
            OrgName = orgName,
            RepoName = repoName,
            Description = request.Description,
            AuthAccount = request.AuthAccount,
            AuthPassword = request.AuthPassword,
            IsPublic = request.IsPublic ?? true,
            GenerateSkill = request.GenerateSkill ?? true,
            Status = RepositoryStatus.Pending
        };

        var branch = new RepositoryBranch
        {
            Id = Guid.NewGuid().ToString(),
            RepositoryId = repository.Id,
            BranchName = branchName
        };

        var language = new BranchLanguage
        {
            Id = Guid.NewGuid().ToString(),
            RepositoryBranchId = branch.Id,
            LanguageCode = languageCode,
            UpdateSummary = string.Empty,
            IsDefault = true
        };

        context.Repositories.Add(repository);
        context.RepositoryBranches.Add(branch);
        context.BranchLanguages.Add(language);
        await context.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/v1/open/repositories/{repository.Id}", new
        {
            success = true,
            data = new
            {
                repositoryId = repository.Id,
                branchId = branch.Id,
                orgName = repository.OrgName,
                repoName = repository.RepoName,
                branchName = branch.BranchName,
                status = repository.Status.ToString(),
                alreadyExists = false,
                message = "仓库已成功接入并进入 Wiki 自动生成队列"
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> GetRepositoryBuildStatusAsync(
        string id,
        HttpContext httpContext,
        [FromServices] IContext context,
        CancellationToken cancellationToken)
    {
        var authError = EnforceScope(httpContext, "open:read");
        if (authError != null) return authError;

        var repository = await context.Repositories
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id && !r.IsDeleted, cancellationToken);

        if (repository == null)
        {
            return Results.NotFound(new
            {
                success = false,
                errorCode = "REPOSITORY_NOT_FOUND",
                message = $"未找到 ID 为 '{id}' 的仓库",
                timestamp = DateTime.UtcNow
            });
        }

        var branches = await context.RepositoryBranches
            .AsNoTracking()
            .Where(b => b.RepositoryId == repository.Id && !b.IsDeleted)
            .ToListAsync(cancellationToken);

        var incrementalTasks = await context.IncrementalUpdateTasks
            .AsNoTracking()
            .Where(t => t.RepositoryId == repository.Id && !t.IsDeleted)
            .OrderByDescending(t => t.CreatedAt)
            .Take(5)
            .Select(t => new
            {
                t.Id,
                t.BranchId,
                status = t.Status.ToString(),
                t.PreviousCommitId,
                t.TargetCommitId,
                t.ErrorMessage,
                t.StartedAt,
                t.CompletedAt,
                t.CreatedAt
            })
            .ToListAsync(cancellationToken);

        var recentLogs = await context.RepositoryProcessingLogs
            .AsNoTracking()
            .Where(l => l.RepositoryId == repository.Id && !l.IsDeleted)
            .OrderByDescending(l => l.CreatedAt)
            .Take(20)
            .Select(l => new
            {
                step = l.Step.ToString(),
                l.Message,
                l.IsAiOutput,
                l.ToolName,
                l.CreatedAt
            })
            .ToListAsync(cancellationToken);

        return Results.Ok(new
        {
            success = true,
            data = new
            {
                repositoryId = repository.Id,
                fullName = $"{repository.OrgName}/{repository.RepoName}",
                status = repository.Status.ToString(),
                updatedAt = repository.UpdatedAt,
                branches = branches.Select(b => new
                {
                    b.Id,
                    b.BranchName,
                    b.LastCommitId,
                    b.LastProcessedAt,
                    generationStatus = b.GenerationStatus?.ToString(),
                    b.LastGenerationError
                }),
                recentIncrementalTasks = incrementalTasks,
                recentLogs
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> TriggerRepositorySyncAsync(
        string id,
        [FromBody] OpenRepositorySyncRequest? request,
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromServices] IIncrementalUpdateService incrementalUpdateService,
        [FromServices] IBranchGenerationTaskService branchGenerationTaskService,
        CancellationToken cancellationToken)
    {
        var authError = EnforceScope(httpContext, "open:write");
        if (authError != null) return authError;

        var repository = await context.Repositories
            .FirstOrDefaultAsync(r => r.Id == id && !r.IsDeleted, cancellationToken);

        if (repository == null)
        {
            return Results.NotFound(new
            {
                success = false,
                errorCode = "REPOSITORY_NOT_FOUND",
                message = $"未找到 ID 为 '{id}' 的仓库",
                timestamp = DateTime.UtcNow
            });
        }

        var branches = await context.RepositoryBranches
            .AsNoTracking()
            .Where(b => b.RepositoryId == repository.Id && !b.IsDeleted)
            .ToListAsync(cancellationToken);

        if (branches.Count == 0)
        {
            return Results.BadRequest(new
            {
                success = false,
                errorCode = "BRANCH_NOT_FOUND",
                message = "该仓库下没有可用的分支",
                timestamp = DateTime.UtcNow
            });
        }

        var targetBranch = !string.IsNullOrWhiteSpace(request?.BranchName)
            ? branches.FirstOrDefault(b => string.Equals(b.BranchName, request.BranchName.Trim(), StringComparison.OrdinalIgnoreCase))
            : branches.FirstOrDefault(b => string.Equals(b.BranchName, "main", StringComparison.OrdinalIgnoreCase))
              ?? branches.FirstOrDefault(b => string.Equals(b.BranchName, "master", StringComparison.OrdinalIgnoreCase))
              ?? branches.First();

        if (targetBranch == null)
        {
            return Results.NotFound(new
            {
                success = false,
                errorCode = "BRANCH_NOT_FOUND",
                message = $"未找到分支 '{request?.BranchName}'",
                timestamp = DateTime.UtcNow
            });
        }

        var mode = request?.Mode?.Trim().ToLowerInvariant() ?? "incremental";
        if (mode == "full")
        {
            var result = await branchGenerationTaskService.EnqueueFullGenerationAsync(
                repository.Id,
                targetBranch.Id,
                cancellationToken: cancellationToken);

            return Results.Ok(new
            {
                success = result.Success,
                data = new
                {
                    mode = "full",
                    repositoryId = repository.Id,
                    branchId = targetBranch.Id,
                    branchName = targetBranch.BranchName,
                    taskId = result.Task?.Id,
                    status = result.Task?.Status.ToString() ?? result.ErrorCode
                },
                message = result.ErrorMessage ?? "全量重新生成任务已入队",
                timestamp = DateTime.UtcNow
            });
        }

        var taskId = await incrementalUpdateService.TriggerManualUpdateAsync(
            repository.Id,
            targetBranch.Id,
            cancellationToken);

        return Results.Ok(new
        {
            success = true,
            data = new
            {
                mode = "incremental",
                repositoryId = repository.Id,
                branchId = targetBranch.Id,
                branchName = targetBranch.BranchName,
                taskId,
                status = "Pending"
            },
            message = "增量同步任务已创建",
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<IResult> HandleGitWebhookAsync(
        HttpContext httpContext,
        [FromServices] IContext context,
        [FromServices] IIncrementalUpdateService incrementalUpdateService,
        [FromServices] IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        // 支持 X-Gitlab-Token / X-Webhook-Token / X-API-Key / ?api_key= 校验
        var configuredSecret = configuration["Webhook:Secret"] ?? configuration["WEBHOOK_SECRET"];
        var gitlabToken = httpContext.Request.Headers["X-Gitlab-Token"].FirstOrDefault();
        var isAuthenticated = httpContext.User.Identity?.IsAuthenticated == true;

        if (!isAuthenticated && !string.IsNullOrWhiteSpace(gitlabToken))
        {
            if (!string.IsNullOrWhiteSpace(configuredSecret) &&
                string.Equals(gitlabToken, configuredSecret, StringComparison.Ordinal))
            {
                isAuthenticated = true;
            }
        }

        if (!isAuthenticated && !string.IsNullOrWhiteSpace(configuredSecret))
        {
            return Results.Json(new
            {
                success = false,
                errorCode = "WEBHOOK_UNAUTHORIZED",
                message = "Webhook 令牌校验失败"
            }, statusCode: StatusCodes.Status401Unauthorized);
        }

        using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body, cancellationToken: cancellationToken);
        var root = doc.RootElement;

        string? branchName = null;
        if (root.TryGetProperty("ref", out var refProp) && refProp.ValueKind == JsonValueKind.String)
        {
            var refStr = refProp.GetString();
            if (!string.IsNullOrWhiteSpace(refStr))
            {
                branchName = refStr.StartsWith("refs/heads/", StringComparison.OrdinalIgnoreCase)
                    ? refStr["refs/heads/".Length..]
                    : refStr;
            }
        }

        var candidateUrls = new List<string>();
        string? pathWithNamespace = null;

        // GitLab Push payload: project.git_http_url, project.http_url, project.path_with_namespace
        if (root.TryGetProperty("project", out var projectEl) && projectEl.ValueKind == JsonValueKind.Object)
        {
            if (projectEl.TryGetProperty("git_http_url", out var u1) && u1.GetString() is { } s1) candidateUrls.Add(s1);
            if (projectEl.TryGetProperty("http_url", out var u2) && u2.GetString() is { } s2) candidateUrls.Add(s2);
            if (projectEl.TryGetProperty("git_ssh_url", out var u3) && u3.GetString() is { } s3) candidateUrls.Add(s3);
            if (projectEl.TryGetProperty("path_with_namespace", out var pwn) && pwn.GetString() is { } spwn) pathWithNamespace = spwn;
        }

        // GitHub / Gitee Push payload: repository.clone_url, repository.html_url, repository.full_name
        if (root.TryGetProperty("repository", out var repoEl) && repoEl.ValueKind == JsonValueKind.Object)
        {
            if (repoEl.TryGetProperty("clone_url", out var c1) && c1.GetString() is { } sc1) candidateUrls.Add(sc1);
            if (repoEl.TryGetProperty("git_http_url", out var c2) && c2.GetString() is { } sc2) candidateUrls.Add(sc2);
            if (repoEl.TryGetProperty("html_url", out var c3) && c3.GetString() is { } sc3) candidateUrls.Add(sc3);
            if (repoEl.TryGetProperty("full_name", out var fn) && fn.GetString() is { } sfn) pathWithNamespace ??= sfn;
        }

        Repository? matchedRepo = null;
        if (candidateUrls.Count > 0)
        {
            var normalizedUrls = candidateUrls
                .Select(u => u.Trim().TrimEnd('/'))
                .SelectMany(u => new[] { u, u.EndsWith(".git", StringComparison.OrdinalIgnoreCase) ? u[..^4] : u + ".git" })
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            matchedRepo = await context.Repositories
                .AsNoTracking()
                .FirstOrDefaultAsync(r => !r.IsDeleted && normalizedUrls.Contains(r.GitUrl), cancellationToken);
        }

        if (matchedRepo == null && !string.IsNullOrWhiteSpace(pathWithNamespace))
        {
            var parts = pathWithNamespace.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 2)
            {
                var owner = string.Join("/", parts[..^1]);
                var repo = parts[^1];
                matchedRepo = await context.Repositories
                    .AsNoTracking()
                    .FirstOrDefaultAsync(r => !r.IsDeleted && r.OrgName == owner && r.RepoName == repo, cancellationToken);
            }
        }

        if (matchedRepo == null)
        {
            return Results.NotFound(new
            {
                success = false,
                errorCode = "REPOSITORY_NOT_MATCHED",
                message = "未在知识库中找到与该 Webhook 负载匹配的仓库",
                pathWithNamespace,
                candidateUrls
            });
        }

        var branches = await context.RepositoryBranches
            .AsNoTracking()
            .Where(b => b.RepositoryId == matchedRepo.Id && !b.IsDeleted)
            .ToListAsync(cancellationToken);

        var matchedBranch = !string.IsNullOrWhiteSpace(branchName)
            ? branches.FirstOrDefault(b => string.Equals(b.BranchName, branchName, StringComparison.OrdinalIgnoreCase))
            : branches.FirstOrDefault();

        if (matchedBranch == null)
        {
            return Results.Ok(new
            {
                success = true,
                triggered = false,
                message = $"仓库 '{matchedRepo.OrgName}/{matchedRepo.RepoName}' 未跟踪分支 '{branchName}'，已忽略本次推送"
            });
        }

        var taskId = await incrementalUpdateService.TriggerManualUpdateAsync(
            matchedRepo.Id,
            matchedBranch.Id,
            cancellationToken);

        return Results.Ok(new
        {
            success = true,
            triggered = true,
            data = new
            {
                repositoryId = matchedRepo.Id,
                fullName = $"{matchedRepo.OrgName}/{matchedRepo.RepoName}",
                branchId = matchedBranch.Id,
                branchName = matchedBranch.BranchName,
                taskId
            },
            timestamp = DateTime.UtcNow
        });
    }

    private static async Task<(Repository? Repository, RepositoryBranch? Branch, BranchLanguage? BranchLanguage, IResult? ErrorResult)>
        ResolveBranchAndLanguageAsync(
            IContext context,
            string repositoryId,
            string? branchName,
            string? languageCode,
            CancellationToken cancellationToken)
    {
        var repository = await context.Repositories
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == repositoryId && !r.IsDeleted, cancellationToken);

        if (repository == null)
        {
            return (null, null, null, Results.NotFound(new
            {
                success = false,
                errorCode = "REPOSITORY_NOT_FOUND",
                message = $"未找到 ID 为 '{repositoryId}' 的仓库",
                timestamp = DateTime.UtcNow
            }));
        }

        var branches = await context.RepositoryBranches
            .AsNoTracking()
            .Where(b => b.RepositoryId == repository.Id && !b.IsDeleted)
            .OrderBy(b => b.CreatedAt)
            .ToListAsync(cancellationToken);

        if (branches.Count == 0)
        {
            return (repository, null, null, Results.NotFound(new
            {
                success = false,
                errorCode = "BRANCH_NOT_FOUND",
                message = "该仓库暂无分支数据",
                timestamp = DateTime.UtcNow
            }));
        }

        var branch = !string.IsNullOrWhiteSpace(branchName)
            ? branches.FirstOrDefault(b => string.Equals(b.BranchName, branchName.Trim(), StringComparison.OrdinalIgnoreCase))
            : branches.FirstOrDefault(b => string.Equals(b.BranchName, "main", StringComparison.OrdinalIgnoreCase))
              ?? branches.FirstOrDefault(b => string.Equals(b.BranchName, "master", StringComparison.OrdinalIgnoreCase))
              ?? branches.First();

        if (branch == null)
        {
            return (repository, null, null, Results.NotFound(new
            {
                success = false,
                errorCode = "BRANCH_NOT_FOUND",
                message = $"未找到分支 '{branchName}'",
                timestamp = DateTime.UtcNow
            }));
        }

        var languages = await context.BranchLanguages
            .AsNoTracking()
            .Where(l => l.RepositoryBranchId == branch.Id && !l.IsDeleted)
            .OrderByDescending(l => l.IsDefault)
            .ThenBy(l => l.CreatedAt)
            .ToListAsync(cancellationToken);

        if (languages.Count == 0)
        {
            return (repository, branch, null, Results.NotFound(new
            {
                success = false,
                errorCode = "LANGUAGE_NOT_FOUND",
                message = "该分支尚未生成任何语言的文档",
                timestamp = DateTime.UtcNow
            }));
        }

        var lang = !string.IsNullOrWhiteSpace(languageCode)
            ? languages.FirstOrDefault(l => string.Equals(l.LanguageCode, languageCode.Trim(), StringComparison.OrdinalIgnoreCase))
            : languages.FirstOrDefault(l => string.Equals(l.LanguageCode, "zh", StringComparison.OrdinalIgnoreCase))
              ?? languages.First();

        if (lang == null)
        {
            return (repository, branch, null, Results.NotFound(new
            {
                success = false,
                errorCode = "LANGUAGE_NOT_FOUND",
                message = $"未找到语言 '{languageCode}' 的文档",
                timestamp = DateTime.UtcNow
            }));
        }

        return (repository, branch, lang, null);
    }

    private static (int MatchLine, string Snippet) ExtractSnippet(string content, string query)
    {
        if (string.IsNullOrEmpty(content))
        {
            return (-1, string.Empty);
        }

        var lines = content.Split('\n');
        var matchLine = -1;
        for (var i = 0; i < lines.Length; i++)
        {
            if (lines[i].Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                matchLine = i + 1;
                break;
            }
        }

        var startLine = Math.Max(0, (matchLine > 0 ? matchLine - 1 : 0) - 2);
        var snippet = string.Join("\n", lines.Skip(startLine).Take(6)).Trim();
        if (snippet.Length > 500)
        {
            snippet = snippet[..500] + "...";
        }

        return (matchLine, snippet);
    }

    private static string[] ParseSourceFiles(string? rawSourceFiles)
    {
        if (string.IsNullOrWhiteSpace(rawSourceFiles))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(rawSourceFiles) ?? [];
        }
        catch
        {
            return rawSourceFiles.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        }
    }

    private static (string? OrgName, string? RepoName) TryParseOrgAndRepo(string gitUrl)
    {
        try
        {
            var trimmed = gitUrl.Trim().TrimEnd('/');
            if (trimmed.StartsWith("git@", StringComparison.OrdinalIgnoreCase))
            {
                var colonIdx = trimmed.IndexOf(':');
                if (colonIdx > 0 && colonIdx < trimmed.Length - 1)
                {
                    var pathPart = trimmed[(colonIdx + 1)..].Trim('/');
                    var segs = pathPart.Split('/', StringSplitOptions.RemoveEmptyEntries);
                    if (segs.Length >= 2)
                    {
                        return (string.Join("/", segs[..^1]), segs[^1].Replace(".git", "", StringComparison.OrdinalIgnoreCase));
                    }
                }
            }

            if (Uri.TryCreate(trimmed, UriKind.Absolute, out var uri))
            {
                var segs = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
                if (segs.Length >= 2)
                {
                    return (string.Join("/", segs[..^1]), segs[^1].Replace(".git", "", StringComparison.OrdinalIgnoreCase));
                }
            }
        }
        catch
        {
            // Ignore parse errors
        }

        return (null, null);
    }
}

public sealed class OpenKnowledgeSearchRequest
{
    public required string Query { get; set; }
    public string? Group { get; set; }
    public string? RepositoryId { get; set; }
    public string[]? RepositoryIds { get; set; }
    public string? Owner { get; set; }
    public string? Repo { get; set; }
    public string? Branch { get; set; }
    public string? Language { get; set; }
    public int? MaxResults { get; set; }
    public bool? IncludeContent { get; set; }
}

public sealed class OpenAskRequest
{
    public required string Query { get; set; }
    public string? Group { get; set; }
    public string? RepositoryId { get; set; }
    public string[]? RepositoryIds { get; set; }
    public string? Owner { get; set; }
    public string? Repo { get; set; }
    public string? Branch { get; set; }
    public string? Language { get; set; }
    public string? ModelId { get; set; }
    public string? SystemPrompt { get; set; }
    public int? MaxSources { get; set; }
}

public sealed class OpenRepositoryGroupSubmitRequest
{
    public required string GroupName { get; set; }
    public string? Description { get; set; }
    public string? LanguageCode { get; set; }
    public bool? IsPublic { get; set; }
    public bool? GenerateSkill { get; set; }
    public string? AuthAccount { get; set; }
    public string? AuthPassword { get; set; }
    public List<OpenRepositoryGroupItemRequest> Repositories { get; set; } = [];
}

public sealed class OpenRepositoryGroupItemRequest
{
    public required string GitUrl { get; set; }
    public string? RepoName { get; set; }
    public string? Role { get; set; }
    public string? BranchName { get; set; }
    public string? Description { get; set; }
    public string? AuthAccount { get; set; }
    public string? AuthPassword { get; set; }
}

public sealed class OpenRepositorySubmitRequest
{
    public required string GitUrl { get; set; }
    public string? OrgName { get; set; }
    public string? RepoName { get; set; }
    public string? Description { get; set; }
    public string? BranchName { get; set; }
    public string? LanguageCode { get; set; }
    public bool? IsPublic { get; set; }
    public bool? GenerateSkill { get; set; }
    public string? AuthAccount { get; set; }
    public string? AuthPassword { get; set; }
}

public sealed class OpenRepositorySyncRequest
{
    public string? BranchName { get; set; }
    /// <summary>
    /// "incremental" (default) or "full"
    /// </summary>
    public string? Mode { get; set; }
}
