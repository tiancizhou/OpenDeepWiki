using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using OpenDeepWiki.EFCore;
using OpenDeepWiki.Entities;
using OpenDeepWiki.Services.Admin;
using Xunit;

namespace OpenDeepWiki.Tests.Services.Admin;

public class AdminToolsServiceTests
{
    [Fact]
    public async Task DiscoverAiModelsAsync_ParsesExplicitAndAliasPrices()
    {
        await using var context = CreateContext();
        var provider = CreateProvider();
        context.AiProviderConfigs.Add(provider);
        await context.SaveChangesAsync();

        using var handler = new StubHttpMessageHandler("""
            {
              "data": [
                {
                  "id": "model-a",
                  "name": "Model A",
                  "inputPrice": 1.2,
                  "outputPrice": 3.4,
                  "cacheHitPrice": 0.5,
                  "cacheCreationPrice": 0.25
                },
                {
                  "id": "model-b",
                  "promptPrice": 2.5,
                  "completionPrice": 5.5
                }
              ]
            }
            """);
        var service = CreateService(context, handler);

        var models = await service.DiscoverAiModelsAsync(provider.Id);

        var explicitPriceModel = Assert.Single(models, model => model.ModelId == "model-a");
        Assert.Equal("Model A", explicitPriceModel.Name);
        Assert.Equal(1.2m, explicitPriceModel.InputTokenPrice);
        Assert.Equal(3.4m, explicitPriceModel.OutputTokenPrice);
        Assert.Equal(0.5m, explicitPriceModel.CacheHitTokenPrice);
        Assert.Equal(0.25m, explicitPriceModel.CacheCreationTokenPrice);

        var aliasPriceModel = Assert.Single(models, model => model.ModelId == "model-b");
        Assert.Equal(2.5m, aliasPriceModel.InputTokenPrice);
        Assert.Equal(5.5m, aliasPriceModel.OutputTokenPrice);
        Assert.Null(aliasPriceModel.CacheHitTokenPrice);
        Assert.Null(aliasPriceModel.CacheCreationTokenPrice);
    }

    [Fact]
    public async Task DiscoverAiModelsAsync_SupportsStringListsAndMissingPrices()
    {
        await using var context = CreateContext();
        var provider = CreateProvider();
        context.AiProviderConfigs.Add(provider);
        await context.SaveChangesAsync();

        using var handler = new StubHttpMessageHandler("""
            [
              "model-a",
              { "id": "model-b" },
              "model-a"
            ]
            """);
        var service = CreateService(context, handler);

        var models = await service.DiscoverAiModelsAsync(provider.Id);

        Assert.Equal(2, models.Count);
        Assert.All(models, model =>
        {
            Assert.Null(model.InputTokenPrice);
            Assert.Null(model.OutputTokenPrice);
            Assert.Null(model.CacheHitTokenPrice);
            Assert.Null(model.CacheCreationTokenPrice);
        });
    }

    [Fact]
    public async Task DiscoverAiModelsAsync_WhenEndpointReturnsHtml_ThrowsReadableError()
    {
        await using var context = CreateContext();
        var provider = CreateProvider();
        context.AiProviderConfigs.Add(provider);
        await context.SaveChangesAsync();

        using var handler = new StubHttpMessageHandler("""
            <html>
            <body>404 Not Found</body>
            </html>
            """);
        var service = CreateService(context, handler);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.DiscoverAiModelsAsync(provider.Id));

        Assert.Contains("non-JSON response", ex.Message);
        Assert.Contains("/models", ex.Message);
    }

    private static AdminToolsService CreateService(IContext context, HttpMessageHandler handler)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Skills:BasePath"] = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"))
            })
            .Build();

        return new AdminToolsService(
            context,
            NullLogger<AdminToolsService>.Instance,
            configuration,
            new StubHttpClientFactory(handler));
    }

    private static TestDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<TestDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        var context = new TestDbContext(options);
        context.Database.EnsureCreated();
        return context;
    }

    private static AiProviderConfig CreateProvider()
    {
        return new AiProviderConfig
        {
            Id = Guid.NewGuid().ToString(),
            Name = "test-provider",
            DisplayName = "Test Provider",
            ProviderType = "OpenAI",
            BaseUrl = "https://provider.example/v1",
            SupportsModelDiscovery = true,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
    }

    private sealed class TestDbContext(DbContextOptions<TestDbContext> options)
        : MasterDbContext(options);

    private sealed class StubHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class StubHttpMessageHandler(string responseBody) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(responseBody)
            });
        }
    }
}
