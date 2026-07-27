using Microsoft.Extensions.AI;

namespace OpenDeepWiki.Services.Chat;

internal static class ChatImageData
{
    private const int MaxImageBytes = 10 * 1024 * 1024;
    private static readonly HashSet<string> SupportedMediaTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp"
    };

    public static DataContent Create(string image)
    {
        if (string.IsNullOrWhiteSpace(image))
        {
            throw new FormatException("图片内容不能为空");
        }

        var mediaType = "image/png";
        var base64 = image.Trim();
        if (base64.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var separatorIndex = base64.IndexOf(',');
            if (separatorIndex <= 5)
            {
                throw new FormatException("图片 data URL 格式无效");
            }

            var metadata = base64[5..separatorIndex];
            if (!metadata.EndsWith(";base64", StringComparison.OrdinalIgnoreCase))
            {
                throw new FormatException("图片必须使用 base64 编码");
            }

            mediaType = metadata[..^7];
            base64 = base64[(separatorIndex + 1)..];
        }

        if (!SupportedMediaTypes.Contains(mediaType))
        {
            throw new FormatException("仅支持 PNG、JPG、GIF 和 WebP 图片");
        }

        byte[] imageBytes;
        try
        {
            imageBytes = Convert.FromBase64String(base64);
        }
        catch (FormatException ex)
        {
            throw new FormatException("图片 Base64 数据无效", ex);
        }

        if (imageBytes.Length == 0 || imageBytes.Length > MaxImageBytes)
        {
            throw new FormatException("图片大小必须在 10MB 以内");
        }

        return new DataContent(imageBytes, mediaType);
    }
}
