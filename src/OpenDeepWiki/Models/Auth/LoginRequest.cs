using System.ComponentModel.DataAnnotations;

namespace OpenDeepWiki.Models.Auth;

/// <summary>
/// 登录请求（支持账号/用户名或邮箱登录）
/// </summary>
public class LoginRequest
{
    /// <summary>
    /// 账号（用户名或邮箱）
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 账号（兼容字段）
    /// </summary>
    public string? Account { get; set; }

    /// <summary>
    /// 密码
    /// </summary>
    [Required(ErrorMessage = "密码不能为空")]
    [StringLength(100, MinimumLength = 6, ErrorMessage = "密码长度必须在6-100之间")]
    public string Password { get; set; } = string.Empty;
}
