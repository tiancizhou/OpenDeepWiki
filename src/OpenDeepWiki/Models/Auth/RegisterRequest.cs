using System.ComponentModel.DataAnnotations;

namespace OpenDeepWiki.Models.Auth;

/// <summary>
/// 注册请求
/// </summary>
public class RegisterRequest
{
    /// <summary>
    /// 账号/用户名
    /// </summary>
    [Required(ErrorMessage = "账号不能为空")]
    [StringLength(50, MinimumLength = 2, ErrorMessage = "账号长度必须在2-50之间")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 邮箱（可选，未传时默认生成内部邮箱标识）
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 密码
    /// </summary>
    [Required(ErrorMessage = "密码不能为空")]
    [StringLength(100, MinimumLength = 6, ErrorMessage = "密码长度必须在6-100之间")]
    public string Password { get; set; } = string.Empty;

    /// <summary>
    /// 确认密码
    /// </summary>
    [Required(ErrorMessage = "确认密码不能为空")]
    [Compare("Password", ErrorMessage = "两次密码输入不一致")]
    public string ConfirmPassword { get; set; } = string.Empty;
}
