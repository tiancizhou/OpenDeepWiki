using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.AI;
using OpenDeepWiki.Agents;
using Xunit;

namespace OpenDeepWiki.Tests.Agents;

public class DeepSeekOpenAIChatClientTests
{
    [Fact]
    public async Task GetResponseAsync_AppliesThinkingBodyParamsByDefault()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse("""
            {
              "id":"chatcmpl-test",
              "model":"deepseek-v4-flash",
              "created":1700000000,
              "choices":[{"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],
              "usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3,"prompt_tokens_details":{"cached_tokens":1}}
            }
            """));
        var client = CreateClient(handler);

        var response = await client.GetResponseAsync([new ChatMessage(ChatRole.User, "ping")]);

        using var document = JsonDocument.Parse(handler.RequestBodies.Single());
        Assert.True(document.RootElement.GetProperty("enable_thinking").GetBoolean());
        Assert.Equal("pong", response.Text);
        Assert.Equal(3, response.Usage?.TotalTokenCount);
        Assert.Equal(1, response.Usage?.CachedInputTokenCount);
    }

    [Fact]
    public async Task GetResponseAsync_CanDisableThinkingFromChatOptions()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse("""
            {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}]}
            """));
        var client = CreateClient(handler);

        await client.GetResponseAsync(
            [new ChatMessage(ChatRole.User, "ping")],
            new ChatOptions
            {
                AdditionalProperties = new AdditionalPropertiesDictionary
                {
                    ["thinkingEnabled"] = false
                }
            });

        using var document = JsonDocument.Parse(handler.RequestBodies.Single());
        Assert.False(document.RootElement.GetProperty("enable_thinking").GetBoolean());
    }

    [Fact]
    public async Task GetResponseAsync_IncludesStablePromptCacheKey()
    {
        var firstHandler = new StubHttpMessageHandler(_ => JsonResponse("""
            {"id":"chatcmpl-test-1","model":"deepseek-v4-flash","choices":[{"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}]}
            """));
        var secondHandler = new StubHttpMessageHandler(_ => JsonResponse("""
            {"id":"chatcmpl-test-2","model":"deepseek-v4-flash","choices":[{"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}]}
            """));
        var firstClient = CreateClient(firstHandler);
        var secondClient = CreateClient(secondHandler);

        await firstClient.GetResponseAsync([new ChatMessage(ChatRole.User, "ping")]);
        await secondClient.GetResponseAsync([new ChatMessage(ChatRole.User, "ping")]);

        using var firstDocument = JsonDocument.Parse(firstHandler.RequestBodies.Single());
        using var secondDocument = JsonDocument.Parse(secondHandler.RequestBodies.Single());
        var firstKey = firstDocument.RootElement.GetProperty("prompt_cache_key").GetString();
        var secondKey = secondDocument.RootElement.GetProperty("prompt_cache_key").GetString();

        Assert.False(string.IsNullOrWhiteSpace(firstKey));
        Assert.Equal(firstKey, secondKey);
        Assert.Equal("opendeepwiki", firstKey);
    }

    [Fact]
    public async Task GetResponseAsync_UsesPromptCacheKeyFromRequestOptions()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse("""
            {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}]}
            """));
        var client = CreateClient(
            handler,
            new AiRequestOptions
            {
                SupportsThinking = true,
                PromptCacheKey = "odw:content:repo"
            });

        await client.GetResponseAsync([new ChatMessage(ChatRole.User, "ping")]);

        using var document = JsonDocument.Parse(handler.RequestBodies.Single());
        Assert.Equal("odw:content:repo", document.RootElement.GetProperty("prompt_cache_key").GetString());
    }

    [Fact]
    public async Task GetResponseAsync_ChatOptionsPromptCacheKeyOverridesRequestOptions()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse("""
            {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}]}
            """));
        var client = CreateClient(
            handler,
            new AiRequestOptions
            {
                SupportsThinking = true,
                PromptCacheKey = "request-key"
            });

        await client.GetResponseAsync(
            [new ChatMessage(ChatRole.User, "ping")],
            new ChatOptions
            {
                AdditionalProperties = new AdditionalPropertiesDictionary
                {
                    ["promptCacheKey"] = "chat-options-key"
                }
            });

        using var document = JsonDocument.Parse(handler.RequestBodies.Single());
        Assert.Equal("chat-options-key", document.RootElement.GetProperty("prompt_cache_key").GetString());
    }

    [Fact]
    public async Task GetResponseAsync_PrependsInstructionsAsSystemMessage()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse("""
            {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}]}
            """));
        var client = CreateClient(handler);

        await client.GetResponseAsync(
            [new ChatMessage(ChatRole.User, "ping")],
            new ChatOptions
            {
                Instructions = "You are a wiki assistant."
            });

        using var document = JsonDocument.Parse(handler.RequestBodies.Single());
        var messages = document.RootElement.GetProperty("messages").EnumerateArray().ToArray();
        Assert.Equal("system", messages[0].GetProperty("role").GetString());
        Assert.Equal("You are a wiki assistant.", messages[0].GetProperty("content").GetString());
        Assert.Equal("user", messages[1].GetProperty("role").GetString());
    }

    [Fact]
    public async Task GetStreamingResponseAsync_AcceptsDoneSentinelAndMapsUsage()
    {
        var handler = new StubHttpMessageHandler(_ => EventStreamResponse("""
            data: {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"delta":{"content":"hel"},"finish_reason":null}]}

            data: {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}

            data: DONE

            """));
        var client = CreateClient(handler);
        var updates = new List<ChatResponseUpdate>();

        await foreach (var update in client.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, "ping")]))
        {
            updates.Add(update);
        }

        Assert.Equal("hello", string.Concat(updates.Select(update => update.Text)));
        var usage = updates.SelectMany(update => update.Contents).OfType<UsageContent>().Single().Details;
        Assert.Equal(4, usage.TotalTokenCount);
    }

    [Fact]
    public async Task GetStreamingResponseAsync_AccumulatesToolCallDeltas()
    {
        var handler = new StubHttpMessageHandler(_ => EventStreamResponse("""
            data: {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\"path\":\""}}]},"finish_reason":null}]}

            data: {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"README.md\"}"}}]},"finish_reason":"tool_calls"}]}

            data: [DONE]

            """));
        var client = CreateClient(handler);
        var updates = new List<ChatResponseUpdate>();

        await foreach (var update in client.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, "read")]))
        {
            updates.Add(update);
        }

        var functionCall = updates
            .SelectMany(update => update.Contents)
            .OfType<FunctionCallContent>()
            .Single();
        Assert.Equal("call_1", functionCall.CallId);
        Assert.Equal("read_file", functionCall.Name);
        Assert.NotNull(functionCall.Arguments);
        var arguments = functionCall.Arguments!;
        Assert.True(arguments.TryGetValue("path", out var path));
        Assert.Equal("README.md", path);
    }

    [Fact]
    public async Task GetStreamingResponseAsync_RoundTripsReasoningContentWithToolCalls()
    {
        var requestIndex = 0;
        var handler = new StubHttpMessageHandler(_ => requestIndex++ == 0
            ? EventStreamResponse("""
                data: {"id":"chatcmpl-test","model":"deepseek-v4-pro","choices":[{"delta":{"reasoning_content":"think "},"finish_reason":null}]}

                data: {"id":"chatcmpl-test","model":"deepseek-v4-pro","choices":[{"delta":{"reasoning_content":"more"},"finish_reason":null}]}

                data: {"id":"chatcmpl-test","model":"deepseek-v4-pro","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"README.md\"}"}}]},"finish_reason":"tool_calls"}]}

                data: [DONE]

                """)
            : JsonResponse("""
                {"id":"chatcmpl-test-2","model":"deepseek-v4-pro","choices":[{"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}
                """));
        var client = CreateClient(handler);
        var updates = new List<ChatResponseUpdate>();

        await foreach (var update in client.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, "read")]))
        {
            updates.Add(update);
        }

        var toolCallUpdate = updates.Single(update =>
            update.Contents.OfType<FunctionCallContent>().Any());
        var streamedReasoning = string.Concat(updates
            .Where(update => !ReferenceEquals(update, toolCallUpdate))
            .SelectMany(update => update.Contents)
            .OfType<TextReasoningContent>()
            .Select(content => content.Text));
        Assert.Equal("think more", streamedReasoning);

        Assert.Equal("think more", string.Concat(toolCallUpdate.Contents
            .OfType<TextReasoningContent>()
            .Select(content => content.Text)));

        var conversation = new List<ChatMessage>
        {
            new(ChatRole.User, "read")
        };
        conversation.AddMessages(updates);
        conversation.Add(new ChatMessage(
            ChatRole.Tool,
            [new FunctionResultContent("call_1", "file contents")]));

        await client.GetResponseAsync(conversation);

        using var document = JsonDocument.Parse(handler.RequestBodies[1]);
        var messages = document.RootElement.GetProperty("messages").EnumerateArray().ToArray();
        var assistant = messages.Single(message =>
            message.GetProperty("role").GetString() == "assistant");
        Assert.Equal("think more", assistant.GetProperty("reasoning_content").GetString());
        Assert.True(assistant.TryGetProperty("tool_calls", out _));
    }

    [Fact]
    public async Task GetResponseAsync_RestoresReasoningContentFromFunctionCallProperties()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse("""
            {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}
            """));
        var client = CreateClient(handler);
        var functionCall = new FunctionCallContent(
            "call_1",
            "read_file",
            new Dictionary<string, object?>
            {
                ["path"] = "README.md"
            })
        {
            AdditionalProperties = new AdditionalPropertiesDictionary
            {
                ["reasoning_content"] = "need to inspect the file"
            }
        };

        await client.GetResponseAsync([
            new ChatMessage(ChatRole.User, "read"),
            new ChatMessage(ChatRole.Assistant, [functionCall]),
            new ChatMessage(ChatRole.Tool, [new FunctionResultContent("call_1", "file contents")])
        ]);

        using var document = JsonDocument.Parse(handler.RequestBodies.Single());
        var messages = document.RootElement.GetProperty("messages").EnumerateArray().ToArray();
        var assistant = messages.Single(message =>
            message.GetProperty("role").GetString() == "assistant");
        Assert.Equal("need to inspect the file", assistant.GetProperty("reasoning_content").GetString());
        Assert.True(assistant.TryGetProperty("tool_calls", out _));
    }

    [Fact]
    public async Task GetResponseAsync_RestoresReasoningContentFromCachedToolCallId()
    {
        var requestIndex = 0;
        var handler = new StubHttpMessageHandler(_ => requestIndex++ == 0
            ? EventStreamResponse("""
                data: {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"delta":{"reasoning_content":"need learning data"},"finish_reason":null}]}

                data: {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_learning","type":"function","function":{"name":"PlayEduLearningData","arguments":"{\"input\":\"overview\"}"}}]},"finish_reason":"tool_calls"}]}

                data: [DONE]

                """)
            : JsonResponse("""
                {"id":"chatcmpl-test-2","model":"deepseek-v4-flash","choices":[{"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}
                """));
        var client = CreateClient(handler);

        await foreach (var _ in client.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, "query learning data")]))
        {
        }

        var reconstructedFunctionCall = new FunctionCallContent(
            "call_learning",
            "PlayEduLearningData",
            new Dictionary<string, object?>
            {
                ["input"] = "overview"
            });

        await client.GetResponseAsync([
            new ChatMessage(ChatRole.User, "query learning data"),
            new ChatMessage(ChatRole.Assistant, [reconstructedFunctionCall]),
            new ChatMessage(ChatRole.Tool, [new FunctionResultContent("call_learning", "{\"ok\":true}")])
        ]);

        using var document = JsonDocument.Parse(handler.RequestBodies[1]);
        var messages = document.RootElement.GetProperty("messages").EnumerateArray().ToArray();
        var assistant = messages.Single(message =>
            message.GetProperty("role").GetString() == "assistant");
        Assert.Equal("need learning data", assistant.GetProperty("reasoning_content").GetString());
        Assert.True(assistant.TryGetProperty("tool_calls", out _));
    }

    [Fact]
    public async Task GetResponseAsync_DisablesThinkingWhenToolContinuationHasNoReasoningContent()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse("""
            {"id":"chatcmpl-test","model":"deepseek-v4-flash","choices":[{"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}
            """));
        var client = CreateClient(handler);

        await client.GetResponseAsync([
            new ChatMessage(ChatRole.User, "query learning data"),
            new ChatMessage(ChatRole.Assistant, [
                new FunctionCallContent(
                    "call_missing_reasoning",
                    "PlayEduLearningData",
                    new Dictionary<string, object?>
                    {
                        ["input"] = "overview"
                    })
            ]),
            new ChatMessage(ChatRole.Tool, [new FunctionResultContent("call_missing_reasoning", "{\"ok\":true}")])
        ]);

        using var document = JsonDocument.Parse(handler.RequestBodies.Single());
        Assert.False(document.RootElement.GetProperty("enable_thinking").GetBoolean());
        var messages = document.RootElement.GetProperty("messages").EnumerateArray().ToArray();
        var assistant = messages.Single(message =>
            message.GetProperty("role").GetString() == "assistant");
        Assert.False(assistant.TryGetProperty("reasoning_content", out _));
        Assert.True(assistant.TryGetProperty("tool_calls", out _));
    }

    private static DeepSeekOpenAIChatClient CreateClient(
        StubHttpMessageHandler handler,
        AiRequestOptions? options = null)
    {
        options ??= new AiRequestOptions
        {
            SupportsThinking = true,
            ThinkingConfigJson = """
                {
                  "bodyParams":{"enable_thinking":true},
                  "disabledBodyParams":{"enable_thinking":false}
                }
                """
        };

        return new DeepSeekOpenAIChatClient(
            "deepseek-v4-flash",
            "https://api.deepseek.com/v1",
            "test-key",
            new HttpClient(handler),
            options,
            disposeHttpClient: true);
    }

    private static HttpResponseMessage JsonResponse(string content)
    {
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(content, Encoding.UTF8, "application/json")
        };
    }

    private static HttpResponseMessage EventStreamResponse(string content)
    {
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(content, Encoding.UTF8, "text/event-stream")
        };
    }

    private sealed class StubHttpMessageHandler(
        Func<HttpRequestMessage, HttpResponseMessage> handle)
        : HttpMessageHandler
    {
        public List<string> RequestBodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestBodies.Add(request.Content == null
                ? string.Empty
                : await request.Content.ReadAsStringAsync(cancellationToken));
            return handle(request);
        }
    }
}
