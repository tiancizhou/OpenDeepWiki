using System.ComponentModel.DataAnnotations;

namespace OpenDeepWiki.Entities;

/// <summary>
/// Chat application access grant for a specific user.
/// </summary>
public class ChatAppUserAccess : AggregateRoot<Guid>
{
    /// <summary>
    /// Chat application primary key.
    /// </summary>
    [Required]
    public Guid ChatAppId { get; set; }

    /// <summary>
    /// User id that can access the chat application.
    /// </summary>
    [Required]
    [StringLength(100)]
    public string UserId { get; set; } = string.Empty;
}
