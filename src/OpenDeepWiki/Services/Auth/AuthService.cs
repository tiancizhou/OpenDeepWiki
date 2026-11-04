using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Entities;
using OpenDeepWiki.Models.Auth;

namespace OpenDeepWiki.Services.Auth;

/// <summary>
/// 认证服务实现（支持账号/用户名或邮箱登录）
/// </summary>
public class AuthService : IAuthService
{
    private readonly IContext _context;
    private readonly IJwtService _jwtService;
    private readonly JwtOptions _jwtOptions;

    public AuthService(IContext context, IJwtService jwtService, IOptions<JwtOptions> jwtOptions)
    {
        _context = context;
        _jwtService = jwtService;
        _jwtOptions = jwtOptions.Value;
    }

    public async Task<LoginResponse> LoginAsync(LoginRequest request)
    {
        var account = (!string.IsNullOrWhiteSpace(request.Account) ? request.Account : request.Email)?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(account))
        {
            throw new Exception("请输入账号或用户名");
        }

        var accountLower = account.ToLowerInvariant();
        var user = await _context.Users
            .FirstOrDefaultAsync(u =>
                !u.IsDeleted &&
                (u.Name.ToLower() == accountLower || u.Email.ToLower() == accountLower));

        if (user == null)
        {
            throw new Exception("账号或密码错误");
        }

        // 验证密码
        if (!VerifyPassword(request.Password, user.Password))
        {
            throw new Exception("账号或密码错误");
        }

        if (user.Status != 1)
        {
            throw new Exception("账号已被禁用或待验证");
        }

        // 更新最后登录时间
        user.LastLoginAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        // 获取用户角色
        var roles = await GetUserRolesAsync(user.Id);

        // 生成JWT令牌
        var token = _jwtService.GenerateToken(user, roles);

        return new LoginResponse
        {
            AccessToken = token,
            ExpiresIn = _jwtOptions.ExpirationMinutes * 60,
            User = new UserInfo
            {
                Id = user.Id,
                Name = user.Name,
                Email = user.Email,
                Avatar = user.Avatar ?? $"https://api.dicebear.com/7.x/notionists/svg?seed={Uri.EscapeDataString(user.Name)}",
                Roles = roles
            }
        };
    }

    public async Task<LoginResponse> RegisterAsync(RegisterRequest request)
    {
        var userName = request.Name.Trim();
        var email = string.IsNullOrWhiteSpace(request.Email)
            ? $"{userName}@internal.local"
            : request.Email.Trim();

        var userNameLower = userName.ToLowerInvariant();
        var emailLower = email.ToLowerInvariant();

        // 检查账号或邮箱是否已存在
        var existingUser = await _context.Users
            .FirstOrDefaultAsync(u =>
                !u.IsDeleted &&
                (u.Name.ToLower() == userNameLower || u.Email.ToLower() == emailLower));

        if (existingUser != null)
        {
            throw new InvalidOperationException("该账号已被注册");
        }

        // 创建新用户
        var user = new User
        {
            Id = Guid.NewGuid().ToString(),
            Name = userName,
            Email = email,
            Password = HashPassword(request.Password),
            Status = 1,
            CreatedAt = DateTime.UtcNow
        };

        _context.Users.Add(user);

        // 分配默认角色（User）
        var defaultRole = await _context.Roles
            .FirstOrDefaultAsync(r => r.Name == "User" && !r.IsDeleted);

        if (defaultRole != null)
        {
            var userRole = new UserRole
            {
                Id = Guid.NewGuid().ToString(),
                UserId = user.Id,
                RoleId = defaultRole.Id,
                CreatedAt = DateTime.UtcNow
            };
            _context.UserRoles.Add(userRole);
        }

        await _context.SaveChangesAsync();

        // 生成JWT令牌
        var roles = await GetUserRolesAsync(user.Id);
        var token = _jwtService.GenerateToken(user, roles);

        return new LoginResponse
        {
            AccessToken = token,
            ExpiresIn = _jwtOptions.ExpirationMinutes * 60,
            User = new UserInfo
            {
                Id = user.Id,
                Name = user.Name,
                Email = user.Email,
                Avatar = user.Avatar ?? $"https://api.dicebear.com/7.x/notionists/svg?seed={Uri.EscapeDataString(user.Name)}",
                Roles = roles
            }
        };
    }

    public async Task<UserInfo?> GetUserInfoAsync(string userId)
    {
        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.Id == userId && !u.IsDeleted);

        if (user == null)
        {
            return null;
        }

        var roles = await GetUserRolesAsync(userId);

        return new UserInfo
        {
            Id = user.Id,
            Name = user.Name,
            Email = user.Email,
            Avatar = user.Avatar ?? $"https://api.dicebear.com/7.x/notionists/svg?seed={Uri.EscapeDataString(user.Name)}",
            Roles = roles
        };
    }

    private async Task<List<string>> GetUserRolesAsync(string userId)
    {
        return await _context.UserRoles
            .Where(ur => ur.UserId == userId && !ur.IsDeleted)
            .Join(_context.Roles, ur => ur.RoleId, r => r.Id, (ur, r) => r.Name)
            .ToListAsync();
    }

    private static string HashPassword(string password)
    {
        // 使用BCrypt进行密码哈希
        return BCrypt.Net.BCrypt.HashPassword(password);
    }

    private static bool VerifyPassword(string password, string? hashedPassword)
    {
        if (string.IsNullOrEmpty(hashedPassword))
        {
            return false;
        }

        try
        {
            return BCrypt.Net.BCrypt.Verify(password, hashedPassword);
        }
        catch
        {
            return false;
        }
    }
}
