using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.AI;
using OpenDeepWiki.Entities;
using OpenDeepWiki.Services.Chat;
using OpenDeepWiki.Tests.Chat.Sessions;
using Xunit;

namespace OpenDeepWiki.Tests.Services.Chat;

public class McpToolConverterTests
{
    [Fact]
    public async Task ConvertMcpConfigsToToolsAsync_UsesMcpJsonRpcToolsListAndToolsCall()
    {
        var options = new DbContextOptionsBuilder<TestDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        using var context = new TestDbContext(options);
        context.Database.EnsureCreated();
        context.McpConfigs.Add(new McpConfig
        {
            Id = "mcp-1",
            Name = "PlayEdu",
            Description = "Learning data",
            ServerUrl = "https://example.test/mcp/learning",
            IsActive = true
        });
        await context.SaveChangesAsync();

        var handler = new StubHttpMessageHandler(request =>
        {
            using var document = JsonDocument.Parse(request.Body);
            var method = document.RootElement.GetProperty("method").GetString();
            return method switch
            {
                "tools/list" => JsonResponse("""
                    {
                      "jsonrpc": "2.0",
                      "id": "1",
                      "result": {
                        "tools": [
                          {
                            "name": "get_my_learning_overview",
                            "description": "查询当前登录学员的学习总览",
                            "inputSchema": {
                              "type": "object",
                              "properties": {},
                              "additionalProperties": false
                            }
                          }
                        ]
                      }
                    }
                    """),
                "tools/call" => JsonResponse("""
                    {
                      "jsonrpc": "2.0",
                      "id": "2",
                      "result": {
                        "content": [
                          {
                            "type": "text",
                            "text": "{\"totalStudySeconds\":120}"
                          }
                        ]
                      }
                    }
                    """),
                _ => JsonResponse("""{"jsonrpc":"2.0","id":"x","error":{"message":"unexpected method"}}""")
            };
        });
        var converter = new McpToolConverter(
            context,
            new StubHttpClientFactory(handler),
            NullLogger<McpToolConverter>.Instance);

        var tools = await converter.ConvertMcpConfigsToToolsAsync(
            ["mcp-1"],
            "student-token");

        var tool = Assert.Single(tools);
        var function = Assert.IsAssignableFrom<AIFunction>(tool);
        Assert.Equal("get_my_learning_overview", function.Name);

        var result = await function.InvokeAsync(
            new AIFunctionArguments
            {
                ["arguments"] = new Dictionary<string, object?>()
            });

        Assert.Contains("totalStudySeconds", result?.ToString());
        Assert.Equal(2, handler.Requests.Count);

        using var listRequest = JsonDocument.Parse(handler.Requests[0].Body);
        Assert.Equal("tools/list", listRequest.RootElement.GetProperty("method").GetString());
        Assert.Equal("Bearer", handler.Requests[0].AuthorizationScheme);
        Assert.Equal("student-token", handler.Requests[0].AuthorizationParameter);

        using var callRequest = JsonDocument.Parse(handler.Requests[1].Body);
        Assert.Equal("tools/call", callRequest.RootElement.GetProperty("method").GetString());
        Assert.Equal("get_my_learning_overview",
            callRequest.RootElement.GetProperty("params").GetProperty("name").GetString());
    }

    private static HttpResponseMessage JsonResponse(string json)
    {
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
    }

    private sealed class StubHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name)
        {
            return new HttpClient(handler, disposeHandler: false);
        }
    }

    private sealed class StubHttpMessageHandler(
        Func<CapturedRequest, HttpResponseMessage> handle)
        : HttpMessageHandler
    {
        public List<CapturedRequest> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var captured = new CapturedRequest(
                request.RequestUri?.ToString() ?? string.Empty,
                request.Headers.Authorization?.Scheme,
                request.Headers.Authorization?.Parameter,
                request.Content == null
                    ? string.Empty
                    : await request.Content.ReadAsStringAsync(cancellationToken));
            Requests.Add(captured);
            return handle(captured);
        }
    }

    private sealed record CapturedRequest(
        string Url,
        string? AuthorizationScheme,
        string? AuthorizationParameter,
        string Body);
}
