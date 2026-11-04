using System.ComponentModel.DataAnnotations;

namespace OpenDeepWiki.Entities;

/// <summary>
/// 用户创建的对话应用实体
/// 包含AppId、AppSecret和配置信息，用于嵌入到外部网站、ZtWork 连接器及 MCP 服务
/// </summary>
public class ChatApp : AggregateRoot<Guid>
{
    /// <summary>
    /// 所属用户ID
    /// </summary>
    [Required]
    [StringLength(100)]
    public string UserId { get; set; } = string.Empty;

    /// <summary>
    /// 应用名称
    /// </summary>
    [Required]
    [StringLength(100)]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 应用描述
    /// </summary>
    [StringLength(500)]
    public string? Description { get; set; }

    /// <summary>
    /// 应用图标URL
    /// </summary>
    [StringLength(500)]
    public string? IconUrl { get; set; }

    /// <summary>
    /// 公开的应用ID（用于嵌入脚本、ZtWork 项目ID、MCP 路由）
    /// </summary>
    [Required]
    [StringLength(64)]
    public string AppId { get; set; } = string.Empty;

    /// <summary>
    /// 服务端验证密钥
    /// </summary>
    [Required]
    [StringLength(128)]
    public string AppSecret { get; set; } = string.Empty;

    /// <summary>
    /// 是否启用域名校验
    /// </summary>
    public bool EnableDomainValidation { get; set; } = false;

    /// <summary>
    /// 允许的域名列表（JSON数组）
    /// </summary>
    [StringLength(2000)]
    public string? AllowedDomains { get; set; }

    /// <summary>
    /// AI模型提供商类型（OpenAI、OpenAIResponses、Anthropic）
    /// </summary>
    [Required]
    [StringLength(50)]
    public string ProviderType { get; set; } = "OpenAI";

    /// <summary>
    /// 关联的 AI 提供商配置 ID
    /// </summary>
    [StringLength(100)]
    public string? AiProviderId { get; set; }

    /// <summary>
    /// API密钥
    /// </summary>
    [StringLength(500)]
    public string? ApiKey { get; set; }

    /// <summary>
    /// API基础URL
    /// </summary>
    [StringLength(500)]
    public string? BaseUrl { get; set; }

    /// <summary>
    /// 可用模型列表（JSON数组）
    /// </summary>
    [StringLength(1000)]
    public string? AvailableModels { get; set; }

    /// <summary>
    /// 默认模型
    /// </summary>
    [StringLength(100)]
    public string? DefaultModel { get; set; }

    /// <summary>
    /// 每分钟请求限制
    /// </summary>
    public int? RateLimitPerMinute { get; set; }

    /// <summary>
    /// 是否激活
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// 业务分组名称（供 ZtWork 连接器按分组折叠展示，如“采购供应”、“制造执行”）
    /// </summary>
    [StringLength(100)]
    public string? GroupName { get; set; }

    /// <summary>
    /// 绑定的知识库代码仓库 ID 列表（JSON 数组，支持前后端多仓库联合挂载）
    /// </summary>
    [StringLength(4000)]
    public string? RepositoryIds { get; set; }

    /// <summary>
    /// 智能体专属系统提示词（System Prompt）
    /// </summary>
    [StringLength(4000)]
    public string? SystemPrompt { get; set; }

    /// <summary>
    /// 是否全员可见（ZtWork 连接器及内部成员默认可访问）
    /// </summary>
    public bool IsPublic { get; set; } = true;

    /// <summary>
    /// 允许访问的飞书员工工号白名单（逗号分隔，如 "64308,zt64003"）
    /// </summary>
    [StringLength(2000)]
    public string? AllowedEmployeeNos { get; set; }
}
