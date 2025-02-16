package com.example;

import com.theokanning.openai.service.OpenAiService;
import com.theokanning.openai.completion.chat.ChatCompletionRequest;
import com.theokanning.openai.completion.chat.ChatCompletionResult;
import com.theokanning.openai.completion.chat.ChatMessage;

import io.socket.client.IO;
import io.socket.client.Socket;
import io.socket.emitter.Emitter;

import java.net.URISyntaxException;
import java.util.Arrays;

public class ChatGPTMotorControl {
    // Updated IP to match your server's address
    private static final String NODE_SERVER_URL = "http://192.168.1.148:3001";
    private static final String OPENAI_API_KEY = "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"; // Replace with your OpenAI API key

    public static void main(String[] args) throws URISyntaxException {
        OpenAiService openAiService = new OpenAiService(OPENAI_API_KEY);

        Socket socket = IO.socket(NODE_SERVER_URL);

        // Listen for connection errors to help with debugging
        socket.on(Socket.EVENT_CONNECT_ERROR, new Emitter.Listener() {
            @Override
            public void call(Object... args) {
                System.err.println("Connection Error: " + Arrays.toString(args));
            }
        });

        socket.on(Socket.EVENT_CONNECT, args1 -> {
            System.out.println("Connected to Node.js server.");
            socket.emit("identify", "java"); // Identify as Java client
        });

        // Listen for text processing events from the server
        socket.on("processText", args1 -> {
            String receivedText = (String) args1[0];
            System.out.println("Received text from Node.js: " + receivedText);

            // Process with ChatGPT
            String response = processWithChatGPT(openAiService, receivedText);
            System.out.println("Response from ChatGPT: " + response);

            // Send the response back to the server
            socket.emit("chatgptResponse", response);
        });

        socket.connect();
    }

    private static String processWithChatGPT(OpenAiService service, String text) {
        ChatMessage systemMessage = new ChatMessage("system",
                "You are an assistant that converts text into motor commands. Respond with commands: 'move forward', 'move backward', 'turn left', 'turn right', or 'stop'.");
        ChatMessage userMessage = new ChatMessage("user", text);

        ChatCompletionRequest request = ChatCompletionRequest.builder()
                .model("gpt-3.5-turbo")
                .messages(Arrays.asList(systemMessage, userMessage))
                .maxTokens(10)
                .temperature(0.0)
                .build();

        ChatCompletionResult result = service.createChatCompletion(request);
        return result.getChoices().get(0).getMessage().getContent().trim();
    }
}


